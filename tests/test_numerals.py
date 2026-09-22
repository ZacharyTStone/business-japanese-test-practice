"""The Arabic-numeral rule for printed text (bjt/render/numerals.py).

The cases here are the ones that decide whether the rule is safe to run over
the whole library: the words that merely contain a numeral character, the names
that keep their kanji, and idempotence — the offline check works by re-running
the converter, so a converter that moved on its own output would fail every
clean batch and corrupt every money value it touched.
"""
import copy
import json
import pathlib

import pytest

from bjt import batch, schemas
from bjt.render import numerals

BATCHES = pathlib.Path(__file__).resolve().parent.parent / "batches"


# ----- what is a number -------------------------------------------------

@pytest.mark.parametrize("before,after", [
    ("九月九日（火）", "9月9日（火）"),
    ("十時〜十二時", "10時〜12時"),
    ("九時三十分〜十六時三十分", "9時30分〜16時30分"),
    ("九月九日 九時十分", "9月9日 9時10分"),
    ("数量二百個の場合", "数量200個の場合"),
    ("椅子六十脚", "椅子60脚"),
    ("二十台から十六台に減らす", "20台から16台に減らす"),
    ("午前九時から午後三時まで", "午前9時から午後3時まで"),
    ("三階および四階", "3階および4階"),
    ("週二日までとする", "週2日までとする"),
    ("納期を一か月延ばし", "納期を1か月延ばし"),
    ("納品前に二週間", "納品前に2週間"),
    ("基礎研修 一日目", "基礎研修 1日目"),
    ("進行中（八割）", "進行中（8割）"),
    ("五十パーセント", "50パーセント"),
    ("一脚につき一枚ずつ", "1脚につき1枚ずつ"),
    ("二〇二六年", "2026年"),
    ("八月二十八日 十七時二十分", "8月28日 17時20分"),
    ("正午から一時は閉室", "正午から1時は閉室"),
])
def test_numbers_become_digits(before, after):
    assert numerals.to_arabic_text(before) == after


@pytest.mark.parametrize("before,after", [
    ("一万円以上の支出", "1万円以上の支出"),
    ("三十万円", "30万円"),
    ("予算は八百万円", "予算は800万円"),
    ("二十四万四千円", "24万4000円"),
    ("単価は千五百円まで", "単価は1500円まで"),
])
def test_money_keeps_its_myriad_word(before, after):
    """800万円, never 8000000円 — which is how a Japanese accountant writes it."""
    assert numerals.to_arabic_text(before) == after


# ----- what is not a number ---------------------------------------------

@pytest.mark.parametrize("text,word", [
    ("九月分 発注一覧", "一覧"),      # 覧 is not a counter
    ("資料が一部足りません", "一部"),   # a copy, not one 部
    ("十分な時間がある", "十分な"),     # not ten minutes
    ("一時的な措置", "一時的"),        # not one o'clock
    ("一般のお客様", "一般"),
    ("一方の案", "一方"),
])
def test_words_that_merely_contain_a_numeral_are_left_alone(text, word):
    assert word in numerals.to_arabic_text(text)


def test_a_real_number_beside_such_a_word_still_moves():
    assert numerals.to_arabic_text("九月分 発注一覧") == "9月分 発注一覧"


@pytest.mark.parametrize("name", [
    "第一会議室", "第二会議室", "第一研修室",
    "第三回 設備改修 打ち合わせ 議事録", "第四回 案件N", "第二部",
])
def test_ordinals_in_names_keep_their_kanji(name):
    """Without the 第 guard, 回 and 部 would renumber every meeting room in the
    library and the options naming them would stop matching the table."""
    assert numerals.to_arabic_text(name) == name


@pytest.mark.parametrize("text", [
    "二三日で終わります",   # two or three days, not the 23rd
    "四五人",            # four or five people
])
def test_an_approximate_pair_is_not_a_multi_digit_number(text):
    """二〇二六 concatenates because the 〇 says it is positional. 二三 does not:
    a multi-digit run with no 〇 in it is a Japanese speaker saying "two or
    three", so it is left alone rather than guessed at."""
    assert numerals.to_arabic_text(text) == text


@pytest.mark.parametrize("text", ["二、三日", "二，三名", "三、四か月"])
def test_an_approximate_pair_split_by_a_comma_is_left_whole(text):
    """Only the second half is followed by a counter, so without the guard this
    would produce 「二、3日」 — half an idiom, worse than no change at all."""
    assert numerals.to_arabic_text(text) == text


@pytest.mark.parametrize("label", ["案一", "案二", "案三"])
def test_a_bare_label_is_not_a_number(label):
    assert numerals.to_arabic_text(label) == label


# ----- idempotence ------------------------------------------------------

@pytest.mark.parametrize("text", [
    "20万円", "800万円", "24万4000円", "1万8000円×12", "21万6000円",
    "9月9日 9時10分", "10時〜12時", "万円",
])
def test_converting_twice_changes_nothing(text):
    """`20万円` read again offers its 万 as a fresh number; taking it would give
    `201万円`, and then `2011万円`. The check re-runs the converter, so this is
    the property that makes the check usable at all."""
    once = numerals.to_arabic_text(text)
    assert numerals.to_arabic_text(once) == once


