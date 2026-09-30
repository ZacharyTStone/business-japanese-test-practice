#!/usr/bin/env python3
"""Check the app's queries against the real schema.

TypeScript will happily compile `select("is_corect")`. The type checker only
knows the shape we *claimed* the database has; it cannot know whether that claim
is true. The mismatch shows up at runtime, on a device, as an empty screen.

So this reads every Supabase call in the client and emits SQL that asserts each
table, view, column and function it names actually exists — and, for every
column the app inserts, updates or upserts, that a signed-in client holds that
privilege on it, since some tables here are granted column by column. `run.sh`
pipes that into the same throwaway database the schema tests use, which makes
"the app and the schema agree" a thing that fails in CI rather than in
someone's hand.

It is a deliberately shallow parser — it matches call chains, not TypeScript —
and that is fine: it only needs to find the identifiers, and anything it cannot
parse it simply does not assert (and says so on stderr).

It reads .ts and .tsx alike, test files aside: `supabase.rpc("is_tester")`
lives in a component. And when a write is handed a variable rather than an
object literal — `.insert(row)`, `.update(patch)` — it looks for what that
variable is in the same top-level function: a `const row = { ... }` literal,
or a parameter typed `Pick<Row, "a" | "b">`, whose keys are then asserted as
columns like any other.

    supabase/test/contract.py client/src/lib > /tmp/contract.sql
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# supabase.from("table") ... up to the end of the statement, OR up to the next
# query, whichever comes first. Anchored on the client itself so that
# supabase.storage.from("audio") — a bucket, not a table — is not mistaken for
# one.
#
# The "next query" half matters because a screen that needs two tables at once
# fetches them in one Promise.all, which is one statement with two chains in it.
# Stopping only at the semicolon would attribute the second query's filters to
# the first query's table, and report a perfectly good column as missing from a
# table that never mentioned it.
CHAIN = re.compile(
    r'\bsupabase\s*\.\s*from\(\s*"([a-z_0-9]+)"\s*\)'
    r'(.*?)(?=;|\bsupabase\s*\.\s*(?:from|rpc)\()',
    re.S,
)
SELECT = re.compile(r'\.select\(\s*"([^"]*)"')
KEY = re.compile(r'(?:^|[\s,{])([a-z_][a-z_0-9]*)\s*:', re.M)
COLUMN_FILTER = re.compile(r'\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|not|order)\(\s*"([a-z_0-9]+)"')
RPC = re.compile(r'\.rpc\(\s*"([a-z_0-9]+)"\s*(?:,\s*\{(.*?)\})?\s*\)', re.S)
# Where a top-level function or constant starts: the scope a variable handed to
# a write is looked for in.
TOP_LEVEL = re.compile(r'^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let)\b', re.M)
PICK_KEYS = re.compile(r'"([a-z_][a-z_0-9]*)"')

# JavaScript literals, not names: KEY also matches the `true :` of a ternary
# such as `x ? true : false`.
SKIP_KEYS = {"true", "false", "null"}


def _balanced(src: str, open_at: int) -> str | None:
    """The text inside the brace that opens at `open_at`, or None."""
    depth = 0
    for i in range(open_at, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[open_at + 1:i]
    return None


def resolve_object(src: str, name: str, at: int) -> set[str] | None:
    """The keys of the object a variable named `name` holds where it is used at
    `at`, from its latest declaration in the same top-level function: a
    `const name = { ... }` literal, or a parameter typed with `Pick<X, "a" | ...>`.
    None when neither is there to read."""
    starts = [m.start() for m in TOP_LEVEL.finditer(src, 0, at)]
    scope_start = starts[-1] if starts else 0
    scope = src[scope_start:at]
    n = re.escape(name)
    found: list[tuple[int, set[str]]] = []
    for m in re.finditer(rf'\b(?:const|let|var)\s+{n}\s*(?::[^=;]*)?=\s*\{{', scope):
        inner = _balanced(scope, m.end() - 1)
        if inner is not None:
            found.append((m.start(), {k for k in KEY.findall(inner) if k not in SKIP_KEYS}))
    for m in re.finditer(rf'\b{n}\s*\??\s*:\s*[^=;{{]*?\bPick<\s*[\w.]+\s*,\s*((?:"[a-z_0-9]+"\s*\|?\s*)+)>', scope):
        found.append((m.start(), set(PICK_KEYS.findall(m.group(1)))))
    if not found:
        return None
    return max(found, key=lambda f: f[0])[1]


WRITE = re.compile(r'\.(insert|update|upsert)\(')
# What each write needs of the authenticated role, column by column.
PRIVILEGES = {"insert": ("INSERT",), "update": ("UPDATE",), "upsert": ("INSERT", "UPDATE")}


def _written(body: str, src: str, at: int, where: str) -> dict[str, set[str]]:
    """The columns each kind of write in this chain sends: literal keys, or the
    keys of the variable it is handed when that can be read."""
    out: dict[str, set[str]] = {}
    for m in WRITE.finditer(body):
        verb, rest = m.group(1), body[m.end():]
        keys: set[str] | None = None
        literal = re.match(r'\s*\{', rest)
        named = re.match(r'\s*([A-Za-z_$][\w$]*)\s*[,)]', rest)
        if literal:
            inner = _balanced(rest, literal.end() - 1)
            keys = {k for k in KEY.findall(inner or "") if k not in SKIP_KEYS}
        elif named:
            keys = resolve_object(src, named.group(1), at) if src else None
            if keys is None and where:
                print(f"contract.py: cannot see which columns `{named.group(1)}` writes "
                      f"({where}); not asserted", file=sys.stderr)
        if keys:
            out.setdefault(verb, set()).update(keys)
    return out


def columns_for_chain(body: str, src: str = "", at: int = 0, where: str = "") -> set[str]:
    cols: set[str] = set()
    for raw in SELECT.findall(body):
        for piece in raw.split(","):
            name = piece.strip().split("(")[0].strip()
            if name and name != "*":
                cols.add(name)
    for keys in _written(body, src, at, where).values():
        cols.update(keys)
    cols.update(COLUMN_FILTER.findall(body))
    return cols


def scan(paths: list[Path]) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    tables, rpcs, _ = scan_all(paths)
    return tables, rpcs


def scan_all(paths: list[Path]) -> tuple[dict[str, set[str]], dict[str, set[str]],
                                          dict[tuple[str, str], set[str]]]:
    """Tables and their columns, functions and their arguments, and, for each
    (table, privilege) a write needs, the columns it writes."""
    tables: dict[str, set[str]] = {}
    rpcs: dict[str, set[str]] = {}
    writes: dict[tuple[str, str], set[str]] = {}
    for path in paths:
        src = path.read_text(encoding="utf-8")
        for m in CHAIN.finditer(src):
            table, body = m.group(1), m.group(2)
            where = f"{path.name}:{src.count(chr(10), 0, m.start()) + 1}"
            tables.setdefault(table, set()).update(columns_for_chain(body, src, m.start(), where))
            for verb, keys in _written(body, src, m.start(), "").items():
                for priv in PRIVILEGES[verb]:
                    writes.setdefault((table, priv), set()).update(keys)
        for fn, args in RPC.findall(src):
            rpcs.setdefault(fn, set()).update(
                k for k in KEY.findall(args or "") if k not in SKIP_KEYS
            )
    return tables, rpcs, writes


def client_files(root: Path) -> list[Path]:
    """Every .ts and .tsx file under `root`, test files aside: a test's mock is
    not a query the app makes."""
    if not root.is_dir():
        return [root]
    return sorted(
        p for p in root.rglob("*")
        if p.suffix in (".ts", ".tsx")
        and not p.name.endswith((".test.ts", ".test.tsx", ".d.ts"))
    )


def emit(tables: dict[str, set[str]], rpcs: dict[str, set[str]],
         writes: dict[tuple[str, str], set[str]] | None = None) -> str:
    out = [
        "-- Generated by supabase/test/contract.py — do not edit.",
        "-- Asserts that every table, view, column and function the app calls exists,",
        "-- and that a signed-in client may write every column the app writes.",
        "\\set ON_ERROR_STOP on",
        "",
    ]
    for table in sorted(tables):
        out.append(
            f"do $$ begin perform test.check("
            f"to_regclass('public.{table}') is not null, "
            f"'app reads public.{table}'); end $$;"
        )
        for column in sorted(tables[table]):
            out.append(
                "do $$ begin perform test.check(exists ("
                "select 1 from information_schema.columns "
                f"where table_schema='public' and table_name='{table}' "
                f"and column_name='{column}'), "
                f"'  public.{table}.{column}'); end $$;"
            )
    # A column that exists and may not be written is the same empty screen as
    # one that does not exist: some tables here are granted column by column.
    for (table, priv), columns in sorted((writes or {}).items()):
        for column in sorted(columns):
            out.append(
                "do $$ begin perform test.check(has_column_privilege("
                f"'authenticated', 'public.{table}', '{column}', '{priv}'), "
                f"'  the app may {priv.lower()} public.{table}.{column}'); end $$;"
            )
    for fn in sorted(rpcs):
        out.append(
            "do $$ begin perform test.check(exists ("
            f"select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
            f"where n.nspname='public' and p.proname='{fn}'), "
            f"'app calls public.{fn}()'); end $$;"
        )
        for arg in sorted(rpcs[fn]):
            out.append(
                "do $$ begin perform test.check(exists ("
                "select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                f"where n.nspname='public' and p.proname='{fn}' "
                f"and '{arg}' = any(p.proargnames)), "
                f"'  {fn}({arg} => ...)'); end $$;"
            )
    out.append("\\echo 'CLIENT CONTRACT OK'")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    roots = [Path(a) for a in argv[1:]] or [Path("client/src/lib")]
    files: list[Path] = []
    for root in roots:
        files.extend(client_files(root))
    tables, rpcs, writes = scan_all(files)
    if not tables and not rpcs:
        print("-- no Supabase calls found; check the path", file=sys.stderr)
        return 1
    sys.stdout.write(emit(tables, rpcs, writes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
