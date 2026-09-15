"""TTS provider adapters.

An adapter rather than a hard-coded vendor, for a reason that is specific rather
than architectural good manners: the choice between providers has to be settled
by a native speaker listening to the same twenty clips from each, judging names,
business terms, dates, 敬語 and contrastive emphasis. That comparison is only
cheap if switching is a flag. It is also the kind of decision that gets revisited
— a provider that reads 御社 correctly today may not after its next model update,
and the pronunciation dictionary below is where such a fix goes.

Every adapter returns 16-bit PCM WAV at whatever rate it likes; `channel.py`
resamples. WAV rather than a compressed format because review happens on the
original and a delivery derivative is made afterwards, once.

No adapter is called at practice time, ever. This runs on a laptop, over a
bundle that has already passed every gate.
"""
from __future__ import annotations

import os
from typing import Protocol

from . import channel


class Provider(Protocol):
    """What a TTS backend has to do."""

    name: str

    def synthesize(self, text: str, voice: str, *, instructions: str = "") -> bytes:
        """Japanese text → 16-bit PCM WAV bytes."""
        ...


#: How each cast voice should be delivered. Sent to providers that accept a
#: direction; ignored by those that do not. These are performance notes, not
#: identities — the identity is the provider's voice id, chosen once during the
#: listening comparison and recorded in VOICE_IDS.
VOICE_DIRECTION: dict[str, str] = {
    "narrator_f": "Neutral, even, unhurried. Reading a situation aloud, not acting it. "
                  "No warmth and no drama — the narration is not what is being tested.",
    "staff_junior_m": "A junior employee. Polite, slightly careful, a little fast when nervous.",
    "staff_junior_f": "A junior employee. Polite and clear, deferential to seniors.",
    "staff_mid_m": "A mid-career employee. Businesslike, unhurried, comfortable with keigo.",
    "staff_mid_f": "A mid-career employee. Businesslike and warm, professional pace.",
    "manager_m": "A section manager. Calm, measured, used to being listened to.",
    "reception_f": "Front desk. Bright, very clear articulation, welcoming but formal.",
}

#: The pronunciation dictionary. Business Japanese is full of readings a TTS
#: model gets wrong in a way that would teach the wrong thing — a learner who
#: hears 代替 as だいがえ and repeats it in an interview has been actively
#: harmed by this app. Entries are applied as a text substitution before
#: synthesis, so they work with any provider.
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


class OpenAIProvider:
    """OpenAI's speech API.

    A candidate because it takes free-text delivery instructions, which is the
    only mechanism either candidate offers for "say this the way a receptionist
    would" without hand-tuning SSML per clip.
    """

    name = "openai"
    MODEL = "gpt-4o-mini-tts"

    #: Cast voice → the provider's voice id. Filled in once the listening
    #: comparison has been done; until then the adapter refuses rather than
    #: guessing, because a cast assigned by accident is one the whole library
    #: inherits.
    VOICE_IDS: dict[str, str] = {}

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")

    def synthesize(self, text: str, voice: str, *, instructions: str = "") -> bytes:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        provider_voice = self.VOICE_IDS.get(voice)
        if not provider_voice:
            raise RuntimeError(
                f"no OpenAI voice chosen for cast voice {voice!r}. Run the listening "
                "comparison first and record the choice in OpenAIProvider.VOICE_IDS — "
                "a cast assigned by accident is one the whole library inherits."
            )
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - depends on optional extra
            raise RuntimeError("pip install 'bjt[tts-openai]' to use this provider") from exc

        client = OpenAI(api_key=self.api_key)
        response = client.audio.speech.create(
            model=self.MODEL,
            voice=provider_voice,
            input=apply_pronunciation(text),
            instructions=instructions or VOICE_DIRECTION.get(voice, ""),
            response_format="wav",
        )
        return response.read()


class GoogleProvider:
    """Google Cloud Text-to-Speech.

    The other candidate, and the stronger one wherever exact control matters:
    SSML gives explicit pauses, and `<sub>` handles a reading without editing the
    text the learner sees. If the comparison turns on dates, numbers and
    acronyms, this is likely to win it.
    """

    name = "google"

    VOICE_IDS: dict[str, str] = {}

    def synthesize(self, text: str, voice: str, *, instructions: str = "") -> bytes:
        provider_voice = self.VOICE_IDS.get(voice)
        if not provider_voice:
            raise RuntimeError(
                f"no Google voice chosen for cast voice {voice!r}. Run the listening "
                "comparison first and record the choice in GoogleProvider.VOICE_IDS."
            )
        try:  # pragma: no cover - depends on optional extra
            from google.cloud import texttospeech
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("pip install 'bjt[tts-google]' to use this provider") from exc

        client = texttospeech.TextToSpeechClient()
        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(ssml=self.to_ssml(text)),
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
    "openai": OpenAIProvider,
    "google": GoogleProvider,
}


def get_provider(name: str) -> Provider:
    if name not in PROVIDERS:
        raise KeyError(f"unknown TTS provider {name!r}; available: {sorted(PROVIDERS)}")
    return PROVIDERS[name]()
