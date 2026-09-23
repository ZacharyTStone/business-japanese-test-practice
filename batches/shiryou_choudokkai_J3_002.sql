-- shiryou_choudokkai_J3_002: 1 × shiryou_choudokkai (J3)
-- generated 2026-09-23T21:02:59+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('fbafa2ed5f38fdc8', '同僚がオンライン会議で予定表を画面に映しながらこう言いました。「4日の第一倉庫、C社さんとB社さんが重なっている件ですが、C社さんの納品はけっきょく延期になって、D社さんと同じ日に入ることになりました。場所は第一倉庫のまま変わりません。」C社の納品はいつになりますか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J3_002', 'shiryou_choudokkai', 'J3', 'claude-sonnet-5', '2026-09-23T21:02:59+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('4f749dbe58', 'shiryou_choudokkai_J3_002', 'shiryou_choudokkai', 'J3', 'video_shared_doc+peer_to_peer+find_the_date@J3', 'video_shared_doc', 'peer_to_peer', 'find_the_date', 'video', null, null, null, '倉庫予約の重なりと延期連絡', '同僚がオンライン会議で予定表を画面に映しながらこう言いました。「4日の第一倉庫、C社さんとB社さんが重なっている件ですが、C社さんの納品はけっきょく延期になって、D社さんと同じ日に入ることになりました。場所は第一倉庫のまま変わりません。」C社の納品はいつになりますか。', 2, '予定表では10月4日に第一倉庫でB社とC社の予定が重なっており、C社は「仮」とされている。話し手はこの重なりを解消するため、C社の納品をD社と同じ日、つまり10月9日に延期すると伝えている。10月4日は延期前の資料の値のままで誤り。9月30日はC社の別の作業（検品）の完了日であり、これから行う納品とは別物。10月2日はA社の行を誤って読んだもの。資料だけでは重なりの解消先が分からず、音声だけではD社の日付が10月9日だと分からない。', 'The chart shows a double booking on the 4th; the colleague resolves it by moving C''s delivery to the same date as D''s slot, October 9.', '[{"term": "納品立会い", "reading": "のうひんたちあい", "meaning": "attending a delivery to confirm receipt"}, {"term": "仮予約", "reading": "かりよやく", "meaning": "provisional reservation"}]'::jsonb, '[{"template": "schedule", "title": "10月 納品立会い予定表", "meta": [{"label": "期間", "value": "9月30日（土）〜10月9日（月）"}, {"label": "作成者", "value": "総務部 中村"}], "blocks": [{"type": "table", "columns": ["日付", "内容", "場所", "担当"], "rows": [["9月30日（土）", "C社 検品（完了）", "第一倉庫", "高橋"], ["10月2日（月）", "A社 納品立会い", "本社倉庫", "佐藤"], ["10月4日（水）", "B社 納品立会い", "第一倉庫", "鈴木"], ["10月4日（水）", "C社 納品立会い（仮）", "第一倉庫", "高橋"], ["10月9日（月）", "D社 納品立会い", "第二倉庫", "佐藤"]]}]}]'::jsonb, '[]'::jsonb, 'fbafa2ed5f38fdc8', 1.0)
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
delete from public.item_options where item_id in ('4f749dbe58');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('4f749dbe58', 0, '10月4日', 'ignores_the_spoken_change', '予定表に元々書かれている仮予約の日付で、口頭で延期になったことを反映していない。', null),
       ('4f749dbe58', 1, '10月2日', 'reads_wrong_row', '隣のA社の納品立会いの日付で、C社の行ではない。', null),
       ('4f749dbe58', 2, '10月9日', 'correct', 'C社の納品はD社と同じ日に延期されたと話されており、予定表でD社の行は10月9日にあたる。', null),
       ('4f749dbe58', 3, '9月30日', 'wrong_timeframe', 'これは同じC社の検品がすでに完了した日付で、これから行う納品立会いの日ではない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
