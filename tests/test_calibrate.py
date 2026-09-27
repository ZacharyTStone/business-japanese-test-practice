"""`bjt calibrate`: a skip is not a wrong answer, and the bank's side is the app.

Until 2026-09-27 the official score divided by every official item, skipped
ones included, and the bank's score was whatever `bjt practice` had written to
the local database. Both flattered the bank. These tests sit a fixture paper
with a skip in it, read a fixture export of the app's first attempts, and hold
the two numbers apart.
"""
import json

import pytest

from bjt import calibration, cli
from bjt.db import Store

#: Four answerable items and one the terminal cannot show (five options). The
#: keys are A, B, C, D in turn.
OFFICIAL = [
    {"stem": f"公式サンプル問題{n}：＿＿＿に入る最も適切なものはどれですか。",
     "options": ["ござい", "おり", "いたし", "まいり"], "answer": n, "level": "J2",
     "explanation_ja": "解説。"}
    for n in range(4)
] + [
    {"stem": "選択肢が五つある問題。", "options": ["一", "二", "三", "四", "五"],
     "answer": 0, "level": "J2", "explanation_ja": "解説。"},
]

#: Right, skipped, wrong, right — and the fifth is never asked.
ANSWERS = ["A", "s", "A", "D"]

CSV = (
    "﻿item_type,is_correct,chosen_index\n"   # the byte-order mark a download can carry
    "goi_bunpou,true,0\n"
    "goi_bunpou,t,2\n"
    "goi_bunpou,FALSE,1\n"
    "goi_bunpou,false,-1\n"                         # the clock ran out: not an answer
    "hyougen,true,3\n"                              # another type: not this calibration
)


@pytest.fixture
def paper(seeds_dir, tmp_path, monkeypatch):
    (seeds_dir / "official").mkdir()
    (seeds_dir / "official" / "goi_bunpou.json").write_text(
        json.dumps(OFFICIAL, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr("bjt.config.DB_PATH", tmp_path / "calibrate.db")
    answers = iter(ANSWERS)
    monkeypatch.setattr("builtins.input", lambda prompt="": next(answers))
    return tmp_path


def _runs(tmp_path):
    store = Store(tmp_path / "calibrate.db")
    try:
        return [dict(r) for r in store.conn.execute("SELECT * FROM calibration_runs")]
    finally:
        store.close()


def test_a_skip_is_not_a_wrong_answer(paper, capsys):
    csv_path = paper / "attempts.csv"
    csv_path.write_text(CSV, encoding="utf-8")
    assert cli.main(["calibrate", "--type", "goi_bunpou", "--attempts-csv", str(csv_path)]) == 0
    out = capsys.readouterr().out

    # Two right of the three answered — not two of five.
    assert "official items:  2 right of 3 answered (67%); answered 3 of 5" in out
    assert "2 left unanswered, which is not the same as wrong" in out
    [run] = _runs(paper)
    assert run["official_accuracy"] == pytest.approx(2 / 3)
    assert run["n_official"] == 3


def test_the_banks_side_is_the_apps_first_attempts(paper, capsys):
    csv_path = paper / "attempts.csv"
    csv_path.write_text(CSV, encoding="utf-8")
    assert cli.main(["calibrate", "--type", "goi_bunpou", "--attempts-csv", str(csv_path)]) == 0
    out = capsys.readouterr().out

    assert "generated items: 2 right of 3 answered (67%)" in out
    assert "your first attempts in the app (attempts.csv)" in out
    assert "1 timed out, not counted as answers" in out
    assert "comparable" in out
    [run] = _runs(paper)
    assert run["generated_accuracy"] == pytest.approx(2 / 3)
    assert run["n_generated"] == 3


def test_without_a_file_the_local_database_is_read(paper, capsys):
    store = Store(paper / "calibrate.db")
    try:
        from bjt import fixtures, schemas
        item = fixtures.FIXTURES["goi_bunpou"]
        iid = store.insert_item("goi_bunpou", "J2", item, "fixture")
        ci = schemas.correct_index(item["options"])
        for chosen in (ci, ci, ci, (ci + 1) % 4):
            store.record_response(iid, chosen, chosen == ci)
    finally:
        store.close()

    assert cli.main(["calibrate", "--type", "goi_bunpou"]) == 0
    out = capsys.readouterr().out
    assert "generated items: 3 right of 4 answered (75%)" in out
    assert "what `bjt practice` recorded here" in out


def test_a_bad_export_is_refused_before_the_sitting(paper, capsys, monkeypatch):
    def never(prompt=""):
        raise AssertionError("the file is read before anybody answers anything")
    monkeypatch.setattr("builtins.input", never)

    csv_path = paper / "attempts.csv"
    csv_path.write_text("item_type,chosen_index\ngoi_bunpou,0\n", encoding="utf-8")
    assert cli.main(["calibrate", "--type", "goi_bunpou", "--attempts-csv", str(csv_path)]) == 2
    assert "no is_correct column" in capsys.readouterr().err


def test_an_unreadable_row_is_an_error_not_a_skip(tmp_path):
    """A skipped row is a number that looks measured and is not."""
    csv_path = tmp_path / "a.csv"
    csv_path.write_text("item_type,is_correct\ngoi_bunpou,true\ngoi_bunpou,maybe\n",
                        encoding="utf-8")
    with pytest.raises(ValueError, match=r"a\.csv:3"):
        calibration.read_attempts_csv(csv_path, "goi_bunpou")


def test_without_chosen_index_every_row_is_an_answer(tmp_path):
    csv_path = tmp_path / "a.csv"
    csv_path.write_text("is_correct,item_type,user\n1,goi_bunpou,x\n0,goi_bunpou,x\n",
                        encoding="utf-8")
    tally = calibration.read_attempts_csv(csv_path, "goi_bunpou")
    assert (tally.right, tally.answered, tally.total) == (1, 2, 2)


def test_the_export_sql_is_in_the_help_and_only_reads(capsys):
    with pytest.raises(SystemExit) as done:
        cli.main(["calibrate", "--help"])
    assert done.value.code == 0
    out = capsys.readouterr().out
    assert "public.attempts" in out and "you@example.com" in out

    sql = calibration.ATTEMPTS_EXPORT_SQL.lower()
    assert sql.lstrip().startswith("select") and sql.count(";") == 1
    for verb in ("insert", "update", "delete", "truncate", "drop", "alter", "grant"):
        assert verb not in sql, f"the export must only read, and it says {verb}"
    # First attempts, one account, the live bank.
    assert "distinct on (att.item_id)" in sql and "order by att.item_id, att.answered_at" in sql
    assert "u.email" in sql and "is_published" in sql
