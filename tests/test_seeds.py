"""Seeds the repository can make for itself, from the reference batches."""
import json

from bjt import config, seeds
from bjt.generators.base import load_seed_json


def test_examples_come_from_the_batches_in_the_generators_shape():
    examples = seeds.examples_from_batches()
    assert "hatsugen_choukai" in examples and "goi_bunpou" in examples
    for item_type, items in examples.items():
        assert 0 < len(items) <= seeds.PER_TYPE
        for item in items:
            # The shape the generator emits and the few-shot README describes:
            # no identity, no provenance, no media, no answer key.
            for field in seeds._NOT_AN_EXAMPLE_FIELD:
                assert field not in item
            assert item["explanation_ja"] and item["options"]
            assert sum(o["role"] == "correct" for o in item["options"]) == 1
            assert all(o.get("why") for o in item["options"])


def test_examples_are_spread_across_levels():
    # 発言聴解 has J3, J2 and J1 batches; five examples should show all three.
    items = seeds.examples_from_batches()["hatsugen_choukai"]
    assert len(items) == seeds.PER_TYPE
    # Level was stripped from the example, so read it off the source bundles.
    stems = {it["stem"] for it in items}
    levels_seen = set()
    for path in config.BATCH_DIR.glob("hatsugen_choukai_*.json"):
        if path.name.endswith(".source.json"):
            continue
        bundle = json.loads(path.read_text(encoding="utf-8"))
        if any(it["stem"] in stems for it in bundle["items"]):
            levels_seen.add(bundle["level"])
    assert levels_seen == {"J3", "J2", "J1"}


def test_bootstrap_writes_a_seeds_dir_the_generator_reads(tmp_path, monkeypatch):
    target = tmp_path / "seeds"
    result = seeds.bootstrap(target)
    assert not result.skipped
    assert (target / seeds.MARKER).exists()
    assert result.business_terms > 0
    assert (target / "vocab" / "business_terms.txt").exists()
    # What it must not invent.
    assert not (target / "official").exists()
    assert not (target / "levels.json").exists()
    assert not list((target / "vocab").glob("jlpt_*"))

    monkeypatch.setattr(config, "SEEDS_DIR", target)
    assert len(load_seed_json("fewshot", "goi_bunpou")) == result.fewshot["goi_bunpou"]
    assert "Built" in result.summary() and "no official/ items" in result.summary()


def test_bootstrap_never_overwrites_real_seeds(tmp_path):
    real = tmp_path / "seeds"
    (real / "fewshot").mkdir(parents=True)
    (real / "fewshot" / "goi_bunpou.json").write_text("[]", encoding="utf-8")
    assert seeds.has_licensed_seeds(real)
    result = seeds.bootstrap(real)
    assert result.skipped and "leaving it alone" in result.skipped
    assert not (real / seeds.MARKER).exists()
    # --force does, and the marker then says so.
    assert not seeds.bootstrap(real, force=True).skipped
    assert not seeds.has_licensed_seeds(real)


def test_a_bootstrapped_dir_is_not_licensed_and_can_be_rebuilt(tmp_path):
    target = tmp_path / "seeds"
    seeds.bootstrap(target)
    assert not seeds.has_licensed_seeds(target)
    assert not seeds.bootstrap(target).skipped


def test_the_cli_bootstraps_and_reports(tmp_path, monkeypatch, capsys):
    from bjt import cli

    monkeypatch.setattr(config, "SEEDS_DIR", tmp_path / "seeds")
    assert cli.main(["seeds", "--bootstrap"]) == 0
    out = capsys.readouterr().out
    assert "Built" in out and "bootstrapped from batches/" in out
