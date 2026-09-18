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

    item, iid, kept, detail = cli._generate_and_gate(store, "goi_bunpou", "J2", gate=True)
    assert kept
    stored = store.get_item(iid)
    assert stored["gate_verdict"] == "kept"
    assert stored["full_success_rate"] == 1.0
    assert stored["cold_success_rate"] == 0.0


def test_generate_and_gate_skipped(store, monkeypatch):
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: _valid("hyougen"))
    item, iid, kept, detail = cli._generate_and_gate(store, "hyougen", "J2", gate=False)
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
    assert "insert into public.testers (email, note, unlimited)" in out
    assert "'z@example.com', '', false" in out
    assert "unlimited = excluded.unlimited" in out

    assert cli.main(["tester", "z@example.com", "--unlimited"]) == 0
    out = capsys.readouterr().out
    assert "'z@example.com', '', true" in out
    assert "no daily ceiling" in out


def test_tester_remove_and_bad_input(capsys):
    assert cli.main(["tester", "b@example.com", "--remove"]) == 0
    assert "delete from public.testers where email = 'b@example.com'" in capsys.readouterr().out
    assert cli.main(["tester", "not-an-email"]) == 2
