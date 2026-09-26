"""Drawing the scene bank, offline.

The placeholder provider is not a mock hidden here — it is how the job runs
without a vendor account. The reviewer is faked, because that is the model
call; what is tested is that the job obeys the reviewer, keeps what it
rejects, and never lets a stand-in be mistaken for artwork.
"""

import pytest

from bjt import config, scene_art, scenes


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


def test_every_scene_has_a_brief_and_the_prompt_names_the_place(tmp_path):
    """The seed tables carry only a Japanese label; the image model draws
    from the English brief, so every scene the tables can ask for has one,
    and the old "a Japanese office setting" gloss is gone — it put the
    restaurant and the outdoor phone call indoors."""
    for scene in scenes.survey(tmp_path):
        if scene.is_picture:
            continue  # drawn from its item's own brief, below
        assert scene.scene_id in scenes.SCENE_BRIEFS, scene.scene_id
        place, channel = scenes.SCENE_BRIEFS[scene.scene_id]
        assert channel in scenes.COMPOSITION
        for text in (scenes.prompt_for(scene), scenes.image_prompt(scene)):
            assert place in text
            assert scenes.COMPOSITION[channel] in text
            assert "office setting" not in text


def test_the_speaker_addresses_the_viewer_and_nobody_else_is_principal(tmp_path):
    """The learner chooses the reply, so the learner is the one spoken to and
    is never drawn: one speaker facing the viewer in person, alone on the
    phone, on screen for a video call. A reviewer rule fails a listener."""
    by_id = {s.scene_id: s for s in scenes.survey(tmp_path)}
    in_person = scenes.image_prompt(by_id["scene_corridor"])
    assert "one principal figure" in in_person and "NOT drawn" in in_person
    phone = scenes.image_prompt(by_id["scene_phone_mobile_outside"])
    assert "on the phone" in phone and "no listener beside them" in phone
    assert "outdoors" in phone and "no office interior" in phone
    video = scenes.image_prompt(by_id["scene_video_call_laptop"])
    assert "video-call window" in video
    assert "no_focus" in scene_art.RULES
    assert any("never in the picture" in clause for clause in scenes.FORBIDDEN)


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

    up = scene_art.upload_approved(survey, bucket, tmp_path)
    assert up.sent == ["scene_phone_desk.webp"]  # the bucket's own file is not re-sent
    assert up.failed == []
    assert requests[-1] == ("POST", "https://p.supabase.co/storage/v1/object/scenes/scene_phone_desk.webp",
                            "image/webp", "true")

    # Both reach the SQL, so a scene drawn on an earlier night keeps its picture.
    sql = scenes.to_sql(survey)
    assert "scene_corridor.webp" in sql and "scene_phone_desk.webp" in sql


def test_one_bad_upload_does_not_stop_the_rest(tmp_path, monkeypatch):
    """The first real night: the fourth file was over the bucket's limit, the
    exception ended the loop, and ten approved pictures never left the runner.
    Now the oversized file is refused before a byte is sent, a refusal from the
    bucket is recorded against its file, and every other file still goes."""
    uploaded = []

    def fake_raw(method, url, body, headers):
        if url.endswith("scene_corridor.webp"):
            raise RuntimeError(f"POST {url} → HTTP 400: EntityTooLarge")
        uploaded.append(url.rsplit("/", 1)[1])
        return b""

    monkeypatch.setattr(scene_art, "_request", fake_raw)
    monkeypatch.setattr(config, "SCENE_MAX_BYTES", 10)
    (tmp_path / "scenes").mkdir()
    (tmp_path / "scenes" / "scene_phone_desk.webp").write_bytes(b"x" * 11)   # too big
    (tmp_path / "scenes" / "scene_corridor.webp").write_bytes(b"x" * 5)      # bucket says no
    (tmp_path / "scenes" / "scene_elevator_hall.webp").write_bytes(b"x" * 5)  # fine
    (tmp_path / "scenes" / "scene_izakaya_table.webp").write_bytes(b"x" * 5)  # fine

    bucket = scene_art.Bucket(url="https://p.supabase.co", key="service")
    survey = scenes.survey(tmp_path)
    up = scene_art.upload_approved(survey, bucket, tmp_path)

    assert sorted(up.sent) == ["scene_elevator_hall.webp", "scene_izakaya_table.webp"]
    assert sorted(uploaded) == ["scene_elevator_hall.webp", "scene_izakaya_table.webp"]
    assert up.failed_paths == {"scene_phone_desk.webp", "scene_corridor.webp"}
    why = dict(up.failed)
    assert "11 bytes is over the bucket's 10 byte limit" == why["scene_phone_desk.webp"]
    assert "EntityTooLarge" in why["scene_corridor.webp"]
    assert "scene_phone_desk.webp" in up.summary() and "Not uploaded" in up.summary()

    # The SQL must describe the bucket, not this machine: the two files that
    # did not get there read as "no picture", and the two that did are kept.
    safe = scene_art.without(survey, up.failed_paths)
    sql = scenes.to_sql(safe)
    assert "scene_elevator_hall.webp" in sql and "scene_izakaya_table.webp" in sql
    assert "scene_phone_desk.webp" not in sql and "scene_corridor.webp" not in sql
    # The corridor, having no picture of its own in the bucket, borrows the
    # elevator hall's until it does; the desk phone's stand-in has none to lend.
    assert "('scene_corridor', 'オフィスの廊下', 'scene_elevator_hall.webp')" in sql
    assert "'scene_phone_desk'" not in sql
    # ...and the survey itself is untouched.
    assert {s.scene_id for s in survey if s.has_art} >= {"scene_phone_desk", "scene_corridor"}


