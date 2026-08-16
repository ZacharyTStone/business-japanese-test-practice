"""SQLite persistence.

Everything the brief asks to keep lives here from day one: generated items, my
answers, and every fidelity metric — so per-item-type accuracy history is
available later and generation can weight toward weak areas.

Single-user, local, synchronous. sqlite3 is stdlib, so no dependency.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable, Optional

from .. import config
from ..schemas import correct_index

_SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id              INTEGER PRIMARY KEY,
    item_type       TEXT NOT NULL,
    level           TEXT NOT NULL,
    topic           TEXT NOT NULL,
    stem            TEXT NOT NULL,
    options_json    TEXT NOT NULL,       -- list of {text, role}, already shuffled
    correct_index   INTEGER NOT NULL,    -- index into options_json
    explanation_ja  TEXT NOT NULL,
    explanation_en  TEXT NOT NULL,
    vocab_notes_json TEXT NOT NULL,
    model           TEXT NOT NULL,
    -- fidelity metrics captured at generation time (nullable until the gate runs)
    cold_success_rate REAL,
    full_success_rate REAL,
    gate_verdict    TEXT,                -- 'kept' | 'discarded:<reason>' | 'skipped'
    vocab_violations_json TEXT,
    created_at      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
    id          INTEGER PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    chosen_index INTEGER NOT NULL,
    correct     INTEGER NOT NULL,        -- 0/1
    answered_at REAL NOT NULL
);

-- One row per cold/full trial, for auditing gate consistency.
CREATE TABLE IF NOT EXISTS gate_trials (
    id          INTEGER PRIMARY KEY,
    item_id     INTEGER REFERENCES items(id),
    side        TEXT NOT NULL,           -- 'cold' | 'full'
    trial       INTEGER NOT NULL,
    chosen_index INTEGER,
    correct     INTEGER NOT NULL,        -- 0/1
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS discriminator_runs (
    id                  INTEGER PRIMARY KEY,
    item_type           TEXT NOT NULL,
    n_generated         INTEGER NOT NULL,
    n_official          INTEGER NOT NULL,
    discrimination_rate REAL NOT NULL,   -- fraction the judge labelled correctly
    reasons_json        TEXT NOT NULL,   -- judge's stated tells
    created_at          REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS calibration_runs (
    id                  INTEGER PRIMARY KEY,
    item_type           TEXT NOT NULL,
    official_accuracy   REAL,
    generated_accuracy  REAL,
    n_official          INTEGER NOT NULL,
    n_generated         INTEGER NOT NULL,
    created_at          REAL NOT NULL
);
"""


