-- bamen_haaku_J1_003: 1 × bamen_haaku (J1)
-- generated 2026-10-08T21:25:42+00:00 by claude-sonnet-5
-- Produced by bjt publish. Idempotent: re-running replaces these rows.

-- Scenes are a shared bank (or, for 画像把握, one picture per item),
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into scenes (id, label_ja) values ('scene_video_call_laptop', 'ノートPCでオンライン会議') on conflict (id) do update set label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into audio_clips (id, text, voice, channel) values ('7697df97dbed55b7', 'オンライン会議で、ある人がこう話しています。「先日はお忙しい中、資料のまとめ方を一から教えていただき、本当に助かりました。おかげさまで、先週の部内会議での発表は無事に終わりました。改めてお礼申し上げます。」この人は誰に向かって話していますか。', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('25c7c1a4fbc76235', 'いち', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('da9b1e734101077f', '取引先の担当者', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('6e34bf5479a4824e', 'に', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('9b5512a874a866fe', '他部署の先輩', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('a94822f17a881031', 'さん', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('83393fbe7d77651e', '直属の上司である課長', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('5577d7cacee29a6c', 'よん', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;
insert into audio_clips (id, text, voice, channel) values ('4cce692797ada6ab', '同じ部署の先輩', 'narrator_f', 'in_person') on conflict (id) do update set text = excluded.text, voice = excluded.voice, channel = excluded.channel;

insert into bundles (id, item_type, level, generator_model, generated_at) values ('bamen_haaku_J1_003', 'bamen_haaku', 'J1', 'claude-sonnet-5', '2026-10-08T21:25:42+00:00') on conflict (id) do update set item_type = excluded.item_type, level = excluded.level, generator_model = excluded.generator_model, generated_at = excluded.generated_at;

insert into items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct) values ('56d2848650', 'bamen_haaku_J1_003', 'bamen_haaku', 'J1', 'video_call+junior_to_senior+identify_listener_role@J1', 'video_call', 'junior_to_senior', 'identify_listener_role', 'video', 'scene_video_call_laptop', null, null, 'オンライン会議で指導への礼を述べる', 'オンライン会議で、ある人がこう話しています。「先日はお忙しい中、資料のまとめ方を一から教えていただき、本当に助かりました。おかげさまで、先週の部内会議での発表は無事に終わりました。改めてお礼申し上げます。」この人は誰に向かって話していますか。', 3, '「教えていただき」「お礼申し上げます」という謙譲表現と、「先週の部内会議での発表」という部署内の出来事が結び付いており、話し手は自分の部署の先輩に向けて礼を述べていると分かる。取引先であれば社内の部内会議の話はしない。他部署の先輩では部内会議との結び付きが説明できない。上司（課長）である可能性は否定できないが、本文に役職への言及は一切なく、単なる思い込みにすぎない。', 'The internal 部内会議 reference ties the thank-you to a senior colleague in the same department, ruling out a client, a senior from another department, or an assumed manager title never mentioned.', '[{"term": "教えていただく", "reading": "おしえていただく", "meaning": "to have someone kindly teach (humble receptive form)"}, {"term": "部内会議", "reading": "ぶないかいぎ", "meaning": "internal department meeting"}]', '[]', '[]', '7697df97dbed55b7', 0.53) on conflict (id) do update set bundle_id = excluded.bundle_id, item_type = excluded.item_type, level = excluded.level, seed_cell_id = excluded.seed_cell_id, setting = excluded.setting, relation = excluded.relation, function = excluded.function, channel = excluded.channel, scene_id = excluded.scene_id, speaker_role = excluded.speaker_role, listener_role = excluded.listener_role, topic = excluded.topic, stem = excluded.stem, correct_index = excluded.correct_index, explanation_ja = excluded.explanation_ja, explanation_en = excluded.explanation_en, vocab_notes = excluded.vocab_notes, documents = excluded.documents, dialogue = excluded.dialogue, narration_clip_id = excluded.narration_clip_id, model_p_correct = excluded.model_p_correct;

-- Options are replaced wholesale rather than upserted: a corrected item can
-- have fewer options or a different order, and a stale row left behind would
-- be a fifth answer nobody meant to publish.
delete from item_options where item_id in ('56d2848650');
insert into item_options (item_id, position, text, role, why, clip_id) values ('56d2848650', 0, '取引先の担当者', 'wrong_participant', '自社の部内会議の準備を教わったという内容で、社外の取引先に向けて述べる話ではない。', 'da9b1e734101077f') on conflict (item_id, position) do update set text = excluded.text, role = excluded.role, why = excluded.why, clip_id = excluded.clip_id;
insert into item_options (item_id, position, text, role, why, clip_id) values ('56d2848650', 1, '他部署の先輩', 'adjacent_setting', '先輩に向けた礼ではあるが、話題が自分の部署の部内会議であり、他部署の先輩が教えたという説明にはならない。', '9b5512a874a866fe') on conflict (item_id, position) do update set text = excluded.text, role = excluded.role, why = excluded.why, clip_id = excluded.clip_id;
insert into item_options (item_id, position, text, role, why, clip_id) values ('56d2848650', 2, '直属の上司である課長', 'plausible_but_unmentioned', '指導や礼を述べる相手として自然だが、相手が上司であるとも課長であるとも一切述べられていない。', '83393fbe7d77651e') on conflict (item_id, position) do update set text = excluded.text, role = excluded.role, why = excluded.why, clip_id = excluded.clip_id;
insert into item_options (item_id, position, text, role, why, clip_id) values ('56d2848650', 3, '同じ部署の先輩', 'correct', '部内会議の発表に向けて資料のまとめ方を教わったと礼を述べており、同じ部署内で指導してくれた先輩に向けた話である。', '4cce692797ada6ab') on conflict (item_id, position) do update set text = excluded.text, role = excluded.role, why = excluded.why, clip_id = excluded.clip_id;

-- Withdrawn after review: batches/withdrawn.txt says why. An unpublish,
-- never a delete, so every answer already given keeps resolving. Nothing
-- here ever sets is_published back to 1: a question the owner vetoed
-- in the app stays vetoed however often this file is applied.
update items set is_published = 0
 where id in ('56d2848650');

