"""What to write next, decided by counting rather than by taste.

The app's queue can only do its job if the bank underneath it is the right
shape. It serves three levels, spreads a set across problem types so nobody gets
five 語彙・文法 in a row, and slips in one item from the level above — and every
one of those promises is empty when the library is 40 items of one type at one
level and six of everything else. A queue cannot interleave what is not there.

So the bank has 27 shelves — nine problem types × three levels — and the job of
the nightly run is to **fill the emptiest shelf first**. That is the whole
algorithm:

    while there is budget left:
        give the next item to the shelf with the fewest items,
        skipping any shelf that has no unspent seed cells
        or has already taken its share of this run

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
from . import seedtable

#: Below this many items, a shelf is thin enough that the queue notices: a set
#: of five cannot avoid repeating a type that only has a handful published.
#: Reporting only — the greedy fill needs no threshold.
DEFAULT_FLOOR = 12

#: Most items one run may write into one (type, level) shelf.
DEFAULT_PER_SLOT = 3

#: Most items one run may write at all. Eight a night is about two dollars on
#: Sonnet; the bank fills its thin shelves in weeks rather than days, and the
#: owner asked for cheap (2026-09-18). The night's real throttle is the
#: review gate: nothing is written while an earlier night waits unmerged.
DEFAULT_BUDGET = 8


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
    def thin(self) -> bool:
        return self.have < DEFAULT_FLOOR

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
) -> list[WorkItem]:
    """Fill the emptiest shelf first, until the budget runs out.

    Ties are broken by item type and then by level, so the order is a function of
    the library and nothing else — run it twice on the same tree and you get the
    same plan, which is what makes it reviewable before it is executed.
    """
    assigned: dict[tuple[str, str], int] = {}
    shelves = list(survey_result.shelves)

    for _ in range(max(budget, 0)):
        eligible = [
            s
            for s in shelves
            if assigned.get((s.item_type, s.level), 0) < min(per_slot, s.cells_left)
        ]
        if not eligible:
            break
        target = min(
            eligible,
            key=lambda s: (
                s.have + assigned.get((s.item_type, s.level), 0),
                s.item_type,
                s.level,
            ),
        )
        key = (target.item_type, target.level)
        assigned[key] = assigned.get(key, 0) + 1

    by_key = {(s.item_type, s.level): s for s in shelves}
    return [
        WorkItem(
            item_type=item_type,
            level=level,
            n=n,
            have=by_key[(item_type, level)].have,
            cells_left=by_key[(item_type, level)].cells_left,
        )
        # Emptiest first in the output too, so a truncated run still does the
        # most useful work.
        for (item_type, level), n in sorted(
            assigned.items(), key=lambda kv: (by_key[kv[0]].have, kv[0])
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
    }


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
        f"{len(survey_result.thin)} below {DEFAULT_FLOOR}; "
        f"{survey_result.cells_left} seed cell(s) left."
    )
    lines.append("")

    if not order:
        lines.append("Nothing to write: every shelf is out of seed cells.")
        return "\n".join(lines)

    lines.append(f"Work order — {sum(w.n for w in order)} item(s), emptiest shelf first")
    lines.append("")
    for w in order:
        lines.append(
            f"  {w.n:>2} × {w.item_type} {w.level}"
            f"   (has {w.have}, {w.cells_left} cell(s) left)"
        )
    return "\n".join(lines)
