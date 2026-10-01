"""Whole files or none, and readers that do not take a broken file for an empty one.

A bundle, its SQL, a clip and a picture are each written by one step and
trusted by the next. Written in place, a process stopped part-way left a
truncated file behind; read tolerantly, a corrupt clip became zero
milliseconds in the SQL. These hold the writers to `files.write_atomic` and
the readers to raising.
"""
import io
import os
import wave

import pytest

from bjt import batch, fixtures, http, publish, r2, scene_art
from bjt.files import write_atomic
from bjt.tts import channel, synth


def _failing_replace(monkeypatch):
    def refuse(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(os, "replace", refuse)


def test_a_failed_write_leaves_the_old_file_and_no_litter(tmp_path, monkeypatch):
    path = tmp_path / "b.json"
    path.write_text("the old bundle", encoding="utf-8")
    _failing_replace(monkeypatch)
    with pytest.raises(OSError):
        write_atomic(path, "the new bu")
    assert path.read_text(encoding="utf-8") == "the old bundle"
    assert [p.name for p in tmp_path.iterdir()] == ["b.json"]


def test_a_bundle_and_its_sql_are_written_whole(tmp_path, monkeypatch):
    bundle = batch.build_bundle("hatsugen_choukai", "J2", [fixtures.FIXTURES["hatsugen_choukai"]], "t")
    path = batch.save(bundle, tmp_path / "hatsugen_choukai_J2_001.json")
    sql, _ = publish.publish_bundle(path)
    before = (path.read_bytes(), sql.read_bytes())

    _failing_replace(monkeypatch)
    bundle["items"] = []
    with pytest.raises(OSError):
        batch.save(bundle, path)
    with pytest.raises(OSError):
        publish.publish_bundle(path)
    assert (path.read_bytes(), sql.read_bytes()) == before


def _wav(frames: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


@pytest.mark.parametrize("data", [
    b"not a wav at all",
    _wav(24000)[:-1000],   # cut short of the frames its header promises
    _wav(0),               # a header and nothing
])
def test_a_clip_that_is_not_whole_has_no_duration(tmp_path, data):
    path = tmp_path / "x.wav"
    path.write_bytes(data)
    with pytest.raises(ValueError):
        synth._duration_of(path)


def test_a_whole_clip_has_its_duration(tmp_path):
    path = tmp_path / "x.wav"
    path.write_bytes(_wav(24000))
    assert synth._duration_of(path) == 1000 == channel.duration_ms(_wav(24000))


def test_a_corrupt_clip_on_disk_is_a_failure_not_zero_milliseconds(tmp_path):
    bundle = batch.build_bundle("hatsugen_choukai", "J2", [fixtures.FIXTURES["hatsugen_choukai"]], "t")
    first = synth.synthesise_bundle(bundle, out_dir=tmp_path)
    broken = first.written[0]
    (tmp_path / "audio" / broken.path).write_bytes(b"RIFF....truncated")

    again = synth.synthesise_bundle(bundle, out_dir=tmp_path)
    assert broken.clip_id in {cid for cid, _ in again.failed}
    assert broken.clip_id not in {c.clip_id for c in again.clips}
    assert f"'{broken.clip_id}'" not in synth.to_sql(again)
    assert all(c.duration_ms > 0 for c in again.clips)


def test_the_bucket_listing_reads_every_page(monkeypatch):
    ns = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"'

    def page(keys, token=None):
        more = f"<IsTruncated>true</IsTruncated><NextContinuationToken>{token}</NextContinuationToken>" \
            if token else "<IsTruncated>false</IsTruncated>"
        return (f"<ListBucketResult {ns}>{more}"
                + "".join(f"<Contents><Key>scenes/rejected/{k}.txt</Key></Contents>" for k in keys)
                + "</ListBucketResult>").encode()

    pages = [page(range(1000), token="p2"), page(range(1000, 1005))]
    asked = []

    def listing(method, url, body, headers, **kw):
        asked.append("continuation-token=p2" in url)
        return pages[len(asked) - 1]

    monkeypatch.setattr(http, "request", listing)
    bucket = scene_art.Bucket(creds=r2.Credentials("acct", "k", "s"))
    assert len(bucket.list("rejected/")) == 1005
    assert asked == [False, True]


def test_an_approved_picture_is_written_whole(tmp_path, monkeypatch):
    class Real:
        name, suffix, media_type, real = "fake", ".png", "image/png", True

        def generate(self, prompt):
            return scene_art._flat_png(6, 4, (1, 2, 3))

    from bjt import scenes
    _failing_replace(monkeypatch)
    wanted = scenes.survey(tmp_path)[:1]
    with pytest.raises(OSError):
        scene_art.draw(wanted, provider=Real(), review=lambda *a: scene_art.Verdict(True),
                       media_dir=tmp_path)
    assert not any(s.has_art for s in scenes.survey(tmp_path)), "no half picture counts as art"
    assert not list((tmp_path / "scenes").glob("*.tmp")) and \
        not list((tmp_path / "scenes").glob(".*"))
