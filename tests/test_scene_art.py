"""Drawing the scene bank, offline.

The placeholder provider is not a mock hidden here — it is how the job runs
without a vendor account. The reviewer is faked, because that is the model
call; what is tested is that the job obeys the reviewer, keeps what it
rejects, and never lets a stand-in be mistaken for artwork.
"""
import json
import zlib

import pytest

from bjt import scene_art, scenes


def _png_is_valid(data: bytes) -> bool:
    return data.startswith(b"\x89PNG\r\n\x1a\n") and data.endswith(b"IEND\xaeB`\x82")


def test_the_placeholder_is_a_real_png_of_the_banks_shape():
    data = scene_art.PlaceholderProvider().generate("anything")
    assert _png_is_valid(data)
    width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    assert width * 2 == height * 3


def test_placeholders_are_never_counted_as_artwork(tmp_path):
    wanted = scenes.survey(tmp_path)
    result = scene_art.draw(wanted, provider=scene_art.PlaceholderProvider(),
                            review=scene_art.review_with_model, media_dir=tmp_path)
    assert len(result.approved) == len(wanted)
    assert all(d.path.startswith("placeholder/") for d in result.drawn)
    # The survey looks only at the top of media/scenes, so nothing changed.
    assert not any(s.has_art for s in scenes.survey(tmp_path))
    assert "nothing here is artwork" in result.summary()


class _Real:
    """A provider whose output counts, so the review gate is exercised."""
    name = "fake"
    suffix = ".png"
    media_type = "image/png"
    real = True

    def __init__(self):
        self.calls = 0

    def generate(self, prompt):
        self.calls += 1
        assert "must not contain" in prompt
        return scene_art._flat_png(6, 4, (self.calls, 0, 0))


def test_a_rejected_draft_is_kept_with_its_reason_and_the_next_one_tried(tmp_path):
    wanted = scenes.survey(tmp_path)[:2]
    verdicts = iter([
        scene_art.Verdict(False, ("readable text drawn in",)),
        scene_art.Verdict(True),
        scene_art.Verdict(True),
    ])
    provider = _Real()
    result = scene_art.draw(wanted, provider=provider,
                            review=lambda img, mt, sc: next(verdicts),
                            media_dir=tmp_path, attempts=3)
    first, second = result.drawn
    assert first.ok and first.attempts == 2 and first.rejected == [("readable text drawn in",)]
    assert second.ok and second.attempts == 1
    assert provider.calls == 3

    rejected = tmp_path / "scenes" / "rejected"
    assert (rejected / f"{first.scene_id}-1.png").exists()
    assert (rejected / f"{first.scene_id}-1.txt").read_text() == "readable text drawn in\n"
    # And the approved one is where the survey looks, so it now counts as art.
    art = [s.scene_id for s in scenes.survey(tmp_path) if s.has_art]
    assert sorted(art) == sorted([first.scene_id, second.scene_id])


def test_a_scene_that_fails_every_attempt_ships_without_a_picture(tmp_path):
    wanted = scenes.survey(tmp_path)[:1]
    result = scene_art.draw(wanted, provider=_Real(),
                            review=lambda *a: scene_art.Verdict(False, ("a likeness",)),
                            media_dir=tmp_path, attempts=2)
    (only,) = result.drawn
    assert not only.ok and only.attempts == 2 and len(only.rejected) == 2
    assert result.failed == [only]
    assert not any(s.has_art for s in scenes.survey(tmp_path))
    assert "no draft passed" in result.summary()


def test_a_vendor_error_is_a_result_not_a_crash(tmp_path):
    class Broken(_Real):
        def generate(self, prompt):
            raise RuntimeError("HTTP 429")

    wanted = scenes.survey(tmp_path)[:1]
    result = scene_art.draw(wanted, provider=Broken(), review=lambda *a: scene_art.Verdict(True),
                            media_dir=tmp_path)
    assert result.drawn[0].error == "HTTP 429"
    assert "error: HTTP 429" in result.summary()


def test_the_model_review_turns_flags_into_a_verdict(monkeypatch, tmp_path):
    seen = {}

    def fake(image, media_type, brief, rules, model=None):
        seen.update(brief=brief, rules=rules)
        return {rule: rule == "gives_scenario_away" for rule in rules} | {"notes": "x"}

    monkeypatch.setattr("bjt.llm.review_scene_image", fake)
    scene = scenes.survey(tmp_path)[0]
    verdict = scene_art.review_with_model(b"img", "image/webp", scene)
    assert not verdict.approved
    assert verdict.reasons == (scene_art.RULES["gives_scenario_away"],)
    # The judge is given the same brief a human would get, rule for rule.
    assert seen["brief"] == scenes.prompt_for(scene)
    assert seen["rules"] is scene_art.RULES
    for clause in scenes.FORBIDDEN:
        assert clause in seen["brief"]


