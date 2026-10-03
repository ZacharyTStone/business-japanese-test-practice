-- gazou_haaku_J3_001: 1 × gazou_haaku (J3)
-- generated 2026-10-03T19:18:12+00:00 by claude-sonnet-5
-- Produced by bjt publish. Idempotent: re-running replaces these rows.

-- Scenes are a shared bank (or, for 画像把握, one picture per item),
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into scenes (id, label_ja) values ('pic_2b3e3869ff', 'オフィス移転に伴う什器の運搬') on conflict (id) do update set label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into audio_clips (id, text, voice, channel) values ('c064ca96bc75914f', '矢印の左側の人は何をしていますか。', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('25c7c1a4fbc76235', 'いち', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('f3afb28806141469', '搬入口でトラックから段ボール箱を降ろしています。', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('6e34bf5479a4824e', 'に', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('d62b5c4039bf1d96', '段ボール箱を両手で抱えてエレベーターのほうへ歩いています。', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('a94822f17a881031', 'さん', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('928767f56e8b66ef', '台車に段ボール箱を乗せて押して運んでいます。', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('5577d7cacee29a6c', 'よん', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('969b493125a98d0c', 'エレベーターの扉を押さえています。', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;

insert into bundles (id, item_type, level, generator_model, generated_at) values ('gazou_haaku_J3_001', 'gazou_haaku', 'J3', 'claude-sonnet-5', '2026-10-03T19:18:12+00:00') on conflict (id) do update set item_type = excluded.item_type, level = excluded.level, generator_model = excluded.generator_model, generated_at = excluded.generated_at;

insert into items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct) values ('2b3e3869ff', 'gazou_haaku_J3_001', 'gazou_haaku', 'J3', 'corridor+peer_to_peer+carrying_boxes@J3', 'corridor', 'peer_to_peer', 'carrying_boxes', 'in_person', 'pic_2b3e3869ff', null, null, 'オフィス移転に伴う什器の運搬', '矢印の左側の人は何をしていますか。', 1, '左の人が段ボール箱を両手で抱え、エレベーターの扉のほうへ体を向けて歩いているので、正解は「段ボール箱を抱えてエレベーターのほうへ歩いている」。台車は絵の中に存在せず、別の運び方を示す選択肢は誤り。扉を押さえているのは右の人であり、左の人の動作として述べるのは人物の取り違え。また場面はエレベーターホールであり、トラックや搬入口は描かれていないため、その選択肢も誤りとなる。', 'The left colleague is carrying a cardboard box with both hands toward the elevator doors; no cart, no door-holding by that person, and no loading dock are shown, so the other three options fail.', '[{"term": "段ボール箱", "reading": "だんぼーるばこ", "meaning": "cardboard box"}, {"term": "搬入口", "reading": "はんにゅうぐち", "meaning": "loading/delivery entrance"}, {"term": "台車", "reading": "だいしゃ", "meaning": "hand cart/dolly"}, {"term": "エレベーターホール", "reading": "えれべーたーほーる", "meaning": "elevator hall/lobby"}]', '[]', '[]', 'c064ca96bc75914f', 1.0) on conflict (id) do update set bundle_id = excluded.bundle_id, item_type = excluded.item_type, level = excluded.level, seed_cell_id = excluded.seed_cell_id, setting = excluded.setting, relation = excluded.relation, function = excluded.function, channel = excluded.channel, scene_id = excluded.scene_id, speaker_role = excluded.speaker_role, listener_role = excluded.listener_role, topic = excluded.topic, stem = excluded.stem, correct_index = excluded.correct_index, explanation_ja = excluded.explanation_ja, explanation_en = excluded.explanation_en, vocab_notes = excluded.vocab_notes, documents = excluded.documents, dialogue = excluded.dialogue, narration_clip_id = excluded.narration_clip_id, model_p_correct = excluded.model_p_correct;

-- Options are replaced wholesale rather than upserted: a corrected item can
-- have fewer options or a different order, and a stale row left behind would
-- be a fifth answer nobody meant to publish.
delete from item_options where item_id in ('2b3e3869ff');
insert into item_options (item_id, position, text, role, why, clip_id) values ('2b3e3869ff', 0, '搬入口でトラックから段ボール箱を降ろしています。', 'adjacent_setting', '場面はエレベーターホールであり、トラックや搬入口の扉は描かれていない。', 'f3afb28806141469') on conflict (item_id, position) do update set text = excluded.text, role = excluded.role, why = excluded.why, clip_id = excluded.clip_id;
insert into item_options (item_id, position, text, role, why, clip_id) values ('2b3e3869ff', 1, '段ボール箱を両手で抱えてエレベーターのほうへ歩いています。', 'correct', '左の人が段ボール箱を両腕で抱え、体をエレベーターのドアのほうへ向けて歩き出している。', 'd62b5c4039bf1d96') on conflict (item_id, position) do update set text = excluded.text, role = excluded.role, why = excluded.why, clip_id = excluded.clip_id;
insert into item_options (item_id, position, text, role, why, clip_id) values ('2b3e3869ff', 2, '台車に段ボール箱を乗せて押して運んでいます。', 'different_action', '台車は描かれておらず、左の人は箱を両手で直接抱えている。', '928767f56e8b66ef') on conflict (item_id, position) do update set text = excluded.text, role = excluded.role, why = excluded.why, clip_id = excluded.clip_id;
insert into item_options (item_id, position, text, role, why, clip_id) values ('2b3e3869ff', 3, 'エレベーターの扉を押さえています。', 'wrong_participants', '扉を手で押さえているのは右の人で、左の人は箱を抱えたまま歩いている。', '969b493125a98d0c') on conflict (item_id, position) do update set text = excluded.text, role = excluded.role, why = excluded.why, clip_id = excluded.clip_id;

