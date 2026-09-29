"""The app's copy of the pipeline's constants is the one the generator writes.

`client/src/lib/generated.ts` is written by `python -m bjt.client_constants`
from the distractor-role enums and the seed tables. A role or a tag added on
the Python side and not regenerated would reach the app as a generic sentence
such as 「この場面に合わない」 or a raw id, so a stale file fails here.
"""
import pathlib
import re

from bjt import client_constants
from bjt.fidelity.roles import DISTRACTOR_ROLES

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_the_committed_file_is_what_the_generator_writes():
    assert client_constants.TARGET.read_text(encoding="utf-8") == client_constants.render(), (
        "client/src/lib/generated.ts is stale: run python -m bjt.client_constants"
    )


def test_every_role_of_every_type_is_in_it_once():
    roles = client_constants.distractor_roles()
    assert len(roles) == len(set(roles))
    assert set(roles) == {r for rs in DISTRACTOR_ROLES.values() for r in rs}


def test_a_tag_label_is_the_one_most_tables_agree_on(tmp_path):
    for name, label in (("a", "依頼する"), ("b", "依頼する"), ("c", "お願いする")):
        (tmp_path / f"{name}.json").write_text(
            '{"functions": [{"id": "request", "ja": "%s"}]}' % label, encoding="utf-8")
    assert client_constants.tag_labels(tmp_path)["function"]["request"] == "依頼する"


def test_the_app_describes_every_role_by_the_generated_list():
    """roles.ts types its table as a Record over the generated roles, so the
    typecheck is what enforces coverage. This only checks that it still does:
    a table typed as a plain Record<string, …> would let a role slip through."""
    roles_ts = (ROOT / "client" / "src" / "lib" / "roles.ts").read_text(encoding="utf-8")
    assert re.search(r"Record<\s*DistractorRole\b", roles_ts), (
        "roles.ts no longer types its table over DistractorRole"
    )


def test_the_reading_clock_and_the_ladder_agree_on_its_longest_allowance():
    """pace.ts clamps a reading question's clock at MAX_SCALE times its type's
    budget; the ladder calls a right answer slow past pace_max_scale() times
    the same budget. If the two drift, an answer given inside the clock could
    be held as slow."""
    pace = (ROOT / "client" / "src" / "lib" / "pace.ts").read_text(encoding="utf-8")
    ts = re.search(r"const MAX_SCALE = ([0-9.]+);", pace)
    assert ts, "pace.ts no longer declares MAX_SCALE as expected"
    sql = "\n".join(p.read_text(encoding="utf-8")
                    for p in sorted((ROOT / "supabase" / "migrations").glob("*.sql")))
    defs = re.findall(r"function public\.pace_max_scale\(\).*?select ([0-9.]+)::numeric", sql, re.S)
    assert defs, "no migration defines pace_max_scale()"
    assert float(defs[-1]) == float(ts.group(1))