def test_the_image_prompt_carries_every_prohibition(tmp_path):
    prompt = scenes.image_prompt(scenes.survey(tmp_path)[0])
    for clause in scenes.FORBIDDEN:
        assert clause in prompt
    assert scenes.STYLE in prompt


# ----- the bucket -----------------------------------------------------------

def test_the_bucket_refuses_without_its_two_variables(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    bucket = scene_art.Bucket()
    assert not bucket.configured
    with pytest.raises(RuntimeError):
        bucket.list()
    with pytest.raises(RuntimeError):
        bucket.upload("x.webp", b"", "image/webp")


def test_artwork_already_in_the_bucket_counts_and_is_not_resent(tmp_path, monkeypatch):
    requests = []

    def fake_json(method, url, body, headers):
        requests.append((method, url))
        return [{"name": "scene_corridor.webp", "id": "1"},
                {"name": "rejected", "id": None},
                {"name": "notes.txt", "id": "2"}]

    def fake_raw(method, url, body, headers):
        requests.append((method, url, headers["Content-Type"], headers["x-upsert"]))
        return b""

    monkeypatch.setattr(scene_art, "_json_request", fake_json)
    monkeypatch.setattr(scene_art, "_request", fake_raw)
    bucket = scene_art.Bucket(url="https://p.supabase.co/", key="service")
    assert bucket.configured
    assert bucket.list() == {"scene_corridor.webp"}
    assert requests[0] == ("POST", "https://p.supabase.co/storage/v1/object/list/scenes")

    (tmp_path / "scenes").mkdir()
    (tmp_path / "scenes" / "scene_phone_desk.webp").write_bytes(b"art")
    survey = scenes.survey(tmp_path, bucket.list())
    have = {s.scene_id: s.path for s in survey if s.has_art}
    assert have == {"scene_corridor": "scene_corridor.webp",
                    "scene_phone_desk": "scene_phone_desk.webp"}

    sent = scene_art.upload_approved(survey, bucket, tmp_path)
    assert sent == ["scene_phone_desk.webp"]  # the bucket's own file is not re-sent
    assert requests[-1] == ("POST", "https://p.supabase.co/storage/v1/object/scenes/scene_phone_desk.webp",
                            "image/webp", "true")

    # Both reach the SQL, so a scene drawn on an earlier night keeps its picture.
    sql = scenes.to_sql(survey)
    assert "scene_corridor.webp" in sql and "scene_phone_desk.webp" in sql


def test_a_local_file_wins_over_the_bucket(tmp_path):
    (tmp_path / "scenes").mkdir()
    (tmp_path / "scenes" / "scene_corridor.png").write_bytes(b"new")
    survey = scenes.survey(tmp_path, {"scene_corridor.webp"})
    (corridor,) = [s for s in survey if s.scene_id == "scene_corridor"]
    assert corridor.path == "scene_corridor.png"


def test_the_openai_provider_refuses_without_a_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        scene_art.OpenAIImageProvider().generate("x")


def test_the_openai_provider_asks_for_webp_at_three_by_two(monkeypatch):
    import base64

    captured = {}

    def fake_json(method, url, body, headers):
        captured.update(url=url, body=body, auth=headers["Authorization"])
        return {"data": [{"b64_json": base64.b64encode(b"webp-bytes").decode()}]}

    monkeypatch.setattr(scene_art, "_json_request", fake_json)
    out = scene_art.OpenAIImageProvider(api_key="k").generate("draw")
    assert out == b"webp-bytes"
    assert captured["auth"] == "Bearer k"
    assert captured["body"]["output_format"] == "webp"
    assert captured["body"]["size"] == "1536x1024"
    assert captured["body"]["n"] == 1


def test_the_cli_draws_offline_and_writes_the_summary(tmp_path, capsys):
    from bjt import cli

    rc = cli.main(["scenes", "--generate", "--provider", "placeholder",
                   "--media-dir", str(tmp_path), "--summary", str(tmp_path / "s.md")])
    assert rc == 0
    assert (tmp_path / "s.md").read_text().startswith("## Scene artwork (placeholder)")
    assert (tmp_path / "scenes" / "placeholder").is_dir()
    assert "nothing uploads them" in capsys.readouterr().out


def test_the_cli_refuses_to_upload_without_the_bucket(tmp_path, monkeypatch):
    from bjt import cli

    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    assert cli.main(["scenes", "--upload", "--media-dir", str(tmp_path)]) == 2


def test_the_cli_names_an_unknown_scene(tmp_path, monkeypatch):
    from bjt import cli

    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert cli.main(["scenes", "--generate", "scene_nowhere", "--provider", "placeholder",
                     "--media-dir", str(tmp_path)]) == 2
