"""Author-composed illustrative items.

These are original compositions written for this tool, used by `selftest` (to
exercise validation + DB with no API) and by `practice --demo` (to show the study
UX without a key). They are NOT official BJT material and NOT few-shot seeds —
they are clearly-labelled samples. Real few-shot examples belong in seeds/.

There is one for every item type, and that is deliberate rather than tidy. A type
whose schema nothing ever constructs is a type whose schema is only asserted:
`selftest` runs validation over all nine, so a document field that cannot
actually be filled, or a role enum that cannot actually be satisfied, fails here
with no API key rather than in the middle of a paid batch run.

Every name, company, date and amount below is invented.
"""
from __future__ import annotations

FIXTURES: dict[str, dict] = {
    "goi_bunpou": {
        "item_type": "goi_bunpou",
        "level": "J2",
        "topic": "プロジェクト成功のお礼",
        "stem": "このたびのプロジェクト成功は、皆様のご協力の＿＿＿です。",
        "options": [
            {"text": "おかげ", "role": "correct",
             "why": "感謝の文脈で良い結果の原因を示す語で、「ご協力の—です」の名詞スロットに収まる。"},
            {"text": "せい", "role": "opposite_valence",
             "why": "原因を示す点は同じだが悪い結果に使う語なので、お礼の文が非難に変わる。"},
            {"text": "おかげさま", "role": "set_phrase_misfit",
             "why": "「おかげさまで」の形であいさつに使う定型で、「の—です」の名詞スロットには立てられない。"},
            {"text": "おかげがち", "role": "nonexistent_form",
             "why": "「〜がち」は動詞連用形や一部の名詞に付くが、「おかげがち」という語は存在しない。"},
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
            {"text": "資料を拝見してもよろしいでしょうか。", "role": "correct",
             "why": "見るのは自分なので謙譲語「拝見する」、さらに「〜てもよろしいでしょうか」で許可を求めている。"},
            {"text": "資料をご覧になってもよろしいでしょうか。", "role": "wrong_honorific_direction",
             "why": "「ご覧になる」は尊敬語。自分が見る行為に使うと、自分を高めることになる。"},
            {"text": "資料、見てもいい？", "role": "register_too_casual",
             "why": "内容は正しいが、取引先の担当者に対してタメ口で、丁寧さがまったく足りない。"},
            {"text": "資料を拝見いたしましょうか。", "role": "correct_keigo_wrong_speech_act",
             "why": "謙譲語は正しいが「〜ましょうか」は申し出で、許可を求める場面の発話行為とずれる。"},
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

# ---------------------------------------------------------------- 聴解

FIXTURES["hatsugen_choukai"] = {
    "item_type": "hatsugen_choukai",
    "level": "J2",
    "topic": "上司の不在を取引先に伝える",
    "scene_id": "scene_phone_desk",
    "speaker_role": "営業担当（若手）",
    "listener_role": "取引先の担当者",
    "channel": "phone",
    "stem": (
        "取引先の担当者から、課長あてに電話がかかってきました。課長は外出していて、"
        "戻るのは夕方です。こんなとき、何と言いますか。"
    ),
    "options": [
        {"text": "あいにく田中は外出しておりまして、夕方には戻る予定でございます。",
         "role": "correct",
         "why": "社外に自社の上司を伝えるので敬称を付けず、「おります」と謙譲語で述べていて、戻る時刻も添えている。"},
        {"text": "あいにく田中課長はお出かけになっていて、夕方お戻りになります。",
         "role": "wrong_uchi_soto",
         "why": "社外の相手に自社の上司を「課長」「お出かけになる」と高めており、ウチとソトが逆になっている。"},
        {"text": "田中は席を外しております。またおかけ直しください。",
         "role": "phone_protocol_violation",
         "why": "謙譲語は正しいが、戻る見込みも折り返しの申し出もなく、かけ直しを相手に一方的に求めている。"},
        {"text": "田中は外出しておりますので、私がご用件を承ってもよろしいでしょうか。",
         "role": "content_mismatch",
         "why": "表現としては自然だが、不在と戻り時刻を伝えるという、この場面で求められていることをしていない。"},
    ],
    "explanation_ja": (
        "社外の相手に自社の人間のことを話すときは、敬称を付けず謙譲語を使う。"
        "不在を伝える電話では、不在の事実に加えて戻る見込みを添えるのが基本の形。"
        "「田中課長はお出かけになって」は自社の上司を高めており、ウチ・ソトの扱いが逆。"
        "「おかけ直しください」は謙譲語としては正しいが、電話の型として折り返しの配慮を欠く。"
        "用件を承る申し出は自然だが、この場面で求められている不在の連絡になっていない。"
    ),
    "explanation_en": (
        "To an outsider, one's own manager takes no title and humble verbs; a business "
        "absence message states when they return."
    ),
    "vocab_notes": [
        {"term": "あいにく", "reading": "あいにく", "meaning": "unfortunately (set opener for bad news)"},
        {"term": "承る", "reading": "うけたまわる", "meaning": "to receive / hear (humble)"},
    ],
}

FIXTURES["bamen_haaku"] = {
    "item_type": "bamen_haaku",
    "level": "J2",
    "topic": "受付での来客対応",
    "scene_id": "scene_reception_counter",
    "channel": "in_person",
    "stem": (
        "女の人が男の人に話しています。"
        "「お約束の一時からでしたね。第二会議室にご案内いたしますので、こちらの札をお付けください。」"
        "この人はこのあと何をしますか。"
    ),
    "options": [
        {"text": "来客に入館の札を渡して、会議室まで案内する。", "role": "correct",
         "why": "札を付けるよう頼み、会議室に案内すると自分で述べているので、次の行動はその二つ。"},
        {"text": "来客の約束の時間を担当者に電話で確認する。", "role": "plausible_but_unmentioned",
         "why": "受付でよくある行動だが、時間はすでに「一時からでしたね」と確認済みで、電話の話は出ていない。"},
        {"text": "来客を第二会議室ではなく応接室に通す。", "role": "adjacent_setting",
         "why": "案内先として自然だが、発話では「第二会議室」と明示されている。"},
        {"text": "打ち合わせが終わった来客を出口まで見送る。", "role": "right_scene_wrong_moment",
         "why": "同じ受付での行動だが、これから案内する場面であり、見送りは打ち合わせの後のこと。"},
    ],
    "explanation_ja": (
        "「ご案内いたします」「札をお付けください」から、これから会議室へ案内する場面だと分かる。"
        "時間の確認はすでに終わっており、案内先も「第二会議室」と言われている。"
        "見送りは同じ受付でも、打ち合わせが終わったあとの場面である。"
    ),
    "explanation_en": "The speaker states both next actions: hand over the badge, then guide the visitor.",
    "vocab_notes": [
        {"term": "ご案内する", "reading": "ごあんないする", "meaning": "to show someone the way (humble)"},
        {"term": "札", "reading": "ふだ", "meaning": "badge / tag"},
    ],
}

FIXTURES["sougou_choukai"] = {
    "item_type": "sougou_choukai",
    "level": "J2",
    "topic": "提案書の提出遅れ",
    "scene_id": "scene_meeting_room_table",
    "channel": "in_person",
    "dialogue": [
        {"speaker_role": "課長", "text": "みどり物産さんへの提案書、今週の金曜でしたね。間に合いそうですか。"},
        {"speaker_role": "営業担当（若手）", "text": "申し訳ありません。価格の部分がまだ固まっていなくて、"
                                                  "月曜まで延ばしていただけないかと思っております。"},
        {"speaker_role": "課長", "text": "先方には私から伝えましょうか。"},
        {"speaker_role": "先輩社員", "text": "いえ、価格は今日中に出せます。金曜のままで大丈夫です。"},
        {"speaker_role": "課長", "text": "そうですか。では予定どおりで。連絡は要りませんね。"},
    ],
    "stem": "提案書はいつ提出することになりましたか。",
    "options": [
        {"text": "予定どおり、今週の金曜日に提出する。", "role": "correct",
         "why": "先輩が価格は今日中に出せると述べ、課長が「予定どおりで」とまとめているので、金曜のまま。"},
        {"text": "月曜日まで延ばしてもらう。", "role": "superseded_by_later_turn",
         "why": "若手がいったんそう希望したが、そのあと先輩の発言で撤回され、延期はしないことになった。"},
        {"text": "価格が固まってから、日を決めて提出する。", "role": "unsupported_but_plausible",
         "why": "進め方としてはありそうだが、会話の中で日を後から決めるとは誰も言っていない。"},
        {"text": "課長が先方に連絡してから提出する。", "role": "stated_by_wrong_speaker",
         "why": "課長は連絡を申し出たが、そのあと「連絡は要りませんね」と自分で取り下げている。"},
    ],
    "explanation_ja": (
        "いったん月曜への延期が希望として出るが、先輩社員が価格は今日中に出せると述べたことで撤回され、"
        "課長が「予定どおりで」と結論づける。会話の途中で出た案がそのまま結論になるとは限らない。"
    ),
    "explanation_en": "The postponement is proposed and then withdrawn; the deadline stays Friday.",
    "vocab_notes": [
        {"term": "固まる", "reading": "かたまる", "meaning": "to be settled / finalised"},
        {"term": "予定どおり", "reading": "よていどおり", "meaning": "as scheduled"},
    ],
}

# ------------------------------------------------------------- 聴読解・読解

FIXTURES["joukyou_haaku"] = {
    "item_type": "joukyou_haaku",
    "level": "J2",
    "topic": "入館手続きの変更",
    "scene_id": "scene_reception_counter",
    "channel": "in_person",
    "document": {
        "template": "office_sign",
        "title": "入館手続き変更のお知らせ",
        "meta": [{"label": "掲示者", "value": "総務部"}],
        "blocks": [
            {"type": "paragraph", "text": "四月一日より、来客の入館手続きが変わりました。"},
            {"type": "numbered", "items": [
                "受付で来訪先の部署名とお名前をお伝えください。",
                "入館証をお受け取りのうえ、見える位置にお付けください。",
                "お帰りの際は、受付の返却箱に入館証をお戻しください。",
            ]},
            {"type": "callout", "tone": "warning",
             "text": "社員の同行がない場合、三階より上へはお進みいただけません。"},
        ],
    },
    "stem": (
        "受付で、来客の男の人が女の人に話しています。"
        "「四階の営業部に伺うことになっているのですが、担当の方はあとから来られるそうで、"
        "先に上で待たせていただけますか。」"
        "女の人はこのあと、どうすればいいですか。"
    ),
    "options": [
        {"text": "入館証を渡したうえで、営業部の担当者が来るまで受付で待ってもらう。",
         "role": "correct",
         "why": "社員の同行がなければ三階より上へは進めないため、担当者が来るまで受付で待ってもらうほかない。"},
        {"text": "入館証を渡して、四階の営業部まで一人で上がってもらう。",
         "role": "ignores_the_document",
         "why": "来客の希望どおりだが、社員の同行がない場合は三階より上へ進めないという掲示に反する。"},
        {"text": "入館証は渡さず、担当者が受付に来てから手続きを始める。",
         "role": "ignores_the_request",
         "why": "掲示は守れるが、手続きは受付で名前を伝えた時点で進めるもので、来客を待たせる理由がない。"},
        {"text": "来客に代わって、営業部の担当者に入館証を取りに来るよう伝える。",
         "role": "wrong_action_owner",
         "why": "入館証を受け取るのは来客本人で、担当者が代わりに受け取る手続きにはなっていない。"},
    ],
    "explanation_ja": (
        "掲示には、社員の同行がない場合は三階より上へ進めないと書かれている。"
        "来客は先に四階で待ちたいと希望しているが、そのまま通すことはできない。"
        "入館証の手続き自体は受付で進めたうえで、担当者が来るまで受付で待ってもらうのが正しい対応。"
    ),
    "explanation_en": "The notice forbids unaccompanied visitors above the third floor, so the request cannot be granted as asked.",
    "vocab_notes": [
        {"term": "入館証", "reading": "にゅうかんしょう", "meaning": "visitor badge"},
        {"term": "同行", "reading": "どうこう", "meaning": "accompaniment"},
    ],
}

FIXTURES["shiryou_choudokkai"] = {
    "item_type": "shiryou_choudokkai",
    "level": "J2",
    "topic": "打ち合わせの日程変更",
    "scene_id": "scene_phone_desk",
    "channel": "phone",
    "document": {
        "template": "schedule",
        "title": "第二会議室 予約状況（四月第二週）",
        "meta": [
            {"label": "期間", "value": "四月八日（月）〜四月十二日（金）"},
            {"label": "作成者", "value": "総務部 川口"},
        ],
        "blocks": [
            {"type": "table",
             "columns": ["日付", "十時〜十二時", "十三時〜十五時", "十五時〜十七時"],
             "rows": [
                 ["四月九日（火）", "経理部 月次", "空き", "空き"],
                 ["四月十日（水）", "空き", "営業部 定例", "空き"],
                 ["四月十一日（木）", "採用面接", "採用面接", "空き"],
             ]},
            {"type": "callout", "tone": "info",
             "text": "十一日（木）の十五時以降は、内装工事のため使用できません。"},
        ],
    },
    "stem": (
        "取引先から電話がありました。"
        "「水曜日は終日出られなくなってしまいまして。木曜の午後、遅い時間でしたら伺えます。」"
        "打ち合わせはいつになりますか。"
    ),
    "options": [
        {"text": "四月九日（火）の十五時から", "role": "correct",
         "why": "木曜の十五時以降は工事で使えないため、先方の条件に合う空きは残らず、空いている火曜の午後に回すことになる。"},
        {"text": "四月十一日（木）の十五時から", "role": "ignores_the_spoken_change",
         "why": "予約表の上では空きだが、工事のため使用できないと注記されており、この枠は取れない。"},
        {"text": "四月十日（水）の十五時から", "role": "reads_wrong_row",
         "why": "表では空いている枠だが、先方が終日出られないと言っているのは、まさにこの水曜日。"},
        {"text": "四月十一日（木）の十時から", "role": "wrong_timeframe",
         "why": "木曜ではあるが午前で、「午後の遅い時間」という先方の条件から外れ、採用面接も入っている。"},
    ],
    "explanation_ja": (
        "先方の条件は「水曜は不可」「木曜の午後の遅い時間なら可」の二つ。"
        "木曜十五時以降は工事で使用できないため、条件を満たす枠は木曜には残らない。"
        "空いていて条件に反しないのは火曜の午後で、これが答えになる。"
        "予約表の「空き」だけを見ると、注記の工事を見落とす。"
    ),
    "explanation_en": "Thursday's late slot is blocked by the building work note, so the only workable free slot is Tuesday afternoon.",
    "vocab_notes": [
        {"term": "終日", "reading": "しゅうじつ", "meaning": "all day"},
        {"term": "内装工事", "reading": "ないそうこうじ", "meaning": "interior building work"},
    ],
}

FIXTURES["sougou_choudokkai"] = {
    "item_type": "sougou_choudokkai",
    "level": "J1",
    "topic": "見積書の数量修正と担当",
    "scene_id": "scene_meeting_room_table",
    "channel": "in_person",
    "dialogue": [
        {"speaker_role": "課長", "text": "先方から、椅子の数を二十脚に増やしたいと連絡がありました。"},
        {"speaker_role": "営業担当（若手）", "text": "では見積書を作り直します。机のほうは十台のままでよろしいですか。"},
        {"speaker_role": "課長", "text": "机は変更なしです。それと、納期は先方の都合で一週間後ろ倒しになります。"},
        {"speaker_role": "先輩社員", "text": "見積書は私が直しますので、山川さんは先方への連絡をお願いします。"},
        {"speaker_role": "課長", "text": "そうしてください。金額の確認は私がします。"},
    ],
    "documents": [
        {
            "template": "quote_order",
            "title": "お見積書（オフィス家具一式）",
            "meta": [
                {"label": "宛先", "value": "みどり物産株式会社 御中"},
                {"label": "発行者", "value": "山川商事株式会社 営業部"},
                {"label": "発行日", "value": "四月五日"},
            ],
            "blocks": [
                {"type": "table",
                 "columns": ["品名", "数量", "単価", "金額"],
                 "rows": [
                     ["事務机", "10台", "32,000円", "320,000円"],
                     ["事務椅子", "12脚", "18,000円", "216,000円"],
                     ["書棚", "4本", "24,000円", "96,000円"],
                 ]},
                {"type": "key_values", "pairs": [
                    {"label": "納入希望日", "value": "四月二十六日"},
                    {"label": "有効期限", "value": "発行日より三十日"},
                ]},
            ],
        }
    ],
    "stem": "見積書を作り直すのは誰で、椅子の数量はいくつになりますか。",
    "options": [
        {"text": "先輩社員が作り直し、椅子は二十脚にする。", "role": "correct",
         "why": "先輩が「見積書は私が直します」と申し出て課長が認めており、椅子は二十脚への変更が冒頭で伝えられている。"},
        {"text": "若手の営業担当が作り直し、椅子は二十脚にする。", "role": "wrong_action_owner",
         "why": "若手はいったん作り直すと言ったが、そのあと先輩が引き取り、若手は先方への連絡担当になった。"},
        {"text": "先輩社員が作り直し、椅子は十二脚のままにする。", "role": "combines_wrong_pair",
         "why": "担当は正しいが、十二脚は見積書の現在の数量で、会話で伝えられた変更を反映していない。"},
        {"text": "課長が作り直し、椅子は二十脚にする。", "role": "stated_by_wrong_speaker",
         "why": "課長が引き受けたのは金額の確認で、見積書を直すとは言っていない。"},
    ],
    "explanation_ja": (
        "会話の中で担当が一度入れ替わっている。若手がいったん作り直すと言うが、"
        "先輩が「私が直します」と引き取り、若手は先方への連絡に回る。課長が引き受けたのは金額の確認。"
        "椅子の数量は見積書では十二脚だが、冒頭で二十脚への変更が伝えられている。"
        "資料の数字と会話の変更を、どちらか一方だけで答えると誤る。"
    ),
    "explanation_en": "Ownership changes hands mid-conversation, and the quantity on the quotation has been superseded by the spoken change.",
    "vocab_notes": [
        {"term": "後ろ倒し", "reading": "うしろだおし", "meaning": "pushed back (of a schedule)"},
        {"term": "脚", "reading": "きゃく", "meaning": "counter for chairs"},
    ],
}

FIXTURES["sougou_dokkai"] = {
    "item_type": "sougou_dokkai",
    "level": "J1",
    "topic": "取引先からの問い合わせへの対応",
    "document": {
        "template": "email_thread",
        "title": "Re: 保守契約の更新について",
        "meta": [
            {"label": "差出人", "value": "みどり物産 購買部 田中"},
            {"label": "宛先", "value": "山川商事 営業部 佐藤様"},
            {"label": "件名", "value": "Re: 保守契約の更新について"},
            {"label": "日時", "value": "四月十二日 十七時四十分"},
        ],
        "blocks": [
            {"type": "paragraph", "text": "佐藤様　お世話になっております。みどり物産の田中でございます。"},
            {"type": "paragraph",
             "text": "先日いただいた更新のご案内につきまして、社内で検討いたしました。"
                     "条件そのものに異存はございませんが、稟議の関係で、月末までに"
                     "正式なご回答を差し上げることが難しくなりました。"},
            {"type": "paragraph",
             "text": "つきましては、現行の契約を一か月だけ延長していただくことは可能でしょうか。"
                     "難しいようでしたら、こちらの進め方を改めて検討いたします。"},
            {"type": "quoted_message", "sender": "山川商事 佐藤", "sent_at": "四月八日 十時十五分", "depth": 1,
             "text": "保守契約の更新期限は四月末でございます。更新条件は昨年度と同一です。"
                     "期限を過ぎますと、いったん契約が切れる形になりますのでご注意ください。"},
        ],
    },
    "stem": "このメールを受けて、佐藤さんがまずすべきことは何ですか。",
    "options": [
        {"text": "現行契約を一か月延長できるかを社内で確認し、その可否を回答する。",
         "role": "correct",
         "why": "先方は延長の可否を尋ねており、その答えによって先方の進め方が変わるため、まず確認して返すべきこと。"},
        {"text": "更新条件を見直し、値引きを含む新しい案を提示する。",
         "role": "unsupported_but_plausible",
         "why": "商談としてはありうるが、先方は「条件そのものに異存はない」と書いており、条件は論点になっていない。"},
        {"text": "四月末で契約がいったん切れることを、改めて知らせる。",
         "role": "stated_but_answers_different_question",
         "why": "引用部分にある事実だが、先方はそれを踏まえたうえで延長を尋ねており、繰り返しても質問に答えていない。"},
        {"text": "稟議が通るまで待ってから、正式な回答を受け取る。",
         "role": "wrong_timeframe",
         "why": "先方が待てるかどうかを聞いているのは今であり、稟議の結果を待つ判断そのものが、まだ返せていない。"},
    ],
    "explanation_ja": (
        "先方のメールの中心は「現行契約を一か月延長できるか」という問いで、"
        "条件への異存はないと明記されている。"
        "契約が切れることは引用部分ですでに伝えた内容であり、繰り返しても問いの答えにはならない。"
        "延長の可否によって先方の進め方が変わると書かれている以上、まず社内で確認して回答するのが先。"
    ),
    "explanation_en": "The email's actual question is whether a one-month extension is possible; everything else is already settled or already said.",
    "vocab_notes": [
        {"term": "稟議", "reading": "りんぎ", "meaning": "internal circulated approval"},
        {"term": "異存", "reading": "いぞん", "meaning": "objection"},
    ],
}
