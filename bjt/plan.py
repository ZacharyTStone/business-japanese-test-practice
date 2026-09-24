"""What to write next, decided by counting rather than by taste.

The app's queue can only do its job if the bank underneath it is the right
shape. It serves three levels, spreads a set across problem types so nobody gets
five 語彙・文法 in a row, and slips in one item from the level above — and every
one of those promises is empty when the library is 40 items of one type at one
level and six of everything else. A queue cannot interleave what is not there.

So the bank has 30 shelves — ten problem types × three levels — and the job of
the nightly run is to **fill the shelf that is furthest behind its share of the
exam**. That is the whole algorithm:

    give the first few items to the emptiest READING shelves (the floor);
    while there is budget left:
        give the next item to the shelf furthest behind its share,
        skipping any shelf that has no unspent seed cells
        or has already taken its share of this run
        or belongs to a type that has had its night's allowance

"Furthest behind its share" rather than "fewest items" because the exam does not
ask the same number of every type: 場面把握 and 状況把握 are five-question types
where the other seven are ten (`schemas.EXAM_QUESTIONS`). Levelling all thirty
shelves flat therefore builds a bank in the wrong shape — deepest, in
proportional terms, in exactly the two types a learner meets least often. The
rule is otherwise unchanged, and with equal shares it *is* the old rule.

It has three properties worth the plainness. It is *deterministic*: the same
library produces the same work order, so a run is reviewable before it is made.
It *converges*: repeated runs level the shelves rather than deepening whichever
type happens to be easiest to generate. And it *stops*: a shelf whose seed table
is exhausted drops out, which turns "will we run out of questions?" into a
number this module prints.

Two caps keep a night's work reviewable by a person:

  * ``budget`` — how many items the whole run may write. Content that nobody
    reads is worse than no content, and a human has to read this.
  * ``per_slot`` — how many may go into one shelf. Without it a single run can
    write thirty items of one type, which is one big risk instead of four small
    ones, and a diff nobody finishes.

What this module deliberately does NOT do is look at learners. The roadmap is
explicit that targeting an individual with a generation run is the wrong shape —
it costs money per person, it leaks a profile into a prompt, and it cannot be
reviewed before it is served. Weakness targeting happens in the *queue*, over a
bank that is already published, which is where it is free and reversible. This
module only makes sure the queue has something to choose from.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterable, Optional

from . import batch as batchmod
from . import schemas, seedtable

#: Below this many items, a shelf of a ten-question type is thin enough that the
#: queue notices: a set of five cannot avoid repeating a type that only has a
#: handful published. A five-question type is held to half of it, for the same
#: reason the fill is share-relative — see `Shelf.target`. Reporting only; the
#: greedy fill needs no threshold.
DEFAULT_FLOOR = 12

#: Most items one run may write into one (type, level) shelf.
DEFAULT_PER_SLOT = 3

#: Most items one run may write at all. Eight a night is about two dollars on
#: Sonnet; the bank fills its thin shelves in weeks rather than days, and the
#: owner asked for cheap (2026-09-18). The night's real throttle is the
#: review gate: nothing is written while an earlier night waits unmerged.
DEFAULT_BUDGET = 8

#: How many of the night's items go to the reading shelves (語彙・文法, 表現読解,
#: 総合読解) before the emptiest-first rule sees the rest. The owner asked for
#: reading items every night (2026-09-19): they need no audio and no picture,
#: so they are the cheapest item to ship and the one kind a night should never
#: come back without. Three of eight is one per reading type on an ordinary
#: night; the floor takes the emptiest reading shelves first, exactly as the
#: main rule does, and yields whatever it cannot place back to the main rule.
DEFAULT_READING_MIN = 3

#: Most items a night may write of a type that should stay uncommon. 画像把握
#: is one: each item needs a picture of its own, drawn and reviewed at a cost
#: no shared-bank item has, and the owner asked for it to be a rare question
#: rather than a common one (2026-09-19). Without this, three empty shelves of
#: a new type are the emptiest in the bank and would take every night for a
#: week.
NIGHT_TYPE_CAPS: dict[str, int] = {"gazou_haaku": 1}


@dataclass(frozen=True)
class Shelf:
    """One (item type, level) pair, and what is on it."""

    item_type: str
    level: str
    #: Items already committed to `batches/` for this pair.
    have: int
    #: Seed cells at this level that no committed item has spent yet.
    cells_left: int

    @property
    def target(self) -> int:
        """How deep this shelf should be before it stops being thin.

        Scaled by the type's share of the exam, so a five-question type is not
        held to the depth of a ten-question one. A learner meets 場面把握 half as
        often as 発言聴解, so half the shelf goes half as far in exactly the same
        sense.
        """
        return max(1, round(DEFAULT_FLOOR * schemas.EXAM_QUESTIONS.get(self.item_type, 10) / 10))

    @property
    def thin(self) -> bool:
        return self.have < self.target

    @property
    def exhausted(self) -> bool:
        return self.cells_left == 0


@dataclass(frozen=True)
class WorkItem:
    """One line of the work order: write `n` items for this pair."""

    item_type: str
    level: str
    n: int
    have: int
    cells_left: int


@dataclass
class Survey:
    shelves: list[Shelf] = field(default_factory=list)

    @property
    def items(self) -> int:
        return sum(s.have for s in self.shelves)

    @property
    def cells_left(self) -> int:
        return sum(s.cells_left for s in self.shelves)

    @property
    def empty(self) -> list[Shelf]:
        return [s for s in self.shelves if s.have == 0]

    @property
    def thin(self) -> list[Shelf]:
        return [s for s in self.shelves if s.thin]


def _published_counts() -> dict[tuple[str, str], int]:
    """How many items each (type, level) pair has in the committed bundles.

    The bundles are the ledger rather than the local SQLite database, for the
    same reason `batch.spent_cell_ids` uses them: the database is gitignored, so
    on a fresh clone — which is what CI is, every time — it reports an empty
    library while 88 items sit in the tree.
    """
    counts: dict[tuple[str, str], int] = {}
    for path in batchmod.bundles():
        try:
            bundle = batchmod.load(path)
        except (OSError, json.JSONDecodeError):
            continue
        item_type = bundle.get("item_type")
        if not item_type:
            continue
        for item in bundle.get("items", []):
            level = item.get("level") or bundle.get("level")
            if level:
                counts[(item_type, level)] = counts.get((item_type, level), 0) + 1
    return counts


def survey(item_types: Optional[Iterable[str]] = None) -> Survey:
    """Every shelf, with what is on it and how much room is left."""
    counts = _published_counts()
    out = Survey()
    for item_type in sorted(item_types or seedtable.available()):
        try:
            table = seedtable.load(item_type)
        except FileNotFoundError:
            continue
        spent = batchmod.spent_cell_ids(item_type)
        for level in table.levels:
            cells = table.cells(level)
            out.shelves.append(
                Shelf(
                    item_type=item_type,
                    level=level,
                    have=counts.get((item_type, level), 0),
                    cells_left=sum(1 for c in cells if c.id not in spent),
                )
            )
    return out


def work_order(
    survey_result: Survey,
    *,
    budget: int = DEFAULT_BUDGET,
    per_slot: int = DEFAULT_PER_SLOT,
    reading_min: int = DEFAULT_READING_MIN,
) -> list[WorkItem]:
    """Fill the shelf furthest behind its share, until the budget runs out.

    Two passes of the same greedy rule. The first hands `reading_min` items to
    the reading shelves alone (furthest behind first among them); the second
    hands the rest of the budget to every shelf on the same rule, counting what
    the first pass placed. A reading floor that cannot be filled — every reading
    shelf out of cells, or capped — gives its remainder back to the second pass.

    Ties are broken by item type and then by level, so the order is a function of
    the library and nothing else — run it twice on the same tree and you get the
    same plan, which is what makes it reviewable before it is executed.
    """
    assigned: dict[tuple[str, str], int] = {}
    shelves = list(survey_result.shelves)
    budget = max(budget, 0)

    def by_type(item_type: str) -> int:
        return sum(n for (t, _), n in assigned.items() if t == item_type)

    def fullness(s: Shelf) -> float:
        """How full this shelf is, measured against the exam rather than against
        the other shelves.

        "Emptiest first" used to mean the smallest `have`, which levels all
        thirty shelves to the same depth — and the exam does not ask the same
        number of every type. 場面把握 and 状況把握 are five-question types where
        the rest are ten, so a bank levelled flat over-supplies exactly the two
        types a learner meets least. Dividing by the share turns "emptiest" into
        "furthest behind its share", which levels the bank into the shape of the
        exam and is the same greedy rule otherwise.
        """
        have = s.have + assigned.get((s.item_type, s.level), 0)
        return have / schemas.EXAM_QUESTIONS.get(s.item_type, 10)

    def place(n: int, candidates: list[Shelf]) -> int:
        placed = 0
        for _ in range(n):
            eligible = [
                s
                for s in candidates
                if assigned.get((s.item_type, s.level), 0) < min(per_slot, s.cells_left)
                and by_type(s.item_type) < NIGHT_TYPE_CAPS.get(s.item_type, budget)
            ]
            if not eligible:
                break
            target = min(
                eligible,
                key=lambda s: (
                    fullness(s),
                    s.item_type,
                    s.level,
                ),
            )
            key = (target.item_type, target.level)
            assigned[key] = assigned.get(key, 0) + 1
            placed += 1
        return placed

    reading = [s for s in shelves if s.item_type in schemas.READING_TYPES]
    placed = place(min(max(reading_min, 0), budget), reading)
    place(budget - placed, shelves)

    by_key = {(s.item_type, s.level): s for s in shelves}
    return [
        WorkItem(
            item_type=item_type,
            level=level,
            n=n,
            have=by_key[(item_type, level)].have,
            cells_left=by_key[(item_type, level)].cells_left,
        )
        # Furthest behind first in the output too, so a truncated run still does
        # the most useful work.
        for (item_type, level), n in sorted(
            assigned.items(),
            key=lambda kv: (
                by_key[kv[0]].have / schemas.EXAM_QUESTIONS.get(kv[0][0], 10),
                kv[0],
            ),
        )
    ]


def to_json(survey_result: Survey, order: list[WorkItem]) -> dict:
    return {
        "shelves": [
            {
                "item_type": s.item_type,
                "level": s.level,
                "have": s.have,
                "cells_left": s.cells_left,
            }
            for s in survey_result.shelves
        ],
        "totals": {
            "items": survey_result.items,
            "cells_left": survey_result.cells_left,
            "empty_shelves": len(survey_result.empty),
            "thin_shelves": len(survey_result.thin),
        },
        "work_order": [
            {
                "item_type": w.item_type,
                "level": w.level,
                "n": w.n,
                "have": w.have,
                "cells_left": w.cells_left,
            }
            for w in order
        ],
        "planned_items": sum(w.n for w in order),
        "reading_items": sum(w.n for w in order if w.item_type in schemas.READING_TYPES),
    }


def difficulty_coverage() -> tuple[int, int]:
    """(items carrying a difficulty signal, items published).

    `model_p_correct` is the only term in `next_items()` that separates two
    items of the same type and level, and it is written at generation time or
    not at all — so a bundle that arrived through `bjt importbatch` has none.
    Left uncounted that is invisible: the ranking term falls back to a constant,
    which is not wrong for any one item and does nothing across all of them.
    Counting it here puts it on the same screen as the shelves, because "the
    queue cannot tell these apart" is a fact about the bank's shape.
    """
    have = total = 0
    for path in batchmod.bundles():
        try:
            bundle = batchmod.load(path)
        except (OSError, json.JSONDecodeError):
            continue
        for item in bundle.get("items", []):
            total += 1
            have += item.get("model_p_correct") is not None
    return have, total


def render(survey_result: Survey, order: list[WorkItem]) -> str:
    """The work order as something a person reads before approving it."""
    lines: list[str] = []
    lines.append("The bank, shelf by shelf (items published / seed cells left)")
    lines.append("")
    by_type: dict[str, list[Shelf]] = {}
    for s in survey_result.shelves:
        by_type.setdefault(s.item_type, []).append(s)
    width = max((len(t) for t in by_type), default=0)
    for item_type, shelves in by_type.items():
        cells = "   ".join(
            f"{s.level} {s.have:>3} / {s.cells_left:<5}" for s in shelves
        )
        mark = "  ←thin" if any(s.thin for s in shelves) else ""
        lines.append(f"  {item_type:<{width}}  {cells}{mark}")
    lines.append("")
    lines.append(
        f"  {survey_result.items} item(s) published; "
        f"{len(survey_result.empty)} empty shelf/shelves, "
        f"{len(survey_result.thin)} below the type's share of {DEFAULT_FLOOR}; "
        f"{survey_result.cells_left} seed cell(s) left."
    )
    have, total = difficulty_coverage()
    if total:
        lines.append(
            f"  {have}/{total} carry a difficulty signal"
            + ("." if have == total else
               " — for the rest the queue's difficulty term is a constant, so it "
               "sorts nothing. `bjt probe <bundle>` measures them.")
        )
    lines.append("")

    if not order:
        lines.append("Nothing to write: every shelf is out of seed cells.")
        return "\n".join(lines)

    reading = sum(w.n for w in order if w.item_type in schemas.READING_TYPES)
    lines.append(f"Work order — {sum(w.n for w in order)} item(s), furthest behind its "
                 f"share of the exam first; "
                 f"{reading} of them 読解 (reading first, then the rest)")
    lines.append("")
    for w in order:
        lines.append(
            f"  {w.n:>2} × {w.item_type} {w.level}"
            f"   (has {w.have}, {w.cells_left} cell(s) left)"
        )
    return "\n".join(lines)
