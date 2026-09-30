"""The picture job stops at the run's ceiling, and an outage is not a refusal.

Two ways the job spent what nobody meant it to: the ceiling raised inside the
review was caught as one scene's error, and the next scene began by buying
another image; and a reader that could not be reached was scored as choosing
nothing, a refusal written into the bucket's lifetime ledger — six of those
and a 画像把握 item is never served.
"""
import pytest

from bjt import cli, config, http, llm, scene_art, scenes


class _Real:
    name = "fake"
    suffix = ".png"
    media_type = "image/png"
    real = True

    def __init__(self):
        self.calls = 0

    def generate(self, prompt):
        self.calls += 1
        return scene_art._flat_png(6, 4, (self.calls, 0, 0))


def _ceiling(*a, **k):
    raise llm.LLMSpendLimitError("spend ceiling reached: $0.50 of $0.50")


def test_no_image_is_bought_over_the_ceiling(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "RUN_BUDGET_USD", 0.5)
    llm.spend.usd = 0.5
    provider = _Real()
    with pytest.raises(scene_art.DrawStopped) as stop:
        scene_art.draw(scenes.survey(tmp_path)[:3], provider=provider,
                       review=lambda *a: scene_art.Verdict(True), media_dir=tmp_path)
    assert provider.calls == 0
    assert stop.value.result.stopped and "spend ceiling" in stop.value.result.stopped


def test_every_image_is_a_request_on_the_count(tmp_path):
    provider = _Real()
    scene_art.draw(scenes.survey(tmp_path)[:2], provider=provider,
                   review=lambda *a: scene_art.Verdict(True), media_dir=tmp_path)
    assert llm.spend.attempts == provider.calls == 2


def test_the_ceiling_met_in_review_ends_the_drawing_and_keeps_what_was_approved(tmp_path):
    wanted = scenes.survey(tmp_path)[:3]
    verdicts = iter([scene_art.Verdict(True)])

    def review(image, media_type, scene):
        try:
            return next(verdicts)
        except StopIteration:
            _ceiling()

    provider = _Real()
    with pytest.raises(scene_art.DrawStopped) as stop:
        scene_art.draw(wanted, provider=provider, review=review, media_dir=tmp_path)
    result = stop.value.result
    assert provider.calls == 2, "the third scene is never started"
    assert [d.ok for d in result.drawn] == [True, False]
    assert result.drawn[1].error.startswith("stopped:")
    assert "Stopped before the end" in result.summary()
    assert isinstance(stop.value, llm.LLMBillingError)


def test_an_empty_image_account_stops_the_drawing(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")

    def refuse(*a, **k):
        raise RuntimeError("POST https://api.openai.com/v1/images/generations → HTTP 400: "
                           "billing_hard_limit_reached")

    monkeypatch.setattr(http, "json_request", refuse)
    with pytest.raises(scene_art.DrawStopped):
        scene_art.draw(scenes.survey(tmp_path)[:3], provider=scene_art.OpenAIImageProvider(),
                       review=lambda *a: scene_art.Verdict(True), media_dir=tmp_path)


def _picture(tmp_path):
    return next(s for s in scenes.survey(tmp_path) if s.is_picture)


def _clean_flags(monkeypatch):
    monkeypatch.setattr(llm, "review_scene_image",
                        lambda image, mt, brief, rules: {r: False for r in rules} | {"notes": ""})


@pytest.mark.parametrize("reply", [
    llm.LLMError("API request failed: overloaded"),
    {"choice": "the second one", "reason": "x"},
])
def test_a_reader_that_gave_no_answer_is_an_error_not_a_refusal(tmp_path, monkeypatch, reply):
    _clean_flags(monkeypatch)

    def read(*a, **k):
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(llm, "answer_from_image", read)
    refused = []
    result = scene_art.draw([_picture(tmp_path)], provider=_Real(),
                            review=scene_art.review_with_model, media_dir=tmp_path,
                            on_reject=lambda *a: refused.append(a))
    (only,) = result.drawn
    assert refused == [], "the lifetime ledger counts refusals, not outages"
    assert only.rejected == [] and only.error


def test_a_reader_that_answered_wrongly_is_still_a_refusal(tmp_path, monkeypatch):
    _clean_flags(monkeypatch)
    pic = _picture(tmp_path)
    monkeypatch.setattr(llm, "answer_from_image",
                        lambda *a, **k: {"choice": (pic.answer + 1) % 4, "reason": "x"})
    refused = []
    scene_art.draw([pic], provider=_Real(), review=scene_art.review_with_model,
                   media_dir=tmp_path, attempts=1, on_reject=lambda *a: refused.append(a))
    assert len(refused) == 1


def test_the_command_uploads_nothing_new_but_reports_the_stop(tmp_path, monkeypatch, capsys):
    monkeypatch.setitem(scene_art.PROVIDERS, "fake", _Real)
    monkeypatch.setattr(config, "RUN_BUDGET_USD", 0.5)
    llm.spend.usd = 0.5
    summary = tmp_path / "scenes.md"
    rc = cli.main(["scenes", "--generate", "--provider", "fake", "--media-dir", str(tmp_path),
                   "--summary", str(summary)])
    assert rc == 1
    assert "Stopped before the end" in summary.read_text(encoding="utf-8")
