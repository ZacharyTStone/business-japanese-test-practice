"""The discriminator->generator tell feedback loop, the smoke harness, seeds
status, and gen --json."""
import copy
import json
from types import SimpleNamespace


from bjt import cli, fixtures, llm, schemas
from bjt.generators import get_generator


def _valid(t):
    return copy.deepcopy(fixtures.FIXTURES[t])


# ----- tell feedback loop (fidelity #3 closes onto #1's prompt) -----------

def test_latest_tells_roundtrip(store):
    store.insert_discriminator_run("goi_bunpou", 4, 4, 0.75, ["tell one", "tell two"])
    assert store.latest_tells("goi_bunpou") == ["tell one", "tell two"]
    assert store.latest_tells("hyougen") == []  # none for this type


def test_tells_injected_into_prompt(store):
    store.insert_discriminator_run("goi_bunpou", 4, 4, 0.75, ["distractors too obviously fake"])
    gen = get_generator("goi_bunpou", store=store)
    sp = gen.system_prompt("J2")
    assert "distractors too obviously fake" in sp
    assert "indistinguishable from an official item" in sp


def test_no_tells_no_constraint_block(store):
    gen = get_generator("goi_bunpou", store=store)
    assert "indistinguishable from an official item" not in gen.system_prompt("J2")


# ----- smoke harness ------------------------------------------------------

def _fake_kept_answer(question, options, model=None):
    ci = options.index(next(o["text"] for o in _valid("goi_bunpou")["options"]
                            if o["role"] == "correct"))
    return {"choice": ci if "withheld" not in question else (ci + 1) % 4, "reason": "x"}


def test_smoke_passes(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("bjt.config.DB_PATH", tmp_path / "smoke.db")
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: _valid("goi_bunpou"))
    monkeypatch.setattr("bjt.fidelity.answerability.llm.answer_choice", _fake_kept_answer)
    rc = cli.cmd_smoke(SimpleNamespace(type="goi_bunpou", level="J2", n=3, no_gate=False))
    assert rc == 0
    assert "SMOKE PASSED" in capsys.readouterr().out


def test_smoke_fails_on_crash(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("bjt.config.DB_PATH", tmp_path / "smoke.db")

    def boom(*a, **k):
        raise llm.LLMError("api down")

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", boom)
    rc = cli.cmd_smoke(SimpleNamespace(type="goi_bunpou", level="J2", n=2, no_gate=True))
    assert rc == 1
    assert "SMOKE FAILED" in capsys.readouterr().out


# ----- gen --json ---------------------------------------------------------

def test_gen_json_emits_valid_item(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("bjt.config.DB_PATH", tmp_path / "gen.db")
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: _valid("hyougen"))
    rc = cli.cmd_gen(
        SimpleNamespace(type="hyougen", level="J2", no_gate=True, no_sanity=True, json=True)
    )
    assert rc == 0
    out = capsys.readouterr().out
    item = json.loads(out)  # stdout is pure JSON (verdict goes to stderr)
    assert schemas.validate_item("hyougen", item) == []


# ----- seeds status -------------------------------------------------------

def test_seeds_status_runs(seeds_dir, capsys):
    (seeds_dir / "vocab" / "business_terms.txt").write_text("納期\n", encoding="utf-8")
    rc = cli.cmd_seeds(SimpleNamespace())
    assert rc == 0
    out = capsys.readouterr().out
    assert "goi_bunpou" in out and "hyougen" in out
    assert "business terms: 1" in out
