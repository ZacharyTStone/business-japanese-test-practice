-- gazou_haaku_J1_001: 1 × gazou_haaku (J1)
-- generated 2026-09-21T21:32:30+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('pic_c706451a58', '取引先の応接室で奥へ案内する')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('ec018e53afaa6fee', '社員は何をしていますか。', 'narrator_f', 'in_person'),
       ('d08f3de5649eec59', 'エー', 'narrator_f', 'in_person'),
       ('ef97d3a686346ed6', '来客が社員に会議室までの道を尋ねています。', 'narrator_f', 'in_person'),
       ('da4df49bf7f00ab2', 'ビー', 'narrator_f', 'in_person'),
       ('57b7fa5c5da17f44', '来客に資料を手渡しています。', 'narrator_f', 'in_person'),
       ('d690aea8d6cb91f1', 'シー', 'narrator_f', 'in_person'),
       ('e9c832cf45f1fd0f', '来客を奥の応接室へ案内しています。', 'narrator_f', 'in_person'),
       ('134df096a9c7dc0a', 'デー', 'narrator_f', 'in_person'),
       ('21c4b9db5fd02510', '受付で来客に入館証を渡しています。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('gazou_haaku_J1_001', 'gazou_haaku', 'J1', 'claude-sonnet-5', '2026-09-21T21:32:30+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('c706451a58', 'gazou_haaku_J1_001', 'gazou_haaku', 'J1', 'client_office+staff_to_visitor+guiding_visitor@J1', 'client_office', 'staff_to_visitor', 'guiding_visitor', 'in_person', 'pic_c706451a58', null, null, '取引先の応接室で奥へ案内する', '社員は何をしていますか。', 2, '社員が奥のドアのほうへ手のひらを向けて方向を示し、来客がその方向を見ているので、来客を奥の応接室へ案内している場面。資料などの手渡しは描かれておらず、方向を示しているのは社員であって来客ではない。また、場所は受付ではなく取引先の応接室の内部であり、受付カウンターは存在しない。', 'The employee''s open palm toward the inner door, with the visitor looking that way, shows the visitor being guided further inside; no handover, no reversed roles, and not a reception desk.', '[{"term": "案内する", "reading": "あんないする", "meaning": "to show someone the way"}, {"term": "応接室", "reading": "おうせつしつ", "meaning": "reception/meeting room for guests"}, {"term": "入館証", "reading": "にゅうかんしょう", "meaning": "visitor badge"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'ec018e53afaa6fee', 1.0)
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
delete from public.item_options where item_id in ('c706451a58');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('c706451a58', 0, '来客が社員に会議室までの道を尋ねています。', 'wrong_participants', '手で方向を示しているのは社員のほうで、来客は尋ねる様子もなく黙って従っている。', 'ef97d3a686346ed6'),
       ('c706451a58', 1, '来客に資料を手渡しています。', 'different_action', '手には何も持っておらず、資料のやり取りは描かれていない。手は方向を示す動きをしている。', '57b7fa5c5da17f44'),
       ('c706451a58', 2, '来客を奥の応接室へ案内しています。', 'correct', '社員が手のひらを奥のドアのほうへ向け、来客もその方向を見て歩き出そうとしている。', 'e9c832cf45f1fd0f'),
       ('c706451a58', 3, '受付で来客に入館証を渡しています。', 'adjacent_setting', '場面は取引先の応接室の奥まった一角で、受付カウンターは描かれていない。', '21c4b9db5fd02510')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