def test_a_bare_myriad_is_not_a_quantity():
    assert numerals._value("万") is None
    assert numerals.to_arabic_text("万円") == "万円"


# ----- the document walk ------------------------------------------------

def _doc():
    return {
        "template": "schedule",
        "title": "会議室 予約状況（九月九日）",
        "meta": [{"label": "期間", "value": "九月九日（火）"}],
        "blocks": [
            {"type": "table",
             "columns": ["会議室", "十時〜十二時"],
             "rows": [["第一会議室", "空き"]]},
            {"type": "callout", "tone": "info",
             "text": "十七時までにお返しください。"},
        ],
    }


def test_to_arabic_reaches_every_printed_field():
    doc = _doc()
    moved = numerals.to_arabic(doc)
    assert moved == 4  # title, meta value, one column, the callout
    assert doc["title"] == "会議室 予約状況（9月9日）"
    assert doc["meta"][0]["value"] == "9月9日（火）"
    assert doc["blocks"][0]["columns"] == ["会議室", "10時〜12時"]
    assert doc["blocks"][0]["rows"] == [["第一会議室", "空き"]]
    assert doc["blocks"][1]["text"] == "17時までにお返しください。"


def test_document_faults_names_what_is_left():
    assert numerals.document_faults(_doc()) == ["九", "十", "十七", "十二"]
    clean = _doc()
    numerals.to_arabic(clean)
    assert numerals.document_faults(clean) == []


def test_to_arabic_survives_a_malformed_document():
    assert numerals.to_arabic("not a document") == 0
    assert numerals.to_arabic({"title": "九月", "blocks": [None, {"type": "table"}]}) == 1


# ----- the item-level policy --------------------------------------------

def _item(item_type, **over):
    item = {
        "item_type": item_type,
        "stem": "九時に始めます。",
        "options": [{"text": "十時から", "role": "correct", "why": "十時が正しい理由。"}],
        "explanation_ja": "十時が答え。",
        "explanation_en": "ten.",
        "document": _doc(),
    }
    item.update(over)
    return item


def test_a_spoken_stem_is_never_rewritten():
    """joukyou_haaku narrates its stem, and a clip id hashes its text."""
    item = _item("joukyou_haaku")
    batch.normalise_numerals(item)
    assert item["stem"] == "九時に始めます。"          # spoken — untouched
    assert item["options"][0]["text"] == "10時から"   # printed — moved
    assert item["options"][0]["why"] == "10時が正しい理由。"
    assert item["explanation_ja"] == "10時が答え。"
    assert item["document"]["title"] == "会議室 予約状況（9月9日）"


def test_a_printed_stem_is_rewritten():
    """sougou_dokkai has no audio at all, so its stem is on the screen."""
    item = _item("sougou_dokkai")
    batch.normalise_numerals(item)
    assert item["stem"] == "9時に始めます。"


def test_a_type_with_no_document_is_out_of_scope():
    """表現読解's options are utterances, and 語彙・文法's are the question being
    asked (「十二台」 against 「十二枚」). Nothing on screen contradicts them."""
    item = _item("hyougen", document=None)
    del item["document"]
    assert batch.normalise_numerals(item) == 0
    assert item["stem"] == "九時に始めます。"
    assert item["options"][0]["text"] == "十時から"


def test_spoken_options_are_never_rewritten():
    item = _item("bamen_haaku", document=None)
    del item["document"]
    assert batch.normalise_numerals(item) == 0


def test_normalising_twice_moves_nothing_the_second_time():
    item = _item("joukyou_haaku")
    assert batch.normalise_numerals(item) > 0
    assert batch.normalise_numerals(item) == 0


# ----- the library ------------------------------------------------------

COMMITTED = sorted(p for p in BATCHES.glob("*.json") if not p.name.endswith(".source.json"))


@pytest.mark.parametrize("path", COMMITTED, ids=lambda p: p.name)
def test_every_committed_bundle_reads_like_print(path):
    """The whole point, asserted over the library rather than over a sample."""
    bundle = json.loads(path.read_text(encoding="utf-8"))
    report = batch.check_bundle(bundle)
    numeral_checks = [c for c in report.checks if c.name == "numbers are written as digits"]
    assert all(c.status == "pass" for c in numeral_checks), \
        [c.detail for c in numeral_checks if c.status != "pass"]


@pytest.mark.parametrize("path", COMMITTED, ids=lambda p: p.name)
def test_no_committed_document_spells_a_number_out(path):
    bundle = json.loads(path.read_text(encoding="utf-8"))
    for item in bundle.get("items") or []:
        for doc in schemas.documents_of(batch._as_generator_shape(item)):
            assert numerals.document_faults(doc) == [], f"{item['id']}: {doc.get('title')}"
