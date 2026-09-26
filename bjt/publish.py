"""Bundle → SQL. How checked content gets into the database.

The app never generates anything, so publishing is not an API the app calls; it
is a file. `bjt publish` turns a bundle into one idempotent SQL transaction that
can be read before it is run, committed next to the migration that shaped it,
and applied with `psql` or pasted into the Supabase SQL editor. Re-running it is
always safe: every statement is an upsert, so a corrected batch overwrites the
old rows rather than duplicating them.

That is deliberately less convenient than a script that talks to the API with a
service key. It is also the reason there is no service key on anyone's laptop, no
half-finished import to reason about, and a diff to look at before a hundred
items reach real users.

Two things this must get right:

* **One transaction.** `items.correct_index` is a deferred foreign key into the
  option set, so an item and its options are only valid together. Splitting them
  across transactions fails, which is the database refusing to hold a question
  with no answer.
* **Quoting.** Every value goes through `lit()`. The content is Japanese prose
  full of quotes and brackets, written by a model, and string-formatting it into
  SQL by hand is how you end up with a broken publish at best.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from . import seedtable, withdrawn


def lit(value: Any) -> str:
    """A SQL literal for anything we put in a bundle.

    Dicts and lists become jsonb. Everything else becomes a quoted string with
    embedded quotes doubled, or NULL.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        return _quote(json.dumps(value, ensure_ascii=False)) + "::jsonb"
    return _quote(str(value))


def _quote(s: str) -> str:
    # Backslashes are literal in standard_conforming_strings, which Postgres has
    # had on by default for fifteen years; only the quote needs doubling.
    return "'" + s.replace("'", "''") + "'"


def _upsert(table: str, columns: list[str], rows: list[list[Any]], key: list[str]) -> str:
    """One multi-row INSERT ... ON CONFLICT DO UPDATE."""
    if not rows:
        return ""
    updatable = [c for c in columns if c not in key]
    values = ",\n       ".join(
        "(" + ", ".join(lit(v) for v in row) + ")" for row in rows
    )
    sql = [
        f"insert into public.{table} ({', '.join(columns)})",
        f"values {values}",
        f"on conflict ({', '.join(key)}) do update set",
        "       " + ",\n       ".join(f"{c} = excluded.{c}" for c in updatable)
        if updatable
        else "       nothing",
    ]
    if not updatable:
        sql[-2] = f"on conflict ({', '.join(key)}) do nothing"
        sql.pop()
    return "\n".join(sql) + ";"


def scene_labels(item_type: str) -> dict[str, str]:
    """Japanese labels for the scene bank. The bundle carries scene ids only;
    the seed table is what knows what each picture shows."""
    try:
        return seedtable.load(item_type).scene_labels
    except FileNotFoundError:
        return {}


