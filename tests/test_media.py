"""The media pipeline: channel treatment, the synthesis job, and the scene bank.

All of it runs offline. The `silent` provider is not a mock hidden in a test
directory — it is how the whole pipeline is exercised without a vendor account,
and it is exercised here the same way it is in production.
"""
import io
import json
import wave

import pytest

from bjt import batch, config, fixtures, scenes
from bjt.tts import channel, plan, providers, synth


def _tone(seconds=0.5, rate=24000, amplitude=12000):
    """A signal with content at both ends of the band, so a filter that does
    nothing is distinguishable from one that works."""
    import math

    n = int(seconds * rate)
    samples = [
        int(amplitude * (math.sin(2 * math.pi * 120 * i / rate)
                         + math.sin(2 * math.pi * 6000 * i / rate)) / 2)
        for i in range(n)
    ]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(int(s).to_bytes(2, "little", signed=True) for s in samples))
    return buf.getvalue()


# ----- channel treatment --------------------------------------------------

def test_phone_treatment_resamples_to_the_telephone_rate():
    out = channel.apply_channel(_tone(), "phone")
    with wave.open(io.BytesIO(out), "rb") as w:
        assert w.getframerate() == plan.CHANNEL_PROFILES["phone"]["sample_rate"]


def test_the_band_limit_removes_what_a_telephone_removes():
    """The point of the phone profile is that business phone Japanese is harder
    to hear. A profile that resamples and leaves the band alone is decoration.

    The filters are measured directly rather than through `apply_channel`,
    because that normalises afterwards — it deliberately brings every clip back
    to one level, which would hide exactly the attenuation being asserted.
    """
    low, high = plan.CHANNEL_PROFILES["phone"]["band"]

    # Above the band: the sibilance that separates いたします from いただきます.
    above = _samples(6000, rate=24000)
    assert _rms(channel._one_pole_low_pass(above, 24000, high)) < _rms(above) * 0.6

    # Below it: rumble a telephone line never carries.
    below = _samples(80, rate=24000)
    assert _rms(channel._one_pole_high_pass(below, 24000, low)) < _rms(below) * 0.6

    # Inside it: speech must survive.
    inside = _samples(1000, rate=24000)
    kept = channel._one_pole_high_pass(
        channel._one_pole_low_pass(inside, 24000, high), 24000, low
    )
    assert _rms(kept) > _rms(inside) * 0.7


def test_in_person_keeps_the_full_band():
    out = channel.apply_channel(_tone(), "in_person")
    with wave.open(io.BytesIO(out), "rb") as w:
        assert w.getframerate() == 24000


def test_an_unknown_channel_passes_through_rather_than_raising():
    """`written` reaching here means something upstream planned a clip for a
    reading item. The right response is a clean recording plus a failing test
    elsewhere, not a crash in the middle of two hundred files."""
    raw = _tone()
    assert channel.apply_channel(raw, "written") == raw


def test_clips_come_out_at_a_consistent_level():
    """A learner must not be able to hear which option was recorded differently."""
    quiet = channel.apply_channel(_tone(amplitude=800), "in_person")
    loud = channel.apply_channel(_tone(amplitude=20000), "in_person")
    a, _, _ = channel._decode(quiet)
    b, _, _ = channel._decode(loud)
    assert abs(max(map(abs, a)) - max(map(abs, b))) < 500


def test_duration_is_measured_not_guessed():
    assert 450 <= channel.duration_ms(_tone(seconds=0.5)) <= 550


def _samples(hz, rate=24000, seconds=0.3, amplitude=12000):
    import math

    n = int(seconds * rate)
    return [int(amplitude * math.sin(2 * math.pi * hz * i / rate)) for i in range(n)]


def _rms(samples):
    return (sum(s * s for s in samples) / max(1, len(samples))) ** 0.5


# ----- the synthesis job --------------------------------------------------

