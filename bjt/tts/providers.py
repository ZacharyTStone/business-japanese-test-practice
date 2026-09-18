"""TTS provider adapters.

An adapter rather than a hard-coded vendor, for a reason that is specific rather
than architectural good manners: which provider sounds right is settled by a
native speaker listening to the same clips from each (`bjt audition`), judging
names, business terms, dates, 敬語 and contrastive emphasis. That comparison is
only cheap if switching is a flag. It is also the kind of decision that gets
revisited — a provider that reads 御社 correctly today may not after its next
model update, and the pronunciation dictionary below is where such a fix goes.

Three real adapters, all of them the current generation of "instructable"
speech models rather than the concatenative voices that made TTS sound like a
station announcement:

  openai   OpenAI's speech API. One API key — the same one the scene artwork
           already uses. Takes a free-text direction, so the voice can be told
           to sound like a receptionist rather than tuned per clip. **This is
           the library's voice**: the owner chose it (2026-09-18), and
           `DEFAULT` below is that decision.
  gemini   Google's Gemini speech model, over the Gemini API. One API key.
           Kept as a comparison for `bjt audition`; not what ships.
  google   Google Cloud Text-to-Speech with its studio-grade Japanese voices.
           Needs a Cloud project and application credentials rather than a
           key, so it is the heaviest to set up. Also a comparison only.

Every adapter returns 16-bit PCM WAV at whatever rate it likes; `channel.py`
resamples. WAV rather than a compressed format because review happens on the
original and a delivery derivative is made afterwards, once.

No adapter is called at practice time, ever. This runs on a laptop or in the
deploy workflow, over a bundle that has already passed every gate.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from typing import Protocol

from . import channel


class Provider(Protocol):
    """What a TTS backend has to do."""

    name: str

    def synthesize(self, text: str, voice: str, *, instructions: str = "") -> bytes:
        """Japanese text → 16-bit PCM WAV bytes."""
        ...


#: How every clip should sound, whoever is speaking. Sent, ahead of the role
#: note below, to providers that take a direction; it is the difference between
#: a voice that reads and a person who talks, and it is what "not robotic" means
#: in practice: native pitch accent, an office pace, and phrases that run
#: together the way speech does instead of a pause after every particle.
HOUSE_STYLE = (
    "Natural, native Japanese as spoken in a Tokyo office. Standard pitch accent. "
    "Ordinary business pace — do not slow down or over-enunciate for a learner; "
    "phrases flow together the way a person actually talks, with no pause after "
    "every particle. Keigo comes out fluently, as from someone who says it every "
    "day, never stiffly or as if reading a list. Plain, unaffected delivery: no "
    "theatrical acting, no smiling announcer voice, no foreign accent. Read the "
    "text exactly as written and say nothing else."
)

#: How each cast voice should be delivered, on top of the house style. These are
#: performance notes, not identities — the identity is the provider's voice id,
#: chosen once during the listening comparison and recorded in VOICE_IDS.
VOICE_DIRECTION: dict[str, str] = {
    "narrator_f": "The narrator, outside the scene: even, neutral, unhurried, setting up "
                  "a situation rather than acting it. No warmth and no drama — the "
                  "narration is not what is being tested.",
    "staff_junior_m": "A junior employee in his twenties. Polite and a little careful; "
                      "slightly quick when nervous.",
    "staff_junior_f": "A junior employee in her twenties. Polite, clear, deferential to "
                      "seniors without sounding meek.",
    "staff_mid_m": "A mid-career employee. Businesslike, unhurried, entirely at ease with "
                   "keigo — the voice of somebody who answers the phone all day.",
    "staff_mid_f": "A mid-career employee. Businesslike and warm, professional pace.",
    "manager_m": "A section manager. Calm and measured, used to being listened to; "
                 "never barks.",
    "reception_f": "Front desk. Bright, very clear articulation, welcoming but formal.",
}


def direction_for(voice: str) -> str:
    """The full delivery note for a cast voice: house style, then the role."""
    role = VOICE_DIRECTION.get(voice, "")
    return f"{HOUSE_STYLE}\n\n{role}".strip()


#: The pronunciation dictionary. Business Japanese is full of readings a TTS
#: model gets wrong in a way that would teach the wrong thing — a learner who
#: hears 代替 as だいがえ and repeats it in an interview has been actively
#: harmed by this app. Entries are applied as a text substitution before
#: synthesis, so they work with any provider. Kept short on purpose: kana in
#: place of kanji costs a modern model context it uses for accent, so only the
#: readings that are commonly got wrong belong here.
PRONUNCIATION: dict[str, str] = {
    "代替": "だいたい",
    "早急": "さっきゅう",
    "重複": "ちょうふく",
    "施行": "しこう",
    "貼付": "ちょうふ",
    "相殺": "そうさい",
    "続柄": "つづきがら",
    "出納": "すいとう",
    "定礎": "ていそ",
    "遵守": "じゅんしゅ",
    "他人事": "ひとごと",
    "一段落": "いちだんらく",
    "何卒": "なにとぞ",
    "御中": "おんちゅう",
}


def apply_pronunciation(text: str) -> str:
    """Substitute the readings we have decided on.

    Longest first, so 「一段落」 is not caught by a shorter entry midway through.
    """
    for term in sorted(PRONUNCIATION, key=len, reverse=True):
        text = text.replace(term, PRONUNCIATION[term])
    return text


class SilentProvider:
    """Valid, silent clips of a plausible length.

    Not a mock hidden in the test directory: it is how the whole media pipeline
    — planning, synthesis, channel treatment, duration measurement, the SQL that
    fills in audio_path — is exercised end to end with no API key, no vendor
    account and no network. What it cannot tell you is whether the Japanese
    sounds right, which is exactly the part a native speaker has to judge
    anyway.

    Files it produces are marked `silent/` in their path so a silent clip can
    never be mistaken for a real one, in storage or in a review.
    """

    name = "silent"

    #: Japanese speech runs at roughly this rate in business delivery. Only used
    #: to give the silence a believable length so layout and duration handling
    #: can be tested.
    CHARS_PER_SECOND = 6.5

    def synthesize(self, text: str, voice: str, *, instructions: str = "") -> bytes:
        seconds = max(0.6, len(text) / self.CHARS_PER_SECOND)
        return channel.silence(seconds)


def _cast(provider_label: str, voice_ids: dict[str, str], voice: str) -> str:
    """The provider's id for a cast voice, or a refusal that says why.

    A cast assigned by accident is one the whole library inherits: clip ids hash
    the cast voice, so a voice that quietly fell back to some default would be
    recorded once and shared by every item that uses that role.
    """
    provider_voice = voice_ids.get(voice)
    if not provider_voice:
        raise RuntimeError(
            f"no {provider_label} voice cast for {voice!r}. Add it to VOICE_IDS after "
            "listening to the candidates (`bjt audition`) — a cast assigned by "
            "accident is one the whole library inherits."
        )
    return provider_voice


class OpenAIProvider:
    """OpenAI's speech API.

    Takes a free-text delivery direction, which is the mechanism that lets one
    house style apply to every clip without hand-tuning SSML. The same key the
    scene artwork uses, so a project that draws pictures can speak for free.
    """

    name = "openai"
    MODEL = os.environ.get("BJT_OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
    URL = "https://api.openai.com/v1/audio/speech"

    #: Every voice the model offers, for `bjt audition --voices`: one line in
    #: each, so a role can be recast by ear if one sounds accented in Japanese.
    CANDIDATE_VOICES = ("alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
                        "onyx", "sage", "shimmer", "verse")

    #: Cast voice → the provider's voice id. Chosen by the voices' published
    #: character (register, age, warmth) so that `bjt synth` runs the day a key
    #: exists; `bjt audition` is how it gets checked by ear, and any change is
    #: made here, once, before the library is synthesised — a live clip is
    #: never re-made, so a recast after that is a library that sounds different
    #: from one item to the next.
    VOICE_IDS: dict[str, str] = {
        "narrator_f": "sage",
        "staff_junior_m": "verse",
        "staff_junior_f": "coral",
        "staff_mid_m": "ash",
        "staff_mid_f": "nova",
        "manager_m": "onyx",
        "reception_f": "shimmer",
    }

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")

    def synthesize(self, text: str, voice: str, *, instructions: str = "",
                   provider_voice: str | None = None) -> bytes:
        """`provider_voice` bypasses the cast — for the audition only, which
        asks every voice the model offers to say the same line."""
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        provider_voice = provider_voice or _cast("OpenAI", self.VOICE_IDS, voice)
        body = {
            "model": self.MODEL,
            "voice": provider_voice,
            "input": apply_pronunciation(text),
            "instructions": instructions or direction_for(voice),
            "response_format": "wav",
        }
        return _post(
            self.URL, body,
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
        )


class GeminiProvider:
    """Google's Gemini speech model, over the Gemini API.

    The lightest of the three to set up — one API key from AI Studio — and a
    model of the same family as the generator, which matters for the thing this
    app tests: it reads keigo as language rather than as a string of readings,
    so 伺います and 参ります come out as a person would say them, not as a
    dictionary would. Directions are natural language, prefixed to the line.

    The response is raw 16-bit PCM (24 kHz mono, per its MIME type) rather than
    a container, so it is wrapped into WAV here.
    """

    name = "gemini"
    MODEL = os.environ.get("BJT_GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")
    URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    #: Cast voice → prebuilt voice name. Chosen by the voices' published
    #: character; checked by ear with `bjt audition`.
    VOICE_IDS: dict[str, str] = {
        "narrator_f": "Erinome",       # clear
        "staff_junior_m": "Iapetus",   # clear, younger
        "staff_junior_f": "Leda",      # youthful
        "staff_mid_m": "Charon",       # informative, even
        "staff_mid_f": "Sulafat",      # warm
        "manager_m": "Alnilam",        # firm
        "reception_f": "Autonoe",      # bright
    }

    def __init__(self, api_key: str | None = None):
        self.api_key = (
            api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        )

    def synthesize(self, text: str, voice: str, *, instructions: str = "") -> bytes:
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        provider_voice = _cast("Gemini", self.VOICE_IDS, voice)
        prompt = self.prompt_for(apply_pronunciation(text), instructions or direction_for(voice))
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": provider_voice}}
                },
            },
        }
        raw = _post(
            self.URL.format(model=self.MODEL), body,
            {"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
        )
        return self.wav_from_response(raw)

    @staticmethod
    def prompt_for(text: str, direction: str) -> str:
        """The direction, then the line — the model speaks the line only."""
        return f"{direction}\n\nSay only this line, exactly as written:\n{text}"

    @staticmethod
    def wav_from_response(raw: bytes) -> bytes:
        try:
            payload = json.loads(raw)
            part = payload["candidates"][0]["content"]["parts"][0]["inlineData"]
            data = base64.b64decode(part["data"])
            mime = part.get("mimeType", "")
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("Gemini returned no audio: " + raw[:300].decode("utf-8", "replace")) from exc
        rate = 24000
        for field in mime.split(";"):
            field = field.strip()
            if field.startswith("rate="):
                rate = int(field[len("rate="):])
        if mime.startswith("audio/wav") or data[:4] == b"RIFF":
            return data
        return channel.wrap_pcm(data, rate)


class GoogleProvider:
    """Google Cloud Text-to-Speech.

    The candidate with the most explicit control and the most setup: a Cloud
    project, the API enabled, and application default credentials. Its newest
    Japanese voices are native studio recordings driven by a modern model,
    which is why it is worth the comparison. Those voices take plain text; the
    older ones take SSML, where `<sub>` handles a reading without editing the
    text the learner sees.
    """

    name = "google"

    #: Cast voice → Cloud voice name. The Chirp 3 HD voices for ja-JP.
    VOICE_IDS: dict[str, str] = {
        "narrator_f": "ja-JP-Chirp3-HD-Kore",
        "staff_junior_m": "ja-JP-Chirp3-HD-Puck",
        "staff_junior_f": "ja-JP-Chirp3-HD-Leda",
        "staff_mid_m": "ja-JP-Chirp3-HD-Charon",
        "staff_mid_f": "ja-JP-Chirp3-HD-Aoede",
        "manager_m": "ja-JP-Chirp3-HD-Orus",
        "reception_f": "ja-JP-Chirp3-HD-Zephyr",
    }

    def synthesize(self, text: str, voice: str, *, instructions: str = "") -> bytes:
        provider_voice = _cast("Google Cloud", self.VOICE_IDS, voice)
        try:  # pragma: no cover - depends on optional extra
            from google.cloud import texttospeech
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("pip install 'bjt-practice[tts-google]' to use this provider") from exc

        if "Chirp" in provider_voice:
            synthesis_input = texttospeech.SynthesisInput(text=apply_pronunciation(text))
        else:
            synthesis_input = texttospeech.SynthesisInput(ssml=self.to_ssml(text))
        client = texttospeech.TextToSpeechClient()
        response = client.synthesize_speech(
            input=synthesis_input,
            voice=texttospeech.VoiceSelectionParams(
                language_code="ja-JP", name=provider_voice
            ),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.LINEAR16,
                sample_rate_hertz=24000,
            ),
        )
        return response.audio_content

    @staticmethod
    def to_ssml(text: str) -> str:
        """Wrap the text, expressing the pronunciation dictionary as `<sub>`.

        Better than a plain substitution: the written form stays in the SSML, so
        a reviewer reading the request can see what was meant to be said.
        """
        from html import escape

        body = escape(text)
        for term in sorted(PRONUNCIATION, key=len, reverse=True):
            body = body.replace(
                escape(term), f'<sub alias="{PRONUNCIATION[term]}">{escape(term)}</sub>'
            )
        return f"<speak>{body}</speak>"


PROVIDERS: dict[str, type] = {
    "silent": SilentProvider,
    "gemini": GeminiProvider,
    "openai": OpenAIProvider,
    "google": GoogleProvider,
}

#: What each real provider needs in the environment before it can be used.
#: Any one of the names is enough.
CREDENTIALS: dict[str, tuple[str, ...]] = {
    "openai": ("OPENAI_API_KEY",),
    "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "google": ("GOOGLE_APPLICATION_CREDENTIALS",),
}

#: The library's voice. A decision, recorded in code rather than in anybody's
#: environment, because the cast is fixed for the life of the library and a
#: clip once live is never re-made: the provider must not follow whichever key
#: happens to be set on the machine running the job. The owner chose OpenAI
#: (2026-09-18).
DEFAULT = "openai"

#: An override, for trying another provider on a laptop. Not for the workflow.
PROVIDER_ENV = "BJT_TTS_PROVIDER"


def available() -> list[str]:
    """The real providers whose credentials are in the environment."""
    return [name for name, keys in CREDENTIALS.items()
            if any(os.environ.get(k) for k in keys)]


def default_provider() -> str:
    """What `--provider auto` means.

    `BJT_TTS_PROVIDER` when set, else the library's voice (`DEFAULT`) when its
    key is present, else `silent`, so the pipeline still runs end to end on a
    machine with no key. Another provider's key alone does not make it the
    voice — a job with only GEMINI_API_KEY set synthesises silence and says so,
    rather than quietly giving the library a second cast.
    """
    pinned = os.environ.get(PROVIDER_ENV, "").strip().lower()
    if pinned:
        return pinned
    return DEFAULT if DEFAULT in available() else "silent"


def get_provider(name: str) -> Provider:
    if name == "auto":
        name = default_provider()
    if name not in PROVIDERS:
        raise KeyError(f"unknown TTS provider {name!r}; available: {sorted(PROVIDERS)}")
    return PROVIDERS[name]()


def _post(url: str, body: dict, headers: dict[str, str]) -> bytes:
    """One JSON request, the response body as bytes, and an error that names
    the status and the first few hundred characters of what came back — the
    part of a vendor error that actually says what was wrong."""
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), method="POST", headers=headers
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"POST {url} → HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"POST {url} failed: {exc.reason}") from exc
