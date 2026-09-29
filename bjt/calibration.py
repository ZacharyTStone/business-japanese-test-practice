"""`bjt calibrate`: your accuracy on the official samples, against the bank's.

The honesty check the README describes. There is no IRT calibration for a
generated item, so the only evidence that the bank is pitched like the exam is
one person answering both: a learner who scores much higher on the bank than
on the official samples is looking at prompts that have drifted soft. Both
numbers are easy to get wrong in a way that flatters the bank:

* **A skip is not a wrong answer.** An accuracy is right over answered: the
  official items left unanswered ('s') and those never shown (more than four
  options) are not in it, or skipping half the paper would cap the official
  score at half and make the bank look that much easier than the exam. How
  much was answered — answered over total — is reported beside it, never
  folded in.
* **The bank's side is the app, not the terminal.** The local SQLite
  `responses` table holds only what `bjt practice` writes; the app's record is
  `public.attempts` in Supabase, which comes in as a CSV exported with
  `ATTEMPTS_EXPORT_SQL` (`--attempts-csv`). The SQLite table is read when no
  file is given, for somebody who practised here.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

#: What to run in the Supabase SQL editor to export the app's side, then
#: "Download CSV". One select, so it changes nothing; the editor runs it as
#: `postgres`, which can read `auth.users`, and no key leaves the dashboard.
#:
#: * **First attempts only**: each question's first answer, before its 解説
#:   was on screen, which is the only answer comparable with an official item
#:   sat once. A second attempt is a memory test.
#: * **One account**: calibration compares one person with themself.
#:   Everybody's answers would compare one person's official score with the
#:   testers' ability.
#: * **The live bank**: a withdrawn question left for being broken, and its
#:   answers say nothing about how the bank is pitched now.
#: * `chosen_index` -1 is the reading clock running out
#:   (supabase/migrations/20260919000300_the_reading_clock.sql). It is exported
#:   so it can be counted apart, the way a skip is on the official side.
ATTEMPTS_EXPORT_SQL = """\
select i.item_type, a.is_correct, a.chosen_index
  from (select distinct on (att.item_id) att.item_id, att.is_correct, att.chosen_index
          from public.attempts att
          join auth.users u on u.id = att.user_id
         where lower(u.email) = lower('you@example.com')  -- your sign-in address
         order by att.item_id, att.answered_at, att.id) a
  join public.items i on i.id = a.item_id
 where i.is_published
 order by i.item_type;"""

#: The columns `--attempts-csv` cannot do without. `chosen_index` is optional:
#: without it a timed-out answer is indistinguishable from a wrong one, which
#: is how the app grades it, and the tally says nothing ran out.
REQUIRED_COLUMNS = ("item_type", "is_correct")

_TRUE = {"true", "t", "1", "yes", "y"}
_FALSE = {"false", "f", "0", "no", "n"}


@dataclass
class Tally:
    """Right over answered, and answered over total, kept apart."""
    right: int = 0
    answered: int = 0
    #: Official side: the items in the sitting. App side: the first attempts
    #: in the file, timed-out ones included.
    total: int = 0

    @property
    def accuracy(self) -> Optional[float]:
        return self.right / self.answered if self.answered else None

    @property
    def unanswered(self) -> int:
        return self.total - self.answered


def read_attempts_csv(path: Path, item_type: str) -> Tally:
    """The app's first attempts at one item type, from the exported CSV.

    Accepts whatever the SQL editor's download writes: a byte-order mark,
    `true`/`false` or `t`/`f`, extra columns. A row that cannot be read is an
    error naming its line, not a row skipped: a skipped row is a number that
    looks measured and is not.
    """
    path = Path(path)
    tally = Tally()
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        columns = {(c or "").strip() for c in reader.fieldnames or []}
        missing = [c for c in REQUIRED_COLUMNS if c not in columns]
        if missing:
            raise ValueError(f"{path.name} has no {', '.join(missing)} column; export it "
                             "with the SQL in `bjt calibrate --help`")
        for line, raw in enumerate(reader, start=2):
            row = {(k or "").strip(): (v or "").strip() for k, v in raw.items()}
            if row["item_type"] != item_type:
                continue
            tally.total += 1
            if row.get("chosen_index") == "-1":
                continue  # the clock ran out: no answer was given
            value = row["is_correct"].lower()
            if value not in _TRUE | _FALSE:
                raise ValueError(f"{path.name}:{line}: is_correct is {row['is_correct']!r}, "
                                 "not true or false")
            tally.answered += 1
            tally.right += int(value in _TRUE)
    return tally


def from_store(store, item_type: str) -> Tally:
    """The fallback: what `bjt practice` recorded in the local database."""
    for row in store.accuracy_by_type():
        if row["item_type"] == item_type:
            return Tally(right=row["correct"], answered=row["answered"], total=row["answered"])
    return Tally()


def _score(tally: Tally) -> str:
    if tally.accuracy is None:
        return "n/a, nothing answered"
    return f"{tally.right} right of {tally.answered} answered ({tally.accuracy:.0%})"


def report(item_type: str, official: Tally, bank: Tally, source: str) -> str:
    """The comparison, as the lines `bjt calibrate` prints."""
    pad = " " * 19
    lines = ["", "=" * 50, f"CALIBRATION — {item_type}"]
    lines.append(f"  official items:  {_score(official)}; "
                 f"answered {official.answered} of {official.total}")
    if official.unanswered:
        lines.append(f"{pad}{official.unanswered} left unanswered, "
                     "which is not the same as wrong")
    lines.append(f"  generated items: {_score(bank)}")
    lines.append(f"{pad}from {source}"
                 + (f"; {bank.unanswered} timed out, not counted as answers"
                    if bank.unanswered else ""))
    if official.accuracy is not None and bank.accuracy is not None:
        gap = bank.accuracy - official.accuracy
        if gap > 0.1:
            lines.append("  → Generated items look consistently EASIER than official ones.")
            lines.append("    The prompts may have drifted soft — tighten them.")
        elif gap < -0.1:
            lines.append("  → Generated items look harder than official ones.")
        else:
            lines.append("  → Generated and official difficulty look comparable.")
    lines.append("=" * 50)
    return "\n".join(lines)
