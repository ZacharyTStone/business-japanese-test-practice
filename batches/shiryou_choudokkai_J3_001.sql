-- shiryou_choudokkai_J3_001: 2 × shiryou_choudokkai (J3)
-- generated 2026-09-18T08:50:50+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('03fe192dcea39264', 'オンライン会議で、人事部の担当者が画面に予定表を映しながらこう言いました。「一つ変更があります。基礎研修の二日目ですが、第一会議室が使えなくなったので、第三会議室に変わります。時間は同じです。」十月八日の研修はどこで行いますか。', 'narrator_f', 'in_person'),
       ('8aeeb45217f779a4', 'お客様から電話がありました。「カタログの件でメールをいただきました。二回目の、十七日に届くのは何部でしょうか。」十七日に届くのは何部ですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J3_001', 'shiryou_choudokkai', 'J3', 'manual-load', '2026-09-18T08:50:50+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('3abf299a57', 'shiryou_choudokkai_J3_001', 'shiryou_choudokkai', 'J3', 'video_shared_doc+other_department+apply_spoken_change@J3', 'video_shared_doc', 'other_department', 'apply_spoken_change', 'video', 'scene_video_call_laptop', null, null, '研修の場所が変わる', 'オンライン会議で、人事部の担当者が画面に予定表を映しながらこう言いました。「一つ変更があります。基礎研修の二日目ですが、第一会議室が使えなくなったので、第三会議室に変わります。時間は同じです。」十月八日の研修はどこで行いますか。', 1, '話し手は「二日目」と言い、日付は言っていない。予定表で二日目が十月八日だと分かり、その場所が第一会議室から第三会議室に変わる。予定表だけでは変更が分からず、話だけでは二日目がどの日か分からない。', 'The speaker says day two, not the date; the sheet maps day two to October 8, and the room change is spoken only.', '[{"term": "研修", "reading": "けんしゅう", "meaning": "training"}, {"term": "変更", "reading": "へんこう", "meaning": "change"}]'::jsonb, '[{"template": "schedule", "title": "十月 新人研修 予定表", "meta": [{"label": "期間", "value": "十月七日（火）〜九日（木）"}, {"label": "作成者", "value": "人事部 山本"}], "blocks": [{"type": "table", "columns": ["日付", "内容", "場所"], "rows": [["十月七日（火）", "基礎研修 一日目", "第二会議室"], ["十月八日（水）", "基礎研修 二日目", "第一会議室"], ["十月九日（木）", "実技研修", "研修センター"]]}, {"type": "key_values", "pairs": [{"label": "時間", "value": "各日 九時三十分〜十六時三十分"}]}]}]'::jsonb, '[]'::jsonb, '03fe192dcea39264', null),
       ('aa772d5814', 'shiryou_choudokkai_J3_001', 'shiryou_choudokkai', 'J3', 'delivery_email+staff_to_customer+find_the_quantity@J3', 'delivery_email', 'staff_to_customer', 'find_the_quantity', 'phone', 'scene_phone_desk', null, null, '二回目に届く部数', 'お客様から電話がありました。「カタログの件でメールをいただきました。二回目の、十七日に届くのは何部でしょうか。」十七日に届くのは何部ですか。', 3, 'メールには「三百部」「十日に二百部」「十七日に残り」とあり、残りの数は書かれていない。電話で聞かれたのは十七日の分なので、三百から二百を引いて百部。メールだけでは何を聞かれているか分からず、電話だけでは数が分からない。', 'The email gives the total and the first delivery; the remainder for the seventeenth has to be computed.', '[{"term": "部", "reading": "ぶ", "meaning": "counter for copies (of a catalogue)"}, {"term": "残り", "reading": "のこり", "meaning": "the remainder"}]'::jsonb, '[{"template": "email_external", "title": "カタログの納品日について", "meta": [{"label": "差出人", "value": "山川商事 営業部 佐藤"}, {"label": "宛先", "value": "あさひ工業 総務部 鈴木様"}, {"label": "件名", "value": "カタログの納品日について"}, {"label": "日時", "value": "九月八日 十時"}], "blocks": [{"type": "paragraph", "text": "ご注文のカタログ三百部は、二回に分けてお届けします。"}, {"type": "bullets", "items": ["九月十日：二百部", "九月十七日：残りの部数"]}, {"type": "paragraph", "text": "どうぞよろしくお願いいたします。"}]}]'::jsonb, '[]'::jsonb, '8aeeb45217f779a4', null)
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
delete from public.item_options where item_id in ('3abf299a57', 'aa772d5814');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('3abf299a57', 0, '研修センター', 'surface_keyword_match', '「研修」という言葉は同じだが、これは九日の実技研修の場所で、二日目の話ではない。', null),
       ('3abf299a57', 1, '第三会議室', 'correct', '十月八日は予定表で基礎研修の二日目にあたり、その場所が口頭で第三会議室に変わると言われた。', null),
       ('3abf299a57', 2, '第一会議室', 'ignores_the_spoken_change', '予定表に書かれているままの場所で、使えなくなったという話を聞いていない。', null),
       ('3abf299a57', 3, '第二会議室', 'reads_wrong_row', '一日目の場所で、十月八日の行ではない。', null),
       ('aa772d5814', 0, '二百部', 'reads_wrong_row', 'これは十日に届く一回目の部数で、聞かれている十七日の分ではない。', null),
       ('aa772d5814', 1, '三百部', 'wrong_timeframe', '注文全体の部数で、二回に分けて届くうちの十七日の分ではない。', null),
       ('aa772d5814', 2, '十七部', 'surface_keyword_match', '「十七」は日付の数字で、部数ではない。', null),
       ('aa772d5814', 3, '百部', 'correct', '全部で三百部のうち、十日に二百部が届くので、十七日に届く残りは百部。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
