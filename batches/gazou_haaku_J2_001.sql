-- gazou_haaku_J2_001: 4 × gazou_haaku (J2)
-- generated 2026-09-19T05:09:05+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('pic_09fa4bde9a', '取引先の会議室で名刺交換をする'),
       ('pic_1a8cd70899', '席にいる同僚に書類を渡す'),
       ('pic_66f0315028', '会議室でホワイトボードを使って説明する'),
       ('pic_917fb25e9a', '受付で来客を奥へ案内する')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('a3990da6dc9586a1', '受付の人は何をしていますか。', 'narrator_f', 'in_person'),
       ('12a6417d94fc1758', '来客を会議室のほうへ案内しています。', 'narrator_f', 'in_person'),
       ('dde8847bc9008cc9', '来客に入館証を渡しています。', 'narrator_f', 'in_person'),
       ('69282f33f91fdb33', '来客が受付の人に行き方を教えています。', 'narrator_f', 'in_person'),
       ('d3cbe53e6dc4565b', '打ち合わせを終えた来客を見送っています。', 'narrator_f', 'in_person'),
       ('abaf9651a101be6d', 'ホワイトボードの前に立っている人は何をしていますか。', 'narrator_f', 'in_person'),
       ('7e8c0a5f1bcb6461', '会議が終わってホワイトボードを消しています。', 'narrator_f', 'in_person'),
       ('67d2e6a8af4095dc', '図を示しながら座っている人たちに説明しています。', 'narrator_f', 'in_person'),
       ('8e64c79fdcd93cc6', '受付で来客に建物の場所を説明しています。', 'narrator_f', 'in_person'),
       ('99fb646d0ecebcbc', '座っている上司が立っている部下に指示を出しています。', 'narrator_f', 'in_person'),
       ('0d0158d4833770f0', '二人は何をしていますか。', 'narrator_f', 'in_person'),
       ('ac6371692996e71c', '契約書にサインをしています。', 'narrator_f', 'in_person'),
       ('1f57603708c2ecb2', '受付で入館の手続きをしています。', 'narrator_f', 'in_person'),
       ('56564e56403ead63', '名刺を交換しています。', 'narrator_f', 'in_person'),
       ('3dad80b2e0eaaa5c', '席に着いて打ち合わせを始めています。', 'narrator_f', 'in_person'),
       ('1e71f4a4c3270528', '立っている人は何をしていますか。', 'narrator_f', 'in_person'),
       ('e15467a2cf5f15e0', '座っている同僚の机の上を片付けています。', 'narrator_f', 'in_person'),
       ('b4902132efe6c826', '座っている同僚に書類を渡しています。', 'narrator_f', 'in_person'),
       ('a810efe4a500aa1f', '渡した書類を同僚と一緒に確認しています。', 'narrator_f', 'in_person'),
       ('049d2b679a2d21ec', '座っている人が立っている人に書類を渡しています。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('gazou_haaku_J2_001', 'gazou_haaku', 'J2', 'author-composed', '2026-09-19T05:09:05+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('917fb25e9a', 'gazou_haaku_J2_001', 'gazou_haaku', 'J2', 'reception+staff_to_visitor+guiding_visitor@J2', 'reception', 'staff_to_visitor', 'guiding_visitor', 'in_person', 'pic_917fb25e9a', null, null, '受付で来客を奥へ案内する', '受付の人は何をしていますか。', 0, '受付の人が廊下のほうに手のひらを向けて方向を示し、来客がそちらを向いているので、来客を奥へ案内している場面。入館証などの受け渡しは描かれておらず、方向を示しているのは受付の人。来客は出口ではなく奥を向いているので、見送りではなく、これから通す場面である。', 'The receptionist''s open-palm gesture down the corridor, with the visitor facing that way, shows the visitor being shown in.', '[{"term": "案内する", "reading": "あんないする", "meaning": "to show someone the way"}, {"term": "入館証", "reading": "にゅうかんしょう", "meaning": "visitor badge"}, {"term": "見送る", "reading": "みおくる", "meaning": "to see someone off"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'a3990da6dc9586a1', null),
       ('66f0315028', 'gazou_haaku_J2_001', 'gazou_haaku', 'J2', 'meeting_room+subordinate_to_superior+presenting_at_whiteboard@J2', 'meeting_room', 'subordinate_to_superior', 'presenting_at_whiteboard', 'in_person', 'pic_66f0315028', null, null, '会議室でホワイトボードを使って説明する', 'ホワイトボードの前に立っている人は何をしていますか。', 1, '立っている若手社員がマーカーを持ち、ホワイトボードの図を指さして、テーブルに座った三人に向かって説明している場面。消している様子はなく、場所は受付ではなく社内の会議室で、話しているのは座っている側ではなく立っている側である。', 'Marker in hand and pointing at the chart, the standing employee is explaining to the seated colleagues, not erasing or being instructed.', '[{"term": "指示を出す", "reading": "しじをだす", "meaning": "to give instructions"}, {"term": "図", "reading": "ず", "meaning": "diagram, chart"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'abaf9651a101be6d', null),
       ('09fa4bde9a', 'gazou_haaku_J2_001', 'gazou_haaku', 'J2', 'client_office+staff_to_client+exchanging_business_cards@J2', 'client_office', 'staff_to_client', 'exchanging_business_cards', 'in_person', 'pic_09fa4bde9a', null, null, '取引先の会議室で名刺交換をする', '二人は何をしていますか。', 2, '二人が立ったまま、両手で名刺を差し出し合い、軽く頭を下げているので、名刺交換の場面。ペンや記入の様子はなく、場所は受付ではなく取引先の会議室で、まだ席には着いていない。', 'Both standing, both holding out a card with two hands and bowing slightly: the moment of exchanging business cards, before the meeting begins.', '[{"term": "名刺交換", "reading": "めいしこうかん", "meaning": "exchanging business cards"}, {"term": "席に着く", "reading": "せきにつく", "meaning": "to take one''s seat"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '0d0158d4833770f0', null),
       ('1a8cd70899', 'gazou_haaku_J2_001', 'gazou_haaku', 'J2', 'office_floor+peer_to_peer+handing_documents@J2', 'office_floor', 'peer_to_peer', 'handing_documents', 'in_person', 'pic_1a8cd70899', null, null, '席にいる同僚に書類を渡す', '立っている人は何をしていますか。', 1, '立っている人が書類の束を差し出し、座っている同僚が振り向いて受け取ろうとしている場面なので、書類を渡しているところ。片付けている様子はなく、書類はまだ手の中にあって一緒に確認する前で、渡しているのは立っている人のほうである。', 'The standing colleague holds the papers out and the seated one reaches for them: handing over, not tidying or reading together, and in that direction.', '[{"term": "片付ける", "reading": "かたづける", "meaning": "to tidy up"}, {"term": "確認する", "reading": "かくにんする", "meaning": "to check, to confirm"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '1e71f4a4c3270528', null)
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
delete from public.item_options where item_id in ('917fb25e9a', '66f0315028', '09fa4bde9a', '1a8cd70899');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('917fb25e9a', 0, '来客を会議室のほうへ案内しています。', 'correct', '受付の人が廊下のほうへ手のひらを向けて方向を示し、来客もそちらを向いている。', '12a6417d94fc1758'),
       ('917fb25e9a', 1, '来客に入館証を渡しています。', 'different_action', '受付でよくある行動だが、絵の中で手渡されている物はなく、手は方向を示している。', 'dde8847bc9008cc9'),
       ('917fb25e9a', 2, '来客が受付の人に行き方を教えています。', 'wrong_participants', '方向を示しているのは受付の人のほうで、来客はかばんを持って立っているだけ。', '69282f33f91fdb33'),
       ('917fb25e9a', 3, '打ち合わせを終えた来客を見送っています。', 'right_scene_wrong_moment', '同じ受付の場面だが、来客は出口ではなく奥の廊下を向いていて、これから入る場面。', 'd3cbe53e6dc4565b'),
       ('66f0315028', 0, '会議が終わってホワイトボードを消しています。', 'different_action', '手にはマーカーを持ち、図を指さしているので、消しているのではなく説明している。', '7e8c0a5f1bcb6461'),
       ('66f0315028', 1, '図を示しながら座っている人たちに説明しています。', 'correct', '立っている人がボードの図を指さし、座っている三人がそれを見て聞いている。', '67d2e6a8af4095dc'),
       ('66f0315028', 2, '受付で来客に建物の場所を説明しています。', 'adjacent_setting', '説明している点は合っているが、場所は会議室で、相手は席に着いた社内の人たち。', '8e64c79fdcd93cc6'),
       ('66f0315028', 3, '座っている上司が立っている部下に指示を出しています。', 'wrong_participants', '話しているのは立っている若手のほうで、座っている人たちは聞く側。', '99fb646d0ecebcbc'),
       ('09fa4bde9a', 0, '契約書にサインをしています。', 'different_action', '二人は立って小さなカードを差し出し合っており、ペンも書類への記入も描かれていない。', 'ac6371692996e71c'),
       ('09fa4bde9a', 1, '受付で入館の手続きをしています。', 'adjacent_setting', '取引先の会議室のテーブルのそばで向かい合っており、受付のカウンターはない。', '1f57603708c2ecb2'),
       ('09fa4bde9a', 2, '名刺を交換しています。', 'correct', '二人が両手で名刺を差し出し合い、軽くお辞儀をしている。', '56564e56403ead63'),
       ('09fa4bde9a', 3, '席に着いて打ち合わせを始めています。', 'right_scene_wrong_moment', '打ち合わせの前の場面で、二人はまだ立っていて、椅子は引かれていない。', '3dad80b2e0eaaa5c'),
       ('1a8cd70899', 0, '座っている同僚の机の上を片付けています。', 'different_action', '手に持っているのは書類の束で、机の上の物には触れていない。', 'e15467a2cf5f15e0'),
       ('1a8cd70899', 1, '座っている同僚に書類を渡しています。', 'correct', '立っている人が書類を差し出し、座っている人がそれを受け取ろうと手を伸ばしている。', 'b4902132efe6c826'),
       ('1a8cd70899', 2, '渡した書類を同僚と一緒に確認しています。', 'right_scene_wrong_moment', '書類はまだ立っている人の手にあり、二人で読んでいる場面ではない。', 'a810efe4a500aa1f'),
       ('1a8cd70899', 3, '座っている人が立っている人に書類を渡しています。', 'wrong_participants', '書類を持って差し出しているのは立っている人で、座っている人は受け取る側。', '049d2b679a2d21ec')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
