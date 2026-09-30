"""A live clip is never re-made, whether or not the caller said which are live.

`bjt synth --upload` without `--have` on an empty media/ re-synthesised every
clip, uploaded each over the live file (x-upsert: true), and rewrote every
duration. Now the upload needs `--have`, and the bucket itself is asked not to
replace anything but the clips `--remake` names: a file already at a clip's
path is a live clip, left alone and counted as live.
"""
import io
import urllib.error
import urllib.request

import pytest

from bjt import batch, cli, config, fixtures, scene_art
from bjt.tts import providers, synth

REFERENCE = str(config.ROOT / "batches" / "hatsugen_choukai_J2_001.json")


@pytest.fixture
def bundle():
    return batch.build_bundle("hatsugen_choukai", "J2", [fixtures.FIXTURES["hatsugen_choukai"]], "test")


def test_the_upload_needs_the_list_of_live_clips(tmp_path, capsys):
    rc = cli.main(["synth", REFERENCE, "--provider", "openai", "--upload",
                   "--media-dir", str(tmp_path)])
    assert rc == 2
    assert "--upload needs --have" in capsys.readouterr().err
    assert not (tmp_path / "audio").exists(), "nothing synthesised"


def _bucket_seeing(monkeypatch, answer):
    """A configured bucket whose server answers each upload with `answer`."""
    seen = []

    def request(method, url, body, headers):
        seen.append(headers)
        return answer(url, headers)

    monkeypatch.setattr(scene_art, "_request", request)
    return scene_art.Bucket(name="audio", url="https://x.supabase.co", key="k"), seen


def test_the_bucket_is_asked_not_to_replace(monkeypatch):
    bucket, seen = _bucket_seeing(monkeypatch, lambda url, h: b"{}")
    bucket.upload("openai/ab/abc.wav", b"RIFF", "audio/wav", upsert=False)
    bucket.upload("openai/ab/abd.wav", b"RIFF", "audio/wav", upsert=True)
    assert [h["x-upsert"] for h in seen] == ["false", "true"]


#: The real seam, taken at import: the autouse guard replaces it in every test.
_REAL_REQUEST = scene_art._request


@pytest.mark.parametrize("status, body", [
    (409, '{"error": "Duplicate"}'),
    (400, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}'),
])
def test_a_file_already_there_is_said_so(monkeypatch, status, body):
    def refuse(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, status, "x", {}, io.BytesIO(body.encode()))

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(scene_art, "_request", _REAL_REQUEST)
    bucket = scene_art.Bucket(name="audio", url="https://x.supabase.co", key="k")
    with pytest.raises(scene_art.AlreadyExists):
        bucket.upload("openai/ab/abc.wav", b"RIFF", "audio/wav", upsert=False)
    # With upsert the same answer is an ordinary failure, never "already live".
    with pytest.raises(scene_art.RequestFailed) as err:
        bucket.upload("openai/ab/abc.wav", b"RIFF", "audio/wav", upsert=True)
    assert not isinstance(err.value, scene_art.AlreadyExists)


class _Bucket:
    name = "audio"
    configured = True

    def __init__(self, live: set):
        self.live = live
        self.sent: list = []

    def upload(self, path, data, content_type, *, upsert=True):
        clip_id = path.rsplit("/", 1)[-1][:-4]
        if clip_id in self.live and not upsert:
            raise scene_art.AlreadyExists(path)
        self.sent.append((clip_id, upsert))


def test_a_clip_already_in_the_bucket_is_live_and_only_a_named_one_replaced(bundle, tmp_path):
    report = synth.synthesise_bundle(bundle, out_dir=tmp_path)
    ids = [c.clip_id for c in report.clips]
    bucket = _Bucket(live={ids[0], ids[1]})
    up = synth.upload_clips(report, bucket, tmp_path, remake={ids[1]})

    assert [p.rsplit("/", 1)[-1][:-4] for p in up.existing] == [ids[0]]
    sent = dict(bucket.sent)
    assert sent[ids[1]] is True, "the named clip replaces the live one"
    assert all(upsert is False for cid, upsert in bucket.sent if cid != ids[1])
    assert ids[0] not in sent


def test_the_command_leaves_a_clip_the_bucket_has_out_of_the_sql(tmp_path, monkeypatch, capsys):
    class Voice(providers.SilentProvider):
        name = "fakevoice"

    monkeypatch.setitem(providers.PROVIDERS, "fakevoice", Voice)
    live = set()
    manifest = batch.load(config.ROOT / "batches" / "hatsugen_choukai_J2_001.json")["audio_manifest"]
    first = manifest[0]["clip_id"]
    live.add(first)
    fake = _Bucket(live)
    monkeypatch.setattr(scene_art, "Bucket", lambda name="scenes", **k: fake)
    have = tmp_path / "have.txt"
    have.write_text("", encoding="utf-8")  # the database knew of nothing
    out = tmp_path / "audio.sql"

    rc = cli.main(["synth", REFERENCE, "--provider", "fakevoice", "--upload", "--have", str(have),
                   "--media-dir", str(tmp_path), "--out", str(out)])
    assert rc == 0, capsys.readouterr().err
    assert "already in the bucket" in capsys.readouterr().out
    sql = out.read_text(encoding="utf-8")
    assert first not in sql, "no duration rewritten for a clip the learner already hears"
    assert first not in {cid for cid, _ in fake.sent}
