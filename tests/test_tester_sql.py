"""Re-adding a tester changes only what the command names.

The deploy workflow re-adds a tester with `bjt tester "$EMAIL" --note "$NOTE"`,
and the statement it wrote set every flag from the command line — false,
false, null for a command that named none — so re-adding the owner took away
the veto, the unlimited day and the day's size.
"""
import re

from bjt import cli


def _sql(capsys, *argv):
    assert cli.main(["tester", *argv]) == 0
    out = capsys.readouterr().out
    return out[out.index("insert into"):]


def _updated(sql: str) -> list[str]:
    tail = sql[sql.index("on conflict"):]
    return re.findall(r"(\w+) = excluded\.\1", tail)


def test_the_deploy_workflows_re_add_keeps_the_owners_flags(capsys):
    sql = _sql(capsys, "owner@example.com", "--note", "the owner")
    assert _updated(sql) == ["note"]
    for flag in ("unlimited", "may_veto", "max_daily_goal"):
        assert f"{flag} = excluded" not in sql


def test_a_re_add_that_names_nothing_changes_nothing(capsys):
    sql = _sql(capsys, "owner@example.com")
    assert "on conflict (email) do nothing;" in sql
    assert "do update" not in sql


def test_each_named_flag_is_the_only_one_written(capsys):
    assert _updated(_sql(capsys, "a@example.com", "--veto")) == ["may_veto"]
    assert _updated(_sql(capsys, "a@example.com", "--unlimited")) == ["unlimited"]
    assert _updated(_sql(capsys, "a@example.com", "--max-goal", "60")) == ["max_daily_goal"]
    assert _updated(_sql(capsys, "a@example.com", "--note", "x", "--veto", "--max-goal", "60")) \
        == ["note", "may_veto", "max_daily_goal"]


def test_a_flag_can_still_be_taken_away_by_name(capsys):
    sql = _sql(capsys, "a@example.com", "--no-veto", "--no-unlimited", "--no-max-goal")
    assert "values ('a@example.com', '', false, false, null)" in sql
    assert _updated(sql) == ["unlimited", "may_veto", "max_daily_goal"]


def test_a_new_row_still_gets_the_defaults(capsys):
    sql = _sql(capsys, "new@example.com", "--note", "new")
    assert "values ('new@example.com', 'new', false, false, null)" in sql


def test_contradicting_the_day_is_refused(capsys):
    assert cli.main(["tester", "a@example.com", "--max-goal", "60", "--no-max-goal"]) == 2
