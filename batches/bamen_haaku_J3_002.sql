-- bamen_haaku_J3_002: 1 × bamen_haaku (J3)
-- generated 2026-09-19T05:27:33+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_izakaya_table', '居酒屋のテーブル')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('29ae54fd4470a9cd', '会食の席で、上司と部下たちが同じテーブルを囲んでいます。グラスを片手に、ある人がこう話しています。「今年配属されたばかりのみんなが、こうして仕事の話を楽しそうにしているのを見ると安心するよ。困ったことがあったら、いつでも遠慮なく相談してほしい。」この人はどの立場の人ですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('bamen_haaku_J3_002', 'bamen_haaku', 'J3', 'claude-sonnet-5', '2026-09-19T05:27:33+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('b52928d04e', 'bamen_haaku_J3_002', 'bamen_haaku', 'J3', 'dining+superior_to_subordinate+identify_speaker_role@J3', 'dining', 'superior_to_subordinate', 'identify_speaker_role', 'in_person', 'scene_izakaya_table', null, null, '会食で新人をねぎらう上司', '会食の席で、上司と部下たちが同じテーブルを囲んでいます。グラスを片手に、ある人がこう話しています。「今年配属されたばかりのみんなが、こうして仕事の話を楽しそうにしているのを見ると安心するよ。困ったことがあったら、いつでも遠慮なく相談してほしい。」この人はどの立場の人ですか。', 2, '「配属されたばかりのみんな」という三人称の言い方と、「困ったことがあったら相談してほしい」という声かけから、話しているのは部下たちを束ねる上司だと分かる。新入社員本人ならこのような三人称の言い方はしない。幹事の発言は会の進行に関するものになるはずで、ここでは進行の話は一切出ていない。人事部担当者だという情報もどこにも述べられていない。', 'The third-person reference to newly assigned staff and the offer to listen to their concerns mark the speaker as their supervisor.', '[{"term": "配属される", "reading": "はいぞくされる", "meaning": "to be assigned (to a department)"}, {"term": "ねぎらう", "reading": "ねぎらう", "meaning": "to show appreciation for someone''s effort"}, {"term": "遠慮なく", "reading": "えんりょなく", "meaning": "without hesitation"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '29ae54fd4470a9cd', 1.0)
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
delete from public.item_options where item_id in ('b52928d04e');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('b52928d04e', 0, '人事部から出席している担当者', 'plausible_but_unmentioned', '配属や相談という話題から人事部を連想しやすいが、人事部から来たことは一言も述べられていない。', null),
       ('b52928d04e', 1, '会の進行を仕切る幹事役の若手社員', 'adjacent_setting', '乾杯や締めの挨拶をする幹事の言葉ではなく、部下の様子を見て安心するという上司特有の視点で話しており、幹事の発言ではない。', null),
       ('b52928d04e', 2, '部下たちをまとめる立場の上司', 'correct', '「配属されたばかりのみんな」と部下を三人称で指し、彼らの様子を見て安心し相談を促す言い方から、まとめる立場の上司だと分かる。', null),
       ('b52928d04e', 3, '今年配属されたばかりの新入社員本人', 'wrong_participant', '「配属されたばかりのみんな」と話している対象として三人称で言及されており、話している本人がその新入社員ではあり得ない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
