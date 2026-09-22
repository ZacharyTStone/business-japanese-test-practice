"""Numbers in a printed document are written with Arabic digits.

A booking grid headed 「十時〜十二時」, a quotation for 「数量二百個」, a schedule
titled 「十月 新人研修 予定表」 — each is grammatical Japanese, and none of them is
what comes off an office printer. Japanese business documents set their dates,
times, quantities and money in Arabic digits; kanji numerals belong to vertical
prose and to the *names* of things (第一会議室, 第三回, 一覧). A 資料 that spells
its numbers out reads as a textbook exercise rather than as paper somebody was
handed, which is the one thing this library is trying not to be. Every document
in the bank was written that way until 2026-09-22 — 41 of them, not one Arabic
digit between them — because nothing said otherwise and nothing checked.

So the rule lives here once and is used three times: `document_schema()` quotes
it to the generator, `to_arabic` applies it to a document on its way into a
bundle, and the offline batch check refuses a bundle whose 資料 still spells a
number out. A rule that is stated in a prompt and nowhere else is a suggestion.

**What counts as a number:** a run of numeral kanji immediately followed by a
counter — 九月九日, 十時三十分, 二百個, 八百万円, 二日間, 八割. Requiring the
counter is what keeps the rule off words that merely contain a numeral
character, and the exclusions are load-bearing rather than tidy:

- 一覧, 一般, 一因 — 覧, 般 and 因 are not counters, so nothing matches.
- 第一会議室, 第三回 設備改修 — a run preceded by 第 is an ordinal in a name, and
  names keep their kanji. Without that guard 回 and 部 would renumber every
  meeting room and every section heading in the library, and the options that
  name them (「第一会議室の十三時からを取る。」) would stop matching the table.
- 案一, 案二 — nothing follows them, so nothing matches.
- `_NOT_NUMBERS` — the handful where a numeral kanji and a counter really do
  collide inside a word: 一部 is a copy or a portion, 一時的 is not one o'clock,
  十分な is not ten minutes. A bare 「十分」 is genuinely ambiguous to a human
  reader too, and is the known hole in this: written as "sufficient" with
  nothing after it, it would be rewritten to 「10分」. No document in the bank
  does that, and a proofreader would catch it if one did.

Only the digits move. 「十時〜十二時」 becomes 「10時〜12時」, not 「10:00〜12:00」:
substituting a numeral cannot change what a document says, and rewriting its
punctuation can. 万 and 億 stay words, because a Japanese accountant writes
800万円 and not 8,000,000円.

**Spoken text is deliberately out of scope.** `bjt.tts.plan` synthesises the
stem, the options and the dialogue; nothing synthesises a document (`TYPE_AUDIO`
has no entry that could). Rewriting a number the narrator reads would change
that clip's text, and a live clip is never re-made. A document is also the only
part of an item that is printed *to look like something*, so it is the only
place the problem was.
"""
from __future__ import annotations

import re
from typing import Any

_DIGITS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4,
           "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_SCALES = {"十": 10, "百": 100, "千": 1000}

#: Myriad groupings keep their kanji — 800万円, never 8000000円 — so they split
#: the run rather than multiplying it out. 億 before 万: the bigger one first.
_MYRIADS = ("億", "万")

_NUMERAL_CHARS = "".join(_DIGITS) + "".join(_SCALES) + "".join(_MYRIADS)

#: What a number may be followed by for this to be a number at all. Every entry
#: is a counter or a unit, never a word-forming character: adding 度 here would
#: rewrite 「一度」, and adding つ would rewrite 「二つ」, which are prose rather
#: than data. Multi-character entries come first so the longer one is tried
#: first; the match is only ever a lookahead, so nothing is consumed.
COUNTERS = (
    "か月", "ヶ月", "カ月", "箇月", "週間", "日間", "時間", "分間", "年間",
    "日目", "年度", "名様", "パーセント", "％",
    "月", "日", "年", "時", "分", "秒", "週",
    "個", "台", "脚", "部", "名", "人", "回", "点", "階", "枚", "件", "本",
    "通", "割", "円", "冊", "箱", "袋", "室", "社", "号", "版", "倍", "歳",
    "枠", "席", "%",
)

