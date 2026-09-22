-- hyougen_J3_002: 1 × hyougen (J3)
-- generated 2026-09-22T20:45:40+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hyougen_J3_002', 'hyougen', 'J3', 'claude-sonnet-5', '2026-09-22T20:45:40+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('97f123223d', 'hyougen_J3_002', 'hyougen', 'J3', 'chat_internal+peer_to_peer+request@J3', 'chat_internal', 'peer_to_peer', 'request', 'written', null, null, null, '社内チャットで同僚に資料チェックを依頼する', '社内チャットで、同じ課の同僚に、明日提出する資料の数字チェックを今日中にしてほしいと頼みます。最も適切な表現はどれですか。', 3, '同僚への依頼は、内容と期限を示したうえで疑問形にし、相手が引き受けやすい形にする。「よろしく」だけでは何をいつまでにという依頼の中身が伝わらず素っ気ない。「していただき、ありがとうございます」はすでに終わったことへの感謝であり、これから頼む場面には合わない。「させていただけますか」は自分がチェックする許可を求める形で、相手に行為を求める依頼とは向きが逆になっている。', 'A peer request states the task and deadline in a question form; thanking for a finished action or asking permission to act oneself both fail as a forward-looking request.', '[{"term": "お願いできる？", "reading": "おねがいできる？", "meaning": "could you do this for me? (casual-polite request among peers)"}, {"term": "させていただけますか", "reading": "させていただけますか", "meaning": "may I be allowed to do ~ (asks permission for one''s own action)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, 1.0)
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
delete from public.item_options where item_id in ('97f123223d');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('97f123223d', 0, '資料チェック、よろしく。', 'register_too_casual', '何を今日中にしてほしいのかという依頼の形になっておらず、命令に近い言い切りで、チャットの文としても素っ気なさすぎる。', null),
       ('97f123223d', 1, '資料のチェックをしていただき、ありがとうございます。', 'correct_keigo_wrong_speech_act', '敬語は整っているが、相手がすでにチェックを終えたことへの感謝の言葉になっており、これから頼む場面の依頼にはなっていない。', null),
       ('97f123223d', 2, '資料のチェックをさせていただけますか。', 'wrong_honorific_direction', '「させていただく」は自分がチェックする許可を求める形で、相手にチェックしてほしいという依頼とは行為の向きが逆になっている。', null),
       ('97f123223d', 3, '資料のチェック、今日中にお願いできる？', 'correct', '依頼の内容と期限を示しつつ疑問形で相手に判断を委ねており、同僚同士のチャットとして丁寧さと親しさのバランスが取れている。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
