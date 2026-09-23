-- sougou_choudokkai_J1_002: 1 × sougou_choudokkai (J1)
-- generated 2026-09-23T21:04:19+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('a4e7430667229af8', '研修当日の会場対応は、誰が行うことになりましたか。', 'narrator_f', 'in_person'),
       ('6c56f26bb38d3038', '議事録では、会場の予約と当日対応、それに昼食の手配まで、すべて中村さんになっていますね。', 'manager_m', 'video'),
       ('d64533cf7fe8ccc5', 'はい。ただ、中村さんは来週から出張で、研修当日は不在の予定です。', 'staff_junior_m', 'video'),
       ('e357a5e2ef1b42db', 'それは困りますね。予約はもう済んでいるようですが、当日対応は佐藤さんにお願いできますか。', 'manager_m', 'video'),
       ('ef6bf54f12483df1', '承知しました。私が当日対応いたします。', 'staff_junior_m', 'video'),
       ('6b2ab03f77832a05', '昼食の手配については、中村さんが出張前に済ませると言っていました。', 'staff_junior_m', 'video'),
       ('e33a1f16704f607c', 'それはそのままで結構です。', 'manager_m', 'video')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choudokkai_J1_002', 'sougou_choudokkai', 'J1', 'claude-sonnet-5', '2026-09-23T21:04:19+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('dc756cc425', 'sougou_choudokkai_J1_002', 'sougou_choudokkai', 'J1', 'video_review+superior_to_subordinate+reconcile_document@J1', 'video_review', 'superior_to_subordinate', 'reconcile_document', 'video', 'scene_video_call_laptop', null, null, '新人研修の会場担当の引き継ぎ', '研修当日の会場対応は、誰が行うことになりましたか。', 2, '議事録では会場の予約・当日対応・昼食の手配がすべて中村の担当とされているが、会話で中村が研修当日は出張で不在になることが分かり、部長が当日対応だけを佐藤に依頼している。昼食の手配は出張前に中村が済ませる予定なので変更されていない。議事録だけでは出張の事実が分からず、会話だけでは元の担当割り振りが分からないため、両方を照合しないと正解できない。', 'The minutes assign everything to Nakamura, but the call reveals Nakamura will be away, so the manager moves only the on-site duty to Sato, leaving the lunch arrangement unchanged.', '[{"term": "引き継ぐ", "reading": "ひきつぐ", "meaning": "to take over / hand over (a task)"}, {"term": "手配", "reading": "てはい", "meaning": "arrangement, making arrangements"}]'::jsonb, '[{"template": "meeting_minutes", "title": "新人研修 運営打ち合わせ 議事録", "meta": [{"label": "日時", "value": "9月5日 15時"}, {"label": "場所", "value": "オンライン"}, {"label": "出席者", "value": "部長、中村、佐藤"}], "blocks": [{"type": "table", "columns": ["項目", "担当"], "rows": [["会場の予約", "中村"], ["当日対応", "中村"], ["昼食の手配", "中村"]]}, {"type": "bullets", "items": ["研修は9月20日実施。", "詳細は担当者が各自進めること。"]}]}]'::jsonb, '[{"speaker_role": "部長", "text": "議事録では、会場の予約と当日対応、それに昼食の手配まで、すべて中村さんになっていますね。", "clip_id": "6c56f26bb38d3038"}, {"speaker_role": "部下", "text": "はい。ただ、中村さんは来週から出張で、研修当日は不在の予定です。", "clip_id": "d64533cf7fe8ccc5"}, {"speaker_role": "部長", "text": "それは困りますね。予約はもう済んでいるようですが、当日対応は佐藤さんにお願いできますか。", "clip_id": "e357a5e2ef1b42db"}, {"speaker_role": "部下", "text": "承知しました。私が当日対応いたします。", "clip_id": "ef6bf54f12483df1"}, {"speaker_role": "部下", "text": "昼食の手配については、中村さんが出張前に済ませると言っていました。", "clip_id": "6b2ab03f77832a05"}, {"speaker_role": "部長", "text": "それはそのままで結構です。", "clip_id": "e33a1f16704f607c"}]'::jsonb, 'a4e7430667229af8', 1.0)
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
delete from public.item_options where item_id in ('dc756cc425');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('dc756cc425', 0, '中村が行う。', 'combines_wrong_pair', '議事録の担当者欄のままで、中村が出張で不在になるという会話の内容を反映していない。', null),
       ('dc756cc425', 1, '中村が出張を短縮して対応する。', 'unsupported_but_plausible', '出張を切り上げて戻る可能性はあり得るが、会話ではそのような話は一切出ていない。', null),
       ('dc756cc425', 2, '佐藤が行う。', 'correct', '中村が出張で当日不在になるため、部長が佐藤に当日対応を依頼し、佐藤も了承している。', null),
       ('dc756cc425', 3, '佐藤が昼食の手配も合わせて行う。', 'wrong_action_owner', '昼食の手配は中村が出張前に済ませると述べており、佐藤が引き継いだのは会場対応だけである。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
