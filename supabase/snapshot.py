#!/usr/bin/env python3
"""The current definition of every function, view and trigger, in one file.

A migration that changes a function redefines the whole of it (`create or
replace`). That is the right way to change a schema and the wrong way to read
one: "what does the queue do today?" would mean finding the last migration that
redefined `next_items()` and trusting that no later one touched it. So this
reads every migration in order, keeps the latest statement for each function,
view and trigger (and its latest `comment on`), drops the ones a later migration
dropped, and writes them out.

A later `alter function ... set <parameter>` (or `reset`) is folded into the
definition it applies to, as the `set` line the function now carries: a pinned
search_path shown unpinned is a definition somebody will copy, and a copied
`create or replace` without the line quietly unpins it again. A later `create`
starts over, as it does in Postgres, where replacing a function replaces its
settings too.

    python supabase/snapshot.py            # rewrite supabase/current.sql
    python supabase/snapshot.py --check    # exit 1 if it is out of date

`tests/test_schema_snapshot.py` fails when the committed file is stale, so a
migration and the snapshot land together. Text, not a database dump: it needs
no Postgres, and it reads exactly as the migration wrote it, comments included.

Tables are not here. They are built up column by column across migrations,
and `supabase/test/run.sh` is where the whole schema is applied and checked.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
MIGRATIONS = HERE / "migrations"
TARGET = HERE / "current.sql"


def statements(sql: str) -> list[str]:
    """Split a migration into statements on the semicolons outside comments,
    quoted strings and dollar-quoted bodies, each with the comment block that
    precedes it."""
    out: list[str] = []
    i, start, n = 0, 0, len(sql)
    while i < n:
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif sql[i] == "'":
            i += 1
            while i < n:
                if sql[i] == "'" and sql.startswith("''", i):
                    i += 2
                elif sql[i] == "'":
                    i += 1
                    break
                else:
                    i += 1
        elif sql[i] == "$":
            m = re.match(r"\$[A-Za-z_]*\$", sql[i:])
            if m:
                tag = m.group(0)
                j = sql.find(tag, i + len(tag))
                i = n if j < 0 else j + len(tag)
            else:
                i += 1
        elif sql[i] == ";":
            text = sql[start:i + 1].strip()
            if text:
                out.append(text)
            i += 1
            start = i
        else:
            i += 1
    tail = sql[start:].strip()
    if tail and not all(line.strip().startswith("--") or not line.strip() for line in tail.splitlines()):
        out.append(tail)
    return out


def _code(statement: str) -> str:
    """The statement without its leading comment lines, lower-cased and on one
    line, for recognising what it is."""
    lines = [ln for ln in statement.splitlines() if not ln.strip().startswith("--")]
    return " ".join(" ".join(lines).split()).lower()


CREATE = re.compile(
    r"^create (?:or replace )?(function|view|trigger) (?:public\.)?\"?([a-z_][a-z0-9_]*)\"?"
)
DROP = re.compile(
    r"^drop (function|view|trigger) (?:if exists )?(?:public\.)?\"?([a-z_][a-z0-9_]*)\"?"
)
COMMENT = re.compile(r"^comment on (function|view) (?:public\.)?([a-z_][a-z0-9_]*)")
# Matched against the statement on one line but NOT lower-cased, so a setting's
# value keeps its case.
ALTER_SET = re.compile(
    r"^alter function (?:public\.)?\"?([a-z_][a-z0-9_]*)\"?\s*(?:\([^)]*\))?\s*"
    r"(?:(set)\s+([a-z_][a-z0-9_.]*)\s*(?:=|\bto\b)\s*(.+?)|(reset)\s+([a-z_][a-z0-9_.]*))\s*;?$",
    re.I,
)
# Where a function's body starts: the dollar quote after `as`, on a line of its
# own in every migration so far, or at the end of a one-line header.
BODY = re.compile(r"^[ \t]*as\s+\$[A-Za-z_]*\$", re.I | re.M)
BODY_INLINE = re.compile(r"\bas\s+\$[A-Za-z_]*\$", re.I)
# One `set name = value` in a function header, a list value included.
_VALUE = r"(?:'(?:[^']|'')*'|\"[^\"]*\"|[^\s,;]+)"
SETTING = r"(?<![a-z0-9_])set\s+{name}\s*(?:=|\bto\b)\s*" + _VALUE + r"(?:\s*,\s*" + _VALUE + r")*[ \t]*\n?"


def _flat(statement: str) -> str:
    """The statement without its leading comment lines, on one line."""
    lines = [ln for ln in statement.splitlines() if not ln.strip().startswith("--")]
    return " ".join(" ".join(lines).split())


def _apply_setting(stmt: str, action: str, param: str, value: str | None) -> str:
    """The definition as it stands after `alter function ... set/reset param`:
    the `set param = ...` in its header replaced, added or removed."""
    body = BODY.search(stmt)
    if body is not None:
        header, rest = stmt[:body.start()], stmt[body.start():]
    else:
        body = BODY_INLINE.search(stmt)
        if body is None:
            return stmt
        header, rest = stmt[:body.start()].rstrip() + "\n", stmt[body.start():]
    name = r"[a-z_][a-z0-9_.]*" if param.lower() == "all" else re.escape(param)
    setting = re.compile(SETTING.format(name=name), re.I)
    if action == "reset":
        header = setting.sub("", header)
    elif setting.search(header):
        header = setting.sub(lambda _: f"set {param} = {value}\n", header, count=1)
    else:
        if header and not header.endswith("\n"):
            header += "\n"
        header += f"set {param} = {value}\n"
    return header + rest


def snapshot(migrations_dir: pathlib.Path = MIGRATIONS) -> str:
    objects: dict[tuple[str, str], tuple[str, str]] = {}
    comments: dict[tuple[str, str], str] = {}
    altered: dict[tuple[str, str], list[str]] = {}
    for path in sorted(migrations_dir.glob("*.sql")):
        for stmt in statements(path.read_text(encoding="utf-8")):
            code = _code(stmt)
            if m := CREATE.match(code):
                key = (m.group(1), m.group(2))
                objects[key] = (path.name, stmt)
                comments.pop(key, None)
                altered.pop(key, None)
            elif m := DROP.match(code):
                key = (m.group(1), m.group(2))
                objects.pop(key, None)
                comments.pop(key, None)
                altered.pop(key, None)
            elif m := COMMENT.match(code):
                comments[(m.group(1), m.group(2))] = stmt
            elif (m := ALTER_SET.match(_flat(stmt))) and ("function", m.group(1).lower()) in objects:
                key = ("function", m.group(1).lower())
                source, current = objects[key]
                if m.group(2):
                    current = _apply_setting(current, "set", m.group(3), m.group(4))
                else:
                    current = _apply_setting(current, "reset", m.group(6), None)
                objects[key] = (source, current)
                altered.setdefault(key, [])
                if path.name not in altered[key]:
                    altered[key].append(path.name)
    order = {"view": 0, "function": 1, "trigger": 2}
    parts = [
        "-- The current definition of every function, view and trigger in",
        "-- supabase/migrations/, each as the latest migration to touch it left it.",
        "-- Generated by supabase/snapshot.py: do not edit, and do not apply —",
        "-- the migrations are the schema; this is the schema made readable.",
        "-- Tables are not here; supabase/test/run.sh applies and checks the whole.",
    ]
    for key in sorted(objects, key=lambda k: (order[k[0]], k[1])):
        kind, name = key
        source, stmt = objects[key]
        if key in altered:
            source += ", altered by " + ", ".join(altered[key])
        parts += ["", "", f"-- ==== {kind} {name} — {source}", "", _without_leading_comments(stmt)]
        if key in comments:
            parts += ["", _without_leading_comments(comments[key])]
    return "\n".join(parts) + "\n"


def _without_leading_comments(stmt: str) -> str:
    """The statement from its first line of code: the comments above a
    statement in a migration are usually a section header for what follows."""
    lines = stmt.splitlines()
    while lines and (not lines[0].strip() or lines[0].strip().startswith("--")):
        lines.pop(0)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if supabase/current.sql is out of date, and write nothing")
    args = parser.parse_args(argv)
    text = snapshot()
    current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
    if args.check:
        if current != text:
            print("supabase/current.sql is out of date: run python supabase/snapshot.py", file=sys.stderr)
            return 1
        return 0
    if current != text:
        TARGET.write_text(text, encoding="utf-8")
        print("wrote supabase/current.sql")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
