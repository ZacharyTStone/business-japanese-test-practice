"""発言聴解: the seed cell is an assignment, and the schema enforces the fields
the audio and image pipelines depend on."""
import copy

import pytest

from bjt import batch, schemas, seedtable
from bjt.generators import get_generator
from bjt.tts import plan as tts_plan

CELL_ID = "phone_external+staff_to_client+phone_absence@J2"


@pytest.fixture
def cell():
    return seedtable.load("hatsugen_choukai").get(CELL_ID)


@pytest.fixture
def item(cell):
    """A minimal valid item for the cell above."""
    return {
        "item_type": "hatsugen_choukai",
        "level": "J2",
        "topic": "不在の伝達",
        "stem": "取引先から上司あてに電話がかかってきました。上司は外出中です。こんなとき、何と言いますか。",
        "scene_id": "scene_phone_desk",
        "speaker_role": "電話を受けた社員",
        "listener_role": "取引先の担当者",
        "channel": "phone",
        "options": [
            {"text": "田中はただいま外出しております。", "role": "correct",
             "why": "社外には身内を呼び捨てにし、謙譲語で述べるのが原則。"},
            {"text": "田中部長は外出されています。", "role": "wrong_uchi_soto",
             "why": "社外に対して身内の上司を尊敬語で高めている。"},
            {"text": "田中、今出ちゃってます。", "role": "register_too_casual",
             "why": "取引先に向ける丁寧さがない話し言葉になっている。"},
            {"text": "少々お待ちいただけますでしょうか。", "role": "content_mismatch",
             "why": "丁寧だが不在という肝心の情報を伝えていない。"},
        ],
        "explanation_ja": "社外には身内を低めて言う。",
        "explanation_en": "Own side takes humble forms toward outsiders.",
        "vocab_notes": [],
    }


def test_item_validates(item):
    assert schemas.validate_item("hatsugen_choukai", item) == []


def test_missing_listening_fields_are_rejected(item):
    for field in ("scene_id", "speaker_role", "listener_role", "channel"):
        broken = copy.deepcopy(item)
        broken.pop(field)
        errs = schemas.validate_item("hatsugen_choukai", broken)
        assert any(field in e for e in errs), f"{field} was not enforced"


def test_unknown_channel_is_rejected(item):
    item["channel"] = "telepathy"
    assert any("channel" in e for e in schemas.validate_item("hatsugen_choukai", item))


def test_option_without_why_is_rejected(item):
    item["options"][2].pop("why")
    assert any("missing why" in e for e in schemas.validate_item("hatsugen_choukai", item))


def test_scene_outside_the_cell_is_rejected(item, cell):
    item["scene_id"] = "scene_restaurant_private"   # real scene, wrong setting
    errs = get_generator("hatsugen_choukai").validate_extra(item, cell)
    assert any("scene_id" in e for e in errs)


def test_channel_disagreeing_with_the_cell_is_rejected(item, cell):
    item["channel"] = "in_person"                   # the cell is a phone cell
    errs = get_generator("hatsugen_choukai").validate_extra(item, cell)
    assert any("channel" in e for e in errs)


def test_generation_refuses_to_run_without_a_cell():
    with pytest.raises(ValueError):
        get_generator("hatsugen_choukai").generate("J2")


def test_generation_stamps_the_cell_and_takes_its_level(monkeypatch, item, cell):
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: copy.deepcopy(item))
    got = get_generator("hatsugen_choukai").generate(cell=cell, seed=0)
    assert got["seed_cell"]["id"] == CELL_ID
    assert got["level"] == cell.level


def test_generation_retries_when_the_model_ignores_the_assigned_scene(monkeypatch, item, cell):
    calls = {"n": 0}

    def fake(*a, **k):
        calls["n"] += 1
        out = copy.deepcopy(item)
        if calls["n"] == 1:
            out["scene_id"] = "scene_izakaya_table"  # not one of this cell's scenes
        return out

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    got = get_generator("hatsugen_choukai").generate(cell=cell, seed=0)
    assert calls["n"] == 2
    assert got["scene_id"] in cell.scenes


def test_prompt_carries_the_cell_not_a_plea_for_variety(cell):
    prompt = get_generator("hatsugen_choukai").user_prompt("J2", [], cell)
    assert cell.setting_ja in prompt
    assert cell.relation_ja in prompt
    assert cell.function_ja in prompt
    for scene in cell.scenes:
        assert scene in prompt


# ----- TTS planning ------------------------------------------------------

def test_voice_follows_the_relation_so_it_stays_fixed_across_items(item, cell):
    item["seed_cell"] = cell.to_dict()
    assert tts_plan.voice_for(item) == tts_plan.RELATION_VOICES[cell.relation]


def test_narration_stays_clean_even_on_a_phone_item(item):
    clips = tts_plan.plan_item(item, "x")
    assert clips[0].kind == "narration"
    # Only what is said *inside* the scene goes down the phone line. The
    # narrator is outside it, and so is the voice that reads the option
    # letters — a letter is the exam speaking, not anybody in the room.
    outside = [c for c in clips if c.kind in ("narration", "option_label")]
    assert len(outside) == 5
    assert all(c.channel == "in_person" for c in outside)
    assert all(c.channel == "phone" for c in clips if c.kind == "option")


def test_identical_utterances_share_one_clip(item):
    a = tts_plan.plan_item(item, "item-a")
    b = tts_plan.plan_item(item, "item-b")
    assert {c.clip_id for c in a} == {c.clip_id for c in b}
    # The question, the four options, and the four letters — and the letters
    # are the same four files for every item in the library, which is the
    # point of hashing a clip id from (voice, channel, text).
    assert len(tts_plan.manifest([("item-a", item), ("item-b", item)])) == 9


def test_bundle_item_keeps_the_listening_fields_and_resolves_the_answer(item, cell):
    item["seed_cell"] = cell.to_dict()
    bi = batch.to_bundle_item(item)
    assert bi["correct_index"] == 0
    assert bi["channel"] == "phone"
    assert bi["scene_id"] == "scene_phone_desk"
    assert len(bi["audio"]["options"]) == 4