@pytest.fixture
def bundle():
    return batch.build_bundle(
        "hatsugen_choukai", "J2", [fixtures.FIXTURES["hatsugen_choukai"]], "test"
    )


def test_clips_already_live_are_neither_made_nor_pointed_at_again(bundle, tmp_path):
    """On a fresh runner media/ is empty; the database says what exists, and a
    clip on that list is left exactly as the learner first heard it."""
    have_file = tmp_path / "have.txt"
    ids = [c["clip_id"] for c in bundle["audio_manifest"]]
    have_file.write_text(f"# from psql\n{ids[0]}\n\n{ids[1]}\n", encoding="utf-8")
    have = synth.read_have(have_file)
    assert have == {ids[0], ids[1]}

    report = synth.synthesise_bundle(bundle, out_dir=tmp_path, have=have)
    assert sorted(report.live) == sorted(have)
    assert len(report.written) == len(ids) - 2
    assert not (tmp_path / "audio" / synth.storage_path(ids[0], "silent")).exists()
    sql = synth.to_sql(report)
    assert ids[0] not in sql and ids[2] in sql
    assert "already live" in report.summary()


def test_a_bundle_that_is_entirely_live_has_nothing_to_apply(bundle, tmp_path):
    have = {c["clip_id"] for c in bundle["audio_manifest"]}
    report = synth.synthesise_bundle(bundle, out_dir=tmp_path, have=have)
    assert not report.clips
    assert "Nothing to apply" in synth.to_sql(report)


def test_uploading_sends_every_clip_and_a_failure_keeps_it_out_of_the_sql(bundle, tmp_path):
    from bjt import scene_art

    report = synth.synthesise_bundle(bundle, out_dir=tmp_path)
    bad = report.written[0].path
    sent = []

    class FakeBucket:
        name = "audio"
        configured = True

        def upload(self, path, data, content_type):
            assert content_type == "audio/wav"
            if path == bad:
                raise RuntimeError("413 too large")
            sent.append(path)

    up = synth.upload_clips(report, FakeBucket(), tmp_path)  # type: ignore[arg-type]
    assert len(sent) == len(report.clips) - 1
    assert up.failed == [(bad, "413 too large")]
    assert isinstance(up, scene_art.UploadResult)

    report.drop({c.clip_id for c in report.clips if c.path == bad})
    assert bad not in synth.to_sql(report)
    assert all(c.path in synth.to_sql(report) for c in report.clips)


def test_synthesis_produces_a_clip_per_manifest_entry(bundle, tmp_path):
    report = synth.synthesise_bundle(bundle, out_dir=tmp_path)
    assert len(report.written) == len(bundle["audio_manifest"])
    assert not report.failed
    for clip in report.written:
        assert (tmp_path / "audio" / clip.path).exists()
        assert clip.duration_ms > 0


def test_a_second_run_reuses_every_clip(bundle, tmp_path):
    """Clip ids are content hashes, so re-running a batch after fixing one item
    must re-synthesise that item and nothing else."""
    synth.synthesise_bundle(bundle, out_dir=tmp_path)
    second = synth.synthesise_bundle(bundle, out_dir=tmp_path)
    assert not second.written
    assert len(second.reused) == len(bundle["audio_manifest"])


def test_the_limit_is_a_budget(bundle, tmp_path):
    """The first time this points at a paid provider it must not be able to
    spend the afternoon's money in one command."""
    report = synth.synthesise_bundle(bundle, out_dir=tmp_path, limit=2)
    assert len(report.written) == 2


def test_one_failing_clip_does_not_lose_the_others(bundle, tmp_path):
    class Flaky:
        name = "flaky"
        seen = 0

        def synthesize(self, text, voice, *, instructions=""):
            Flaky.seen += 1
            if Flaky.seen == 2:
                raise RuntimeError("provider said no")
            return channel.silence(0.5)

    report = synth.synthesise_bundle(bundle, provider=Flaky(), out_dir=tmp_path)
    assert len(report.failed) == 1
    assert len(report.written) == len(bundle["audio_manifest"]) - 1


