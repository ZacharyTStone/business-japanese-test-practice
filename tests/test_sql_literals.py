"""Every value that reaches the SQL goes in as data, never as SQL.

`publish.lit` quotes a value; `publish.comment` makes one safe inside a `--`
line. Without the second, a newline in a bundle's model name, a product
name or an address typed into a form ended the comment and started a line of
SQL the deploy would run.
"""
import json
import math
import random
import re

import pytest

from bjt import cli, publish

#: The alphabet the random strings are drawn from: everything that has ever
#: broken hand-quoted SQL, and the Japanese the content is written in.
_HARD = ["'", "''", "\\", "\\'", "$$", "$tag$", "\n", "\r\n", "--", "/*", "*/", ";",
         "\"", "`", "\t", " ", "　", "「", "」", "敬語", "ご確認ください。",
         "😀", "\U0001F9E7", "é", "E'x'", "%s", "{}", "a", " "]


def _unquote(literal: str) -> str:
    """Read a standard-conforming SQL string literal back, or fail."""
    assert re.fullmatch(r"'(?:[^']|'')*'", literal, re.S), literal
    return literal[1:-1].replace("''", "'")


def _strings(seed: int, n: int = 300):
    rng = random.Random(seed)
    for _ in range(n):
        yield "".join(rng.choice(_HARD) for _ in range(rng.randint(0, 12)))


@pytest.mark.parametrize("seed", range(5))
def test_any_string_comes_back_as_itself(seed):
    for s in _strings(seed):
        assert _unquote(publish.lit(s)) == s


@pytest.mark.parametrize("seed", range(3))
def test_any_json_comes_back_as_itself(seed):
    for s in _strings(seed, 100):
        value = {"text": s, "list": [s, 1, 2.5, None, True], s: [s]}
        # JSON text, which the schema checks with json_valid().
        assert json.loads(_unquote(publish.lit(value))) == value


def test_numbers_and_the_rest():
    assert publish.lit(None) == "null"
    # A SQLite boolean is an integer, and the schema checks it is 0 or 1.
    assert publish.lit(True) == "1" and publish.lit(False) == "0"
    assert publish.lit(3) == "3" and publish.lit(-2) == "-2"
    assert publish.lit(0.75) == "0.75"
    assert float(publish.lit(2 / 3)) == pytest.approx(2 / 3)


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_a_number_that_is_not_one_is_refused(bad):
    with pytest.raises(ValueError):
        publish.lit(bad)
    with pytest.raises(ValueError):
        publish.lit({"model_p_correct": bad})


def test_a_nul_is_refused_rather_than_cut_off():
    with pytest.raises(ValueError):
        publish.lit("before\x00after")


@pytest.mark.parametrize("seed", range(3))
def test_a_comment_is_always_one_line(seed):
    for s in _strings(seed):
        text = "-- " + publish.comment(s)
        assert len(text.splitlines()) == 1, repr(s)


def _code_lines(sql: str) -> list[str]:
    """The lines SQL would run: string literals (data) blanked out, and the
    comment lines themselves left in, since those are what is tested."""
    return re.sub(r"'(?:[^']|'')*'", "''", sql, flags=re.S).splitlines()


def test_a_bundle_cannot_smuggle_a_statement_through_its_header():
    bundle = {"item_type": "goi_bunpou", "level": "J2", "items": [],
              "generated_at": "2026-09-30\ndelete from items; --",
              "generator_model": "claude\r\ndrop table attempts;"}
    sql = publish.bundle_sql(bundle, "goi_bunpou_J2_999", withdrawn_ids=set())
    for line in _code_lines(sql):
        assert not line.lstrip().startswith(("delete from items;", "drop table")), line
    assert "-- generated 2026-09-30 delete from items, -- by claude drop table" in sql


def test_the_grant_refuses_what_is_not_a_user_id(capsys):
    assert cli.main(["grant", "00000000-0000-0000-0000-000000000000\n; drop table x"]) == 2
    assert cli.main(["grant", "not-a-uuid"]) == 2
    assert cli.main(["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b"]) == 0


def test_the_grants_product_stays_in_its_comment(capsys):
    assert cli.main(["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b",
                     "--product", "ads_free\ndelete from entitlements;"]) == 0
    out = capsys.readouterr().out
    assert not any(line.startswith("delete") for line in _code_lines(out))


@pytest.mark.parametrize("address", [
    "not-an-email", "a@b", "a@@b.co", "@b.co", "a@.co", "a b@c.co", "a@b.co\n; drop",
    "a@b.co x", "a\x00@b.co",
])
def test_the_tester_list_refuses_what_is_not_an_address(address):
    assert cli.main(["tester", address]) == 2


@pytest.mark.parametrize("address", ["owner@example.com", "o'brien@example.co.jp",
                                     "first.last+app@mail.example.org"])
def test_the_tester_list_takes_a_real_address(address, capsys):
    assert cli.main(["tester", address]) == 0
    out = capsys.readouterr().out
    assert publish.lit(address) in out


# ----- what a statement splitter sees -------------------------------------------

#: A splitter that does not know about `--` comments reads a quote in one as
#: the start of a string, and a semicolon as the end of a statement. D1 splits
#: a migration on its own side, and a "learner's" in a comment swallowed the
#: rest of one (the first remote deploy, 2026-10-01: "incomplete input").
_SPLITTER_CHARS = ("'", ";", "`", '"')


def _comment_lines(sql: str) -> list[str]:
    return [line for line in sql.splitlines() if line.lstrip().startswith("--")]


def _shipped_sql() -> list:
    from bjt import config
    root = config.ROOT
    return sorted([*root.glob("d1/**/*.sql"), *root.glob("batches/*.sql")])


def test_no_sql_this_project_ships_has_a_quote_or_a_semicolon_in_a_comment():
    files = _shipped_sql()
    assert files
    for path in files:
        for line in _comment_lines(path.read_text(encoding="utf-8")):
            assert not any(ch in line for ch in _SPLITTER_CHARS), f"{path.name}: {line}"


def test_a_trigger_body_has_no_case_expression():
    """CASE ... END inside BEGIN ... END is what a splitter counting ENDs
    closes the trigger on. Plain boolean logic says the same thing."""
    from bjt import config
    for path in sorted(config.ROOT.glob("d1/**/*.sql")):
        for body in re.findall(r"create trigger.*?\nend;", path.read_text(encoding="utf-8"), re.S | re.I):
            code = "\n".join(line.split("--")[0] for line in body.splitlines())
            assert not re.search(r"\bcase\b", code, re.I), f"{path.name}: {body[:80]}"


@pytest.mark.parametrize("argv", [
    ["tester", "o'brien@example.com", "--note", "it's me; really", "--max-goal", "60", "--veto"],
    ["tester", "o'brien@example.com", "--remove"],
    ["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b", "--product", "ads'free;x"],
    ["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b", "--revoke"],
])
def test_the_one_off_sql_the_commands_print_has_clean_comments(argv, capsys):
    assert cli.main(argv) == 0
    for line in _comment_lines(capsys.readouterr().out):
        assert not any(ch in line for ch in _SPLITTER_CHARS), line


def test_a_comment_value_loses_what_a_splitter_would_read():
    assert publish.comment("borrows desk's; `x` \"y\"") == "borrows desk’s, x y"
