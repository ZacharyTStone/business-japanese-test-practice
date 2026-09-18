-- sougou_choudokkai_J3_001: 2 × sougou_choudokkai (J3)
-- generated 2026-09-18T08:50:50+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('746d99f6e9d0ae31', '山川商事は、来週何を送ることになりましたか。', 'narrator_f', 'in_person'),
       ('974857861692bca4', '画面の議事録をご覧ください。カタログの送付は、こちらの担当になっています。', 'manager_m', 'video'),
       ('154a24f23d460b91', 'はい。ただ、サンプルのほうは、私どもで用意することになっていましたよね。', 'staff_junior_m', 'video'),
       ('be5dc87c707bc5a2', 'そうでした。では、サンプルはそちらから、カタログはこちらから、それぞれ来週お送りするということで。', 'manager_m', 'video'),
       ('deb628edc9cb7828', '分かりました。あと、価格表もお願いできますか。', 'staff_junior_m', 'video'),
       ('ca87bcbc707d1e78', '承知しました。価格表はカタログと一緒にお送りします。', 'manager_m', 'video'),
       ('26971fe7ec13e98a', '工事はいつ行うことになりましたか。', 'narrator_f', 'in_person'),
       ('78f33f0791e4f1d2', '工事の日程ですが、資料の案Aと案Bのどちらにしましょうか。', 'manager_m', 'in_person'),
       ('2f01f044db69588a', '案Aは休日の工事ですね。費用は高くなりますが、業務に影響がありません。', 'staff_junior_m', 'in_person'),
       ('9d84a8cd603292b2', 'はい。案Bは平日ですので、その日は事務所が使えません。', 'manager_m', 'in_person'),
       ('d8440ebd2ab4c784', 'その週は来客も多いですから、事務所が使えないのは困ります。費用がかかっても、休日にしましょう。', 'staff_junior_m', 'in_person'),
       ('44b421eaab1d537a', '分かりました。では、業者に連絡します。', 'manager_m', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choudokkai_J3_001', 'sougou_choudokkai', 'J3', 'manual-load', '2026-09-18T08:50:50+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('01948b5471', 'sougou_choudokkai_J3_001', 'sougou_choudokkai', 'J3', 'video_review+staff_to_client+identify_action_owner@J3', 'video_review', 'staff_to_client', 'identify_action_owner', 'video', 'scene_video_call_laptop', null, null, '資料を送るのは誰か', '山川商事は、来週何を送ることになりましたか。', 3, '議事録では、カタログは山川商事、サンプルと日程はあさひ工業の担当。会話で、それに価格表が加わり、カタログと一緒に山川商事が送ることになった。議事録だけでは価格表が分からず、会話だけではカタログの担当が分からない。', 'The minutes assign the catalogue to one side and the samples to the other; the conversation adds the price list to the catalogue.', '[{"term": "送付", "reading": "そうふ", "meaning": "sending / dispatch"}, {"term": "価格表", "reading": "かかくひょう", "meaning": "price list"}]'::jsonb, '[{"template": "meeting_minutes", "title": "打ち合わせ 議事録", "meta": [{"label": "日時", "value": "九月十日 十四時"}, {"label": "場所", "value": "オンライン"}, {"label": "出席者", "value": "山川商事 佐藤、あさひ工業 鈴木"}], "blocks": [{"type": "table", "columns": ["項目", "担当"], "rows": [["カタログの送付", "山川商事"], ["サンプルの用意", "あさひ工業"], ["次回の日程調整", "あさひ工業"]]}]}]'::jsonb, '[{"speaker_role": "自社の営業担当", "text": "画面の議事録をご覧ください。カタログの送付は、こちらの担当になっています。", "clip_id": "974857861692bca4"}, {"speaker_role": "取引先の担当者", "text": "はい。ただ、サンプルのほうは、私どもで用意することになっていましたよね。", "clip_id": "154a24f23d460b91"}, {"speaker_role": "自社の営業担当", "text": "そうでした。では、サンプルはそちらから、カタログはこちらから、それぞれ来週お送りするということで。", "clip_id": "be5dc87c707bc5a2"}, {"speaker_role": "取引先の担当者", "text": "分かりました。あと、価格表もお願いできますか。", "clip_id": "deb628edc9cb7828"}, {"speaker_role": "自社の営業担当", "text": "承知しました。価格表はカタログと一緒にお送りします。", "clip_id": "ca87bcbc707d1e78"}]'::jsonb, '746d99f6e9d0ae31', null),
       ('dfb5fc07a2', 'sougou_choudokkai_J3_001', 'sougou_choudokkai', 'J3', 'project_meeting+subordinate_to_superior+choose_revision@J3', 'project_meeting', 'subordinate_to_superior', 'choose_revision', 'in_person', 'scene_meeting_room_table', null, null, 'どちらの日程案にするか', '工事はいつ行うことになりましたか。', 1, '資料には二つの案があり、日付と費用が書いてある。会話では「休日にしましょう」と言うだけで、日付は言っていない。休日の案は資料の案Aで、十月十一日の土曜日。資料だけではどちらに決まったか分からず、会話だけでは日付が分からない。', 'The manager says only ''the weekend option''; the sheet is what turns that into October 11.', '[{"term": "空調", "reading": "くうちょう", "meaning": "air conditioning"}, {"term": "業者", "reading": "ぎょうしゃ", "meaning": "contractor"}]'::jsonb, '[{"template": "schedule", "title": "事務所 空調工事 日程案", "meta": [{"label": "期間", "value": "十月"}, {"label": "作成者", "value": "総務部 川口"}], "blocks": [{"type": "table", "columns": ["案", "日程", "費用"], "rows": [["案A", "十月十一日（土）", "四十万円"], ["案B", "十月十四日（火）", "三十万円"]]}, {"type": "callout", "tone": "info", "text": "平日の工事の場合、当日は事務所が使えません。"}]}]'::jsonb, '[{"speaker_role": "部下", "text": "工事の日程ですが、資料の案Aと案Bのどちらにしましょうか。", "clip_id": "78f33f0791e4f1d2"}, {"speaker_role": "課長", "text": "案Aは休日の工事ですね。費用は高くなりますが、業務に影響がありません。", "clip_id": "2f01f044db69588a"}, {"speaker_role": "部下", "text": "はい。案Bは平日ですので、その日は事務所が使えません。", "clip_id": "9d84a8cd603292b2"}, {"speaker_role": "課長", "text": "その週は来客も多いですから、事務所が使えないのは困ります。費用がかかっても、休日にしましょう。", "clip_id": "d8440ebd2ab4c784"}, {"speaker_role": "部下", "text": "分かりました。では、業者に連絡します。", "clip_id": "44b421eaab1d537a"}]'::jsonb, '26971fe7ec13e98a', null)
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
delete from public.item_options where item_id in ('01948b5471', 'dfb5fc07a2');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('01948b5471', 0, 'カタログだけ', 'combines_wrong_pair', '議事録のとおりではあるが、会話の最後で価格表も送ることになった。', null),
       ('01948b5471', 1, 'サンプルと価格表', 'wrong_action_owner', 'サンプルは議事録でも会話でも、あさひ工業が用意することになっている。', null),
       ('01948b5471', 2, 'カタログとサンプル', 'stated_by_wrong_speaker', 'サンプルは取引先の担当者が「私どもで用意する」と述べたもので、山川商事が送るものではない。', null),
       ('01948b5471', 3, 'カタログと価格表', 'correct', '議事録でカタログは山川商事の担当で、会話で価格表もカタログと一緒に送ると営業担当が引き受けた。', null),
       ('dfb5fc07a2', 0, '業者が決める日', 'wrong_action_owner', '日程を決めたのは課長で、部下は決まった日を業者に連絡するだけ。', null),
       ('dfb5fc07a2', 1, '十月十一日の土曜日', 'correct', '課長が費用がかかっても休日にすると決め、資料で休日の案Aは十月十一日の土曜日。', null),
       ('dfb5fc07a2', 2, '十月十四日の火曜日', 'combines_wrong_pair', '資料で安いほうの案Bの日程だが、平日で事務所が使えないため、課長が退けている。', null),
       ('dfb5fc07a2', 3, '来客の少ない別の週の平日', 'unsupported_but_plausible', '考えられる案ではあるが、資料にも会話にも別の週の話は出ていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
