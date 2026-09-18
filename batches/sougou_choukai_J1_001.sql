-- sougou_choukai_J1_001: 2 × sougou_choukai (J1)
-- generated 2026-09-18T08:50:50+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_meeting_room', '取引先の会議室'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('65cf4a8882e7739a', '問い合わせの窓口は、誰が担当することになりましたか。', 'narrator_f', 'in_person'),
       ('b22643c081aa6662', '導入後の問い合わせ窓口ですが、御社ではどなたになりますか。', 'manager_m', 'in_person'),
       ('8b748dd1583178f1', '設定まわりは私が見ておりますので、私が窓口になるのが自然かと思います。', 'staff_junior_m', 'in_person'),
       ('183e6464ad06c798', 'ただ、私のほうは来月から御社に常駐しますので、その場で受けられます。', 'staff_mid_f', 'in_person'),
       ('c21f314dc4905198', '常駐していただけるなら、そのほうが助かりますね。', 'manager_m', 'in_person'),
       ('4f7719b70b80cb92', 'では、窓口はそちらにお願いします。私は後ろで技術的な確認を受け持ちます。', 'staff_junior_m', 'in_person'),
       ('b84cf124c8f61c4c', '承知しました。', 'staff_mid_f', 'in_person'),
       ('c8690b84797bbf6f', '二十日に納品する台数は、いくつになりましたか。', 'narrator_f', 'in_person'),
       ('ec250f17b2a14316', '初回は百台を二十日に、とお願いしていましたね。', 'manager_m', 'video'),
       ('52214b37a5ae3fb2', 'はい。ただ、部材の関係で二十日には八十台が限度でして、残りは月末になります。', 'staff_junior_m', 'video'),
       ('b4038ebbc4a15f58', '八十台ですか。実はこちらも現場の準備が遅れていまして、二十日は六十台あれば足ります。', 'manager_m', 'video'),
       ('6354afece6c1151b', 'では二十日に六十台、残りの四十台を月末に、ということで。', 'staff_junior_m', 'video'),
       ('ec0dd13728ce48b0', '月末の分は一度に受け取れないので、二十五日に二十台、月末に二十台と分けていただけますか。', 'manager_m', 'video'),
       ('1839bf4ace7dae98', '承知しました。そのように手配いたします。', 'staff_junior_m', 'video')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choukai_J1_001', 'sougou_choukai', 'J1', 'manual-load', '2026-09-18T08:50:50+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('f833f9f24b', 'sougou_choukai_J1_001', 'sougou_choukai', 'J1', 'client_meeting+peer_to_peer+who_decides@J1', 'client_meeting', 'peer_to_peer', 'who_decides', 'in_person', 'scene_client_meeting_room', null, null, '問い合わせ窓口を誰が持つか', '問い合わせの窓口は、誰が担当することになりましたか。', 0, '最初に手を挙げたのは設定担当の社員だが、常駐するという同僚の話に取引先が「そのほうが助かる」と応じ、設定担当は「窓口はそちらに」と譲った。決まったのは常駐する社員で、譲った側は後ろで技術確認を受け持つ。途中で出た候補をそのまま答えると誤る。', 'The first volunteer withdraws once the client welcomes the on-site colleague; the decision is the later turn, not the first.', '[{"term": "常駐", "reading": "じょうちゅう", "meaning": "being stationed on site"}, {"term": "窓口", "reading": "まどぐち", "meaning": "point of contact"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "取引先の担当者", "text": "導入後の問い合わせ窓口ですが、御社ではどなたになりますか。", "clip_id": "b22643c081aa6662"}, {"speaker_role": "同僚A", "text": "設定まわりは私が見ておりますので、私が窓口になるのが自然かと思います。", "clip_id": "8b748dd1583178f1"}, {"speaker_role": "同僚B", "text": "ただ、私のほうは来月から御社に常駐しますので、その場で受けられます。", "clip_id": "183e6464ad06c798"}, {"speaker_role": "取引先の担当者", "text": "常駐していただけるなら、そのほうが助かりますね。", "clip_id": "c21f314dc4905198"}, {"speaker_role": "同僚A", "text": "では、窓口はそちらにお願いします。私は後ろで技術的な確認を受け持ちます。", "clip_id": "4f7719b70b80cb92"}, {"speaker_role": "同僚B", "text": "承知しました。", "clip_id": "b84cf124c8f61c4c"}]'::jsonb, '65cf4a8882e7739a', null),
       ('0ed5b25518', 'sougou_choukai_J1_001', 'sougou_choukai', 'J1', 'video_meeting+staff_to_client+dates_and_numbers@J1', 'video_meeting', 'staff_to_client', 'dates_and_numbers', 'video', 'scene_video_call_laptop', null, null, '初回納品の台数', '二十日に納品する台数は、いくつになりましたか。', 2, '二十日の数は百台から八十台、さらに六十台へと会話の中で二度変わり、六十台で確定する。残り四十台は二十五日と月末に分けられた。最後の発言は「そのように手配します」としか言わないので、途中の数の動きを追わないと答えられない。', 'The figure for the twentieth drops twice and settles at sixty; the closing line only confirms without repeating it.', '[{"term": "部材", "reading": "ぶざい", "meaning": "components / materials"}, {"term": "手配", "reading": "てはい", "meaning": "arrangements"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "取引先の担当者", "text": "初回は百台を二十日に、とお願いしていましたね。", "clip_id": "ec250f17b2a14316"}, {"speaker_role": "自社の営業担当", "text": "はい。ただ、部材の関係で二十日には八十台が限度でして、残りは月末になります。", "clip_id": "52214b37a5ae3fb2"}, {"speaker_role": "取引先の担当者", "text": "八十台ですか。実はこちらも現場の準備が遅れていまして、二十日は六十台あれば足ります。", "clip_id": "b4038ebbc4a15f58"}, {"speaker_role": "自社の営業担当", "text": "では二十日に六十台、残りの四十台を月末に、ということで。", "clip_id": "6354afece6c1151b"}, {"speaker_role": "取引先の担当者", "text": "月末の分は一度に受け取れないので、二十五日に二十台、月末に二十台と分けていただけますか。", "clip_id": "ec0dd13728ce48b0"}, {"speaker_role": "自社の営業担当", "text": "承知しました。そのように手配いたします。", "clip_id": "1839bf4ace7dae98"}]'::jsonb, 'c8690b84797bbf6f', null)
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
delete from public.item_options where item_id in ('f833f9f24b', '0ed5b25518');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('f833f9f24b', 0, '来月から取引先に常駐する社員', 'correct', '常駐するという申し出を取引先が歓迎し、設定担当の社員も「窓口はそちらに」と譲っている。', null),
       ('f833f9f24b', 1, '設定を担当している社員', 'superseded_by_later_turn', '最初に自分が窓口になるのが自然だと述べたが、常駐の話が出たあとで自ら譲り、後方の技術確認に回った。', null),
       ('f833f9f24b', 2, '取引先の担当者', 'stated_by_wrong_speaker', '窓口を尋ねたのはこの人で、窓口になるとは述べていない。', null),
       ('f833f9f24b', 3, '二人の社員が交代で担当する', 'unsupported_but_plausible', '分担としてはあり得るが、会話では窓口は一人に決まり、もう一人は後方に回っている。', null),
       ('0ed5b25518', 0, '百台', 'surface_keyword_match', '会話の冒頭に出る注文全体の数で、二十日に届く数ではない。', null),
       ('0ed5b25518', 1, '四十台', 'unsupported_but_plausible', '二十日の残りとして出た数で、しかも二十五日と月末に二十台ずつ分けると決まっており、二十日の話ではない。', null),
       ('0ed5b25518', 2, '六十台', 'correct', '取引先が二十日は六十台で足りると述べ、営業担当が「二十日に六十台」と受けており、その後この数は変わっていない。', null),
       ('0ed5b25518', 3, '八十台', 'superseded_by_later_turn', '営業担当が示した二十日の上限だが、その直後に取引先が六十台で足りると述べて数が下がった。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
