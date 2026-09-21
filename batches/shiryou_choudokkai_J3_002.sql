-- shiryou_choudokkai_J3_002: 1 × shiryou_choudokkai (J3)
-- generated 2026-09-21T21:38:19+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_phone_desk', 'デスクで固定電話')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('e47e027fd06a1501', '後輩が予定表を見ながら先輩に電話でこう尋ねました。先輩「15日10時、ABC商事さんとみどり産業さんが重なっていますね。みどり産業さんとはもう16日の13時に変更してもらいました。かえで商会さんは17日に延期になったので、16日は空いています。」みどり産業と実際に会うのはいつですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J3_002', 'shiryou_choudokkai', 'J3', 'claude-sonnet-5', '2026-09-21T21:38:19+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('81a2e12c4c', 'shiryou_choudokkai_J3_002', 'shiryou_choudokkai', 'J3', 'schedule_sheet+junior_to_senior+find_the_conflict@J3', 'schedule_sheet', 'junior_to_senior', 'find_the_conflict', 'phone', 'scene_phone_desk', null, null, '予定表の重複予約を電話で確認する', '後輩が予定表を見ながら先輩に電話でこう尋ねました。先輩「15日10時、ABC商事さんとみどり産業さんが重なっていますね。みどり産業さんとはもう16日の13時に変更してもらいました。かえで商会さんは17日に延期になったので、16日は空いています。」みどり産業と実際に会うのはいつですか。', 3, '予定表では15日10時にABC商事とみどり産業の予約が重複している。先輩の電話で、みどり産業との約束は16日13時に変更されたと分かる。10月15日10時は変更前の値で誤り、10月14日10時はABC商事の別行を読み違えたもの、10月17日はかえで商会が延期になった日であり、みどり産業とは関係ない。予定表だけでは変更後の時間が分からず、電話だけではどの予約が重複していたか分からない。', 'The sheet shows a double booking; the call reveals which appointment moved and to when, while the other date belongs to a different client''s postponement.', '[{"term": "重複", "reading": "じゅうふく", "meaning": "duplication/overlap"}, {"term": "延期", "reading": "えんき", "meaning": "postponement"}, {"term": "応接室", "reading": "おうせつしつ", "meaning": "reception room"}]'::jsonb, '[{"template": "schedule", "title": "来客対応 予定表", "meta": [{"label": "期間", "value": "10月14日(月)～10月16日(水)"}, {"label": "作成者", "value": "後輩 中村"}], "blocks": [{"type": "table", "columns": ["日付", "時間", "訪問先", "場所"], "rows": [["10/14(月)", "10:00", "ABC商事", "第2応接室"], ["10/14(月)", "14:00", "さくら工業", "本社ロビー（元は第1会議室）"], ["10/15(火)", "10:00", "ABC商事", "第2応接室"], ["10/15(火)", "10:00", "みどり産業", "第1応接室"], ["10/16(水)", "13:00", "かえで商会", "第3応接室"]]}]}]'::jsonb, '[]'::jsonb, 'e47e027fd06a1501', 1.0)
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
delete from public.item_options where item_id in ('81a2e12c4c');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('81a2e12c4c', 0, '10月14日10時', 'reads_wrong_row', '同じ第2応接室が使われるABC商事の別日の行で、みどり産業とは無関係の時間帯。', null),
       ('81a2e12c4c', 1, '10月15日10時', 'ignores_the_spoken_change', '予定表に元々書かれていた重複中の時間で、変更後の時間を反映していない。', null),
       ('81a2e12c4c', 2, '10月17日', 'wrong_timeframe', 'これはかえで商会が延期になった日で、みどり産業の約束が移った日ではない。', null),
       ('81a2e12c4c', 3, '10月16日13時', 'correct', '先輩の発言で、重複していたみどり産業との約束は16日13時に変更されたと述べられている。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
