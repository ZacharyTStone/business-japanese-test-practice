"""語彙・文法問題 generator — vocabulary and grammar.

A single carrier sentence with one blank (＿＿＿) and four options; exactly one
completes the sentence correctly. The tested knowledge is the word or grammatical
form itself, so the trap is built entirely in the option set.

Variety here is a different problem from the listening types. Ask a prompt for
"a business sentence with a blank" ten times and you get ten sentences testing
敬語, because that is what "business Japanese" means to a model. So the seed
table's `function` axis carries the GRAMMAR POINT under test, and the cell
assigns it: ten items are ten different grammar points by construction.
"""
from __future__ import annotations

from .base import Generator


class GoiBunpouGenerator(Generator):
    item_type = "goi_bunpou"
    label = "語彙・文法問題 (vocabulary/grammar)"
    requires_cell = True
    task_spec = (
        "Format: a natural business sentence containing exactly one blank written as "
        "＿＿＿. The four options are candidate fillers for that blank. Exactly one is "
        "correct; the sentence must be genuinely natural business Japanese with the "
        "correct filler and clearly wrong with each distractor. The carrier sentence "
        "must supply enough context that the answer is unambiguous WITH the sentence, "
        "but the option set alone must not give the answer away.\n"
        "This type is MORPHOLOGY AND FUNCTION, not business vocabulary. On the real "
        "paper the four options are short and adjacent to each other: one stem with "
        "four endings （使いきり／使いはじめ／使いよう／使いづくめ), four particles or focus "
        "markers （こそ／のみ／だけ／まで), or a set phrase against its near neighbours "
        "（せい／おかげ／ごくろうさま／おせわさま). Four different business nouns is the "
        "wrong item: the difficulty must sit in which FORM the sentence licenses, not "
        "in whether the test-taker knows four words.\n"
        "At least one distractor should be morphologically plausible and not an actual "
        "word — that is the `nonexistent_form` role, and it is a real feature of this "
        "type rather than a trick. The business setting lives in the carrier sentence; "
        "the options themselves are usually ordinary Japanese.\n"
        "Every other distractor must be WRONG in this sentence, not merely less usual. A "
        "register distractor is wrong only when the situation really rules it out "
        "(外しています to a client on the phone), not when it is one notch plainer than "
        "the key. Five questions were withdrawn for marking natural Japanese wrong: "
        "ご確認くださいますよう beside ご確認いただきますよう (both standard before "
        "お願い申し上げます), 得られたら beside 得られれば in minutes, 三人 beside 三名 to "
        "one's boss, すり合わせてあります beside すり合わせてまいりました, 検討を始めて "
        "beside 対応を始めて. If you would hesitate to call a distractor an error in front of "
        "a native editor, the item has two answers — change the sentence until it does "
        "not. The 解説 never calls a real expression nonexistent."
    )

    def cell_spec(self, cell) -> str:
        channel_note = {
            "written": "The carrier sentence is a line of written business Japanese — "
                       "an email, a report, or a notice. Written conventions apply: no "
                       "spoken fillers, no 話し言葉 contractions.",
            "in_person": "The carrier sentence is something said out loud at work.",
            "phone": "The carrier sentence is something said on the telephone.",
        }[cell.channel]
        return (
            "Write this item for the following assignment. These are requirements, not "
            "suggestions:\n"
            f"- 場面（この文が現れる場所）: {cell.setting_ja}\n"
            f"- 関係（書き手・話し手 → 相手）: {cell.relation_ja}\n"
            f"- 出題ポイント（空欄で試す文法・語彙）: {cell.function_ja}\n"
            f"- channel: {cell.channel} — {channel_note}\n"
            "The blank must test exactly the 出題ポイント above. A sentence where the "
            "blank happens to be fillable by testing something else instead is a failed "
            "item: the whole point of the assignment is that a batch of ten covers ten "
            "different points rather than ten flavours of 敬語."
        )
