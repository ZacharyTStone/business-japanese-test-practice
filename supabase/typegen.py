#!/usr/bin/env python3
"""The database's shape as TypeScript, read from a database built from the migrations.

`client/src/lib/database.types.ts` is the `Database` type supabase-js takes as
`createClient<Database>(...)`: tables and views in `public` with their columns
(`Row`, and for a table `Insert` and `Update`), and functions with their
arguments and what they return. `supabase gen types` writes the same shape,
but it wants a linked project or a running local stack; this reads the
throwaway Postgres that `supabase/test/run.sh` builds, so it needs no project,
no network and no key, like everything else in `supabase/test`.

It describes the database as a signed-in client meets it, because that is the
only way the app ever meets it. A table or view the authenticated role cannot
read is left out, and so is a function it cannot call. A column it may not
insert or update — no privilege on the column, or no row-level policy that
lets it insert or update the table at all — is `?: never` in `Insert` or
`Update`, so the type checker says what the grants and policies say:
`attempts` takes the eight columns the app sends and no update, and `profiles`
takes an update of four columns and no insert. A column a trigger stamps
before the row is checked (STAMPED below) is optional in `Insert`, since the
app never sends it.

    BJT_TYPEGEN_WRITE=1 supabase/test/run.sh                  # rewrite the file
    python supabase/typegen.py --db bjt_schema_test           # the same, by hand
    python supabase/typegen.py --db bjt_schema_test --check   # exit 1 if stale

It connects with the usual PG* variables, through psql. run.sh runs it with
--check right after the migrations are applied, so a migration that changes
something the app can see lands with the types regenerated, or the schema
check fails.

Like `supabase gen types`, it types what a function returns as never null:
Postgres does not say which outputs can be.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / "client" / "src" / "lib" / "database.types.ts"

# Columns a BEFORE INSERT trigger fills from the session, which the app
# therefore never sends although it may: optional in `Insert`.
STAMPED = {
    ("item_feedback", "user_id"),   # stamp_item_feedback()
}

# One query, one JSON document: tables and views with their columns, the
# foreign keys between them, and the functions with their arguments.
CATALOG = r"""
with rels as (
    select c.oid, c.relname, c.relkind,
           (not c.relrowsecurity or exists (
                select 1 from pg_policy po
                 where po.polrelid = c.oid and po.polpermissive
                   and po.polcmd in ('a', '*')
                   and (0 = any (po.polroles) or 'authenticated'::regrole::oid = any (po.polroles))
           )) as insert_policy,
           (not c.relrowsecurity or exists (
                select 1 from pg_policy po
                 where po.polrelid = c.oid and po.polpermissive
                   and po.polcmd in ('w', '*')
                   and (0 = any (po.polroles) or 'authenticated'::regrole::oid = any (po.polroles))
           )) as update_policy
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm')
       and has_any_column_privilege('authenticated', c.oid, 'SELECT')
),
cols as (
    select a.attrelid, a.attname, a.attnum,
           t.typname, t.typtype, t.typcategory,
           et.typname as elem,
           not a.attnotnull as nullable,
           a.atthasdef as has_default,
           a.attidentity as identity,
           a.attgenerated as generated,
           has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT') as can_insert,
           has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') as can_update
      from pg_attribute a
      join pg_type t on t.oid = a.atttypid
      left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
     where a.attrelid in (select oid from rels)
       and a.attnum > 0 and not a.attisdropped
),
fks as (
    select con.conrelid, con.conname,
           array(select a.attname from unnest(con.conkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n
                  order by k.i) as columns,
           dst.relname as referenced,
           array(select a.attname from unnest(con.confkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n
                  order by k.i) as referenced_columns,
           exists (select 1 from pg_index x
                    where x.indrelid = con.conrelid and x.indisunique
                      and x.indnkeyatts = cardinality(con.conkey)
                      and (x.indkey::int2[])[0:x.indnkeyatts - 1] @> con.conkey
                      and (x.indkey::int2[])[0:x.indnkeyatts - 1] <@ con.conkey) as one_to_one
      from pg_constraint con
      join pg_class dst on dst.oid = con.confrelid
     where con.contype = 'f'
       and con.conrelid in (select oid from rels)
       and con.confrelid in (select oid from rels)
),
fns as (
    select p.oid, p.proname, p.proretset as setof,
           rt.typname as ret, rt.typtype as ret_kind, rt.typrelid as ret_rel,
           ret_elem.typname as ret_elem,
           p.pronargs, p.pronargdefaults,
           coalesce(p.proargnames, '{}') as argnames,
           coalesce(p.proargmodes::text[], array_fill('i'::text, array[p.pronargs])) as argmodes,
           array(select t.typname from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]))
                        with ordinality u(oid, i)
                   join pg_type t on t.oid = u.oid order by u.i) as argtypes,
           array(select coalesce(et.typname, '') from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]))
                        with ordinality u(oid, i)
                   join pg_type t on t.oid = u.oid
                   left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
                  order by u.i) as argelems
      from pg_proc p
      join pg_type rt on rt.oid = p.prorettype
      left join pg_type ret_elem on ret_elem.oid = rt.typelem and rt.typcategory = 'A'
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and rt.typname not in ('trigger', 'event_trigger')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
)
select json_build_object(
    'relations', (select coalesce(json_agg(json_build_object(
                      'name', r.relname, 'kind', r.relkind,
                   'insert_policy', r.insert_policy, 'update_policy', r.update_policy,
                      'columns', (select coalesce(json_agg(to_json(c) order by c.attname), '[]')
                                    from cols c where c.attrelid = r.oid),
                      'fks', (select coalesce(json_agg(to_json(f) order by f.conname), '[]')
                                from fks f where f.conrelid = r.oid))
                   order by r.relname), '[]') from rels r),
    'functions', (select coalesce(json_agg(to_json(f) order by f.proname, f.oid), '[]') from fns f),
    'composites', (select coalesce(json_object_agg(c.attrelid::text, c.cols), '{}')
                     from (select attrelid, json_agg(to_json(cols) order by attname) as cols
                             from cols group by attrelid) c)
);
"""

SCALARS = {
    "bool": "boolean",
    "int2": "number", "int4": "number", "int8": "number", "float4": "number",
    "float8": "number", "numeric": "number", "oid": "number",
    "json": "Json", "jsonb": "Json",
    "text": "string", "varchar": "string", "bpchar": "string", "name": "string",
    "uuid": "string", "date": "string", "time": "string", "timetz": "string",
    "timestamp": "string", "timestamptz": "string", "interval": "string",
    "bytea": "string", "inet": "string", "cidr": "string", "citext": "string",
    "regclass": "string", "regproc": "string", "regprocedure": "string",
    "void": "undefined",
    "record": "Record<string, unknown>",
}


def ts_type(typname: str, elem: str | None = None) -> str:
    if elem:
        inner = ts_type(elem)
        return f"({inner})[]" if " " in inner else f"{inner}[]"
    return SCALARS.get(typname, "unknown")


def query(db: str) -> dict:
    out = subprocess.run(
        ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", CATALOG],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def _block(lines: list[str], indent: int) -> list[str]:
    pad = " " * indent
    return [pad + ln if ln else ln for ln in lines]


def _object(fields: list[tuple[str, str, bool]]) -> list[str]:
    """`{ name: type }` fields, each (name, type, optional)."""
    if not fields:
        return ["[_ in never]: never"]
    return [f"{name}{'?' if optional else ''}: {typ}" for name, typ, optional in fields]


def _braced(head: str, body: list[str], indent: int) -> list[str]:
    return _block([f"{head}{{", *_block(body, 2), "}"], indent)


def render(cat: dict) -> str:
    tables: list[str] = []
    views: list[str] = []
    for rel in cat["relations"]:
        cols = rel["columns"]
        row = [(c["attname"], ts_type(c["typname"], c["elem"]) + (" | null" if c["nullable"] else ""), False)
               for c in cols]
        rels = []
        for f in rel["fks"]:
            rels += [
                "{",
                f'  foreignKeyName: "{f["conname"]}"',
                f"  columns: [{', '.join(json.dumps(c) for c in f['columns'])}]",
                f"  isOneToOne: {'true' if f['one_to_one'] else 'false'}",
                f'  referencedRelation: "{f["referenced"]}"',
                f"  referencedColumns: [{', '.join(json.dumps(c) for c in f['referenced_columns'])}]",
                "},",
            ]
        relationships = ["Relationships: []"] if not rels else ["Relationships: [", *_block(rels, 2), "]"]
        if rel["kind"] in ("r", "p"):
            insert, update = [], []
            for c in cols:
                typ = ts_type(c["typname"], c["elem"]) + (" | null" if c["nullable"] else "")
                written = not c["generated"] and c["identity"] != "a"
                if written and c["can_insert"] and rel["insert_policy"]:
                    optional = (c["nullable"] or c["has_default"] or bool(c["identity"])
                                or (rel["name"], c["attname"]) in STAMPED)
                    insert.append((c["attname"], typ, optional))
                else:
                    insert.append((c["attname"], "never", True))
                updatable = written and c["can_update"] and rel["update_policy"]
                update.append((c["attname"], typ if updatable else "never", True))
            body = [
                *_braced("Row: ", _object(row), 0),
                *_braced("Insert: ", _object(insert), 0),
                *_braced("Update: ", _object(update), 0),
                *relationships,
            ]
            tables += _braced(f"{rel['name']}: ", body, 0)
        else:
            body = [*_braced("Row: ", _object(row), 0), *relationships]
            views += _braced(f"{rel['name']}: ", body, 0)

    functions: list[str] = []
    for fn in cat["functions"]:
        names, modes = fn["argnames"], fn["argmodes"]
        types, elems = fn["argtypes"], fn["argelems"]
        inputs = [i for i, m in enumerate(modes) if m in ("i", "b", "v")]
        outputs = [i for i, m in enumerate(modes) if m in ("o", "b", "t")]
        first_default = len(inputs) - fn["pronargdefaults"]
        args = sorted((names[i] if i < len(names) and names[i] else f"arg{n}",
                       ts_type(types[i], elems[i] or None), n >= first_default)
                      for n, i in enumerate(inputs))
        if outputs and (len(outputs) > 1 or "t" in modes):
            ret_fields = [(names[i], ts_type(types[i], elems[i] or None), False) for i in outputs]
            ret = ["{", *_block(_object(sorted(ret_fields)), 2), "}" + ("[]" if fn["setof"] else "")]
        elif fn["ret_kind"] == "c" and str(fn["ret_rel"]) in cat["composites"]:
            ret_fields = [(c["attname"], ts_type(c["typname"], c["elem"]) + (" | null" if c["nullable"] else ""),
                           False) for c in cat["composites"][str(fn["ret_rel"])]]
            ret = ["{", *_block(_object(ret_fields), 2), "}" + ("[]" if fn["setof"] else "")]
        else:
            scalar = ts_type(fn["ret"], fn["ret_elem"])
            ret = [scalar + ("[]" if fn["setof"] else "")]
        head = ["Args: never"] if not args else _braced("Args: ", _object(args), 0)
        returns = [f"Returns: {ret[0]}", *ret[1:]]
        functions += _braced(f"{fn['proname']}: ", [*head, *returns], 0)

    never = ["[_ in never]: never"]
    schema = [
        *_braced("Tables: ", tables or never, 0),
        *_braced("Views: ", views or never, 0),
        *_braced("Functions: ", functions or never, 0),
        *_braced("Enums: ", never, 0),
        *_braced("CompositeTypes: ", never, 0),
    ]
    lines = [
        "// Generated by supabase/typegen.py from the migrations — do not edit.",
        "// Regenerate: supabase/test/run.sh fails when this is stale, and says how.",
        "",
        "export type Json =",
        "  | string",
        "  | number",
        "  | boolean",
        "  | null",
        "  | { [key: string]: Json | undefined }",
        "  | Json[]",
        "",
        "export type Database = {",
        *_block(_braced("public: ", schema, 0), 2),
        "}",
        "",
        'type PublicSchema = Database["public"]',
        "",
        "export type Tables<T extends keyof PublicSchema[\"Tables\"]> = PublicSchema[\"Tables\"][T][\"Row\"]",
        "export type TablesInsert<T extends keyof PublicSchema[\"Tables\"]> =",
        "  PublicSchema[\"Tables\"][T][\"Insert\"]",
        "export type TablesUpdate<T extends keyof PublicSchema[\"Tables\"]> =",
        "  PublicSchema[\"Tables\"][T][\"Update\"]",
        "export type Views<T extends keyof PublicSchema[\"Views\"]> = PublicSchema[\"Views\"][T][\"Row\"]",
        "export type Functions<T extends keyof PublicSchema[\"Functions\"]> = PublicSchema[\"Functions\"][T]",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", required=True, help="the database the migrations were applied to")
    parser.add_argument("--out", type=pathlib.Path, default=TARGET)
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if the file is out of date, and write nothing")
    args = parser.parse_args(argv)
    text = render(query(args.db))
    current = args.out.read_text(encoding="utf-8") if args.out.exists() else ""
    if args.check:
        if current != text:
            print(f"{args.out.relative_to(ROOT) if args.out.is_relative_to(ROOT) else args.out} is out of date: "
                  "run supabase/test/run.sh with BJT_TYPEGEN_WRITE=1, or "
                  "python supabase/typegen.py --db <database> against one it built",
                  file=sys.stderr)
            return 1
        return 0
    if current != text:
        args.out.write_text(text, encoding="utf-8")
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
