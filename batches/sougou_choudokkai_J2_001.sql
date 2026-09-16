-- sougou_choudokkai_J2_001: 6 × sougou_choudokkai (J2)
-- generated 2026-09-15T17:58:03+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_meeting_room', '取引先の会議室'),
       ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('81b24ed799748e41', '改修は結局どうなりましたか。', 'narrator_f', 'in_person'),
       ('d2feb65099dc43fe', '議事録では、改修は三階と四階の両方でしたね。', 'manager_m', 'in_person'),
       ('0a2c9c55f0b8bc3c', 'はい。ただ、四階は来年の移転で使わなくなる見込みです。', 'staff_junior_m', 'in_person'),
       ('769dc4b961ffe328', 'では四階は外しましょう。三階だけにします。', 'manager_m', 'in_person'),
       ('2044771a57d9975c', '予算はどういたしますか。三階だけですと半分ほど余りますが。', 'staff_mid_f', 'in_person'),
       ('9ba4d85122c8d1d8', '余った分は戻します。追加の工事はしません。', 'manager_m', 'in_person'),
       ('8f467d1b08b3e967', '先方への連絡と資料の更新は、それぞれ誰がすることになりましたか。', 'narrator_f', 'in_person'),
       ('a5fc79a37ac3b334', '議事録では、先方への連絡は私になっていますね。', 'manager_m', 'video'),
       ('798ea5f09f5d409b', 'そうなんですが、来週は出張で連絡が取りづらいのでは。', 'staff_junior_m', 'video'),
       ('3e4d1ddedd0c092f', '確かに。では連絡はお願いできますか。', 'manager_m', 'video'),
       ('c32a787da888ebdc', '承知しました。資料の更新はそちらでお願いします。', 'staff_junior_m', 'video'),
       ('f0acde8231a74a21', 'はい、資料は私が直します。', 'manager_m', 'video'),
       ('230faf2d31dd06ca', '報告書の期限はいつになりましたか。', 'narrator_f', 'in_person'),
       ('15a9d51a99d45460', '予定表では、試験は二十二日から二十四日の三日間ですね。', 'manager_m', 'video'),
       ('6dd1cf9ed90dd67d', 'はい。ただ、装置の搬入が一日遅れまして、二十三日からになります。', 'staff_junior_m', 'video'),
       ('5f94c5af5f8da526', '三日間は必要ですか。', 'manager_m', 'video'),
       ('473215020b5d02f5', '二日に縮められます。二十四日には終わります。', 'staff_junior_m', 'video'),
       ('5801b8de9b67b7f7', '分かりました。報告書はその翌営業日までに出してください。', 'manager_m', 'video'),
       ('c4293b309817475f', '今回の金額はいくらになりますか。', 'narrator_f', 'in_person'),
       ('6b3689d83ae683a3', '先方のお手元の見積書、単価が千二百円になっていますね。', 'manager_m', 'in_person'),
       ('931ae91ce00eb05d', 'こちらの控えは千円です。どちらが新しいのでしょうか。', 'staff_junior_m', 'in_person'),
       ('b20a47fb473e9cf4', '九月一日付が古いほうです。値上げのご連絡を九月五日に差し上げています。', 'manager_m', 'in_person'),
       ('fe2cccf43493551f', 'では先方のものが新しいということですね。', 'staff_junior_m', 'in_person'),
       ('f501f269d2e0ae62', 'はい。数量は二百個で、どちらの書類も同じです。', 'manager_m', 'in_person'),
       ('1e58b90b3ce779a7', '上に報告することになったのは、どの問題ですか。', 'narrator_f', 'in_person'),
       ('e416e1bdf4ac4ef1', '報告書に挙がっている三つの懸念、いまはどうなっていますか。', 'manager_m', 'in_person'),
       ('d615ee11b538f444', '人員は増員が決まりました。部材も代替品の目処が立っています。', 'staff_junior_m', 'in_person'),
       ('97fa20d4ef6b39e4', 'では残るのは検査の枠ですか。', 'manager_m', 'in_person'),
       ('1d296e597528ea40', 'はい。外部の検査機関がどこも一杯で、まだ押さえられていません。', 'staff_junior_m', 'in_person'),
       ('6141b77afa6f9a8a', '分かりました。そこだけ上に報告します。', 'manager_m', 'in_person'),
       ('8fe792581b5bf438', 'どちらの修正を採ることになりましたか。', 'narrator_f', 'in_person'),
       ('320ace4c40f5e058', '引き継ぎのメールに、修正案が二つ書いてありました。', 'manager_m', 'in_person'),
       ('66d9898eb8d02329', 'どちらも読みました。一つ目は時間がかかりますね。', 'staff_junior_m', 'in_person'),
       ('a124a21779246a97', 'はい、二週間ほど。二つ目なら三日で終わります。', 'manager_m', 'in_person'),
       ('786de540420a845e', '納期は来週です。三日で終わるほうにしましょう。', 'staff_junior_m', 'in_person'),
       ('86499ff12e38f19a', 'ただ、二つ目は来年また直すことになります。', 'manager_m', 'in_person'),
       ('63c7db719dd4e16e', 'それで構いません。今回は間に合わせが先です。', 'staff_junior_m', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choudokkai_J2_001', 'sougou_choudokkai', 'J2', 'author-composed', '2026-09-15T17:58:03+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('7bc31b17c2', 'sougou_choudokkai_J2_001', 'sougou_choudokkai', 'J2', 'project_meeting+superior_to_subordinate+summarise_outcome@J2', 'project_meeting', 'superior_to_subordinate', 'summarise_outcome', 'in_person', 'scene_meeting_room_table', null, null, '改修の範囲がどうなったか', '改修は結局どうなりましたか。', 2, '議事録は「四階の扱いは移転計画の確定後に見直す」としていたが、会話の中で移転の見込みが述べられ、その場で四階が外された。議事録だけを読むと両方、会話だけでは予算の扱いが分からない。', 'The minutes defer a decision; the conversation takes it. Neither alone is the outcome.', '[{"term": "改修", "reading": "かいしゅう", "meaning": "refurbishment"}, {"term": "着工", "reading": "ちゃっこう", "meaning": "start of construction"}]'::jsonb, '[{"template": "meeting_minutes", "title": "第三回 設備改修 打ち合わせ 議事録", "meta": [{"label": "日時", "value": "九月四日 十時"}, {"label": "場所", "value": "第一会議室"}, {"label": "出席者", "value": "課長、佐藤、川口"}], "blocks": [{"type": "numbered", "items": ["改修の対象は三階および四階とする。", "予算は八百万円。着工は十一月。", "四階の扱いは、移転計画の確定後に見直す。"]}]}]'::jsonb, '[{"speaker_role": "課長", "text": "議事録では、改修は三階と四階の両方でしたね。", "clip_id": "d2feb65099dc43fe"}, {"speaker_role": "先輩社員", "text": "はい。ただ、四階は来年の移転で使わなくなる見込みです。", "clip_id": "0a2c9c55f0b8bc3c"}, {"speaker_role": "課長", "text": "では四階は外しましょう。三階だけにします。", "clip_id": "769dc4b961ffe328"}, {"speaker_role": "後輩社員", "text": "予算はどういたしますか。三階だけですと半分ほど余りますが。", "clip_id": "2044771a57d9975c"}, {"speaker_role": "課長", "text": "余った分は戻します。追加の工事はしません。", "clip_id": "9ba4d85122c8d1d8"}]'::jsonb, '81b24ed799748e41', null),
       ('808b6996bf', 'sougou_choudokkai_J2_001', 'sougou_choudokkai', 'J2', 'video_review+peer_to_peer+identify_action_owner@J2', 'video_review', 'peer_to_peer', 'identify_action_owner', 'video', 'scene_video_call_laptop', null, null, '誰が先方に連絡するか', '先方への連絡と資料の更新は、それぞれ誰がすることになりましたか。', 0, '議事録の表では連絡が山本、資料が川口だが、会話で出張を理由に入れ替わっている。出席者名と会話中の呼び方を突き合わせないと、どちらがどちらか決まらない。社内共有は入れ替えの対象になっていない。', 'The table assigns; the conversation swaps two of the three rows, and only two.', '[{"term": "出張", "reading": "しゅっちょう", "meaning": "business trip"}, {"term": "共有", "reading": "きょうゆう", "meaning": "sharing (internally)"}]'::jsonb, '[{"template": "meeting_minutes", "title": "第二回 レビュー 議事録", "meta": [{"label": "日時", "value": "九月八日 十四時"}, {"label": "場所", "value": "オンライン"}, {"label": "出席者", "value": "山本、川口"}], "blocks": [{"type": "table", "columns": ["項目", "担当", "期限"], "rows": [["先方への連絡", "山本", "九月十二日"], ["資料の更新", "川口", "九月十五日"], ["社内共有", "山本", "九月十六日"]]}]}]'::jsonb, '[{"speaker_role": "同僚A", "text": "議事録では、先方への連絡は私になっていますね。", "clip_id": "a5fc79a37ac3b334"}, {"speaker_role": "同僚B", "text": "そうなんですが、来週は出張で連絡が取りづらいのでは。", "clip_id": "798ea5f09f5d409b"}, {"speaker_role": "同僚A", "text": "確かに。では連絡はお願いできますか。", "clip_id": "3e4d1ddedd0c092f"}, {"speaker_role": "同僚B", "text": "承知しました。資料の更新はそちらでお願いします。", "clip_id": "c32a787da888ebdc"}, {"speaker_role": "同僚A", "text": "はい、資料は私が直します。", "clip_id": "f0acde8231a74a21"}]'::jsonb, '8f467d1b08b3e967', null),
       ('b9b8446b1d', 'sougou_choudokkai_J2_001', 'sougou_choudokkai', 'J2', 'video_review+superior_to_subordinate+find_the_deadline@J2', 'video_review', 'superior_to_subordinate', 'find_the_deadline', 'video', 'scene_video_call_laptop', null, null, '期限がいつになったか', '報告書の期限はいつになりましたか。', 3, '搬入の遅れで開始が一日ずれたが、期間を三日から二日に縮めたため終了日は二十四日のまま。期限は「その翌営業日」なので二十五日。資料の最終日や予備日は、どちらも期限の根拠になっていない。', 'The start slips and the duration shrinks, so the end date does not move.', '[{"term": "搬入", "reading": "はんにゅう", "meaning": "delivery into a site"}, {"term": "予備日", "reading": "よびび", "meaning": "reserve day"}]'::jsonb, '[{"template": "schedule", "title": "試験日程", "meta": [{"label": "期間", "value": "九月二十二日（月）〜二十六日（金）"}, {"label": "作成者", "value": "技術部"}], "blocks": [{"type": "table", "columns": ["日付", "予定"], "rows": [["二十二日（月）", "試験一日目"], ["二十三日（火）", "試験二日目"], ["二十四日（水）", "試験三日目"], ["二十五日（木）", "予備日"]]}]}]'::jsonb, '[{"speaker_role": "課長", "text": "予定表では、試験は二十二日から二十四日の三日間ですね。", "clip_id": "15a9d51a99d45460"}, {"speaker_role": "後輩社員", "text": "はい。ただ、装置の搬入が一日遅れまして、二十三日からになります。", "clip_id": "6dd1cf9ed90dd67d"}, {"speaker_role": "課長", "text": "三日間は必要ですか。", "clip_id": "5f94c5af5f8da526"}, {"speaker_role": "後輩社員", "text": "二日に縮められます。二十四日には終わります。", "clip_id": "473215020b5d02f5"}, {"speaker_role": "課長", "text": "分かりました。報告書はその翌営業日までに出してください。", "clip_id": "5801b8de9b67b7f7"}]'::jsonb, '230faf2d31dd06ca', null),
       ('dd4aa457b1', 'sougou_choudokkai_J2_001', 'sougou_choudokkai', 'J2', 'client_review+peer_to_peer+reconcile_document@J2', 'client_review', 'peer_to_peer', 'reconcile_document', 'in_person', 'scene_client_meeting_room', null, null, '単価の食い違いを解く', '今回の金額はいくらになりますか。', 1, '手元の書類は九月一日付で、会話によりこれが古いほうだと分かる。新しい単価は千二百円、数量は二百個で変わらない。資料の金額をそのまま使うと古い額になり、二つの単価を足すと値上げの意味を取り違える。', 'The document in hand is the older one; the conversation is what says so.', '[{"term": "控え", "reading": "ひかえ", "meaning": "one''s own copy"}, {"term": "値上げ", "reading": "ねあげ", "meaning": "price increase"}]'::jsonb, '[{"template": "quote_order", "title": "お見積書（部材）", "meta": [{"label": "宛先", "value": "あさひ工業株式会社 御中"}, {"label": "発行者", "value": "山川商事株式会社"}, {"label": "発行日", "value": "九月一日"}], "blocks": [{"type": "table", "columns": ["品名", "数量", "単価", "金額"], "rows": [["部材B", "200個", "1,000円", "200,000円"]]}]}]'::jsonb, '[{"speaker_role": "同僚A", "text": "先方のお手元の見積書、単価が千二百円になっていますね。", "clip_id": "6b3689d83ae683a3"}, {"speaker_role": "同僚B", "text": "こちらの控えは千円です。どちらが新しいのでしょうか。", "clip_id": "931ae91ce00eb05d"}, {"speaker_role": "同僚A", "text": "九月一日付が古いほうです。値上げのご連絡を九月五日に差し上げています。", "clip_id": "b20a47fb473e9cf4"}, {"speaker_role": "同僚B", "text": "では先方のものが新しいということですね。", "clip_id": "fe2cccf43493551f"}, {"speaker_role": "同僚A", "text": "はい。数量は二百個で、どちらの書類も同じです。", "clip_id": "f501f269d2e0ae62"}]'::jsonb, 'c4293b309817475f', null),
       ('2ee42c7c01', 'sougou_choudokkai_J2_001', 'sougou_choudokkai', 'J2', 'project_meeting+superior_to_subordinate+identify_risk@J2', 'project_meeting', 'superior_to_subordinate', 'identify_risk', 'in_person', 'scene_meeting_room_table', null, null, '何が問題として残るか', '上に報告することになったのは、どの問題ですか。', 3, '報告書の三つの懸念が、会話の中で一つずつ片づけられていく。残るのは外部検査の枠だけで、課長も「そこだけ上に報告します」と述べている。報告書だけを読むと三つとも残っているように見える。', 'The report lists three risks and the conversation closes two of them.', '[{"term": "懸念", "reading": "けねん", "meaning": "concern / risk"}, {"term": "目処が立つ", "reading": "めどがたつ", "meaning": "to have a prospect of"}]'::jsonb, '[{"template": "progress_report", "title": "案件M 進捗報告", "meta": [{"label": "報告者", "value": "営業部 佐藤"}, {"label": "報告日", "value": "九月五日"}, {"label": "案件", "value": "案件M"}], "blocks": [{"type": "paragraph", "text": "全体としては予定どおり進んでいます。懸念は次の三点です。"}, {"type": "bullets", "items": ["人員が二名不足している。", "部材Cの入荷が不透明である。", "外部検査の枠が確保できていない。"]}]}]'::jsonb, '[{"speaker_role": "課長", "text": "報告書に挙がっている三つの懸念、いまはどうなっていますか。", "clip_id": "e416e1bdf4ac4ef1"}, {"speaker_role": "先輩社員", "text": "人員は増員が決まりました。部材も代替品の目処が立っています。", "clip_id": "d615ee11b538f444"}, {"speaker_role": "課長", "text": "では残るのは検査の枠ですか。", "clip_id": "97fa20d4ef6b39e4"}, {"speaker_role": "先輩社員", "text": "はい。外部の検査機関がどこも一杯で、まだ押さえられていません。", "clip_id": "1d296e597528ea40"}, {"speaker_role": "課長", "text": "分かりました。そこだけ上に報告します。", "clip_id": "6141b77afa6f9a8a"}]'::jsonb, '1e58b90b3ce779a7', null),
       ('2bc464a7cb', 'sougou_choudokkai_J2_001', 'sougou_choudokkai', 'J2', 'handover+junior_to_senior+choose_revision@J2', 'handover', 'junior_to_senior', 'choose_revision', 'in_person', 'scene_office_desk_pair', null, null, 'どの修正を採るか', 'どちらの修正を採ることになりましたか。', 0, 'メールは二案を並べるだけで優劣を決めていない。納期が来週だという会話の情報が決め手になり、三日で終わるほうが選ばれる。来年また直すことは承知のうえで、そこまで決めたわけではない。', 'The email offers two options; only the conversation supplies the constraint that picks one.', '[{"term": "工数", "reading": "こうすう", "meaning": "man-hours / effort"}, {"term": "間に合わせ", "reading": "まにあわせ", "meaning": "a stopgap"}]'::jsonb, '[{"template": "email_thread", "title": "Re: 引き継ぎ（表示の不具合）", "meta": [{"label": "差出人", "value": "技術部 山本"}, {"label": "宛先", "value": "営業部 各位"}, {"label": "件名", "value": "Re: 引き継ぎ（表示の不具合）"}, {"label": "日時", "value": "九月九日 十一時"}], "blocks": [{"type": "paragraph", "text": "表示の不具合について、直し方は二通りあります。"}, {"type": "numbered", "items": ["作りを組み直す。根本的に直るが、工数が大きい。", "表示の部分だけを当て直す。早いが、来年の更新時に再度の対応が要る。"]}]}]'::jsonb, '[{"speaker_role": "後輩社員", "text": "引き継ぎのメールに、修正案が二つ書いてありました。", "clip_id": "320ace4c40f5e058"}, {"speaker_role": "先輩社員", "text": "どちらも読みました。一つ目は時間がかかりますね。", "clip_id": "66d9898eb8d02329"}, {"speaker_role": "後輩社員", "text": "はい、二週間ほど。二つ目なら三日で終わります。", "clip_id": "a124a21779246a97"}, {"speaker_role": "先輩社員", "text": "納期は来週です。三日で終わるほうにしましょう。", "clip_id": "786de540420a845e"}, {"speaker_role": "後輩社員", "text": "ただ、二つ目は来年また直すことになります。", "clip_id": "86499ff12e38f19a"}, {"speaker_role": "先輩社員", "text": "それで構いません。今回は間に合わせが先です。", "clip_id": "63c7db719dd4e16e"}]'::jsonb, '8fe792581b5bf438', null)
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
delete from public.item_options where item_id in ('7bc31b17c2', '808b6996bf', 'b9b8446b1d', 'dd4aa457b1', '2ee42c7c01', '2bc464a7cb');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('7bc31b17c2', 0, '三階と四階の両方を改修する。', 'combines_wrong_pair', '議事録の一項目のままで、会話でその項目が見直されたことを反映していない。', null),
       ('7bc31b17c2', 1, '三階を改修し、余った予算で追加の工事をする。', 'unsupported_but_plausible', '余りの使い道としてはありそうだが、課長は「追加の工事はしません」と明確に否定している。', null),
       ('7bc31b17c2', 2, '三階だけを改修し、余った予算は戻す。', 'correct', '課長が「四階は外しましょう。三階だけにします」と決め、余りは「戻します」と述べている。', null),
       ('7bc31b17c2', 3, '移転計画が確定するまで、改修を待つ。', 'stated_by_wrong_speaker', '議事録には見直しの条件としてそう書かれているが、会話ではその場で四階を外すと決まっている。', null),
       ('808b6996bf', 0, '連絡は川口、資料の更新は山本。', 'correct', '議事録の割り当てを、会話の中で二人が入れ替えている。連絡を引き受けたのが川口、資料を直すと言ったのが山本。', null),
       ('808b6996bf', 1, '連絡は山本、資料の更新は川口。', 'combines_wrong_pair', '議事録の表のままで、会話で入れ替わったことを反映していない。', null),
       ('808b6996bf', 2, '連絡も資料の更新も川口。', 'wrong_action_owner', '川口が引き受けたのは連絡だけで、資料は相手に頼んでいる。', null),
       ('808b6996bf', 3, '連絡は川口、社内共有も川口。', 'stated_by_wrong_speaker', '社内共有は議事録で山本の担当とされており、会話でも触れられていない。', null),
       ('b9b8446b1d', 0, '九月二十四日', 'combines_wrong_pair', '試験が終わる日で、報告書の期限ではない。', null),
       ('b9b8446b1d', 1, '九月二十六日', 'unsupported_but_plausible', '予定表の期間の最終日だが、期限は試験の終了日から数えると定められている。', null),
       ('b9b8446b1d', 2, '九月二十七日', 'wrong_action_owner', '予備日の翌日にあたるが、予備日は使われず、そもそも誰も予備日に触れていない。', null),
       ('b9b8446b1d', 3, '九月二十五日', 'correct', '試験は二十四日に終わり、報告書はその翌営業日。二十四日が水曜なので翌営業日は木曜の二十五日。', null),
       ('dd4aa457b1', 0, '二十万円', 'combines_wrong_pair', '手元の見積書の金額そのままで、この書類が古いほうだと会話で分かっている。', null),
       ('dd4aa457b1', 1, '二十四万円', 'correct', '新しいのは千二百円のほうで、数量は二百個のまま。千二百円×二百個で二十四万円。', null),
       ('dd4aa457b1', 2, '四十四万円', 'unsupported_but_plausible', '二つの単価を足して計算した額で、値上げは置き換えであって加算ではない。', null),
       ('dd4aa457b1', 3, '十二万円', 'wrong_action_owner', '新しい単価に百個を掛けた額で、数量は「どちらの書類も同じ」と二百個で確認されている。', null),
       ('2ee42c7c01', 0, '人員が二名不足していること', 'stated_by_wrong_speaker', '報告書に載っている懸念だが、会話では先輩が増員の決定を述べており、残っている問題として挙げたのは検査の枠のほうだけ。', null),
       ('2ee42c7c01', 1, '部材Cの入荷が不透明であること', 'combines_wrong_pair', '報告書の懸念だが、代替品の目処が立ったと会話で解消されている。', null),
       ('2ee42c7c01', 2, '全体の進みが予定より遅れていること', 'unsupported_but_plausible', '報告書は「全体としては予定どおり」と述べており、遅れているとはどこにも書かれていない。', null),
       ('2ee42c7c01', 3, '外部検査の枠が確保できていないこと', 'correct', '三つの懸念のうち人員と部材は解消が述べられ、検査の枠だけが「まだ押さえられていません」と残っている。', null),
       ('2bc464a7cb', 0, '表示の部分だけを当て直し、来年に改めて対応する。', 'correct', '納期が来週であることを理由に三日で終わるほうが選ばれ、来年また直すことも承知のうえだと述べられている。', null),
       ('2bc464a7cb', 1, '作りを組み直して、根本的に直す。', 'combines_wrong_pair', 'メールに書かれた選択肢だが、二週間かかるため納期に間に合わないと会話で退けられている。', null),
       ('2bc464a7cb', 2, '両方を行い、今回は当て直して来年に組み直す。', 'unsupported_but_plausible', '自然な折衷案に見えるが、来年の対応をどうするかは誰も決めておらず、「また直すことになります」と述べられただけ。', null),
       ('2bc464a7cb', 3, '納期を延ばして、組み直すほうを選ぶ。', 'wrong_action_owner', '納期を動かす話は出ておらず、先輩は納期を動かせる立場としては述べていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
