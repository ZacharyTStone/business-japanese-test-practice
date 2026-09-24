-- shiryou_choudokkai_J1_002: 1 × shiryou_choudokkai (J1)
-- generated 2026-09-24T21:04:06+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_phone_desk', 'デスクで固定電話')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('48b2cfd9d9fb7775', '予定表を見ながら電話を受けた後輩に、先輩がこう言いました。「有明商事の件だけど、仮予約だった会議室が先方から正式に決まったって連絡があったんだ。第一会議室じゃなくて、第三会議室になったから。時間はそのまま変わらないよ。」10月16日の訪問はどこで行うことになりましたか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J1_002', 'shiryou_choudokkai', 'J1', 'claude-sonnet-5', '2026-09-24T21:04:06+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('0c99e55bd7', 'shiryou_choudokkai_J1_002', 'shiryou_choudokkai', 'J1', 'schedule_sheet+junior_to_senior+apply_spoken_change@J1', 'schedule_sheet', 'junior_to_senior', 'apply_spoken_change', 'phone', 'scene_phone_desk', null, null, '訪問先の会議室が仮予約から確定する', '予定表を見ながら電話を受けた後輩に、先輩がこう言いました。「有明商事の件だけど、仮予約だった会議室が先方から正式に決まったって連絡があったんだ。第一会議室じゃなくて、第三会議室になったから。時間はそのまま変わらないよ。」10月16日の訪問はどこで行うことになりましたか。', 3, '予定表では10月16日の有明商事訪問の場所は「第一会議室（仮予約）」となっているが、電話で先輩が「仮予約が正式に決まり、第三会議室になった」と伝えている。したがって答えは第三会議室。第一会議室は変更前の資料の記載をそのまま採用した誤り、第二会議室は別の日（15日・17日）に使う弊社の会議室を混同したもの、応接室は既に済んだ14日の訪問先で、時系列を取り違えている。資料だけでは仮予約がどうなったか分からず、電話だけではどの訪問の話か分からない。', 'The schedule lists the October 16 room as provisional; the call confirms it changed from Room 1 to Room 3, so only combining both sources gives the answer.', '[{"term": "仮予約", "reading": "かりよやく", "meaning": "provisional reservation"}, {"term": "正式に決まる", "reading": "せいしきにきまる", "meaning": "to be formally confirmed"}, {"term": "応接室", "reading": "おうせつしつ", "meaning": "reception room"}]'::jsonb, '[{"template": "schedule", "title": "10月 得意先訪問予定表", "meta": [{"label": "期間", "value": "10月14日（月）〜10月18日（金）"}, {"label": "作成者", "value": "営業部 木村"}], "blocks": [{"type": "table", "columns": ["日付", "訪問先", "時間", "場所"], "rows": [["10月14日（月）", "さくら物産", "13時〜14時", "先方本社3階 応接室"], ["10月15日（火）", "高橋精密", "10時〜11時", "弊社 第二会議室"], ["10月16日（水）", "有明商事", "14時〜15時", "先方本社 第一会議室（仮予約）"], ["10月17日（木）", "緑川工業", "11時〜12時", "弊社 第二会議室"], ["10月18日（金）", "高橋精密", "15時〜16時", "先方本社 応接室"]]}]}]'::jsonb, '[]'::jsonb, '48b2cfd9d9fb7775', 1.0)
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
delete from public.item_options where item_id in ('0c99e55bd7');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('0c99e55bd7', 0, '第二会議室', 'reads_wrong_row', '15日と17日の弊社での訪問で使われる会議室で、16日の有明商事の行ではない。', null),
       ('0c99e55bd7', 1, '第一会議室', 'ignores_the_spoken_change', '資料に記載された仮予約時点の場所のままで、電話で伝えられた変更を反映していない。', null),
       ('0c99e55bd7', 2, '先方本社3階 応接室', 'wrong_timeframe', '14日のさくら物産訪問で使われた場所で、電話の時点ですでに終わっている過去の訪問先である。', null),
       ('0c99e55bd7', 3, '第三会議室', 'correct', '仮予約だった第一会議室から、先方の正式決定により変更された場所である。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
