-- sougou_choukai_J3_001: 2 × sougou_choukai (J3)
-- generated 2026-09-19T17:03:52+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_meeting_room', '取引先の会議室'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('b4ec14f1473c4de6', '報告書が遅れそうなのは、なぜですか。', 'narrator_f', 'in_person'),
       ('81895b53cfc0cd40', '課長、報告書の提出が少し遅れそうです。', 'manager_m', 'in_person'),
       ('5e61179310ac7e27', 'どうしたの。データがまだ届いていないのかな。', 'staff_junior_m', 'in_person'),
       ('80191c1fb273d2ba', 'いえ、データは昨日届きました。ただ、グラフを作るソフトが今朝から動かなくて。', 'manager_m', 'in_person'),
       ('27b8b6c9c6ee4426', 'システム部には連絡した？', 'staff_junior_m', 'in_person'),
       ('3b594ac659668250', 'はい。午後には直るそうです。', 'manager_m', 'in_person'),
       ('20d47b49df7e0887', '分かった。直ったらすぐ仕上げてください。', 'staff_junior_m', 'in_person'),
       ('d08f3de5649eec59', 'エー', 'narrator_f', 'in_person'),
       ('3bd105b75311e9bc', '部下がほかの仕事で忙しいから', 'narrator_f', 'in_person'),
       ('da4df49bf7f00ab2', 'ビー', 'narrator_f', 'in_person'),
       ('bef6e01d7e220f55', 'グラフを作るソフトが動かないから', 'narrator_f', 'in_person'),
       ('d690aea8d6cb91f1', 'シー', 'narrator_f', 'in_person'),
       ('c75a2febc5e8cb72', 'データがまだ届いていないから', 'narrator_f', 'in_person'),
       ('134df096a9c7dc0a', 'デー', 'narrator_f', 'in_person'),
       ('21851b3be541eb26', 'システム部からの返事を待っているから', 'narrator_f', 'in_person'),
       ('14b6815909b5129d', '前回の見積から変わったのは、何ですか。', 'narrator_f', 'in_person'),
       ('1bc13ccf8628238f', '前回お渡しした見積から、変わった点をご説明します。', 'manager_m', 'in_person'),
       ('b52bbeaa967fa9ab', '金額が変わったのでしょうか。', 'staff_junior_m', 'in_person'),
       ('d4e3903dd584808d', 'いえ、金額は前回と同じです。納期が一週間早くなりました。', 'manager_m', 'in_person'),
       ('cf697f93a4441aa7', 'それは助かります。担当の方は変わりませんね。', 'staff_junior_m', 'in_person'),
       ('10151dfd4f7b0061', 'はい、私が引き続き担当いたします。', 'manager_m', 'in_person'),
       ('bd91d768d5eb3056', '金額が安くなった点', 'narrator_f', 'in_person'),
       ('04bea37aa697ab21', '担当者が代わった点', 'narrator_f', 'in_person'),
       ('6492ae0776fdcbc1', '数量が増えた点', 'narrator_f', 'in_person'),
       ('c8e4a4385c854e08', '納期が一週間早くなった点', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choukai_J3_001', 'sougou_choukai', 'J3', 'manual-load', '2026-09-19T17:03:52+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('eabb6f222a', 'sougou_choukai_J3_001', 'sougou_choukai', 'J3', 'desk_huddle+subordinate_to_superior+why_delayed@J3', 'desk_huddle', 'subordinate_to_superior', 'why_delayed', 'in_person', 'scene_office_desk_pair', null, null, '報告書が遅れる理由', '報告書が遅れそうなのは、なぜですか。', 1, '課長は「データが届いていないのか」と聞くが、部下は「いえ」と否定し、本当の理由はソフトが動かないことだと言う。システム部には連絡ずみで、午後には直る。課長の推測をそのまま答えにすると誤る。', 'The manager guesses a cause and the subordinate corrects it; the real reason is the software.', '[{"term": "提出", "reading": "ていしゅつ", "meaning": "submission"}, {"term": "仕上げる", "reading": "しあげる", "meaning": "to finish up"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "部下", "text": "課長、報告書の提出が少し遅れそうです。", "clip_id": "81895b53cfc0cd40"}, {"speaker_role": "課長", "text": "どうしたの。データがまだ届いていないのかな。", "clip_id": "5e61179310ac7e27"}, {"speaker_role": "部下", "text": "いえ、データは昨日届きました。ただ、グラフを作るソフトが今朝から動かなくて。", "clip_id": "80191c1fb273d2ba"}, {"speaker_role": "課長", "text": "システム部には連絡した？", "clip_id": "27b8b6c9c6ee4426"}, {"speaker_role": "部下", "text": "はい。午後には直るそうです。", "clip_id": "3b594ac659668250"}, {"speaker_role": "課長", "text": "分かった。直ったらすぐ仕上げてください。", "clip_id": "20d47b49df7e0887"}]'::jsonb, 'b4ec14f1473c4de6', null),
       ('b2498c2196', 'sougou_choukai_J3_001', 'sougou_choukai', 'J3', 'client_meeting+staff_to_client+what_changed@J3', 'client_meeting', 'staff_to_client', 'what_changed', 'in_person', 'scene_client_meeting_room', null, null, '見積で変わった点', '前回の見積から変わったのは、何ですか。', 3, '取引先は金額と担当者について聞くが、どちらも「同じ」「変わらない」と答えられる。変わったのは納期だけ。聞かれたことと、実際に変わったことを分けて聞き取る。', 'Two things the client asks about are unchanged; only the delivery date moved.', '[{"term": "見積", "reading": "みつもり", "meaning": "quotation / estimate"}, {"term": "引き続き", "reading": "ひきつづき", "meaning": "continuing as before"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "自社の営業担当", "text": "前回お渡しした見積から、変わった点をご説明します。", "clip_id": "1bc13ccf8628238f"}, {"speaker_role": "取引先の担当者", "text": "金額が変わったのでしょうか。", "clip_id": "b52bbeaa967fa9ab"}, {"speaker_role": "自社の営業担当", "text": "いえ、金額は前回と同じです。納期が一週間早くなりました。", "clip_id": "d4e3903dd584808d"}, {"speaker_role": "取引先の担当者", "text": "それは助かります。担当の方は変わりませんね。", "clip_id": "cf697f93a4441aa7"}, {"speaker_role": "自社の営業担当", "text": "はい、私が引き続き担当いたします。", "clip_id": "10151dfd4f7b0061"}]'::jsonb, '14b6815909b5129d', null)
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
delete from public.item_options where item_id in ('eabb6f222a', 'b2498c2196');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('eabb6f222a', 0, '部下がほかの仕事で忙しいから', 'unsupported_but_plausible', '遅れの理由としてはありそうだが、会話では誰も言っていない。', '3bd105b75311e9bc'),
       ('eabb6f222a', 1, 'グラフを作るソフトが動かないから', 'correct', '部下が「ただ、グラフを作るソフトが今朝から動かなくて」と、遅れる理由として述べている。', 'bef6e01d7e220f55'),
       ('eabb6f222a', 2, 'データがまだ届いていないから', 'stated_by_wrong_speaker', '課長がそう聞いただけで、部下は「昨日届きました」と否定している。', 'c75a2febc5e8cb72'),
       ('eabb6f222a', 3, 'システム部からの返事を待っているから', 'surface_keyword_match', 'システム部は話に出るが、返事はすでにあり、午後には直ると分かっている。', '21851b3be541eb26'),
       ('b2498c2196', 0, '金額が安くなった点', 'superseded_by_later_turn', '取引先が金額が変わったのかと聞いたが、営業担当は「金額は前回と同じ」と答えている。', 'bd91d768d5eb3056'),
       ('b2498c2196', 1, '担当者が代わった点', 'surface_keyword_match', '「担当」という言葉は出るが、担当は変わらないと確認されている。', '04bea37aa697ab21'),
       ('b2498c2196', 2, '数量が増えた点', 'unsupported_but_plausible', '見積の変更としてはありそうだが、数量の話は出ていない。', '6492ae0776fdcbc1'),
       ('b2498c2196', 3, '納期が一週間早くなった点', 'correct', '営業担当が「納期が一週間早くなりました」と、変わった点として述べている。', 'c8e4a4385c854e08')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
