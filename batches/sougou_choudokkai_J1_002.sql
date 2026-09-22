-- sougou_choudokkai_J1_002: 1 × sougou_choudokkai (J1)
-- generated 2026-09-22T20:57:43+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('89720e51a9160978', '会場と仕出し業者は、結局どうなりましたか。', 'narrator_f', 'in_person'),
       ('ca8e43d4b5d3cad6', '議事録では会場はAホールに決まっていましたが、先週連絡があって、Aホールは改装工事で使えなくなったそうです。', 'manager_m', 'in_person'),
       ('260597879e7e88df', 'それは困りますね。代わりの案はあるんですか。', 'staff_junior_m', 'in_person'),
       ('0bf957ed219656f3', 'Bホールを押さえました。広さも予算内に収まります。', 'manager_m', 'in_person'),
       ('28346885e5f18f68', '分かりました。仕出し業者はどうなりましたか。議事録では未定のままでしたが。', 'staff_junior_m', 'in_person'),
       ('fd85153bd6e5a2f1', 'それは山田さんがX社に決めたと聞いています。', 'manager_m', 'in_person'),
       ('11e96cb2010d343e', 'では、会場と仕出し、両方とも決まったということですね。', 'staff_junior_m', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choudokkai_J1_002', 'sougou_choudokkai', 'J1', 'claude-sonnet-5', '2026-09-22T20:57:43+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('2bb7e73bae', 'sougou_choudokkai_J1_002', 'sougou_choudokkai', 'J1', 'project_meeting+peer_to_peer+summarise_outcome@J1', 'project_meeting', 'peer_to_peer', 'summarise_outcome', 'in_person', null, null, null, '新製品発表会の会場と業者決定', '会場と仕出し業者は、結局どうなりましたか。', 2, '議事録では会場はAホールに決定済み、仕出し業者は未定のまま次回検討とされていた。会話で、Aホールが改装工事のため使えなくなり同僚AがBホールを押さえたこと、仕出し業者は山田がX社に決めたことが分かる。議事録だけでは変更を知りえず、会話だけでは元の会場が分からないため、両方を突き合わせて初めて結論が定まる。combines_wrong_pairは会場だけ古い情報のまま、wrong_action_ownerは決定者を取り違え、stated_by_wrong_speakerは提案者を取り違えている。', 'The minutes fix the venue and leave the caterer open; the conversation reverses this: the venue changes due to renovation while the caterer is settled, and only combining both sources gives the true outcome.', '[{"term": "仕出し業者", "reading": "しだしぎょうしゃ", "meaning": "catering vendor"}, {"term": "押さえる", "reading": "おさえる", "meaning": "to reserve/secure (a venue)"}]'::jsonb, '[{"template": "meeting_minutes", "title": "新製品発表会 会場・準備 打ち合わせ 議事録", "meta": [{"label": "日時", "value": "9月5日（木）10時〜11時"}, {"label": "場所", "value": "第二会議室"}, {"label": "出席者", "value": "同僚A、同僚B、山田"}], "blocks": [{"type": "numbered", "items": ["会場はAホールに決定。", "予算は50万円以内とする。", "仕出し業者は未定。次回までに検討する。"]}]}]'::jsonb, '[{"speaker_role": "同僚A", "text": "議事録では会場はAホールに決まっていましたが、先週連絡があって、Aホールは改装工事で使えなくなったそうです。", "clip_id": "ca8e43d4b5d3cad6"}, {"speaker_role": "同僚B", "text": "それは困りますね。代わりの案はあるんですか。", "clip_id": "260597879e7e88df"}, {"speaker_role": "同僚A", "text": "Bホールを押さえました。広さも予算内に収まります。", "clip_id": "0bf957ed219656f3"}, {"speaker_role": "同僚B", "text": "分かりました。仕出し業者はどうなりましたか。議事録では未定のままでしたが。", "clip_id": "28346885e5f18f68"}, {"speaker_role": "同僚A", "text": "それは山田さんがX社に決めたと聞いています。", "clip_id": "fd85153bd6e5a2f1"}, {"speaker_role": "同僚B", "text": "では、会場と仕出し、両方とも決まったということですね。", "clip_id": "11e96cb2010d343e"}]'::jsonb, '89720e51a9160978', 1.0)
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
delete from public.item_options where item_id in ('2bb7e73bae');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('2bb7e73bae', 0, '会場は同僚Bの提案でBホールに変更され、仕出し業者はX社に決定した。', 'stated_by_wrong_speaker', 'Bホールを押さえて報告したのは同僚Aであり、同僚Bが提案したという事実はない。', null),
       ('2bb7e73bae', 1, '会場はBホールに変更され、仕出し業者は同僚Bが決定した。', 'wrong_action_owner', '仕出し業者をX社に決めたのは山田であり、同僚Bではない。', null),
       ('2bb7e73bae', 2, '会場はBホールに変更され、仕出し業者はX社に決定した。', 'correct', 'Aホールが使えなくなったためBホールに変更され、未定だった仕出し業者は山田がX社に決めたと会話で述べられている。', null),
       ('2bb7e73bae', 3, '会場はAホールのままで、仕出し業者はX社に決定した。', 'combines_wrong_pair', '仕出し業者の決定は会話の内容だが、会場は議事録どおりAホールのままとしており、変更の事実が反映されていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