def bundle_sql(bundle: dict, bundle_id: str, withdrawn_ids: Optional[set[str]] = None) -> str:
    """The whole publish, as one transaction.

    `withdrawn_ids` defaults to the committed ledger (`batches/withdrawn.txt`).
    """
    item_type = bundle["item_type"]
    items = bundle["items"]
    labels = scene_labels(item_type)
    gone = withdrawn.ids() if withdrawn_ids is None else set(withdrawn_ids)

    parts: list[str] = [
        f"-- {bundle_id}: {len(items)} × {item_type} ({bundle['level']})",
        f"-- generated {bundle.get('generated_at', '')} by {bundle.get('generator_model', '')}",
        "-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.",
        "",
        "begin;",
        "",
    ]

    scenes = sorted({it["scene_id"] for it in items if it.get("scene_id")})
    # A per-item picture is labelled by its item's topic; a bank scene by the
    # seed table. Either way image_path is left alone here.
    picture_labels = {it["scene_id"]: it.get("topic", "") for it in items
                      if it.get("scene_id") and it.get("image_brief")}
    if scenes:
        parts += [
            "-- Scenes are a shared bank (or, for 画像把握, one picture per item);",
            "-- image_path stays null until the art exists, and is deliberately not",
            "-- overwritten by a re-publish.",
            _upsert(
                "scenes",
                ["id", "label_ja"],
                [[s, picture_labels.get(s) or labels.get(s, "")] for s in scenes],
                ["id"],
            ),
            "",
        ]

    clips = bundle.get("audio_manifest", [])
    if clips:
        parts += [
            "-- One row per distinct utterance. audio_path is filled in by the TTS step.",
            _upsert(
                "audio_clips",
                ["id", "text", "voice", "channel"],
                [[c["clip_id"], c["text"], c["voice"], c["channel"]] for c in clips],
                ["id"],
            ),
            "",
        ]

    parts += [
        _upsert(
            "bundles",
            ["id", "item_type", "level", "generator_model", "generated_at"],
            [[
                bundle_id,
                item_type,
                bundle["level"],
                bundle.get("generator_model", "unknown"),
                bundle.get("generated_at"),
            ]],
            ["id"],
        ),
        "",
    ]

    item_columns = [
        "id", "bundle_id", "item_type", "level", "seed_cell_id", "setting", "relation",
        "function", "channel", "scene_id", "speaker_role", "listener_role", "topic",
        "stem", "correct_index", "explanation_ja", "explanation_en", "vocab_notes",
        "documents", "dialogue", "narration_clip_id", "model_p_correct",
    ]
    item_rows = []
    option_rows = []
    for it in items:
        cell = it.get("seed_cell") or {}
        item_rows.append([
            it["id"], bundle_id, item_type, it["level"],
            cell.get("id"), cell.get("setting"), cell.get("relation"), cell.get("function"),
            it.get("channel") or cell.get("channel"),
            it.get("scene_id"), it.get("speaker_role"), it.get("listener_role"),
            it.get("topic", ""), it["stem"], it["correct_index"],
            it.get("explanation_ja", ""), it.get("explanation_en", ""),
            it.get("vocab_notes", []),
            # Always arrays, even for the types that carry exactly one document
            # or no conversation: the column's default is `[]` and the app would
            # rather branch on emptiness than on null.
            it.get("documents", []),
            it.get("dialogue", []),
            (it.get("audio") or {}).get("narration"),
            # The difficulty prior, as measured at generation time by the
            # difficulty probe (or by the gate's full view, when the probe did
            # not run). Null for the hand-written batches, which skip both. The
            # queue reads null as "no opinion" rather than as "average", so an
            # unmeasured item is neither promoted nor buried.
            it.get("model_p_correct"),
        ])
        clip_ids = (it.get("audio") or {}).get("options") or []
        for pos, opt in enumerate(it["options"]):
            option_rows.append([
                it["id"], pos, opt["text"], opt["role"], opt.get("why", ""),
                clip_ids[pos] if pos < len(clip_ids) else None,
            ])

    ids = ", ".join(lit(it["id"]) for it in items)
    parts += [
        _upsert("items", item_columns, item_rows, ["id"]),
        "",
        "-- Options are replaced wholesale rather than upserted: a corrected item can",
        "-- have fewer options or a different order, and a stale row left behind would",
        "-- be a fifth answer nobody meant to publish.",
        f"delete from public.item_options where item_id in ({ids});",
        _upsert(
            "item_options",
            ["item_id", "position", "text", "role", "why", "clip_id"],
            option_rows,
            ["item_id", "position"],
        ),
        "",
    ]

    # After the upsert, so an item this transaction inserts for the first time
    # is withdrawn in the same breath rather than served until the next deploy.
    pulled = [it["id"] for it in items if it["id"] in gone]
    if pulled:
        parts += [
            "-- Withdrawn after review; batches/withdrawn.txt says why. An unpublish,",
            "-- never a delete, so every answer already given keeps resolving. Nothing",
            "-- here ever sets is_published back to true: a question the owner vetoed",
            "-- in the app stays vetoed however often this file is applied.",
            "update public.items set is_published = false",
            f" where id in ({', '.join(lit(i) for i in pulled)});",
            "",
        ]

    parts += ["commit;", ""]
    return "\n".join(p for p in parts if p is not None)


def publish_bundle(path: Path, out: Optional[Path] = None) -> tuple[Path, dict]:
    """Read a bundle, write its SQL next to it (or wherever asked)."""
    bundle = json.loads(Path(path).read_text(encoding="utf-8"))
    bundle_id = Path(path).stem
    sql = bundle_sql(bundle, bundle_id)
    out = out or Path(path).with_suffix(".sql")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(sql, encoding="utf-8")
    return out, bundle