#: Words in which a numeral kanji is followed by something in COUNTERS without
#: being a number. Any one of them matching at the start of a candidate blocks
#: it, so the order here does not matter.
_NOT_NUMBERS = (
    "一時的", "一時停止", "一時金", "一時払い", "一部分", "十分な", "十分に",
    "一部", "一般", "一方", "一面", "一度", "一連", "一律", "一環", "一体",
)

#: A run of numeral kanji that a counter follows. Three lookbehinds guard it:
#:
#: - 第 keeps the rule off ordinals in names (第一会議室, 第三回).
#: - A digit keeps it off text that has already been through here. Without it
#:   the 万 in a converted 「20万円」 is itself a candidate and a second pass
#:   gives 「201万円」. Running this over its own output is not a nicety: the
#:   offline check works by re-running it, and `importbatch` re-runs it over a
#:   source file that is already clean.
#: - A numeral and a comma keep it off 「二、三日」 — "two or three days", where
#:   only the 三 is followed by a counter. Converting half of an idiom to give
#:   「二、3日」 is worse than leaving it, which is what happens instead. The
#:   cost is that a numbered clause written 「一、三名以上は…」 keeps its 三名 as
#:   well; our documents number their own lists (the `numbered` block), so that
#:   form should not arise, and a whole idiom beats half a clause either way.
_CANDIDATE = re.compile(
    rf"(?<!第)(?<![0-9０-９])(?<![{_NUMERAL_CHARS}][、，])"
    rf"[{_NUMERAL_CHARS}]+(?={'|'.join(COUNTERS)})"
)


def _value(run: str) -> str | None:
    """A run of numeral kanji as Arabic digits, or None if it will not read.

    Positional runs (二〇二六) concatenate; runs with a scale character (二十二)
    are summed; a myriad splits the run and keeps its own kanji (八百万 → 800万).
    """
    for myriad in _MYRIADS:
        if myriad in run:
            head, _, tail = run.partition(myriad)
            if not head:
                # 「万円」 with nothing in front of it is not a quantity. It is
                # also what an already-converted 「20万円」 looks like to the
                # scanner if the digit lookbehind ever stops holding, and
                # reading it as 1万 there would multiply the number on every
                # pass — see the idempotence test.
                return None
            above, below = _value(head), (_value(tail) if tail else "")
            if above is None or below is None:
                return None
            return f"{above}{myriad}{below}"
    if any(c in _SCALES for c in run):
        total = digit = 0
        for ch in run:
            if ch in _DIGITS:
                digit = _DIGITS[ch]
            elif ch in _SCALES:
                total += (digit or 1) * _SCALES[ch]
                digit = 0
            else:
                return None
        return str(total + digit)
    if all(c in _DIGITS for c in run):
        # One digit, or a positional run like 二〇二六. A bare 「二三日」 is
        # "two or three days" and not the 23rd, so a multi-digit run with no
        # 〇 in it is not a number this will guess at — it is left alone, and
        # the check leaves it alone for the same reason.
        if len(run) == 1 or any(c in "〇零" for c in run):
            return "".join(str(_DIGITS[c]) for c in run)
    return None


def _numbers(text: str) -> list[re.Match[str]]:
    """Every match in the string that really is a spelled-out number.

    The single scanner behind both the rewrite and the check, so the two can
    never disagree about what counts — a check that flagged what the converter
    would not fix would fail a bundle nothing could clean.
    """
    out = []
    for m in _CANDIDATE.finditer(text):
        if any(text[m.start():].startswith(word) for word in _NOT_NUMBERS):
            continue
        if _value(m.group(0)) is None:
            continue
        out.append(m)
    return out


def to_arabic_text(text: str) -> str:
    """One string with its spelled-out numbers rewritten as digits."""
    out = text
    for m in reversed(_numbers(text)):
        out = out[:m.start()] + str(_value(m.group(0))) + out[m.end():]
    return out


def kanji_numbers_in(text: str) -> list[str]:
    """The spelled-out numbers in the string — empty when it reads like print."""
    return [m.group(0) for m in _numbers(text)]