def test_nothing_failed_means_nothing_to_say():
    assert scene_art.UploadResult().summary() == ""
    assert scene_art.without([], set()) == []


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
    # Asked for compressed output, because the bucket has a size limit and a
    # 1536×1024 "high" draft with no compression went over it.
    assert captured["body"]["output_compression"] == config.IMAGE_COMPRESSION
    assert 0 <= config.IMAGE_COMPRESSION <= 100


def test_the_cli_writes_the_summary_even_when_there_is_nothing_to_draw(tmp_path):
    """Once the bank is full every night is this night, and the workflow
    appends the summary file whatever happened — so it has to exist."""
    from bjt import cli

    (tmp_path / "scenes").mkdir()
    for scene in scenes.survey(tmp_path):
        (tmp_path / "scenes" / f"{scene.scene_id}.webp").write_bytes(b"art")
    summary = tmp_path / "s.md"
    rc = cli.main(["scenes", "--generate", "--provider", "placeholder",
                   "--media-dir", str(tmp_path), "--summary", str(summary)])
    assert rc == 0
    assert summary.is_file()
    assert "nothing to draw" in summary.read_text()


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


# ----- stand-ins and the refusal ledger ---------------------------------------

def test_a_scene_without_a_picture_borrows_its_stand_ins(tmp_path):
    (tmp_path / "scenes").mkdir()
    (tmp_path / "scenes" / "scene_phone_desk.webp").write_bytes(b"art")
    survey = scenes.survey(tmp_path)
    outside = next(s for s in survey if s.scene_id == "scene_phone_mobile_outside")
    assert not outside.has_art
    assert scenes.stand_in_for(outside, survey).scene_id == "scene_phone_desk"
    sql = scenes.to_sql(survey)
    assert "('scene_phone_mobile_outside', '外出先で携帯電話', 'scene_phone_desk.webp')" in sql
    assert "borrows scene_phone_desk's" in sql
    # One hop only: the desk pair borrows from the open floor, which has nothing.
    pair = next(s for s in survey if s.scene_id == "scene_office_desk_pair")
    assert scenes.stand_in_for(pair, survey) is None
    # A scene with its own picture lends and never borrows.
    desk = next(s for s in survey if s.scene_id == "scene_phone_desk")
    assert scenes.stand_in_for(desk, survey) is None


def test_every_stand_in_is_a_bank_scene_with_a_brief():
    for a, b in scenes.STAND_INS.items():
        assert a in scenes.SCENE_BRIEFS and b in scenes.SCENE_BRIEFS
        assert a != b


def test_the_ledger_counts_refusals_and_records_new_ones(monkeypatch):
    requests = []

    def fake_json(method, url, body, headers):
        requests.append(body["prefix"])
        return [{"name": "scene_phone_mobile_outside-1.txt", "id": "1"},
                {"name": "scene_phone_mobile_outside-3.txt", "id": "2"},
                {"name": "scene_corridor-2.txt", "id": "3"},
                {"name": "junk", "id": "4"}]

    sent = []
    monkeypatch.setattr(scene_art, "_json_request", fake_json)
    monkeypatch.setattr(scene_art, "_request",
                        lambda m, url, body, headers: sent.append((url, body, headers["Content-Type"])) or b"")
    bucket = scene_art.Bucket(url="https://p.supabase.co", key="k")
    assert bucket.refusals() == {"scene_phone_mobile_outside": 3, "scene_corridor": 2}
    assert requests == ["rejected/"]
    bucket.record_refusal("scene_corridor", 3, ("readable text", "wrong setting"))
    assert sent[0][0].endswith("/object/scenes/rejected/scene_corridor-3.txt")
    assert sent[0][1] == b"readable text\nwrong setting\n"


