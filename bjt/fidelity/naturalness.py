"""Japanese nobody says, caught without a model — and the prompt that asks for
the other kind.

A review of the whole bank on 2026-09-26 withdrew 39 of its 146 questions
(`batches/withdrawn.txt`). Almost none of them were wrong in the sense the
gates look for. They were unnatural: a line a native speaker would never
produce, in an item that was otherwise answerable, un-leaky and correctly keyed.
The commonest single cause was the over-polite distractor. Asked for an option
that is wrong "by being too polite", a model does not reach for the wording a
real person over-uses — it invents a stack nobody says
(「お借りさせていただかせていただいてもよろしいでしょうか」), and a learner who
hears one learns only that the silly option is the wrong one.

Two halves, for the two places an item can be stopped:

* `PROMPT` is told to every generator, so the draft is written right.
* `faults()` is the mechanical part of the same rules. It needs no key and no
  model, so it runs on every draft inside `Generator.generate` (a draft that
  trips it is sent back with the reason) and on every committed bundle inside
  `batch.check_bundle` (a bundle that trips it fails, in CI as in a night). It
  catches only what a pattern can see and says nothing about the rest, which is
  the proofreader's job (`sanity.RULES`, `unnatural_japanese`).

Nothing here second-guesses a deliberate non-word. 語彙・文法 has a distractor
role, `nonexistent_form`, whose whole job is to be morphologically plausible and
not a word; those options are exempt from the keigo patterns.
"""
from __future__ import annotations

import re

from .. import schemas
from ..render import document
from ..tts import plan as tts_plan

#: Keigo no speaker produces. Every pattern here was found in a committed
#: over-polite distractor and is the reason that item was withdrawn: させていただく
#: stacked on itself, できかねる given a させていただく, 申す given one, and the
#: humble いただく made honorific. Real over-politeness sounds like
#: 「おっしゃられる」 or 「お召し上がりになられる」 — one common 二重敬語 — and
#: none of these patterns touches it.
INVENTED_KEIGO = re.compile(
    r"いただかせていただ"   # お借りさせていただかせていただく
    r"|させていただかせ"    # the same stack, caught from its other end
    r"|かねさせていただ"    # できかねさせていただきます
    r"|申させていただ"      # 申させていただきます
    r"|いただかれ"          # お時間をいただかれまして
)

#: A written placeholder where a name belongs. Read aloud, 〇〇商事 is
#: 「まるまるしょうじ」, and printed it is a template nobody filled in.
PLACEHOLDER = re.compile(r"[〇○◯×✕△□]{2,}")

#: Written-only devices in something that is heard. The narrator either reads
#: 「先輩（営業部）」 as two unconnected nouns or skips the half in brackets.
WRITTEN_ONLY = re.compile(r"[（）()［］\[\]]")

#: Types whose narration describes the situation and whose options are short
#: statements about it. For these, the correct option appearing word for word in
#: the narration means the narration said the answer (「社内の会議室で、…」 before
#: 「ここはどこですか」). The other types quote their answer on purpose — a
#: conversation states the figure the question asks about — so they are not held
#: to it.
NARRATION_MUST_NOT_SAY = frozenset({"bamen_haaku"})

_PUNCT = re.compile(r"[\s。、．，,.!?！？「」『』]")

