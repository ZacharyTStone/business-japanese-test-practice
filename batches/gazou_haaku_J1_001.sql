-- gazou_haaku_J1_001: 1 × gazou_haaku (J1)
-- generated 2026-09-27T20:32:15+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('pic_643098801f', '社内書類への押印')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('700fd7b1f7af313d', '机に座っている人は何をしていますか。', 'narrator_f', 'in_person'),
       ('25c7c1a4fbc76235', 'いち', 'narrator_f', 'in_person'),
       ('75e51f06c29bf14f', '書類にサインをしています。', 'narrator_f', 'in_person'),
       ('6e34bf5479a4824e', 'に', 'narrator_f', 'in_person'),
       ('466cbf757d61d8e3', '受付で来客の書類に確認の印を押しています。', 'narrator_f', 'in_person'),
       ('a94822f17a881031', 'さん', 'narrator_f', 'in_person'),
       ('86d1c2b4a98d515d', '書類に印を押しています。', 'narrator_f', 'in_person'),
       ('5577d7cacee29a6c', 'よん', 'narrator_f', 'in_person'),
       ('8697cd6869442220', '同僚に印を押してもらっています。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('gazou_haaku_J1_001', 'gazou_haaku', 'J1', 'claude-sonnet-5', '2026-09-27T20:32:15+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('643098801f', 'gazou_haaku_J1_001', 'gazou_haaku', 'J1', 'office_floor+peer_to_peer+stamping_document@J1', 'office_floor', 'peer_to_peer', 'stamping_document', 'in_person', 'pic_643098801f', null, null, '社内書類への押印', '机に座っている人は何をしていますか。', 2, '座っている人がはんこを紙に押し当て、もう一方の手で紙を押さえているので、書類に印を押している場面である。ペンで署名している様子はなく、はんこを持って押しているのは座っている本人で、立っている同僚は押していない。また場所は受付ではなく執務フロアの机であり、来客も描かれていない。', 'The seated colleague presses a hanko stamp onto a held-down document, so the correct description is ''stamping the document''; the other options misstate the action, reverse who is stamping, or move the scene to a reception desk.', '[{"term": "印を押す", "reading": "いんをおす", "meaning": "to stamp a seal"}, {"term": "朱肉", "reading": "しゅにく", "meaning": "red ink pad used for hanko stamps"}, {"term": "押印", "reading": "おういん", "meaning": "affixing a seal/stamp"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '700fd7b1f7af313d', 1.0)
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
delete from public.item_options where item_id in ('643098801f');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('643098801f', 0, '書類にサインをしています。', 'different_action', '手にあるのはペンではなくはんこで、紙の上には署名ではなく印影を残す動作が描かれている。', '75e51f06c29bf14f'),
       ('643098801f', 1, '受付で来客の書類に確認の印を押しています。', 'adjacent_setting', '場所は受付カウンターではなく机が並ぶ執務フロアで、来客の姿はない。', '466cbf757d61d8e3'),
       ('643098801f', 2, '書類に印を押しています。', 'correct', '座っている人が朱肉の付いたはんこを紙に押し当てており、もう一方の手で紙を押さえている。', '86d1c2b4a98d515d'),
       ('643098801f', 3, '同僚に印を押してもらっています。', 'wrong_participants', 'はんこを持って押しているのは座っている本人で、立っている同僚は書類に触れていない。', '8697cd6869442220')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
