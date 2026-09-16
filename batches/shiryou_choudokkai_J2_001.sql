-- shiryou_choudokkai_J2_001: 6 × shiryou_choudokkai (J2)
-- generated 2026-09-15T17:56:20+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人'),
       ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('097a5d3677f03767', '来客がこう言いました。「用紙は四十箱で結構です。ただ、インクのほうを倍にしていただけますか。ファイルはそのままで。」インクは何本になりますか。', 'narrator_f', 'in_person'),
       ('4a2810d17831a2e5', '上司からこう聞かれました。「あの品物、結局いつ着くことになっているんですか。十八日が土曜だとかで、そのあと二十日の日曜も挟みますよね。」品物はいつ届きますか。', 'narrator_f', 'in_person'),
       ('b7dc5745a7eb9f0c', '同僚から電話がありました。「佐藤さんとの打ち合わせ、一時間でいいので来週入れたいんです。私は午前中がずっと埋まっていて、あと木曜は一日休みを取ります。」いつにすればいいですか。', 'narrator_f', 'in_person'),
       ('ea14344732d61d04', '上司が資料を見ながらこう言いました。「先方の話では、A-205は二百個に増えて、納期も一週間前倒しになったはずなんですがね。B-012は変更なしだそうです。」資料と食い違っているのはどこですか。', 'narrator_f', 'in_person'),
       ('c53b6bf06b1657c4', '先輩が画面を見ながらこう言いました。「二名追加でお願いすることになりました。教材もその分お願いします。」全部でいくらになりますか。', 'narrator_f', 'in_person'),
       ('e32b473e7174bd9f', '上司が画面を見ながらこう言いました。「あさひ工業から急ぎの連絡が来ているんですが、誰に回せばいいですか。」', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J2_001', 'shiryou_choudokkai', 'J2', 'author-composed', '2026-09-15T17:56:20+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('013fa68b2a', 'shiryou_choudokkai_J2_001', 'shiryou_choudokkai', 'J2', 'quotation+staff_to_visitor+apply_spoken_change@J2', 'quotation', 'staff_to_visitor', 'apply_spoken_change', 'in_person', 'scene_office_desk_pair', null, null, '見積書の数量を口頭で直す', '来客がこう言いました。「用紙は四十箱で結構です。ただ、インクのほうを倍にしていただけますか。ファイルはそのままで。」インクは何本になりますか。', 2, '口頭の変更はインクだけで、用紙とファイルは据え置き。資料の二十四本を倍にして四十八本になる。資料だけを読むと二十四本、変更だけを聞くと別の行を倍にしてしまう。どちらか一方では答えが決まらない。', 'Only one row changes; the document supplies the base number and the audio the operation.', '[{"term": "据え置き", "reading": "すえおき", "meaning": "leaving unchanged"}, {"term": "倍", "reading": "ばい", "meaning": "double"}]'::jsonb, '[{"template": "quote_order", "title": "お見積書（事務用品）", "meta": [{"label": "宛先", "value": "あさひ工業株式会社 御中"}, {"label": "発行者", "value": "山川商事株式会社 営業部"}, {"label": "発行日", "value": "九月二日"}], "blocks": [{"type": "table", "columns": ["品名", "数量", "単価", "金額"], "rows": [["コピー用紙（A4）", "40箱", "2,500円", "100,000円"], ["ファイル", "120冊", "180円", "21,600円"], ["インク", "24本", "3,200円", "76,800円"]]}, {"type": "key_values", "pairs": [{"label": "納入希望日", "value": "九月二十日"}]}]}]'::jsonb, '[]'::jsonb, '097a5d3677f03767', null),
       ('f760e4e239', 'shiryou_choudokkai_J2_001', 'shiryou_choudokkai', 'J2', 'delivery_email+subordinate_to_superior+find_the_date@J2', 'delivery_email', 'subordinate_to_superior', 'find_the_date', 'phone', 'scene_phone_desk', null, null, '納期がいつになるか', '上司からこう聞かれました。「あの品物、結局いつ着くことになっているんですか。十八日が土曜だとかで、そのあと二十日の日曜も挟みますよね。」品物はいつ届きますか。', 0, '「翌々営業日」は営業日で二日後という意味で、休日と休業日は数えない。上司の発言で十八日が土曜、二十日が日曜と分かり、メールで二十一日と二十二日が休業日と分かる。両方を合わせて初めて二十四日が出る。', 'The email gives the closures, the caller gives the weekend; neither alone fixes the date.', '[{"term": "出荷", "reading": "しゅっか", "meaning": "shipment"}, {"term": "休業日", "reading": "きゅうぎょうび", "meaning": "non-working day"}]'::jsonb, '[{"template": "email_external", "title": "納品日のご連絡", "meta": [{"label": "差出人", "value": "みどり物産 出荷課 田中"}, {"label": "宛先", "value": "山川商事 営業部 佐藤様"}, {"label": "件名", "value": "納品日のご連絡"}, {"label": "日時", "value": "九月八日 十六時"}], "blocks": [{"type": "paragraph", "text": "ご注文の品は、九月十八日に出荷いたします。"}, {"type": "bullets", "items": ["出荷の翌々営業日にお届けの予定です。", "九月二十一日と二十二日は、当社の休業日にあたります。"]}]}]'::jsonb, '[]'::jsonb, '4a2810d17831a2e5', null),
       ('353e5d008b', 'shiryou_choudokkai_J2_001', 'shiryou_choudokkai', 'J2', 'schedule_sheet+peer_to_peer+choose_the_option@J2', 'schedule_sheet', 'peer_to_peer', 'choose_the_option', 'phone', 'scene_phone_desk', null, null, '条件に合う時間を選ぶ', '同僚から電話がありました。「佐藤さんとの打ち合わせ、一時間でいいので来週入れたいんです。私は午前中がずっと埋まっていて、あと木曜は一日休みを取ります。」いつにすればいいですか。', 3, '予定表は佐藤の都合しか示しておらず、同僚の条件（午前は不可、木曜は不可）は電話でしか分からない。両方を重ねると、残るのは火曜の午後だけ。片方だけでは二つ以上の候補が残る。', 'The sheet shows one person''s availability; the call supplies the other''s.', '[{"term": "終日", "reading": "しゅうじつ", "meaning": "all day"}, {"term": "埋まる", "reading": "うまる", "meaning": "to be booked up"}]'::jsonb, '[{"template": "schedule", "title": "佐藤の来週の予定", "meta": [{"label": "期間", "value": "九月十五日（月）〜十九日（金）"}, {"label": "作成者", "value": "営業部 佐藤"}], "blocks": [{"type": "table", "columns": ["日付", "午前", "午後"], "rows": [["十六日（火）", "社内会議", "空き"], ["十七日（水）", "空き", "外出（終日）"], ["十八日（木）", "空き", "空き"]]}]}]'::jsonb, '[]'::jsonb, 'b7dc5745a7eb9f0c', null),
       ('a58a148f1d', 'shiryou_choudokkai_J2_001', 'shiryou_choudokkai', 'J2', 'meeting_handout+subordinate_to_superior+find_the_conflict@J2', 'meeting_handout', 'subordinate_to_superior', 'find_the_conflict', 'in_person', 'scene_meeting_room_table', null, null, '資料と発言の食い違い', '上司が資料を見ながらこう言いました。「先方の話では、A-205は二百個に増えて、納期も一週間前倒しになったはずなんですがね。B-012は変更なしだそうです。」資料と食い違っているのはどこですか。', 1, '食い違いを問う問題では、変更が何項目あるかまで数える必要がある。A-205は数量と納期の二つが動き、B-012は変更なしと明言されている。数量だけを見つけて満足すると、納期の食い違いを落とす。', 'Two fields moved on one row; finding one of them is not finding the conflict.', '[{"term": "前倒し", "reading": "まえだおし", "meaning": "bringing forward"}, {"term": "品番", "reading": "ひんばん", "meaning": "product number"}]'::jsonb, '[{"template": "quote_order", "title": "九月分 発注一覧", "meta": [{"label": "宛先", "value": "山川商事株式会社 御中"}, {"label": "発行者", "value": "みどり物産 購買部"}, {"label": "発行日", "value": "九月一日"}], "blocks": [{"type": "table", "columns": ["品番", "数量", "納期"], "rows": [["A-101", "300個", "九月十日"], ["A-205", "150個", "九月十七日"], ["B-012", "80個", "九月二十四日"]]}]}]'::jsonb, '[]'::jsonb, 'ea14344732d61d04', null),
       ('0c022ece93', 'shiryou_choudokkai_J2_001', 'shiryou_choudokkai', 'J2', 'video_shared_doc+junior_to_senior+find_the_quantity@J2', 'video_shared_doc', 'junior_to_senior', 'find_the_quantity', 'video', 'scene_video_call_laptop', null, null, '追加分を足した金額', '先輩が画面を見ながらこう言いました。「二名追加でお願いすることになりました。教材もその分お願いします。」全部でいくらになりますか。', 3, '追加は二名で、注記により単価は据え置き。研修と教材の両方が人数に連動するので、どちらも十二名分にする。片方だけを直すと二十一万六千円、何も直さないと二十万円になる。', 'Both rows scale with headcount; the note fixes the unit price.', '[{"term": "単価", "reading": "たんか", "meaning": "unit price"}, {"term": "承る", "reading": "うけたまわる", "meaning": "to accept (humble)"}]'::jsonb, '[{"template": "quote_order", "title": "研修費用のお見積り", "meta": [{"label": "宛先", "value": "山川商事株式会社 御中"}, {"label": "発行者", "value": "みらい研修センター"}, {"label": "発行日", "value": "九月三日"}], "blocks": [{"type": "table", "columns": ["内容", "人数", "単価", "金額"], "rows": [["基礎研修（二日間）", "10名", "18,000円", "180,000円"], ["教材費", "10名", "2,000円", "20,000円"]]}, {"type": "callout", "tone": "info", "text": "追加のお申し込みは、一名につき同じ単価で承ります。"}]}]'::jsonb, '[]'::jsonb, 'c53b6bf06b1657c4', null),
       ('d0694b8a01', 'shiryou_choudokkai_J2_001', 'shiryou_choudokkai', 'J2', 'video_shared_doc+subordinate_to_superior+find_the_owner@J2', 'video_shared_doc', 'subordinate_to_superior', 'find_the_owner', 'video', 'scene_video_call_laptop', null, null, '誰が担当しているか', '上司が画面を見ながらこう言いました。「あさひ工業から急ぎの連絡が来ているんですが、誰に回せばいいですか。」', 0, '一覧のとおり、あさひ工業の担当は川口。引用されている佐藤のメールは、自分が持つみどり物産について急ぎなら川口に頼むことがあると述べたもので、あさひ工業の担当を動かす話ではない。引用部分の向きを読み違えると逆になる。', 'The quoted message hands work one way; reading it backwards inverts the answer.', '[{"term": "担当割り", "reading": "たんとうわり", "meaning": "assignment of accounts"}, {"term": "各位", "reading": "かくい", "meaning": "all concerned (in a salutation)"}]'::jsonb, '[{"template": "email_thread", "title": "Re: 九月の担当割り", "meta": [{"label": "差出人", "value": "営業部 川口"}, {"label": "宛先", "value": "営業部 各位"}, {"label": "件名", "value": "Re: 九月の担当割り"}, {"label": "日時", "value": "九月一日 九時"}], "blocks": [{"type": "paragraph", "text": "九月の担当は次のとおりです。"}, {"type": "bullets", "items": ["みどり物産：佐藤", "あさひ工業：川口", "ひかり製作所：山本"]}, {"type": "quoted_message", "sender": "営業部 佐藤", "sent_at": "八月二十八日 十七時", "depth": 1, "text": "九月は研修で不在の日が多いため、みどり物産は引き続き私が持ちますが、急ぎの件は川口さんにお願いすることがあるかもしれません。"}]}]'::jsonb, '[]'::jsonb, 'e32b473e7174bd9f', null)
on conflict (id) do update set
       bundle_id = excluded.bundle_id,
       item_type = excluded.item_type,
       level = excluded.level,
       seed_cell_id = excluded.seed_cell_id,
       setting = excluded.setting,
       relation = excluded.relation,
       function = excluded.function,
       channel = excluded.channel,
       scene_id = excluded.scene_id,
       speaker_role = excluded.speaker_role,
       listener_role = excluded.listener_role,
       topic = excluded.topic,
       stem = excluded.stem,
       correct_index = excluded.correct_index,
       explanation_ja = excluded.explanation_ja,
       explanation_en = excluded.explanation_en,
       vocab_notes = excluded.vocab_notes,
       documents = excluded.documents,
       dialogue = excluded.dialogue,
       narration_clip_id = excluded.narration_clip_id,
       model_p_correct = excluded.model_p_correct;

-- Options are replaced wholesale rather than upserted: a corrected item can
-- have fewer options or a different order, and a stale row left behind would
-- be a fifth answer nobody meant to publish.
delete from public.item_options where item_id in ('013fa68b2a', 'f760e4e239', '353e5d008b', 'a58a148f1d', '0c022ece93', 'd0694b8a01');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('013fa68b2a', 0, '二十四本', 'ignores_the_spoken_change', '見積書に書かれている数量のままで、口頭で告げられた「倍に」を反映していない。', null),
       ('013fa68b2a', 1, '八十箱', 'reads_wrong_row', '倍にする計算は合っているが、対象が用紙の行で、しかも用紙は「四十箱で結構」と据え置かれている。', null),
       ('013fa68b2a', 2, '四十八本', 'correct', '見積書のインクは二十四本で、それを倍にするので四十八本。', null),
       ('013fa68b2a', 3, '二百四十冊', 'surface_keyword_match', 'ファイルの行を倍にした数で、ファイルは「そのままで」と明言されている。', null),
       ('f760e4e239', 0, '九月二十四日', 'correct', '十八日（土）の翌々営業日。十九日（日）、二十日（日曜と述べられた日）、二十一日と二十二日の休業日を飛ばすと、営業日は二十三日と二十四日になる。', null),
       ('f760e4e239', 1, '九月二十日', 'ignores_the_spoken_change', '出荷の二日後をそのまま数えた日で、上司が述べた曜日も、メールの休業日も飛ばしていない。', null),
       ('f760e4e239', 2, '九月十八日', 'wrong_timeframe', 'これは出荷日で、届く日ではない。', null),
       ('f760e4e239', 3, '九月二十二日', 'reads_wrong_row', 'メールに出てくる日付ではあるが、それは休業日として挙げられた日で、届く日ではない。', null),
       ('353e5d008b', 0, '十八日（木）の午後', 'ignores_the_spoken_change', '予定表では空いているが、同僚が木曜は一日休みを取ると述べている。', null),
       ('353e5d008b', 1, '十七日（水）の午前', 'reads_wrong_row', '佐藤は空いているが、同僚の午前はずっと埋まっている。', null),
       ('353e5d008b', 2, '十八日（木）の午前', 'surface_keyword_match', '表で唯一の「空き」が二つ並ぶ日だが、午前も木曜も同僚の条件に反している。', null),
       ('353e5d008b', 3, '十六日（火）の午後', 'correct', '同僚は午前が不可、木曜は終日不可。残る午後の空きは火曜だけで、水曜の午後は佐藤が外出している。', null),
       ('a58a148f1d', 0, 'A-205の数量だけ', 'wrong_timeframe', '数量の食い違いは正しいが、納期も一週間前倒しと述べられており、片方だけでは足りない。', null),
       ('a58a148f1d', 1, 'A-205の数量と納期の両方', 'correct', '資料は百五十個・九月十七日だが、上司の話では二百個・一週間前倒しで、二つとも合っていない。', null),
       ('a58a148f1d', 2, 'A-101の数量', 'reads_wrong_row', '隣の行の品番で、A-101については何も述べられていない。', null),
       ('a58a148f1d', 3, 'B-012の納期', 'ignores_the_spoken_change', 'B-012は「変更なし」と明言されており、食い違ってはいない。', null),
       ('0c022ece93', 0, '二十万円', 'ignores_the_spoken_change', '資料の合計そのままで、二名の追加を反映していない。', null),
       ('0c022ece93', 1, '二十一万六千円', 'reads_wrong_row', '研修費だけを十二名分にした額で、教材費の行が抜けている。', null),
       ('0c022ece93', 2, '二十四万四千円', 'surface_keyword_match', '追加分を単価ではなく一人あたり二万四千円で計算した額で、注記の「同じ単価で」に反している。', null),
       ('0c022ece93', 3, '二十四万円', 'correct', '十二名分で、研修が一万八千円×十二の二十一万六千円、教材が二千円×十二の二万四千円。合わせて二十四万円。', null),
       ('d0694b8a01', 0, '川口', 'correct', 'あさひ工業の担当は川口と明記されており、急ぎであることは担当を変えない。', null),
       ('d0694b8a01', 1, '佐藤', 'reads_wrong_row', '佐藤が担当するのはみどり物産で、あさひ工業ではない。', null),
       ('d0694b8a01', 2, '山本', 'surface_keyword_match', '同じ一覧に並んでいるが、担当はひかり製作所。', null),
       ('d0694b8a01', 3, '急ぎなので川口ではなく佐藤', 'ignores_the_spoken_change', '引用部分の「急ぎの件は川口さんに」は佐藤が持つ案件についての話で、向きが逆になっている。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