def test_a_scene_at_its_lifetime_allowance_is_not_drawn_again(tmp_path):
    wanted = [s for s in scenes.survey(tmp_path) if s.scene_id in
              ("scene_phone_mobile_outside", "scene_corridor")]
    provider = _Real()
    refused = []
    result = scene_art.draw(
        wanted, provider=provider, media_dir=tmp_path, attempts=3, lifetime=6,
        prior={"scene_phone_mobile_outside": 6, "scene_corridor": 5},
        review=lambda img, mt, sc: scene_art.Verdict(False, ("readable text drawn in",)),
        on_reject=lambda sid, n, why: refused.append((sid, n)),
    )
    by_id = {d.scene_id: d for d in result.drawn}
    outside, corridor = by_id["scene_phone_mobile_outside"], by_id["scene_corridor"]
    assert outside.given_up and outside.attempts == 0 and outside.prior == 6
    # One draft left in the corridor's allowance, so one is drawn — not three.
    assert not corridor.given_up and corridor.attempts == 1 and provider.calls == 1
    assert refused == [("scene_corridor", 6)]
    assert (tmp_path / "scenes" / "rejected" / "scene_corridor-6.txt").exists()
    assert "given up" in result.summary() and "1 (5)" in result.summary()
    assert result.failed and not result.approved


# ----- per-item pictures (画像把握) --------------------------------------------

def _pictures(tmp_path):
    return [s for s in scenes.survey(tmp_path) if s.is_picture]


def test_the_survey_lists_every_committed_picture_with_its_brief_and_options(tmp_path):
    pics = _pictures(tmp_path)
    assert pics, "the reference batch of 画像把握 ships four pictures"
    for s in pics:
        assert s.scene_id.startswith(scenes.PICTURE_PREFIX)
        assert s.used_by == ("gazou_haaku",) and s.cell_count == 1
        assert len(s.brief.split()) >= 25 and len(s.options) == 4
        assert s.answer is not None and s.question
        assert not s.has_art
    # After the bank in the commissioning order: one picture serves one item.
    order = scenes.survey(tmp_path)
    assert all(not s.is_picture for s in order[:len(order) - len(pics)])


def test_a_picture_prompt_is_the_brief_and_the_reviewer_sees_the_four_descriptions(tmp_path):
    pic = _pictures(tmp_path)[0]
    drawn = scenes.image_prompt(pic)
    assert pic.brief in drawn and "must not contain" in drawn
    assert "No words or letters" in drawn
    reviewed = scenes.prompt_for(pic)
    for opt in pic.options:
        assert opt in reviewed
    assert "✔" in reviewed and pic.question in reviewed


def test_a_picture_has_no_stand_in(tmp_path):
    survey = scenes.survey(tmp_path)
    for pic in _pictures(tmp_path):
        assert scenes.stand_in_for(pic, survey) is None


def test_the_visual_gate_refuses_a_picture_a_reader_describes_differently(monkeypatch, tmp_path):
    from bjt import llm
    pic = _pictures(tmp_path)[0]
    monkeypatch.setattr(llm, "review_scene_image",
                        lambda image, mt, brief, rules: {r: False for r in rules} | {"notes": ""})
    picks = iter([pic.answer, pic.answer, (pic.answer + 1) % 4])
    asked = []
    monkeypatch.setattr(llm, "answer_from_image",
                        lambda image, mt, q, opts, model=None: asked.append(q) or {"choice": next(picks), "reason": "x"})
    verdict = scene_art.review_with_model(b"img", "image/png", pic)
    assert not verdict.approved and "rather than the marked description" in verdict.reasons[0]
    assert asked == [pic.question] * 3, "three trials, stopped at the first miss"

    picks = iter([pic.answer] * 3)
    assert scene_art.review_with_model(b"img", "image/png", pic).approved


def test_the_picture_rules_are_checked_before_the_reader_sits_it(monkeypatch, tmp_path):
    from bjt import llm
    pic = _pictures(tmp_path)[0]
    monkeypatch.setattr(llm, "review_scene_image",
                        lambda image, mt, brief, rules: {r: r == "unclear" for r in rules} | {"notes": ""})
    monkeypatch.setattr(llm, "answer_from_image",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("not asked")))
    verdict = scene_art.review_with_model(b"img", "image/png", pic)
    assert not verdict.approved and verdict.reasons == (scene_art.PICTURE_RULES["unclear"],)


def test_a_night_draws_only_so_many_pictures(tmp_path, monkeypatch, capsys):
    from bjt import cli, config
    monkeypatch.setattr(config, "NIGHT_MAX_PICTURES", 2)
    # About the cap, not the ledger: with nothing withdrawn the library holds
    # more pictures than the cap allows, which is what there has to be to test it.
    monkeypatch.setattr("bjt.withdrawn.ids", lambda path=None: frozenset())
    assert cli.main(["scenes", "--generate", "--provider", "placeholder", "--only", "pictures",
                     "--media-dir", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert out.count("| pic_") == 2


def test_a_withdrawn_question_gets_no_picture(monkeypatch):
    """Nobody will see it, so nobody pays for it."""
    from bjt import scenes, withdrawn
    every = {it["id"] for _, it in scenes.picture_items()}
    victim = sorted(every)[0]
    monkeypatch.setattr(withdrawn, "ids", lambda path=None: frozenset({victim}))
    assert victim not in {it["id"] for _, it in scenes.picture_items()}
