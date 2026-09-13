"""The seed table: constraint enforcement, spread, and exhaustion."""
import pytest

from bjt import seedtable


@pytest.fixture
def table():
    return seedtable.load("hatsugen_choukai")


def test_every_cell_satisfies_all_three_constraints(table):
    data = table.data
    settings = {s["id"]: s for s in data["settings"]}
    functions = {f["id"]: f for f in data["functions"]}
    for cell in table.cells():
        setting = settings[cell.setting]
        function = functions[cell.function]
        assert cell.relation in data["setting_relations"][cell.setting]
        assert cell.relation in function["relations"]
        assert setting["channel"] in function["channels"]
        assert cell.channel == setting["channel"]


def test_phone_only_functions_never_land_in_person(table):
    """The constraint that stops 「来客を迎えて案内する」 over the phone, and
    「電話を取り次ぐ」 in a restaurant."""
    for cell in table.cells():
        if cell.function.startswith("phone_"):
            assert cell.channel == "phone"
        if cell.function in ("greet_and_guide", "offer_food"):
            assert cell.channel == "in_person"


def test_cell_ids_are_unique(table):
    ids = [c.id for c in table.cells()]
    assert len(ids) == len(set(ids))


def test_sample_spreads_across_settings_and_functions(table):
    cells = table.sample(10, level="J2", seed=3)
    assert len(cells) == 10
    # Ten picks, ten different functions — that is the whole point of sampling
    # greedily rather than uniformly.
    assert len({c.function for c in cells}) == 10
    assert len({c.setting for c in cells}) >= 7


def test_sample_never_returns_an_excluded_cell(table):
    first = table.sample(5, level="J2", seed=1)
    used = {c.id for c in first}
    second = table.sample(5, level="J2", exclude_ids=used, seed=1)
    assert not used & {c.id for c in second}


def test_sample_is_capped_by_the_pool_rather_than_repeating(table):
    everything = {c.id for c in table.cells(level="J3")}
    got = table.sample(len(everything) + 50, level="J3", exclude_ids=everything)
    assert got == []


def test_every_setting_offers_at_least_one_scene(table):
    for cell in table.cells():
        assert cell.scenes, f"{cell.setting} has no scene to draw"
    # The bank stays small on purpose — images are reused, not generated per item.
    assert len(table.scene_bank) <= 100


def test_coverage_counts_only_cells_in_this_table(table):
    some = [c.id for c in table.cells(level="J2")[:3]]
    cov = table.coverage(some + ["not_a_real_cell@J2"])
    assert cov["used_cells"] == 3
    assert cov["total_cells"] == len(table.cells())


def test_missing_table_raises_rather_than_silently_degrading(tmp_path, monkeypatch):
    monkeypatch.setattr("bjt.config.SEEDTABLE_DIR", tmp_path)
    with pytest.raises(FileNotFoundError):
        seedtable.load("hyougen")
