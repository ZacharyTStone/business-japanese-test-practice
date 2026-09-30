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
        literal = publish.lit(value)
        assert literal.endswith("::jsonb")
        assert json.loads(_unquote(literal[:-len("::jsonb")])) == value


def test_numbers_and_the_rest():
    assert publish.lit(None) == "null"
    assert publish.lit(True) == "true" and publish.lit(False) == "false"
    assert publish.lit(3) == "3" and publish.lit(-2) == "-2"
    assert publish.lit(0.75) == "0.75"
    assert float(publish.lit(2 / 3)) == pytest.approx(2 / 3)


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_a_number_that_is_not_one_is_refused(bad):
    with pytest.raises(ValueError):
        publish.lit(bad)
    with pytest.raises(ValueError):
        publish.lit({"model_p_correct": bad})


def test_a_nul_is_refused_rather_than_cut_off_by_postgres():
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
              "generated_at": "2026-09-30\ndelete from public.items; --",
              "generator_model": "claude\r\ndrop table public.attempts;"}
    sql = publish.bundle_sql(bundle, "goi_bunpou_J2_999", withdrawn_ids=set())
    for line in _code_lines(sql):
        assert not line.lstrip().startswith(("delete from public.items;", "drop table")), line
    assert "-- generated 2026-09-30 delete from public.items; -- by claude drop table" in sql


def test_the_grant_refuses_what_is_not_a_user_id(capsys):
    assert cli.main(["grant", "00000000-0000-0000-0000-000000000000\n; drop table x"]) == 2
    assert cli.main(["grant", "not-a-uuid"]) == 2
    assert cli.main(["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b"]) == 0


def test_the_grants_product_stays_in_its_comment(capsys):
    assert cli.main(["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b",
                     "--product", "ads_free\ndelete from public.entitlements;"]) == 0
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