PROMPT = (
    "Natural Japanese, every line of it. Everything in the item — the narration, the "
    "conversation, the document, the correct option AND each distractor — must be "
    "Japanese a native office worker would actually say or write. A distractor is "
    "wrong the way real people are wrong, never by being malformed:\n"
    "- An over-polite distractor is wording people really use, only in a more formal "
    "situation than this one (a written formula such as ご高配を賜り said aloud; "
    "お任せいただけませんでしょうか to a peer), or ONE 二重敬語 people really say "
    "(おっしゃられる, お召し上がりになられる). Never stack させていただく on itself "
    "（させていただかせていただく）, never 申させていただく, できかねさせていただく or "
    "いただかれる, and never a parody chain of set phrases (…やに拝察いたしますゆえ, "
    "伏してお願い申し上げる次第でございます).\n"
    "- Honorifics go on people. 宅配便がお見えになる is not a mistake anybody makes, so "
    "it is not a distractor.\n"
    "- A casual distractor is how a person really talks to a close colleague, not a "
    "caricature of slang.\n"
    "- A misused word is not an over-polite option: 私では役不足です for 力不足 is a "
    "different error, and a distractor must not teach it unremarked.\n"
    "- Name fictional companies and people (山川商事の佐藤, みどり物産). Never a "
    "placeholder: 〇〇商事 is read aloud as 「まるまる」, and 「A社の『A』の字」 points at "
    "a kanji that does not exist.\n"
    "- Nothing written-only in what is heard: no parentheses in a narration, a spoken "
    "option or a turn of conversation. Say 「営業部の先輩」, not 「先輩（営業部）」.\n"
    "- The narration never states the answer, and the question is plain, grammatical "
    "Japanese: 「二人はどこで話していますか」 or 「ここはどこですか」, never a blend of "
    "the two.\n"
    "- Every option answers the question as asked, about the person it names.\n"
    "- A distractor marked wrong must be wrong in THIS sentence, not merely less usual. "
    "If a native would accept it here — ご確認くださいますよう beside ご確認いただきます"
    "よう, 〜たら beside 〜れば in minutes, 三人 beside 三名 to one's boss — the item has "
    "two answers. The 解説 never calls a real expression nonexistent.\n"
    "- The situation happens in real offices and hangs together: permission is asked of "
    "a superior, not a peer; a request to another department goes by email or in "
    "person, not on a posted notice; cause and effect run the right way; and the 解説 "
    "and every `why` describe the same situation as the stem."
)


def _spoken_texts(item: dict) -> list[tuple[str, str]]:
    """(where, text) for everything `bjt.tts.plan` would synthesise."""
    policy = tts_plan.audio_policy(item.get("item_type", ""))
    out: list[tuple[str, str]] = []
    if policy.get("stem") and item.get("stem"):
        out.append(("the narration", item["stem"]))
    if policy.get("options"):
        for i, o in enumerate(item.get("options") or []):
            out.append((f"option {i + 1}", o.get("text", "")))
    if policy.get("dialogue"):
        for i, t in enumerate(item.get("dialogue") or []):
            out.append((f"turn {i + 1} of the conversation", t.get("text", "")))
    return out


def _all_texts(item: dict) -> list[tuple[str, str, str]]:
    """(where, text, role) for everything a learner reads or hears. `role` is
    the option's distractor role, and empty for anything that is not an option."""
    out: list[tuple[str, str, str]] = [("the stem", item.get("stem", ""), "")]
    for i, o in enumerate(item.get("options") or []):
        out.append((f"option {i + 1}", o.get("text", ""), o.get("role", "")))
    for i, t in enumerate(item.get("dialogue") or []):
        out.append((f"turn {i + 1} of the conversation", t.get("text", ""), ""))
    for doc in schemas.documents_of(item):
        out.append(("the document", document.text_of(doc), ""))
    return out


def faults(item: dict) -> list[str]:
    """Every mechanical tell of unnatural Japanese in one item, each as a
    sentence the next draft can act on. Empty means none was found — which is
    not the same as natural: most of what makes a line unnatural takes a reader.

    Takes an item in generator shape (`batch._as_generator_shape` converts a
    bundle item), because that is what both callers hold.
    """
    found: list[str] = []

    for where, text, role in _all_texts(item):
        if role != "nonexistent_form":
            m = INVENTED_KEIGO.search(text)
            if m:
                found.append(
                    f"{where} uses keigo no speaker produces (「{m.group()}」); an over-polite "
                    "distractor must be wording people really use in a more formal situation")
        m = PLACEHOLDER.search(text)
        if m:
            found.append(
                f"{where} contains the placeholder 「{m.group()}」; name a fictional company "
                "or person instead (山川商事, 佐藤)")

    for where, text in _spoken_texts(item):
        m = WRITTEN_ONLY.search(text)
        if m:
            found.append(
                f"{where} is heard but contains 「{m.group()}」, which a listener cannot "
                "hear; say it as a phrase instead")

    if item.get("item_type") in NARRATION_MUST_NOT_SAY:
        options = item.get("options") or []
        try:
            answer = options[schemas.correct_index(options)].get("text", "")
        except (ValueError, IndexError, KeyError):
            answer = ""
        needle = _PUNCT.sub("", answer)
        if len(needle) >= 4 and needle in _PUNCT.sub("", item.get("stem", "")):
            found.append(
                f"the narration says the answer outright (「{answer}」); describe the "
                "moment so that the listener has to work it out")

    return found
