-- hyougen_J3_002: 1 × hyougen (J3)
-- generated 2026-09-24T21:02:48+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hyougen_J3_002', 'hyougen', 'J3', 'claude-sonnet-5', '2026-09-24T21:02:48+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('5a335f190a', 'hyougen_J3_002', 'hyougen', 'J3', 'meeting_room+superior_to_subordinate+confirm@J3', 'meeting_room', 'superior_to_subordinate', 'confirm', 'in_person', null, null, null, '会議前に部下へ資料準備を確認する', '会議開始直前、会議室で課長が部下に、配布する資料の準備が終わっているかを確認します。最も適切な表現はどれですか。', 0, '上司から部下への確認は、平易な丁寧体で状況をそのまま尋ねればよい。「ご用意いただけますでしょうか」は敬語として正しいが依頼の形であり、まだ準備できていないという前提を作ってしまうため確認にならない。「できた?もうすぐ始まるけど」は内容は合っているが会議室での発話としてくだけすぎている。「拝見しましたか」は謙譲語を相手の行為に向けており、敬意の方向が逆になっている。', 'A supervisor confirming with a subordinate uses a plain polite question about the current state, not a request, casual speech, or a humble verb misapplied to the listener''s action.', '[{"term": "配布資料", "reading": "はいふしりょう", "meaning": "handout materials"}, {"term": "拝見する", "reading": "はいけんする", "meaning": "to see/look at (humble form for one''s own action)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, 1.0)
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
delete from public.item_options where item_id in ('5a335f190a');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('5a335f190a', 0, '資料の準備はできていますか。', 'correct', '部下への確認として簡潔で丁寧さも過不足なく、状況の確認という目的に合っている。', null),
       ('5a335f190a', 1, '資料、ご用意いただけますでしょうか。', 'correct_keigo_wrong_speech_act', '敬語は整っているが、これから用意してほしいという依頼の形になっており、準備済みかどうかを尋ねる確認にはなっていない。', null),
       ('5a335f190a', 2, '資料、できた?もうすぐ始まるけど。', 'register_too_casual', '内容は確認だが、会議室での上司から部下への発話としては友人同士のようなくだけた言い方になっている。', null),
       ('5a335f190a', 3, '資料はもう拝見しましたか。', 'wrong_honorific_direction', '「拝見」は自分の行為をへりくだる謙譲語で、部下が資料を見たかどうかを尋ねる場面で使うと敬意の向きが逆になる。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
