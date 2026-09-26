"""The naturalness rules: the offline lint, the prompt every generator is given,
and the proofreader's new questions.

Every pattern here is tested against a line taken from a question that was
withdrawn for it (batches/withdrawn.txt), so a pattern that stops catching the
thing it was written for fails here — and against a line that must still pass,
so one that starts catching natural Japanese fails too.
"""
import copy

import pytest

from bjt import batch, fixtures, withdrawn
from bjt.fidelity import naturalness, sanity
from bjt.generators import GENERATORS, get_generator


def _item(item_type):
    return copy.deepcopy(fixtures.FIXTURES[item_type])


def _with_option(item_type, text, *, role=None, index=1):
    item = _item(item_type)
    item["options"][index]["text"] = text
    if role:
        item["options"][index]["role"] = role
    return item


# ----- the lint ---------------------------------------------------------------

@pytest.mark.parametrize("item_type", sorted(fixtures.FIXTURES))
def test_every_worked_fixture_is_clean(item_type):
    assert naturalness.faults(_item(item_type)) == []


@pytest.mark.parametrize("line", [
    "課長、会議室の鍵をお借りさせていただかせていただいてもよろしいでしょうか。",
    "ご希望に沿わせていただくことができかねさせていただきます。",
    "いつもお世話になっております。ABC商事の鈴木と申させていただきます。",
    "本日はお忙しい中、お時間をいただかれまして、ありがとうございました。",
])
def test_invented_keigo_is_caught(line):
    found = naturalness.faults(_with_option("hatsugen_choukai", line))
    assert found and "keigo no speaker produces" in found[0]


@pytest.mark.parametrize("line", [
    # Real over-politeness: one common 二重敬語, or a formula out of its place.
    "恐れ入りますが、ただいまおっしゃられた期日をもう一度お聞かせ願えませんでしょうか。",
    "どうぞ、冷めないうちにお召し上がりになられてください。",
    "このたびは格別のご高配を賜りまして、誠にありがとうございました。",
    "差し支えなければ、設営のほうは私にお任せいただけませんでしょうか。",
    # And the ordinary uses of the words the patterns are built from.
    "お忙しいところ、確認させていただきました。",
    "お時間をいただき、ありがとうございました。",
])
def test_real_over_politeness_is_left_alone(line):
    assert naturalness.faults(_with_option("hatsugen_choukai", line)) == []


def test_a_deliberate_non_word_is_exempt():
    """語彙・文法's nonexistent_form distractor is built not to be a word."""
    item = _item("goi_bunpou")
    target = next(o for o in item["options"] if o["role"] == "nonexistent_form")
    target["text"] = "いただかれ"
    assert naturalness.faults(item) == []


def test_a_placeholder_is_caught_anywhere():
    item = _with_option("hatsugen_choukai", "いつもお世話になっております。〇〇商事の田中です。")
    assert any("placeholder" in f for f in naturalness.faults(item))
    doc = _item("sougou_dokkai")
    doc["document"]["title"] = "○○株式会社 御中"
    assert any("placeholder" in f for f in naturalness.faults(doc))


def test_brackets_are_caught_only_where_they_are_heard():
    heard = _item("joukyou_haaku")
    heard["stem"] = heard["stem"].replace("来客の男の人", "来客（男の人）", 1)
    assert "（" in heard["stem"]
    assert any("cannot hear" in f for f in naturalness.faults(heard))

    # A 表現読解 stem is read, not heard: brackets on a page are fine.
    read = _item("hyougen")
    read["stem"] = "（社外）" + read["stem"]
    assert naturalness.faults(read) == []


def test_a_narration_that_says_the_answer_is_caught():
    item = _item("bamen_haaku")
    answer = item["options"][0]
    assert answer["role"] == "correct"
    item["stem"] = f"{answer['text']}ところです。" + item["stem"]
    assert any("says the answer" in f for f in naturalness.faults(item))


def test_the_first_generated_answer_in_the_narration_is_the_one_withdrawn():
    """The pattern was written for this item; it must keep catching it."""
    item = next(it for p in batch.bundles() for it in batch.load(p)["items"]
                if it["id"] == "c21b2af994")
    assert any("says the answer" in f for f in naturalness.faults(batch._as_generator_shape(item)))


def test_every_item_with_a_tell_is_withdrawn_and_every_served_item_is_clean():
    """The ledger is compulsory: a committed item the lint catches is either in
    batches/withdrawn.txt or failing CI."""
    ledger = withdrawn.ids()
    caught, served_dirty = set(), []
    for path in batch.bundles():
        for it in batch.load(path)["items"]:
            if naturalness.faults(batch._as_generator_shape(it)):
                caught.add(it["id"])
                if it["id"] not in ledger:
                    served_dirty.append(it["id"])
    assert not served_dirty, served_dirty
    assert caught, "the lint catches nothing in the library — did a pattern stop working?"


# ----- the generator ----------------------------------------------------------

@pytest.mark.parametrize("item_type", sorted(GENERATORS))
def test_every_generator_is_told_the_rules(item_type):
    assert naturalness.PROMPT in get_generator(item_type).system_prompt("J2")


def test_a_draft_with_a_tell_is_sent_back_with_the_reason(monkeypatch):
    from bjt import seedtable
    cell = seedtable.load("hatsugen_choukai").cells("J2")[0]
    prompts = []

    def fake(system, user, schema):
        prompts.append(user)
        item = _item("hatsugen_choukai")
        item["scene_id"] = cell.scenes[0]
        item["channel"] = cell.channel
        if len(prompts) == 1:
            item["options"][1]["text"] = "課長、少し体調が悪いので、早退させていただかせていただいてもよろしいでしょうか。"
        return item

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    item = get_generator("hatsugen_choukai").generate(cell=cell, seed=0)
    assert len(prompts) == 2
    assert "keigo no speaker produces" in prompts[1]
    assert naturalness.faults(item) == []


# ----- the proofreader ------------------------------------------------------

def test_the_proofreader_is_asked_about_naturalness():
    assert {"unnatural_japanese", "situation_incoherent"} <= set(sanity.RULES)


def test_the_proofreader_sees_each_options_role():
    """Without it a deliberate non-word and a mistake look the same."""
    item = _item("goi_bunpou")
    text = sanity.render_for_sanity(item)
    for o in item["options"]:
        assert f"{o['text']}　［{o['role']}］" in text
