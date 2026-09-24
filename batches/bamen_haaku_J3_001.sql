-- bamen_haaku_J3_001: 2 × bamen_haaku (J3)
-- generated 2026-09-19T17:03:52+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_office_open_floor', '執務フロア全体'),
       ('scene_phone_mobile_outside', '外出先で携帯電話')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('004fa50818a8258a', '執務フロアで、他の部署の人が席に来て、こう話しています。「お忙しいところすみません。先ほどメールでお送りした件ですが、今、少しお時間よろしいでしょうか。」これはやりとりのどの段階ですか。', 'narrator_f', 'in_person'),
       ('25c7c1a4fbc76235', 'いち', 'narrator_f', 'in_person'),
       ('640d84d8044b8a4d', '相手のほうが、時間を取ってほしいと頼んでいる段階', 'narrator_f', 'in_person'),
       ('6e34bf5479a4824e', 'に', 'narrator_f', 'in_person'),
       ('7bb63e3c4b9827f2', 'これから話を始めようとしている段階', 'narrator_f', 'in_person'),
       ('a94822f17a881031', 'さん', 'narrator_f', 'in_person'),
       ('0d607d81478dfa98', '話が終わって、礼を言っている段階', 'narrator_f', 'in_person'),
       ('5577d7cacee29a6c', 'よん', 'narrator_f', 'in_person'),
       ('69f556d7510421e5', 'メールの内容について意見が分かれている段階', 'narrator_f', 'in_person'),
       ('6fd5ad68198fc535', '外出中の部下が、会社の上司に電話をかけています。「課長、お疲れさまです。今、駅に着きました。先方との打ち合わせは三時からですが、資料を会社に忘れてしまいました。」「分かった。資料は今から私が先方にメールで送っておく。君はそのまま向かいなさい。」部下はこのあと何をしますか。', 'narrator_f', 'in_person'),
       ('03037804a4f80b7c', '会社に戻って、資料を取ってくる。', 'narrator_f', 'in_person'),
       ('0556719ed59b9f4e', '先方に資料をメールで送る。', 'narrator_f', 'in_person'),
       ('28e923817b11b472', '駅の近くで資料を印刷してから、先方へ向かう。', 'narrator_f', 'in_person'),
       ('e3b20f3db9cb6e85', 'そのまま先方の会社へ向かう。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('bamen_haaku_J3_001', 'bamen_haaku', 'J3', 'manual-load', '2026-09-19T17:03:52+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('b9e1673422', 'bamen_haaku_J3_001', 'bamen_haaku', 'J3', 'office_floor+other_department+identify_stage@J3', 'office_floor', 'other_department', 'identify_stage', 'in_person', 'scene_office_open_floor', null, null, '他部署の人に声をかける', '執務フロアで、他の部署の人が席に来て、こう話しています。「お忙しいところすみません。先ほどメールでお送りした件ですが、今、少しお時間よろしいでしょうか。」これはやりとりのどの段階ですか。', 1, '「今、少しお時間よろしいでしょうか」は、話を始める前に相手の都合を聞く決まった言い方。「お忙しいところすみません」だけでは始まりか終わりか分からないが、そのあとに時間を聞いているので、これから話が始まる。メールの中身はまだ出ていない。', 'Asking 少しお時間よろしいでしょうか comes before a conversation starts, not after it ends.', '[{"term": "お忙しいところ", "reading": "おいそがしいところ", "meaning": "(sorry to bother you) while you are busy"}, {"term": "件", "reading": "けん", "meaning": "matter / case"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '004fa50818a8258a', null),
       ('32efa89696', 'bamen_haaku_J3_001', 'bamen_haaku', 'J3', 'phone_desk+subordinate_to_superior+identify_next_action@J3', 'phone_desk', 'subordinate_to_superior', 'identify_next_action', 'phone', 'scene_phone_mobile_outside', null, null, '資料を忘れて上司に電話する', '外出中の部下が、会社の上司に電話をかけています。「課長、お疲れさまです。今、駅に着きました。先方との打ち合わせは三時からですが、資料を会社に忘れてしまいました。」「分かった。資料は今から私が先方にメールで送っておく。君はそのまま向かいなさい。」部下はこのあと何をしますか。', 3, '上司の返事には二つのことが入っている。「私が送っておく」は上司がすること、「君はそのまま向かいなさい」は部下がすること。問われているのは部下の行動なので、そのまま先方へ向かう。会社に戻ることも、駅の近くで印刷することも言われていない。', 'The manager''s reply assigns one action to each person; the question asks for the subordinate''s.', '[{"term": "先方", "reading": "せんぽう", "meaning": "the other party / the client"}, {"term": "向かう", "reading": "むかう", "meaning": "to head toward"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '6fd5ad68198fc535', null)
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
delete from public.item_options where item_id in ('b9e1673422', '32efa89696');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('b9e1673422', 0, '相手のほうが、時間を取ってほしいと頼んでいる段階', 'wrong_participant', '時間を頼んでいるのは話しかけた側で、相手はまだ何も言っていない。', '640d84d8044b8a4d'),
       ('b9e1673422', 1, 'これから話を始めようとしている段階', 'correct', '「今、少しお時間よろしいでしょうか」は、話を始める前に相手の都合を確かめる言い方。', '7bb63e3c4b9827f2'),
       ('b9e1673422', 2, '話が終わって、礼を言っている段階', 'right_scene_wrong_moment', '「お忙しいところすみません」は話の終わりにも使うが、ここでは続けて時間があるかを聞いており、まだ話は始まっていない。', '0d607d81478dfa98'),
       ('b9e1673422', 3, 'メールの内容について意見が分かれている段階', 'plausible_but_unmentioned', 'メールの件だとは言っているが、内容も意見の違いも何も述べられていない。', '69f556d7510421e5'),
       ('32efa89696', 0, '会社に戻って、資料を取ってくる。', 'right_scene_wrong_moment', '忘れ物をしたときに考えやすい行動だが、上司はそうせず、そのまま向かうように言っている。', '03037804a4f80b7c'),
       ('32efa89696', 1, '先方に資料をメールで送る。', 'wrong_participant', 'メールで送るのは上司のほうで、部下がすることではない。', '0556719ed59b9f4e'),
       ('32efa89696', 2, '駅の近くで資料を印刷してから、先方へ向かう。', 'adjacent_setting', '駅の近くで済ませる方法としてはありそうだが、資料は上司がメールで送ることになっており、印刷の話は出ていない。', '28e923817b11b472'),
       ('32efa89696', 3, 'そのまま先方の会社へ向かう。', 'correct', '上司が「君はそのまま向かいなさい」と、部下のすることをはっきり指示している。', 'e3b20f3db9cb6e85')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
