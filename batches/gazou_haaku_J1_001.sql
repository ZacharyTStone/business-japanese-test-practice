-- gazou_haaku_J1_001: 1 × gazou_haaku (J1)
-- generated 2026-09-22T20:44:38+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('pic_2cf468fc3d', 'セミナー会場でメモを取る')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('03c83634f156e162', '左の人は何をしていますか。', 'narrator_f', 'in_person'),
       ('d08f3de5649eec59', 'エー', 'narrator_f', 'in_person'),
       ('49cd8a8aef42c8d3', '右の人がメモを取りながら話を聞いています。', 'narrator_f', 'in_person'),
       ('da4df49bf7f00ab2', 'ビー', 'narrator_f', 'in_person'),
       ('62743f260f205fbc', '展示ブースで来場者に商品を説明しています。', 'narrator_f', 'in_person'),
       ('d690aea8d6cb91f1', 'シー', 'narrator_f', 'in_person'),
       ('c2ac6401a66a5061', '配布資料を隣の人に手渡しています。', 'narrator_f', 'in_person'),
       ('134df096a9c7dc0a', 'デー', 'narrator_f', 'in_person'),
       ('863a94197e34572e', '手帳にメモを取りながら話を聞いています。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('gazou_haaku_J1_001', 'gazou_haaku', 'J1', 'claude-sonnet-5', '2026-09-22T20:44:38+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('2cf468fc3d', 'gazou_haaku_J1_001', 'gazou_haaku', 'J1', 'event_venue+peer_to_peer+taking_notes_in_meeting@J1', 'event_venue', 'peer_to_peer', 'taking_notes_in_meeting', 'in_person', 'pic_2cf468fc3d', null, null, 'セミナー会場でメモを取る', '左の人は何をしていますか。', 3, '左の人がペンを持ち手帳に書き込みながら前のスクリーンを見ているので、話を聞きながらメモを取っている場面。資料を配ったり渡したりする様子はなく、メモを取っているのは右の人ではなく左の人であり、場所は展示ブースではなくセミナー会場の座席である。', 'The person on the left holds a pen and writes in a notebook while facing the front, showing note-taking during a talk, not handing out papers or the person on the right taking notes.', '[{"term": "メモを取る", "reading": "めもをとる", "meaning": "to take notes"}, {"term": "配布資料", "reading": "はいふしりょう", "meaning": "handout materials"}, {"term": "展示ブース", "reading": "てんじぶーす", "meaning": "exhibition booth"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '03c83634f156e162', 1.0)
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
delete from public.item_options where item_id in ('2cf468fc3d');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('2cf468fc3d', 0, '右の人がメモを取りながら話を聞いています。', 'wrong_participants', '手帳とペンを持っているのは左の人で、右の人は腕を組んで座っているだけ。', '49cd8a8aef42c8d3'),
       ('2cf468fc3d', 1, '展示ブースで来場者に商品を説明しています。', 'adjacent_setting', '場所は展示ブースではなくセミナー会場の座席で、二人とも聴衆として座っている。', '62743f260f205fbc'),
       ('2cf468fc3d', 2, '配布資料を隣の人に手渡しています。', 'different_action', '手にあるのはペンと手帳で、資料らしき物を持ったり渡したりはしていない。', 'c2ac6401a66a5061'),
       ('2cf468fc3d', 3, '手帳にメモを取りながら話を聞いています。', 'correct', '左の人がペンを持ち手帳に何か書きながら、前のスクリーンのほうを見ている。', '863a94197e34572e')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
