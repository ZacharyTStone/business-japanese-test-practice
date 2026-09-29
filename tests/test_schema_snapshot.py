"""supabase/current.sql is the schema made readable, and it has to be current.

`next_items()` is redefined across many migrations; the snapshot is where its
current definition can be read in one place (supabase/snapshot.py). A migration
that lands without the snapshot being regenerated fails here.
"""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("snapshot", ROOT / "supabase" / "snapshot.py")
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


def test_the_committed_snapshot_is_what_the_migrations_say():
    assert (ROOT / "supabase" / "current.sql").read_text(encoding="utf-8") == snapshot.snapshot(), (
        "supabase/current.sql is stale: run python supabase/snapshot.py"
    )


def test_it_keeps_the_latest_definition_and_forgets_a_dropped_one(tmp_path):
    (tmp_path / "001.sql").write_text(
        "create function public.f() returns int language sql as $$ select 1; $$;\n"
        "create view public.v as select 1;\n"
        "comment on function public.f is 'first';\n",
        encoding="utf-8",
    )
    (tmp_path / "002.sql").write_text(
        "-- a comment with a ; in it\n"
        "create or replace function public.f() returns int language sql as $$ select 'a;b'; $$;\n"
        "drop view public.v;\n",
        encoding="utf-8",
    )
    text = snapshot.snapshot(tmp_path)
    assert "select 'a;b'" in text and "select 1; $$" not in text
    assert "comment on function public.f is 'first'" not in text
    assert "view v" not in text


def test_every_function_the_app_calls_is_in_it():
    text = (ROOT / "supabase" / "current.sql").read_text(encoding="utf-8")
    for name in ("next_items", "my_streak", "reset_my_progress", "veto_item", "may_i_veto", "level_evidence"):
        assert f"-- ==== function {name} " in text, name
