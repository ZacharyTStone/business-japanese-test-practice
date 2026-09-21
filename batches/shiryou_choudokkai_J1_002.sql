-- shiryou_choudokkai_J1_002: 1 × shiryou_choudokkai (J1)
-- generated 2026-09-21T21:37:11+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('868403b9d7b9834c', '後輩が予定表を見ながら電話でこう言いました。「先輩、十五日の予定なんですが、第一応接室にB社商談と定例会議が両方入っているように見えます。」先輩は「ああ、B社商談は仮予約のままだったので、空いていた第二応接室に変更しました。定例会議は予定通り第一応接室で行います」と答えました。B社商談は十五日、どこで行われますか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J1_002', 'shiryou_choudokkai', 'J1', 'claude-sonnet-5', '2026-09-21T21:37:11+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('8091994664', 'shiryou_choudokkai_J1_002', 'shiryou_choudokkai', 'J1', 'schedule_sheet+junior_to_senior+find_the_conflict@J1', 'schedule_sheet', 'junior_to_senior', 'find_the_conflict', 'phone', null, null, null, '予定表の重複予約を電話で確認する', '後輩が予定表を見ながら電話でこう言いました。「先輩、十五日の予定なんですが、第一応接室にB社商談と定例会議が両方入っているように見えます。」先輩は「ああ、B社商談は仮予約のままだったので、空いていた第二応接室に変更しました。定例会議は予定通り第一応接室で行います」と答えました。B社商談は十五日、どこで行われますか。', 3, '予定表では十五日の第一応接室にB社商談（仮予約）と定例会議が重なって記載されている。電話で先輩は、仮予約だったB社商談を空いていた第二応接室に変更したと説明し、定例会議は第一応接室のままだと述べた。予定表だけでは重複していることは分かるが変更後の場所は分からず、電話だけでは何が変更されたのか特定できない。第一応接室は変更前の値、第三応接室は別の日の別の行、第二会議室は語の一部が似ているだけの無関係な部屋であり、いずれも誤り。', 'The schedule shows a room conflict on the 15th; the phone call reveals which event was moved and to where, requiring both sources.', '[{"term": "仮予約", "reading": "かりよやく", "meaning": "provisional reservation"}, {"term": "応接室", "reading": "おうせつしつ", "meaning": "reception/meeting room"}]'::jsonb, '[{"template": "schedule", "title": "来客対応・会議室予定表", "meta": [{"label": "期間", "value": "十月十四日〜十月十六日"}, {"label": "作成者", "value": "営業部 佐藤"}], "blocks": [{"type": "table", "columns": ["日付", "内容", "場所", "担当"], "rows": [["十月十四日", "A社訪問", "第二応接室", "木村"], ["十月十五日", "B社商談", "第一応接室（仮予約）", "森田"], ["十月十五日", "社内定例会議", "第一応接室", "佐藤"], ["十月十六日", "C社訪問", "第三応接室", "木村"]]}]}]'::jsonb, '[]'::jsonb, '868403b9d7b9834c', 1.0)
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
delete from public.item_options where item_id in ('8091994664');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('8091994664', 0, '第二会議室', 'surface_keyword_match', '「第二」という語は共通するが、予定表にも会話にも登場しない部屋であり、実際の変更先である第二応接室とは異なる。', null),
       ('8091994664', 1, '第三応接室', 'reads_wrong_row', '十六日のC社訪問で使われる部屋であり、十五日のB社商談とは別の行の情報。', null),
       ('8091994664', 2, '第一応接室', 'ignores_the_spoken_change', '予定表に元々書かれていた場所で、電話で変更が伝えられたことを反映していない。', null),
       ('8091994664', 3, '第二応接室', 'correct', '先輩の説明どおり、仮予約だったB社商談は実際に空いていた第二応接室に変更されたため。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