def test_a_reading_type_has_no_audio_and_says_so(tmp_path):
    """総合読解 is silent by design. Zero clips is an outcome, not a failure."""
    reading = batch.build_bundle(
        "sougou_dokkai", "J1", [fixtures.FIXTURES["sougou_dokkai"]], "test"
    )
    report = synth.synthesise_bundle(reading, out_dir=tmp_path)
    assert not report.clips
    assert "read, not heard" in report.summary()
    assert "Nothing to apply" in synth.to_sql(report)


def test_silent_clips_are_marked_as_such_in_their_path(bundle, tmp_path):
    """A placeholder must never be mistakable for a real recording, in storage
    or in a review."""
    report = synth.synthesise_bundle(bundle, out_dir=tmp_path)
    assert all(c.path.startswith("silent/") for c in report.written)


def test_the_sql_updates_rather_than_inserts(bundle, tmp_path):
    """The clip rows come from `bjt publish`, off the same manifest. A missing
    row means the bundle was never published, and inventing one hides that."""
    sql = synth.to_sql(synth.synthesise_bundle(bundle, out_dir=tmp_path))
    assert "update public.audio_clips" in sql
    assert "insert into public.audio_clips" not in sql


def test_the_run_leaves_a_record(bundle, tmp_path):
    report = synth.synthesise_bundle(bundle, out_dir=tmp_path)
    out = synth.write_report(report, tmp_path / "reports" / "r.json")
    written = json.loads(out.read_text(encoding="utf-8"))
    assert len(written["written"]) == len(bundle["audio_manifest"])


# ----- pronunciation ------------------------------------------------------

def test_the_pronunciation_dictionary_is_applied():
    """A learner who hears 代替 as だいがえ and repeats it in an interview has
    been actively harmed by this app."""
    assert providers.apply_pronunciation("代替案をご検討ください") == "だいたい案をご検討ください"


def test_ssml_keeps_the_written_form_visible():
    ssml = providers.GoogleProvider.to_ssml("代替案")
    assert "<sub" in ssml and "代替" in ssml and "だいたい" in ssml


def test_a_provider_with_no_cast_refuses_rather_than_guessing():
    """A cast assigned by accident is one the whole library inherits."""
    with pytest.raises(RuntimeError, match="no Google Cloud voice cast"):
        providers.GoogleProvider().synthesize("こんにちは", "someone_new")


CAST = {plan.NARRATOR_VOICE, *plan.RELATION_VOICES.values(), *plan.DIALOGUE_VOICES}


def test_every_cast_voice_has_a_direction():
    missing = CAST - set(providers.VOICE_DIRECTION)
    assert not missing, f"no delivery direction for {missing}"


@pytest.mark.parametrize("cls", [providers.GeminiProvider, providers.OpenAIProvider,
                                 providers.GoogleProvider])
def test_every_real_provider_casts_every_voice(cls):
    """`bjt synth` must run the day a key exists, for every role the plan can
    hand it — a refusal in the middle of a batch is a bill for the clips
    before it and nothing after."""
    missing = CAST - set(cls.VOICE_IDS)
    assert not missing, f"{cls.name} has no voice for {missing}"
    # Distinct voices, or the learner is back to speaker identification for
    # whichever two roles share one.
    assert len(set(cls.VOICE_IDS.values())) == len(cls.VOICE_IDS)


def test_the_direction_says_native_office_japanese_and_nothing_else():
    """The house style is the one lever on "robotic" a provider gives us."""
    note = providers.direction_for("reception_f")
    for phrase in ("pitch accent", "business pace", "exactly as written"):
        assert phrase in note
    assert providers.VOICE_DIRECTION["reception_f"] in note


