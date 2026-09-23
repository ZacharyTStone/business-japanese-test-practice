"""CLI orchestration: official-item normalization, generate+gate+store wiring,
and the argparse guard."""
import copy

import pytest

from bjt import cli, fixtures, schemas
from bjt.fidelity import roles


def _valid(t):
    return copy.deepcopy(fixtures.FIXTURES[t])


def test_normalize_light_shape():
    raw = [{"stem": "x", "options": ["a", "b", "c", "d"], "answer": 2, "explanation_ja": "e"}]
    norm = cli._normalize_official(raw, "goi_bunpou")
    assert schemas.correct_index(norm[0]["options"]) == 2
    assert norm[0]["item_type"] == "goi_bunpou"


def test_normalize_full_shape_passthrough(goi_item):
    norm = cli._normalize_official([goi_item], "goi_bunpou")
    assert schemas.correct_index(norm[0]["options"]) == schemas.correct_index(goi_item["options"])


def test_generate_and_gate_kept(store, monkeypatch):
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: _valid("goi_bunpou"))

    # The gated item is shuffled, so locate the correct option by its text.
    correct_text = next(o["text"] for o in _valid("goi_bunpou")["options"]
                        if o["role"] == roles.CORRECT)

    def fake_answer(question, options, model=None):
        ci = options.index(correct_text)
        # full: correct; cold (stem withheld): wrong
        return {"choice": ci if "withheld" not in question else (ci + 1) % 4, "reason": "x"}

    monkeypatch.setattr("bjt.fidelity.answerability.llm.answer_choice", fake_answer)

    item, iid, kept, detail, _ = cli._generate_and_gate(store, "goi_bunpou", "J2", gate=True)
    assert kept
    stored = store.get_item(iid)
    assert stored["gate_verdict"] == "kept"
    assert stored["full_success_rate"] == 1.0
    assert stored["cold_success_rate"] == 0.0


def test_generate_and_gate_skipped(store, monkeypatch):
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: _valid("hyougen"))
    item, iid, kept, detail, _ = cli._generate_and_gate(store, "hyougen", "J2", gate=False)
    assert kept
    assert store.get_item(iid)["gate_verdict"] == "skipped"


def test_practice_requires_type_without_demo():
    with pytest.raises(SystemExit):
        cli.main(["practice", "-n", "1"])


def test_selftest_passes():
    assert cli.main(["selftest"]) == 0


# ----- the tester list -----------------------------------------------------

def test_tester_sql_is_lowercased_and_idempotent(capsys):
    assert cli.main(["tester", " Zach@Example.com ", "--note", "owner"]) == 0
    out = capsys.readouterr().out
    assert "insert into public.testers" in out
    assert "'zach@example.com'" in out and "Zach" not in out.split("--")[-1]
    assert "on conflict (email) do update" in out


def test_tester_unlimited_lifts_the_ceiling_and_is_off_by_default(capsys):
    assert cli.main(["tester", "z@example.com"]) == 0
    out = capsys.readouterr().out
    assert "insert into public.testers (email, note, unlimited, may_veto, max_daily_goal)" in out
    assert "'z@example.com', '', false" in out
    assert "unlimited = excluded.unlimited" in out

    assert cli.main(["tester", "z@example.com", "--unlimited"]) == 0
    out = capsys.readouterr().out
    assert "'z@example.com', '', true, false" in out
    assert "no daily ceiling" in out


def test_tester_veto_is_off_by_default_and_says_what_it_does(capsys):
    """The veto flag unpublishes for everybody on one press, so the SQL that
    grants it says so out loud — it is the owner's row, not a tester's."""
    assert cli.main(["tester", "z@example.com"]) == 0
    assert "'z@example.com', '', false, false" in capsys.readouterr().out

    assert cli.main(["tester", "z@example.com", "--veto"]) == 0
    out = capsys.readouterr().out
    assert "'z@example.com', '', false, true" in out
    assert "for EVERYBODY on one press" in out
    assert "may_veto = excluded.may_veto" in out

    assert cli.main(["tester", "z@example.com", "--unlimited", "--veto"]) == 0
    out = capsys.readouterr().out
    assert "'z@example.com', '', true, true" in out
    assert "no daily ceiling and the veto button" in out


def test_tester_max_goal_sizes_one_accounts_day(capsys):
    """One row may carry a number: the largest set that account may choose in
    the app, and where its day stops. Null everywhere else, which is the
    ten-a-day, fifteen-at-most everybody gets."""
    assert cli.main(["tester", "z@example.com"]) == 0
    out = capsys.readouterr().out
    assert "insert into public.testers (email, note, unlimited, may_veto, max_daily_goal)" in out
    assert "'z@example.com', '', false, false, null)" in out

    assert cli.main(["tester", "z@example.com", "--max-goal", "40"]) == 0
    out = capsys.readouterr().out
    assert "'z@example.com', '', false, false, 40)" in out
    assert "a day of up to 40 questions" in out
    assert "max_daily_goal = excluded.max_daily_goal" in out

    # However many: there is no product ceiling here, because what limits a set
    # is how many items the bank has in the learner's window rather than this.
    assert cli.main(["tester", "z@example.com", "--max-goal", "500"]) == 0
    assert "'z@example.com', '', false, false, 500)" in capsys.readouterr().out

    # The only bound left is the smallint the column is declared as, so the CLI
    # refuses only SQL the database itself would reject.
    assert cli.main(["tester", "z@example.com", "--max-goal", "32767"]) == 0
    assert cli.main(["tester", "z@example.com", "--max-goal", "32768"]) == 2
    assert cli.main(["tester", "z@example.com", "--max-goal", "0"]) == 2


def test_tester_remove_and_bad_input(capsys):
    assert cli.main(["tester", "b@example.com", "--remove"]) == 0
    assert "delete from public.testers where email = 'b@example.com'" in capsys.readouterr().out
    assert cli.main(["tester", "not-an-email"]) == 2


def test_probe_dry_run_names_the_items_with_no_prior_and_spends_nothing(capsys, monkeypatch):
    """A catch-up pass over the committed bank. The dry run is what makes it
    safe to look before spending, since the real one calls a model per item."""
    from bjt.fidelity import difficulty

    def explode(*a, **k):
        raise AssertionError("--dry-run must not reach the model")
    monkeypatch.setattr(difficulty, "measure", explode)

    assert cli.main(["probe", "batches/sougou_dokkai_J1_001.json", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "without a difficulty signal" in out
    assert "would measure" in out


def test_probe_leaves_the_bundle_alone_when_nothing_could_be_measured(capsys, monkeypatch, tmp_path):
    """A fabricated prior is worse than none — the queue would trust it — so a
    probe that cannot run writes nothing and says so."""
    import shutil

    from bjt.fidelity import difficulty

    src = "batches/sougou_dokkai_J1_001.json"
    dst = tmp_path / "b.json"
    shutil.copy(src, dst)
    before = dst.read_text(encoding="utf-8")

    monkeypatch.setattr(difficulty, "measure",
                        lambda item, **k: difficulty.DifficultyResult(measured=False))
    assert cli.main(["probe", str(dst)]) == 1
    assert dst.read_text(encoding="utf-8") == before
