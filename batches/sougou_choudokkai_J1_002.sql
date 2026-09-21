-- sougou_choudokkai_J1_002: 1 × sougou_choudokkai (J1)
-- generated 2026-09-21T21:40:16+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('c16863511b844dc7', 'データ移行の開始予定は、いつからになりましたか。', 'narrator_f', 'in_person'),
       ('2b02bce288b43518', 'この報告書の通り、データ移行は十月一日開始の予定でした。', 'manager_m', 'in_person'),
       ('7afb4b86ec8df75b', 'テスト環境の構築が九月十五日に終わる予定でしたが、それは今どうなっていますか。', 'staff_junior_m', 'in_person'),
       ('3e61351755a4c0b7', '先週ようやく完了しました。ただ、ベンダー側の人員不足で、データ移行の開始自体が一週間遅れて十月八日からになりました。', 'manager_m', 'in_person'),
       ('894530015214ebfd', 'では、データ移行は九月十五日からということですね？', 'staff_junior_m', 'in_person'),
       ('1febbc2c24f4b404', 'いえ、九月十五日はテスト環境の予定日です。データ移行の開始は十月八日です。', 'manager_m', 'in_person'),
       ('9cdc1f38f6cd06a5', '承知しました。十月八日から準備します。', 'staff_junior_m', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choudokkai_J1_002', 'sougou_choudokkai', 'J1', 'claude-sonnet-5', '2026-09-21T21:40:16+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('23fd538a62', 'sougou_choudokkai_J1_002', 'sougou_choudokkai', 'J1', 'handover+other_department+reconcile_document@J1', 'handover', 'other_department', 'reconcile_document', 'in_person', null, null, null, 'システム移行案件の引き継ぎ', 'データ移行の開始予定は、いつからになりましたか。', 1, '報告書ではデータ移行の開始予定は十月一日となっているが、会話でテスト環境構築の完了後、ベンダー側の人員不足によりデータ移行の開始自体が一週間遅れて十月八日になったと分かる。九月十五日はテスト環境構築の予定日であり、経理部担当者が誤って結び付けたものをシステム部担当者が訂正している。十月十五日はさらに遅れた場合の推測に過ぎず、根拠がない。報告書だけでは遅れが分からず、会話だけでは元の予定日が分からないため、両方を突き合わせないと正しい日付は選べない。', 'The report lists an original start date; the conversation reveals a one-week vendor delay that pushes it back, and a colleague''s misattributed date is corrected on the spot.', '[{"term": "検収", "reading": "けんしゅう", "meaning": "acceptance inspection"}, {"term": "人員不足", "reading": "じんいんぶそく", "meaning": "staff shortage"}, {"term": "引き継ぎ", "reading": "ひきつぎ", "meaning": "handover"}]'::jsonb, '[{"template": "progress_report", "title": "顧客管理システム移行 進捗報告書", "meta": [{"label": "報告者", "value": "システム部 保田"}, {"label": "報告日", "value": "九月二十日"}, {"label": "案件", "value": "顧客管理システム移行（経理部向け）"}], "blocks": [{"type": "table", "caption": "作業マイルストーン", "columns": ["項目", "状況", "予定日"], "rows": [["要件定義", "完了", "八月三十一日"], ["テスト環境構築", "遅延中", "九月十五日"], ["データ移行", "未着手", "十月一日開始"]]}]}]'::jsonb, '[{"speaker_role": "システム部担当者", "text": "この報告書の通り、データ移行は十月一日開始の予定でした。", "clip_id": "2b02bce288b43518"}, {"speaker_role": "経理部担当者", "text": "テスト環境の構築が九月十五日に終わる予定でしたが、それは今どうなっていますか。", "clip_id": "7afb4b86ec8df75b"}, {"speaker_role": "システム部担当者", "text": "先週ようやく完了しました。ただ、ベンダー側の人員不足で、データ移行の開始自体が一週間遅れて十月八日からになりました。", "clip_id": "3e61351755a4c0b7"}, {"speaker_role": "経理部担当者", "text": "では、データ移行は九月十五日からということですね？", "clip_id": "894530015214ebfd"}, {"speaker_role": "システム部担当者", "text": "いえ、九月十五日はテスト環境の予定日です。データ移行の開始は十月八日です。", "clip_id": "1febbc2c24f4b404"}, {"speaker_role": "経理部担当者", "text": "承知しました。十月八日から準備します。", "clip_id": "9cdc1f38f6cd06a5"}]'::jsonb, 'c16863511b844dc7', 1.0)
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
delete from public.item_options where item_id in ('23fd538a62');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('23fd538a62', 0, '九月十五日から', 'stated_by_wrong_speaker', '経理部担当者がそう確認しているが、それはテスト環境構築の予定日であり、システム部担当者がその場で訂正している。', null),
       ('23fd538a62', 1, '十月八日から', 'correct', 'システム部担当者が、ベンダー側の人員不足でデータ移行の開始自体が一週間遅れ、十月八日からになったと明言している。', null),
       ('23fd538a62', 2, '十月一日から', 'combines_wrong_pair', '報告書に書かれた当初の予定日のままで、会話で述べられたベンダー都合の一週間遅れを反映していない。', null),
       ('23fd538a62', 3, '十月十五日から', 'unsupported_but_plausible', 'さらなる遅れとしてありそうな日付だが、会話にも報告書にも述べられていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