class Store:
    def __init__(self, path: Optional[Path] = None):
        self.path = path or config.DB_PATH
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ----- items ----------------------------------------------------------

    def insert_item(
        self,
        item_type: str,
        level: str,
        item: dict,
        model: str,
        *,
        cold_success_rate: Optional[float] = None,
        full_success_rate: Optional[float] = None,
        gate_verdict: str = "skipped",
        vocab_violations: Optional[list[str]] = None,
    ) -> int:
        options = item["options"]
        cur = self.conn.execute(
            """INSERT INTO items (item_type, level, topic, stem, options_json,
                    correct_index, explanation_ja, explanation_en, vocab_notes_json,
                    model, cold_success_rate, full_success_rate, gate_verdict,
                    vocab_violations_json, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                item_type,
                level,
                item.get("topic", ""),
                item["stem"],
                json.dumps(options, ensure_ascii=False),
                correct_index(options),
                item["explanation_ja"],
                item["explanation_en"],
                json.dumps(item.get("vocab_notes", []), ensure_ascii=False),
                model,
                cold_success_rate,
                full_success_rate,
                gate_verdict,
                json.dumps(vocab_violations or [], ensure_ascii=False),
                time.time(),
            ),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def get_item(self, item_id: int) -> Optional[dict]:
        row = self.conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        return _item_row_to_dict(row) if row else None

    def kept_items(self, item_type: str, limit: int) -> list[dict]:
        """Recent items that passed the gate (or were stored gate-skipped) — the
        pool the discriminator draws its generated side from."""
        rows = self.conn.execute(
            """SELECT * FROM items
               WHERE item_type = ? AND gate_verdict IN ('kept', 'skipped')
               ORDER BY id DESC LIMIT ?""",
            (item_type, limit),
        ).fetchall()
        return [_item_row_to_dict(r) for r in rows]

    def recent_topics(self, item_type: str, limit: int) -> list[str]:
        rows = self.conn.execute(
            "SELECT topic FROM items WHERE item_type = ? ORDER BY id DESC LIMIT ?",
            (item_type, limit),
        ).fetchall()
        return [r["topic"] for r in rows if r["topic"]]

    def recent_stems(self, item_type: str, limit: int) -> list[str]:
        rows = self.conn.execute(
            "SELECT stem FROM items WHERE item_type = ? ORDER BY id DESC LIMIT ?",
            (item_type, limit),
        ).fetchall()
        return [r["stem"] for r in rows]

    # ----- responses ------------------------------------------------------

    def record_response(self, item_id: int, chosen_index: int, correct: bool) -> None:
        self.conn.execute(
            "INSERT INTO responses (item_id, chosen_index, correct, answered_at) VALUES (?,?,?,?)",
            (item_id, chosen_index, int(correct), time.time()),
        )
        self.conn.commit()

    def accuracy_by_type(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT i.item_type,
                      COUNT(*)              AS answered,
                      SUM(r.correct)        AS n_correct
               FROM responses r JOIN items i ON i.id = r.item_id
               GROUP BY i.item_type ORDER BY i.item_type"""
        ).fetchall()
        out = []
        for r in rows:
            answered = r["answered"]
            n_correct = r["n_correct"] or 0
            out.append(
                {
                    "item_type": r["item_type"],
                    "answered": answered,
                    "correct": n_correct,
                    "accuracy": (n_correct / answered) if answered else None,
                }
            )
        return out

    # ----- gate trials ----------------------------------------------------

    def record_gate_trial(
        self, item_id: Optional[int], side: str, trial: int, chosen_index: Optional[int], correct: bool
    ) -> None:
        self.conn.execute(
            "INSERT INTO gate_trials (item_id, side, trial, chosen_index, correct, created_at) VALUES (?,?,?,?,?,?)",
            (item_id, side, trial, chosen_index, int(correct), time.time()),
        )
        self.conn.commit()

    def gate_summary(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT item_type,
                      AVG(cold_success_rate) AS avg_cold,
                      AVG(full_success_rate) AS avg_full,
                      COUNT(*)               AS n
               FROM items
               WHERE cold_success_rate IS NOT NULL
               GROUP BY item_type ORDER BY item_type"""
        ).fetchall()
        return [dict(r) for r in rows]

    def verdict_counts(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT item_type, gate_verdict, COUNT(*) AS n
               FROM items GROUP BY item_type, gate_verdict ORDER BY item_type"""
        ).fetchall()
        return [dict(r) for r in rows]

    # ----- discriminator & calibration -----------------------------------

    def insert_discriminator_run(
        self, item_type: str, n_generated: int, n_official: int, rate: float, reasons: list[str]
    ) -> int:
        cur = self.conn.execute(
            """INSERT INTO discriminator_runs
               (item_type, n_generated, n_official, discrimination_rate, reasons_json, created_at)
               VALUES (?,?,?,?,?,?)""",
            (item_type, n_generated, n_official, rate, json.dumps(reasons, ensure_ascii=False), time.time()),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def latest_tells(self, item_type: str, limit: int = 6) -> list[str]:
        """The tells from the most recent discriminator run for this item type —
        fed back into the generator prompt so the loop actually closes."""
        row = self.conn.execute(
            "SELECT reasons_json FROM discriminator_runs WHERE item_type = ? ORDER BY id DESC LIMIT 1",
            (item_type,),
        ).fetchone()
        if not row:
            return []
        return json.loads(row["reasons_json"])[:limit]

    def latest_discriminator_runs(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT * FROM discriminator_runs
               WHERE id IN (SELECT MAX(id) FROM discriminator_runs GROUP BY item_type)
               ORDER BY item_type"""
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["reasons"] = json.loads(d.pop("reasons_json"))
            out.append(d)
        return out

    def insert_calibration_run(
        self, item_type: str, official_acc: Optional[float], gen_acc: Optional[float], n_off: int, n_gen: int
    ) -> int:
        cur = self.conn.execute(
            """INSERT INTO calibration_runs
               (item_type, official_accuracy, generated_accuracy, n_official, n_generated, created_at)
               VALUES (?,?,?,?,?,?)""",
            (item_type, official_acc, gen_acc, n_off, n_gen, time.time()),
        )
        self.conn.commit()
        return int(cur.lastrowid)


def _item_row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["options"] = json.loads(d.pop("options_json"))
    d["vocab_notes"] = json.loads(d.pop("vocab_notes_json"))
    vv = d.pop("vocab_violations_json", None)
    d["vocab_violations"] = json.loads(vv) if vv else []
    return d
