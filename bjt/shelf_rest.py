"""Which shelves rest tonight: the ones that have written nothing, night after night.

The work order sends a night to the shelves furthest behind their share, and a
shelf that cannot be written — a schema the API refuses, distractors the gate
always finds leaky — stays furthest behind, so every night goes back to it and
pays for drafts that are all thrown away. From 2026-09-28 three nights in a row
spent their whole budget on the same three shelves and wrote nothing.

So the night keeps a record, one tiny marker per shelf it tried:
`nightly/shelves/<type>.<level>.<when>.<outcome>` in the media bucket
(bjt/r2.py), where the outcome is `written` or `missed`. A shelf whose last
`config.SHELF_REST_AFTER` markers are all misses rests: the work order passes it
over until `config.SHELF_REST_DAYS` after its last miss, then tries it once
more (a fix may have landed meanwhile), and one more miss rests it again. A
written night clears the streak. A night that stopped on a ceiling or an empty
account records nothing for the shelf it stopped in: that was not the shelf.

The bucket, not a branch, is the memory, as for the picture job's refusals
(bjt/scene_art.py): the runner forgets everything each night, and whether a
night runs is still decided by `main` and the ceilings alone. The Worker serves
only `audio/` and `scenes/`, so these markers are never public. An unconfigured
bucket rests nothing and records nothing; a ledger that cannot be read is a
warning, and every shelf is tried, as before — the dollar ceiling still holds.
"""
from __future__ import annotations

import datetime as dt
from typing import Iterable, Optional

from . import config, r2

PREFIX = "nightly/shelves/"
WRITTEN = "written"
MISSED = "missed"
_STAMP = "%Y%m%dT%H%M%S"

Shelf = tuple[str, str]
#: A shelf's markers, oldest first: (when, outcome).
History = dict[Shelf, list[tuple[dt.datetime, str]]]


def marker(item_type: str, level: str, outcome: str, when: dt.datetime) -> str:
    """The object key one night's outcome on one shelf is recorded under."""
    return f"{PREFIX}{item_type}.{level}.{when.astimezone(dt.timezone.utc):{_STAMP}}.{outcome}"


def parse(keys: Iterable[str]) -> History:
    """Markers back into each shelf's history. A key that is not a marker is
    ignored rather than fatal: the ledger is a courtesy, not the job."""
    history: History = {}
    for key in keys:
        name = key[len(PREFIX):] if key.startswith(PREFIX) else key
        parts = name.split(".")
        if len(parts) != 4 or parts[3] not in (WRITTEN, MISSED):
            continue
        item_type, level, stamp, outcome = parts
        try:
            when = dt.datetime.strptime(stamp, _STAMP).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        history.setdefault((item_type, level), []).append((when, outcome))
    for marks in history.values():
        marks.sort()
    return history


def resting(history: History, now: dt.datetime, *, after: Optional[int] = None,
            days: Optional[float] = None) -> dict[Shelf, dt.datetime]:
    """Shelf → when it may be tried again, for every shelf resting at `now`.

    Resting means its last `after` markers are all misses and the newest is
    less than `days` old. `after` of 0 or less turns resting off.
    """
    after = config.SHELF_REST_AFTER if after is None else after
    days = config.SHELF_REST_DAYS if days is None else days
    if after <= 0:
        return {}
    out: dict[Shelf, dt.datetime] = {}
    for shelf, marks in history.items():
        tail = [outcome for _, outcome in marks[-after:]]
        if len(tail) < after or any(o != MISSED for o in tail):
            continue
        until = marks[-1][0] + dt.timedelta(days=days)
        if now < until:
            out[shelf] = until
    return out


def load(now: dt.datetime, creds: "r2.Credentials | None" = None
         ) -> tuple[dict[Shelf, dt.datetime], Optional[str]]:
    """The shelves resting tonight, read from the bucket, and a warning when
    it could not be read. No bucket: nothing rests, and nothing is said."""
    creds = creds if creds is not None else r2.Credentials.from_env()
    if creds is None:
        return {}, None
    try:
        keys = r2.list_keys(creds, PREFIX, delimiter="/")
    except Exception as exc:  # the ledger is a courtesy, not the job
        return {}, f"could not read the shelf ledger ({exc}); every shelf is tried tonight"
    return resting(parse(keys), now), None


def record(outcomes: Iterable[tuple[str, str, str]], now: dt.datetime,
           creds: "r2.Credentials | None" = None) -> Optional[str]:
    """Write tonight's markers: (item type, level, outcome) each. Returns a
    warning if any could not be written, or None."""
    creds = creds if creds is not None else r2.Credentials.from_env()
    if creds is None:
        return None
    failed = []
    for item_type, level, outcome in outcomes:
        try:
            r2.put(creds, marker(item_type, level, outcome, now), b"",
                   "text/plain; charset=utf-8", overwrite=False)
        except r2.AlreadyExists:
            pass
        except Exception as exc:
            failed.append(f"{item_type} {level}: {exc}")
    return f"could not record in the shelf ledger: {'; '.join(failed)}" if failed else None