def test_the_openai_request_carries_the_direction_and_asks_for_wav(monkeypatch):
    sent = {}

    def fake_post(url, body, headers):
        sent.update(url=url, body=body, headers=headers)
        return channel.silence(0.2)

    monkeypatch.setattr(providers, "_post", fake_post)
    out = providers.OpenAIProvider(api_key="k").synthesize("代替案です", "manager_m")
    assert out[:4] == b"RIFF"
    assert sent["body"]["response_format"] == "wav"
    assert sent["body"]["voice"] == providers.OpenAIProvider.VOICE_IDS["manager_m"]
    assert sent["body"]["input"] == "だいたい案です"
    assert providers.HOUSE_STYLE in sent["body"]["instructions"]
    assert sent["headers"]["Authorization"] == "Bearer k"
    # A shade over natural rate, and never below it: the first clips were a
    # reader, not a person. Bounded, because a typo here is a library of
    # chipmunks that is never re-made.
    assert sent["body"]["speed"] == config.TTS_SPEED
    assert 1.0 <= config.TTS_SPEED <= 1.25


def test_the_direction_asks_for_a_person_talking_not_a_reader():
    note = providers.direction_for("staff_mid_m")
    for phrase in ("connected speech", "brisk", "not a narrator"):
        assert phrase in note


