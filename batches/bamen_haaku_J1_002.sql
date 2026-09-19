-- bamen_haaku_J1_002: 1 × bamen_haaku (J1)
-- generated 2026-09-19T05:25:46+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_meeting_room_table', '社内の会議室のテーブル')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('b7a731f4df058d8f', '社内の会議室で、上司が部下に人事評価の資料を見せながら、こう話しています。「この部屋、さっき総務に頼んで鍵を借りてきたんだ。うちの部署でしばらく押さえてあるから、周りを気にせず話せるよ。壁のホワイトボードに書いてある来週の予定はそのままにしておいて。」ここはどこで話していますか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('bamen_haaku_J1_002', 'bamen_haaku', 'J1', 'claude-sonnet-5', '2026-09-19T05:25:46+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('c21b2af994', 'bamen_haaku_J1_002', 'bamen_haaku', 'J1', 'meeting_room+superior_to_subordinate+identify_place@J1', 'meeting_room', 'superior_to_subordinate', 'identify_place', 'in_person', 'scene_meeting_room_table', null, null, '人事評価の面談で会議室に入る', '社内の会議室で、上司が部下に人事評価の資料を見せながら、こう話しています。「この部屋、さっき総務に頼んで鍵を借りてきたんだ。うちの部署でしばらく押さえてあるから、周りを気にせず話せるよ。壁のホワイトボードに書いてある来週の予定はそのままにしておいて。」ここはどこで話していますか。', 2, '「うちの部署でしばらく押さえてある」「壁のホワイトボード」という発言から、社内の、自分の部署が確保した会議室にいることが分かる。総務課の窓口は鍵を借りる段階の話で、すでに「借りてきた」と過去形になっているため今の場所ではない。応接室は取引先を迎える場所であり、社内利用とは矛盾する。個人オフィスなら「押さえてある」という部署単位の言い方は不自然。', 'The phrase ''our department has it reserved'' plus the whiteboard detail place the speakers in an internal meeting room, not the reception room, the general affairs desk, or a personal office.', '[{"term": "押さえる", "reading": "おさえる", "meaning": "to reserve/secure (a room, time)"}, {"term": "総務", "reading": "そうむ", "meaning": "general affairs department"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'b7a731f4df058d8f', 1.0)
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
delete from public.item_options where item_id in ('c21b2af994');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('c21b2af994', 0, '上司の個人オフィス', 'plausible_but_unmentioned', '個人的な部屋なら普通は本人の裁量で使え、「うちの部署で押さえてある」とはあえて言わない言い方であり、話の内容とも合わない。', null),
       ('c21b2af994', 1, '鍵を借りに行った総務課の窓口', 'right_scene_wrong_moment', '鍵を借りるくだりは出てくるが「借りてきたんだ」と過去形で済んでおり、今いるのはすでに部屋に入った後の会議室である。', null),
       ('c21b2af994', 2, '社内の会議室', 'correct', '「うちの部署でしばらく押さえてある」「壁のホワイトボード」という言い方から、自社内の、部署で確保した会議室だと分かる。', null),
       ('c21b2af994', 3, '取引先を迎える応接室', 'wrong_participant', '応接室なら取引先を迎える場になるが、上司は「うちの部署で押さえてある」と社内利用の言い方をしており、取引先を迎える話は出ていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
