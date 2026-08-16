"""Author-composed illustrative items.

These are original compositions written for this tool, used by `selftest` (to
exercise validation + DB with no API) and by `practice --demo` (to show the study
UX without a key). They are NOT official BJT material and NOT few-shot seeds —
they are clearly-labelled samples. Real few-shot examples belong in seeds/.
"""
from __future__ import annotations

FIXTURES: dict[str, dict] = {
    "goi_bunpou": {
        "item_type": "goi_bunpou",
        "level": "J2",
        "topic": "プロジェクト成功のお礼",
        "stem": "このたびのプロジェクト成功は、皆様のご協力の＿＿＿です。",
        "options": [
            {"text": "おかげ", "role": "correct"},
            {"text": "せい", "role": "opposite_valence"},
            {"text": "おかげさま", "role": "set_phrase_misfit"},
            {"text": "おかげがち", "role": "nonexistent_form"},
        ],
        "explanation_ja": (
            "「おかげ」はよい結果の原因を感謝の気持ちを込めて示す表現で、正解。"
            "「せい」は悪い結果の原因を示すため、感謝の文脈では意味が逆になる。"
            "「おかげさま」は挨拶に使う定型表現で、この名詞スロットには入らない。"
            "「おかげがち」という語は存在しない。"
        ),
        "explanation_en": (
            "おかげ credits a good outcome; せい blames a bad one; おかげさま is a fixed "
            "greeting; おかげがち is not a real word."
        ),
        "vocab_notes": [
            {"term": "おかげ", "reading": "おかげ", "meaning": "thanks to (positive attribution)"},
            {"term": "ご協力", "reading": "ごきょうりょく", "meaning": "cooperation (polite)"},
        ],
    },
    "hyougen": {
        "item_type": "hyougen",
        "level": "J2",
        "topic": "取引先資料の確認許可",
        "stem": (
            "取引先の担当者に、先方から渡された資料をこちらで確認したいと伝える場面。"
            "最も適切な表現はどれか。"
        ),
        "options": [
            {"text": "資料を拝見してもよろしいでしょうか。", "role": "correct"},
            {"text": "資料をご覧になってもよろしいでしょうか。", "role": "wrong_honorific_direction"},
            {"text": "資料、見てもいい？", "role": "register_too_casual"},
            {"text": "資料を拝見いたしましょうか。", "role": "correct_keigo_wrong_speech_act"},
        ],
        "explanation_ja": (
            "自分が見る行為には謙譲語「拝見する」を使う。「拝見してもよろしいでしょうか」は"
            "許可を求める適切な表現で正解。「ご覧になる」は尊敬語で、自分の行為に使うと敬意の"
            "方向が逆。「見てもいい？」は取引先には砕けすぎ。「拝見いたしましょうか」は謙譲語"
            "だが「〜ましょうか」は申し出であり、許可を求める場面には合わない。"
        ),
        "explanation_en": (
            "拝見する is the humble verb for one's own looking; ご覧になる (honorific) points "
            "the respect the wrong way; the casual form is too informal for a client; and "
            "〜ましょうか is an offer, not a request for permission."
        ),
        "vocab_notes": [
            {"term": "拝見する", "reading": "はいけんする", "meaning": "to look (humble)"},
            {"term": "取引先", "reading": "とりひきさき", "meaning": "business client / counterpart"},
        ],
    },
}
