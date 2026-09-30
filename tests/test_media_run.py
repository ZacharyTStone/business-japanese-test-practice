"""The media jobs' decisions, reachable without the command line.

What a scene run draws (`scene_art.select`, `lifetime_ledger`) and the whole
synthesis sequence (`synth.run`) used to live inside `cmd_scenes` and
`cmd_synth`, where only a full command run could test them.
"""
import pytest

from bjt import batch, fixtures, http, scene_art, scenes
from bjt.tts import synth


def test_select_puts_the_bank_first_and_caps_the_pictures(tmp_path, monkeypatch):
    # With nothing withdrawn the library holds more pictures than the cap.
    monkeypatch.setattr("bjt.withdrawn.ids", lambda path=None: frozenset())
    survey = scenes.survey(tmp_path)
    wanted = scene_art.select(survey, max_pictures=2)
    kinds = [s.is_picture for s in wanted]
    assert kinds == sorted(kinds), "the shared bank before the pictures"
    assert sum(kinds) == 2


def test_select_leaves_art_alone_unless_forced(tmp_path):
    (tmp_path / "scenes").mkdir()
    first = next(s for s in scenes.survey(tmp_path) if not s.is_picture)
    (tmp_path / "scenes" / f"{first.scene_id}.webp").write_bytes(b"x")
    survey = scenes.survey(tmp_path)
    assert first.scene_id not in {s.scene_id for s in scene_art.select(survey)}
    assert first.scene_id in {s.scene_id for s in scene_art.select(survey, force=True)}


def test_select_by_name_and_kind(tmp_path):
    survey = scenes.survey(tmp_path)
    bank = [s for s in survey if not s.is_picture][:2]
    names = [s.scene_id for s in bank]
    assert [s.scene_id for s in scene_art.select(survey, names)] == names
    assert scene_art.select(survey, names, only="pictures") == []
    assert all(s.is_picture for s in scene_art.select(survey, only="pictures", max_pictures=99))
    with pytest.raises(ValueError, match="no such scene"):
        scene_art.select(survey, ["not_a_scene"])


def test_an_unconfigured_bucket_remembers_and_records_nothing():
    assert scene_art.lifetime_ledger(scene_art.Bucket(url="", key=""), record=True) == ({}, None, None)


def test_an_unreadable_ledger_is_a_warning(monkeypatch):
    bucket = scene_art.Bucket(url="https://x.supabase.co", key="k")

    def down(*a, **k):
        raise RuntimeError("HTTP 503")

    monkeypatch.setattr(http, "json_request", down)
    prior, on_reject, warning = scene_art.lifetime_ledger(bucket, record=True)
    assert prior == {} and on_reject is not None and "HTTP 503" in warning


@pytest.fixture
def bundle():
    return batch.build_bundle("hatsugen_choukai", "J2", [fixtures.FIXTURES["hatsugen_choukai"]], "t")


class _Bucket:
    name, configured = "audio", True

    def __init__(self, live=(), broken=()):
        self.live, self.broken, self.sent = set(live), set(broken), []

    def upload(self, path, data, content_type, *, upsert=True):
        clip_id = path.rsplit("/", 1)[-1][:-4]
        if clip_id in self.broken:
            raise RuntimeError("HTTP 500")
        if clip_id in self.live and not upsert:
            raise scene_art.AlreadyExists(path)
        self.sent.append(clip_id)


def test_the_run_refuses_an_upload_without_the_live_list(bundle, tmp_path):
    with pytest.raises(ValueError, match="already live"):
        synth.run(bundle, provider="silent", bucket=_Bucket(), media_dir=tmp_path)


def test_the_run_leaves_the_report_describing_the_bucket(bundle, tmp_path, monkeypatch):
    from bjt.tts import providers

    class Voice(providers.SilentProvider):
        name = "fakevoice"

    ids = [c["clip_id"] for c in bundle["audio_manifest"]]
    bucket = _Bucket(live={ids[0]}, broken={ids[1]})
    run = synth.run(bundle, provider=Voice(), bucket=bucket, media_dir=tmp_path, have=set())
    made = {c.clip_id for c in run.report.clips}
    assert ids[0] not in made and ids[0] in run.report.live
    assert ids[1] not in made and ids[1] in {cid for cid, _ in run.report.failed}
    assert made == set(bucket.sent)
    assert run.uploaded is not None and len(run.uploaded.existing) == 1
