"""The withdrawn ledger: what it may say, and what saying it does.

A line in `batches/withdrawn.txt` takes a question out of the bank for
everybody. These tests hold the ledger to the library it names, the reasons to
the ones a tester's report uses, and the committed SQL to what `bjt publish`
writes from the ledger — so a line that is added and not published, or
published and not added, fails here rather than in front of a learner.
"""
import copy
import pathlib
import re

import pytest

from bjt import batch, plan, publish, withdrawn

ROOT = pathlib.Path(__file__).resolve().parent.parent
BATCHES = ROOT / "batches"
REFERENCE = BATCHES / "hatsugen_choukai_J2_001.json"
FEEDBACK_MIGRATION = ROOT / "supabase" / "migrations" / "20260919000400_report_a_bad_question.sql"


def _library_ids() -> set[str]:
    return {it["id"] for p in batch.bundles() for it in batch.load(p)["items"]}


# ----- the committed ledger -------------------------------------------------

def test_the_committed_ledger_reads():
    ledger = withdrawn.load()
    assert ledger, "the ledger is empty — was it moved?"
    for w in ledger.values():
        assert w.reason in withdrawn.REASONS
        assert len(w.note) >= 20, f"{w.item_id}: say what is wrong, in a sentence"


def test_every_withdrawn_id_names_a_committed_item():
    """A typo would withdraw nothing and say it had."""
    unknown = sorted(set(withdrawn.load()) - _library_ids())
    assert not unknown, f"not in any bundle: {unknown}"


def test_the_reasons_are_the_ones_a_report_uses():
    """One vocabulary for a tester's report and the decision it leads to."""
    sql = FEEDBACK_MIGRATION.read_text(encoding="utf-8")
    block = sql.split("reason in (", 1)[1].split(")", 1)[0]
    assert tuple(re.findall(r"'([a-z_]+)'", block)) == withdrawn.REASONS


def test_the_committed_sql_is_what_publish_writes():
    """Every bundle's SQL is exactly what `bjt publish` writes from the bundle
    and the ledger today. A ledger line that nobody published would leave the
    question in the bank; this is where that shows."""
    stale = []
    for path in batch.bundles():
        sql = path.with_suffix(".sql")
        if not sql.exists():
            continue
        if publish.bundle_sql(batch.load(path), path.stem) != sql.read_text(encoding="utf-8"):
            stale.append(sql.name)
    assert not stale, f"re-run `python -m bjt publish` for: {stale}"


# ----- parsing --------------------------------------------------------------

def test_a_missing_ledger_is_an_empty_one(tmp_path):
    assert withdrawn.load(tmp_path / "nothing.txt") == {}


def test_comments_and_blank_lines_are_ignored(tmp_path):
    f = tmp_path / "w.txt"
    f.write_text("# a comment\n\nabc123  unnatural  The option is not Japanese anyone says.\n",
                 encoding="utf-8")
    assert withdrawn.load(f)["abc123"].note == "The option is not Japanese anyone says."


@pytest.mark.parametrize("line", [
    "abc123",                                       # no reason, no note
    "abc123  unnatural",                            # no note
    "abc123  boring  Not a reason in the set.",     # outside the closed set
])
def test_a_malformed_line_is_an_error_not_a_skip(tmp_path, line):
    """Skipping it would put the question back in front of learners without
    anybody deciding to."""
    f = tmp_path / "w.txt"
    f.write_text(line + "\n", encoding="utf-8")
    with pytest.raises(ValueError):
        withdrawn.load(f)


def test_an_item_withdrawn_twice_is_an_error(tmp_path):
    f = tmp_path / "w.txt"
    f.write_text("abc123  unnatural  First reason given here.\n"
                 "abc123  ambiguous  Second reason given here.\n", encoding="utf-8")
    with pytest.raises(ValueError):
        withdrawn.load(f)


# ----- publishing -----------------------------------------------------------

def test_publish_unpublishes_exactly_the_withdrawn_items():
    bundle = batch.load(REFERENCE)
    victim = bundle["items"][0]["id"]
    sql = publish.bundle_sql(bundle, "ref", withdrawn_ids={victim})
    update = sql.split("update public.items set is_published = false", 1)[1].split(";", 1)[0]
    assert re.findall(r"'([0-9a-f]{10})'", update) == [victim]
    # Inside the transaction, after the rows exist.
    assert sql.index("insert into public.items") < sql.index("is_published = false") < sql.index("commit;")


def test_publish_never_sets_anything_back_to_published():
    """An owner's veto from the app must survive every later deploy."""
    bundle = batch.load(REFERENCE)
    for ids in (set(), {bundle["items"][0]["id"]}):
        assert "is_published = true" not in publish.bundle_sql(bundle, "ref", withdrawn_ids=ids)


def test_a_bundle_with_nothing_withdrawn_says_nothing_about_it():
    sql = publish.bundle_sql(batch.load(REFERENCE), "ref", withdrawn_ids=set())
    assert "is_published" not in sql


# ----- what still counts ------------------------------------------------------

def test_a_live_bundle_keeps_only_the_clips_a_live_item_plays():
    bundle = batch.load(REFERENCE)
    victim = bundle["items"][0]
    live = withdrawn.live_bundle(bundle, {victim["id"]})

    assert victim["id"] not in {it["id"] for it in live["items"]}
    assert len(live["items"]) == len(bundle["items"]) - 1

    used = set()
    for it in live["items"]:
        a = it["audio"]
        used |= {a["narration"], *a["options"], *a["dialogue"]}
    kept = {c["clip_id"] for c in live["audio_manifest"]}
    labels = {c["clip_id"] for c in bundle["audio_manifest"] if c["kind"] == "option_label"}
    assert kept == (used - {None}) | labels
    # A clip the victim shares with a live item is still made.
    assert used & set(victim["audio"]["options"]) <= kept
    # And the original is untouched.
    assert victim["id"] in {it["id"] for it in bundle["items"]}


def test_a_withdrawn_item_is_off_its_shelf(monkeypatch):
    """So the planner sees the shelf as emptier and refills it."""
    victim = batch.load(REFERENCE)["items"][0]
    monkeypatch.setattr(withdrawn, "ids", lambda path=None: frozenset())
    before = plan._published_counts()[("hatsugen_choukai", "J2")]
    monkeypatch.setattr(withdrawn, "ids", lambda path=None: frozenset({victim["id"]}))
    after = plan._published_counts()[("hatsugen_choukai", "J2")]
    assert after == before - 1


def test_a_withdrawn_items_cell_stays_spent():
    """A new item for that cell would hash to the withdrawn id, inherit the
    unpublish, and never be served."""
    ledger = withdrawn.load()
    spent = batch.spent_cell_ids("hatsugen_choukai")
    for it in batch.load(REFERENCE)["items"]:
        if it["id"] in ledger:
            assert it["seed_cell"]["id"] in spent


def test_check_bundle_does_not_hold_a_withdrawn_item_to_the_lint():
    bundle = copy.deepcopy(batch.load(REFERENCE))
    ledger = set(withdrawn.ids())
    target = next(it for it in bundle["items"] if it["id"] not in ledger)
    target["options"][0]["text"] = "〇〇商事の田中です。"

    def status(ids):
        report = batch.check_bundle(bundle, withdrawn_ids=ids)
        return next(c.status for c in report.checks if c.name == "reads like Japanese")

    assert status(ledger) == "fail"
    assert status(ledger | {target["id"]}) == "pass"