def to_arabic(doc: Any) -> int:
    """Rewrite every number in a document as digits. Returns how many strings moved.

    Walks the same fields `document.text_of` flattens, because a number the
    learner can read is a number this has to reach: a table's header cell and a
    key/value block's value are as printed as a paragraph is.
    """
    if not isinstance(doc, dict):
        return 0
    moved = 0

    def fix(value: Any) -> Any:
        nonlocal moved
        if not isinstance(value, str):
            return value
        out = to_arabic_text(value)
        if out != value:
            moved += 1
        return out

    doc["title"] = fix(doc.get("title", ""))
    for meta in doc.get("meta") or []:
        if isinstance(meta, dict):
            for key in ("label", "value"):
                if key in meta:
                    meta[key] = fix(meta[key])
    for block in doc.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        for key in ("text", "sender", "sent_at"):
            if key in block:
                block[key] = fix(block[key])
        for key in ("items", "columns"):
            if isinstance(block.get(key), list):
                block[key] = [fix(x) for x in block[key]]
        if isinstance(block.get("rows"), list):
            block["rows"] = [
                [fix(c) for c in row] if isinstance(row, list) else row
                for row in block["rows"]
            ]
        for pair in block.get("pairs") or []:
            if isinstance(pair, dict):
                for key in ("label", "value"):
                    if key in pair:
                        pair[key] = fix(pair[key])
    return moved


def printed_strings(doc: Any) -> list[str]:
    """Every string a reader sees in a document, for checking rather than rendering."""
    if not isinstance(doc, dict):
        return []
    out: list[str] = [str(doc.get("title", ""))]
    for meta in doc.get("meta") or []:
        if isinstance(meta, dict):
            out += [str(meta.get("label", "")), str(meta.get("value", ""))]
    for block in doc.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        out += [str(block.get(k, "")) for k in ("text", "sender", "sent_at")]
        out += [str(x) for x in block.get("items") or []]
        out += [str(c) for c in block.get("columns") or []]
        for row in block.get("rows") or []:
            if isinstance(row, list):
                out += [str(c) for c in row]
        for pair in block.get("pairs") or []:
            if isinstance(pair, dict):
                out += [str(pair.get("label", "")), str(pair.get("value", ""))]
    return [s for s in out if s]


def document_faults(doc: Any) -> list[str]:
    """The spelled-out numbers left in a document — empty when it is clean."""
    return sorted({run for text in printed_strings(doc)
                   for run in kanji_numbers_in(text)})


#: Words in which a numeral kanji is a letter rather than a number. Wider than
#: `_NOT_NUMBERS`, because `mixed_notation` asks a looser question than the
#: converter does — it flags a kanji numeral with no counter after it, which is
#: the shape the converter is blind to by construction.
#: `一覧` is the one that shows why this list is wider: the converter never
#: needed it, because 覧 is not a counter and so nothing ever matched. This
#: asks the looser question, so it does.
_KANJI_AS_A_LETTER = _NOT_NUMBERS + (
    "一覧表", "一覧", "一括", "一項", "一緒", "唯一", "一人", "二人", "三人",
    "四人", "一本化",
    "三人称", "二人称", "一つ", "二つ", "三つ", "四つ", "五つ", "六つ", "七つ",
    "八つ", "九つ", "一日", "二日", "三日", "案一", "案二", "案三",
    "第一", "第二", "第三", "第四", "第五",
)

_ANY_RUN = re.compile(rf"[{_NUMERAL_CHARS}]{{1,6}}")


def mixed_notation(text: str) -> list[str]:
    """Spelled-out numbers in a string that also uses digits — empty if none.

    `to_arabic_text` only moves a number a counter follows, which is what keeps
    it off 一覧 and 第一会議室. The price is that it cannot see a number nothing
    follows: 「1万8000円×十二の21万6000円」 and 「三百から二百を引いて100部」 both
    survived it, and both are worse than either notation alone — the learner is
    converting between two systems inside one sentence, beside a table that
    uses only one of them.

    Catching those by widening the converter would mean rewriting every numeral
    kanji whatever follows it, and 「二、三日」 and 「一覧」 are why that is not
    done. So the converter stays narrow and this reports what it leaves, for a
    person to read. A count, not a rewrite: only a reader can tell 「二案」 (a
    count, digits) from 「案二」 (a label, kanji).
    """
    if not re.search(r"[0-9]", text):
        return []
    spans = [(m.start(), m.end())
             for word in _KANJI_AS_A_LETTER
             for m in re.finditer(re.escape(word), text)]
    out = []
    for m in _ANY_RUN.finditer(text):
        a, b = m.span()
        if any(a < e and s < b for s, e in spans):
            continue
        if text[:a].endswith("第"):
            continue
        if m.group(0) in ("万", "千", "億") and a and text[a - 1].isdigit():
            continue
        out.append(m.group(0))
    return out