def test_the_gemini_response_is_wrapped_into_wav(monkeypatch):
    """Gemini returns headerless PCM; the rest of the pipeline reads WAV."""
    import base64
    import json as jsonmod

    pcm = b"\x00\x10" * 2400  # a tenth of a second at 24 kHz
    reply = {"candidates": [{"content": {"parts": [{"inlineData": {
        "mimeType": "audio/L16;codec=pcm;rate=24000",
        "data": base64.b64encode(pcm).decode("ascii"),
    }}]}}]}
    sent = {}

    def fake_post(url, body, headers):
        sent.update(url=url, body=body, headers=headers)
        return jsonmod.dumps(reply).encode("utf-8")

    monkeypatch.setattr(providers, "_post", fake_post)
    out = providers.GeminiProvider(api_key="k").synthesize("承知いたしました。", "staff_mid_f")
    assert channel.duration_ms(out) == 100
    assert sent["headers"]["x-goog-api-key"] == "k"
    cfg = sent["body"]["generationConfig"]
    assert cfg["responseModalities"] == ["AUDIO"]
    assert cfg["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == \
        providers.GeminiProvider.VOICE_IDS["staff_mid_f"]
    prompt = sent["body"]["contents"][0]["parts"][0]["text"]
    assert prompt.endswith("承知いたしました。")
    assert providers.HOUSE_STYLE in prompt


def test_gemini_says_so_when_there_is_no_audio_in_the_reply():
    with pytest.raises(RuntimeError, match="no audio"):
        providers.GeminiProvider.wav_from_response(b'{"error": {"message": "quota"}}')


def test_the_provider_is_picked_from_the_environment(monkeypatch):
    """No key: silent, so the pipeline still runs. A key: that provider. A
    pinned choice wins over any key, because the cast is fixed for the life of
    the library and must not follow whichever secret was set last."""
    for keys in providers.CREDENTIALS.values():
        for key in keys:
            monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv(providers.PROVIDER_ENV, raising=False)
    assert providers.default_provider() == "silent"

    # Another provider's key alone does not make it the voice: the library's
    # provider is a decision in code, not the last secret somebody set.
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert providers.default_provider() == "silent"
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    assert providers.default_provider() == providers.DEFAULT == "openai"
    assert providers.available() == ["openai", "gemini"]

    monkeypatch.setenv(providers.PROVIDER_ENV, "gemini")
    assert providers.get_provider("auto").name == "gemini"


def test_the_voices_audition_says_one_line_in_every_openai_voice(tmp_path, monkeypatch):
    from bjt.tts import audition

    asked = []

    def fake_post(url, body, headers):
        asked.append(body["voice"])
        return channel.silence(0.2)

    monkeypatch.setattr(providers, "_post", fake_post)
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    report = audition.run([], media_dir=tmp_path, voices=True)
    assert not report.failed
    assert asked == list(providers.OpenAIProvider.CANDIDATE_VOICES)
    page = (tmp_path / "audition" / "index.html").read_text(encoding="utf-8")
    assert 'src="openai-voices/nova.wav"' in page


# ----- the audition ---------------------------------------------------------

def test_the_audition_writes_every_voice_and_a_page_to_compare_them(tmp_path):
    from bjt.tts import audition

    report = audition.run(["silent"], media_dir=tmp_path)
    assert not report.failed
    names = {p.name for p in report.written}
    assert "narrator_f.wav" in names and "staff_mid_m.phone.wav" in names
    assert {v for v, _, _ in audition.LINES} == CAST
    page = (tmp_path / "audition" / "index.html").read_text(encoding="utf-8")
    assert 'src="silent/manager_m.wav"' in page
    assert "代替" in page  # the dictionary reading is on the page to be judged


# ----- the scene bank -----------------------------------------------------

def test_the_survey_covers_every_scene_the_tables_ask_for(tmp_path):
    survey = scenes.survey(tmp_path)
    assert survey
    assert all(s.cell_count > 0 for s in survey)
    assert not any(s.has_art for s in survey)


def test_the_survey_is_a_commissioning_order(tmp_path):
    """Most-wanted first. The bank is shared, so a scene three types use earns
    its drawing before one a single cell wants."""
    survey = scenes.survey(tmp_path)
    wanted = [s.cell_count for s in survey if not s.has_art]
    assert wanted == sorted(wanted, reverse=True)


def test_artwork_on_disk_is_found_and_published(tmp_path, monkeypatch):
    (tmp_path / "scenes").mkdir()
    (tmp_path / "scenes" / "scene_phone_desk.webp").write_bytes(b"not really an image")
    survey = scenes.survey(tmp_path)
    found = [s for s in survey if s.has_art]
    assert [s.scene_id for s in found] == ["scene_phone_desk"]

    sql = scenes.to_sql(survey)
    assert "scene_phone_desk.webp" in sql
    # A scene with no art is left exactly as it is: image_path stays null and
    # the app draws the item without a picture.
    assert "scene_corridor" not in sql


def test_no_artwork_produces_no_statements(tmp_path):
    assert "Nothing to apply" in scenes.to_sql(scenes.survey(tmp_path))


def test_the_brief_forbids_what_makes_a_picture_unusable(tmp_path):
    brief = scenes.prompt_for(scenes.survey(tmp_path)[0])
    for clause in ("readable text", "likeness", "makes the listening optional"):
        assert clause in brief


# ----- the command line -------------------------------------------------------

def test_the_cli_refuses_to_upload_silence(tmp_path, monkeypatch, capsys):
    """Silent clips in the real bucket would make the app play nothing where it
    now shows the text — worse than no audio at all."""
    from bjt import cli

    monkeypatch.delenv("BJT_TTS_PROVIDER", raising=False)
    rc = cli.main(["synth", str(config.ROOT / "batches" / "hatsugen_choukai_J2_001.json"),
                   "--provider", "silent", "--upload", "--media-dir", str(tmp_path)])
    assert rc == 2
    assert "ship silence" in capsys.readouterr().err


def test_the_cli_names_the_provider_it_used(tmp_path, monkeypatch, capsys):
    for keys in providers.CREDENTIALS.values():
        for key in keys:
            monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("BJT_TTS_PROVIDER", raising=False)
    from bjt import cli

    rc = cli.main(["synth", str(config.ROOT / "batches" / "hatsugen_choukai_J2_001.json"),
                   "--media-dir", str(tmp_path), "--out", str(tmp_path / "a.sql")])
    assert rc == 0
    out = capsys.readouterr().out
    assert "(silent)" in out and "SILENT placeholder" in out
    assert (tmp_path / "a.sql").exists()
