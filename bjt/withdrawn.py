"""Questions taken out of the bank after review, and why.

`batches/withdrawn.txt` is the ledger: one line per item, the item id, a reason
from a closed set, and a sentence saying what is wrong. It exists because a
committed item is never simply deleted from its bundle, for three reasons that
each rule deleting out:

* **The database keeps the row.** An item somebody has already answered is
  pointed at by `attempts`, `review_schedule` and `item_feedback`, so removal is
  an unpublish (`is_published = false`), exactly as `veto_item()` does it from
  inside the app. `bjt publish` writes that statement into the bundle's SQL for
  every withdrawn id, so the ledger and the bank cannot disagree after a deploy.
* **The seed cell stays spent.** `item_id` is a hash of (type, cell). Were the
  item deleted, `spent_cell_ids` would free its cell, the next night could write
  that cell again, and the new question would inherit the withdrawn id — and
  with it the unpublish, so it would never be served.
* **The record is the point.** A withdrawn item is a worked example of what the
  generator must not write; `bjt/fidelity/naturalness.py` and the prompts cite
  these. Deleting it would delete the evidence.

Everything that reads the library as a learner meets it — the shelf counts in
`bjt plan`, the phrasebook's recurring lines, the pictures the scene job draws,
the clips `bjt synth` records, the library-wide sweeps in the tests — reads it
through `live_items` / `live_bundle`, so a withdrawn question stops counting the
moment its line is committed. The nightly planner then sees its shelf as
emptier and refills it.

Un-withdrawing is deliberately not symmetrical. Deleting a line stops the next
publish from unpublishing the item, but it does not publish it again, because
the bundle SQL never sets `is_published = true`: that is what keeps an owner's
veto from the app from being undone by the next deploy. Putting an item back is
one `update public.items set is_published = true where id = '…'`, by hand.

The ledger is written by hand, and by one tool: `bjt regate --withdraw`
proposes lines through `append`, which adds after what is there and never
rewrites or removes one. A tool may make the ledger longer; only a person makes
it shorter.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from . import config

#: Why an item was withdrawn. The same closed set as `public.item_feedback.reason`
#: (d1/migrations/0001_initial.sql), so a tester's
#: report and the decision it leads to are counted in one vocabulary. A test
#: holds the two equal.
REASONS: tuple[str, ...] = ("unnatural", "wrong_answer", "ambiguous", "unclear", "audio", "other")

LEDGER_NAME = "withdrawn.txt"


@dataclass(frozen=True)
class Withdrawal:
    item_id: str
    reason: str
    note: str


def ledger_path() -> Path:
    """Read at call time, so a test that points BATCH_DIR elsewhere is obeyed."""
    return config.BATCH_DIR / LEDGER_NAME


def load(path: Optional[Path] = None) -> dict[str, Withdrawal]:
    """The ledger, by item id. A missing file is an empty ledger.

    A malformed line is an error rather than something to skip: a typo that
    silently dropped a withdrawal would put the question back in front of
    learners without anybody deciding to.
    """
    path = Path(path) if path is not None else ledger_path()
    if not path.exists():
        return {}
    out: dict[str, Withdrawal] = {}
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 2)
        if len(parts) < 3:
            raise ValueError(f"{path.name}:{n}: expected '<item id> <reason> <what is wrong>'")
        item_id, reason, note = parts
        if reason not in REASONS:
            raise ValueError(f"{path.name}:{n}: reason {reason!r} is not one of {', '.join(REASONS)}")
        if item_id in out:
            raise ValueError(f"{path.name}:{n}: {item_id} is withdrawn twice")
        out[item_id] = Withdrawal(item_id, reason, note.strip())
    return out


def ids(path: Optional[Path] = None) -> frozenset[str]:
    return frozenset(load(path))


def line(entry: Withdrawal) -> str:
    """One ledger line, laid out the way the hand-written ones are."""
    return f"{entry.item_id}  {entry.reason:<12}  {entry.note}"


def append(entries: Iterable[Withdrawal], *, heading: str = "",
           path: Optional[Path] = None) -> int:
    """Add lines after everything already in the ledger. Returns how many.

    Append-only on purpose, and the only writer this module has. Nothing here
    rewrites or removes a line: a line removed is a question put back in front
    of learners, and that is a decision for a person with an editor, never for
    a tool. Every line is held to the rules `load` applies — a reason from the
    closed set, a note on one line — and an item already in the ledger is
    refused rather than written twice, before anything is written at all.
    `heading` goes above the new lines as comments, to say who proposed them.
    """
    path = Path(path) if path is not None else ledger_path()
    existing = load(path)
    entries = list(entries)
    seen: set[str] = set()
    for e in entries:
        if e.reason not in REASONS:
            raise ValueError(f"{e.item_id}: reason {e.reason!r} is not one of {', '.join(REASONS)}")
        if e.item_id in existing or e.item_id in seen:
            raise ValueError(f"{e.item_id} is already withdrawn")
        if not e.note.strip() or "\n" in e.note or len(e.item_id.split()) != 1:
            raise ValueError(f"{e.item_id}: a withdrawal is an id and a one-line note")
        seen.add(e.item_id)
    if not entries:
        return 0
    before = path.read_text(encoding="utf-8") if path.exists() else ""
    block = [""] if before else []
    block += [f"# {h}".rstrip() for h in heading.splitlines()]
    block += [line(e) for e in entries]
    with path.open("a", encoding="utf-8") as fh:
        if before and not before.endswith("\n"):
            fh.write("\n")
        fh.write("\n".join(block) + "\n")
    return len(entries)


def live_items(bundle: dict, withdrawn: Optional[Iterable[str]] = None) -> list[dict]:
    """The bundle's items a learner can still be served."""
    gone = ids() if withdrawn is None else frozenset(withdrawn)
    return [it for it in bundle.get("items", []) if it.get("id") not in gone]


def live_bundle(bundle: dict, withdrawn: Optional[Iterable[str]] = None) -> dict:
    """A copy of the bundle holding only what is still served: the items that
    are not withdrawn, and the clips at least one of them plays.

    The manifest is de-duplicated across the bundle, so a clip is kept when any
    live item uses it, whichever item happened to list it first. The spoken
    option labels belong to no item — they are four clips for the whole library
    — and are kept while any live item remains.
    """
    out = copy.deepcopy(bundle)
    items = live_items(out, withdrawn)
    out["items"] = items
    used: set[str] = set()
    for it in items:
        audio = it.get("audio") or {}
        if audio.get("narration"):
            used.add(audio["narration"])
        used.update(c for c in audio.get("options") or [] if c)
        used.update(c for c in audio.get("dialogue") or [] if c)
    out["audio_manifest"] = [
        c for c in out.get("audio_manifest", [])
        if c.get("clip_id") in used or (items and c.get("kind") == "option_label")
    ]
    out["scenes"] = sorted({it["scene_id"] for it in items if it.get("scene_id")})
    return out
