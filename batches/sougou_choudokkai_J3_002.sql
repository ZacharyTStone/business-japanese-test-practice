-- sougou_choudokkai_J3_002: 1 × sougou_choudokkai (J3)
-- generated 2026-09-23T21:07:08+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('aa757f8c419a0639', '今回、どの修正案を、誰が担当して進めることになりましたか。', 'narrator_f', 'in_person'),
       ('6ba24d68230e190a', '議事録では、写真を大きくするB案を採用することになっていましたね。', 'manager_m', 'video'),
       ('8deda4d63b7dfe22', 'そうなんですが、先ほど先方から連絡があって、B案は予算オーバーで難しいと言われました。', 'staff_junior_m', 'video'),
       ('1acb9a0c55ed9ef1', 'では、文字サイズを変えるA案はどうですか。', 'manager_m', 'video'),
       ('721b26e0ee23be0d', 'いえ、それは前回ですでに見送りが決まっています。先方は、保留にしていた表紙の色を変えるC案の方を進めてほしいそうです。', 'staff_junior_m', 'video'),
       ('6669e7ea7d280aca', 'では担当は佐藤さんのままで進めましょうか。', 'manager_m', 'video'),
       ('53623583553557ff', 'いえ、C案は佐藤さんではなく、田中さんが担当することになっています。', 'staff_junior_m', 'video')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choudokkai_J3_002', 'sougou_choudokkai', 'J3', 'claude-sonnet-5', '2026-09-23T21:07:08+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('a786957ed9', 'sougou_choudokkai_J3_002', 'sougou_choudokkai', 'J3', 'video_review+peer_to_peer+choose_revision@J3', 'video_review', 'peer_to_peer', 'choose_revision', 'video', null, null, null, 'パンフレットデザイン修正案の採用', '今回、どの修正案を、誰が担当して進めることになりましたか。', 0, '議事録では、A案は見送り、B案は採用（担当・佐藤）、C案は先方の意向確認後に判断（担当未定）となっていた。会話で、B案は先方が予算オーバーで断ったこと、代わりに保留だったC案を進めてほしいと言われたこと、C案の担当は佐藤ではなく田中になったことが分かる。議事録だけでは先方の判断が変わったことが分からず、会話だけでは元々の担当割り当てが分からないため、両方を突き合わせて初めて正しい組み合わせが決まる。', 'The minutes adopt plan B and leave plan C pending; the conversation reveals the client rejected B and requested C instead, with a new owner.', '[{"term": "見送り", "reading": "みおくり", "meaning": "postponement / passing on (a proposal)"}, {"term": "保留", "reading": "ほりゅう", "meaning": "pending, held over"}]'::jsonb, '[{"template": "meeting_minutes", "title": "パンフレットデザイン 修正案 打ち合わせ議事録", "meta": [{"label": "日時", "value": "9月5日（木）15時〜16時"}, {"label": "場所", "value": "オンライン会議室"}, {"label": "出席者", "value": "佐藤、田中、同僚A、同僚B"}], "blocks": [{"type": "numbered", "items": ["A案（文字サイズを11ptから12ptに変更）：見送り", "B案（写真を大きくするレイアウト変更）：採用、担当は佐藤", "C案（表紙の色を変更）：先方の意向確認後に判断、担当は未定"]}]}]'::jsonb, '[{"speaker_role": "同僚A", "text": "議事録では、写真を大きくするB案を採用することになっていましたね。", "clip_id": "6ba24d68230e190a"}, {"speaker_role": "同僚B", "text": "そうなんですが、先ほど先方から連絡があって、B案は予算オーバーで難しいと言われました。", "clip_id": "8deda4d63b7dfe22"}, {"speaker_role": "同僚A", "text": "では、文字サイズを変えるA案はどうですか。", "clip_id": "1acb9a0c55ed9ef1"}, {"speaker_role": "同僚B", "text": "いえ、それは前回ですでに見送りが決まっています。先方は、保留にしていた表紙の色を変えるC案の方を進めてほしいそうです。", "clip_id": "721b26e0ee23be0d"}, {"speaker_role": "同僚A", "text": "では担当は佐藤さんのままで進めましょうか。", "clip_id": "6669e7ea7d280aca"}, {"speaker_role": "同僚B", "text": "いえ、C案は佐藤さんではなく、田中さんが担当することになっています。", "clip_id": "53623583553557ff"}]'::jsonb, 'aa757f8c419a0639', 1.0)
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
delete from public.item_options where item_id in ('a786957ed9');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('a786957ed9', 0, '表紙の色を変えるC案を、田中が担当して進める。', 'correct', '先方からC案を進めてほしいと連絡があり、担当も保留から田中に決まったため。', null),
       ('a786957ed9', 1, '写真を大きくするB案を、佐藤が担当して進める。', 'combines_wrong_pair', '議事録どおりの組み合わせだが、先方がB案を予算オーバーで断ったという会話の内容を反映していない。', null),
       ('a786957ed9', 2, '表紙の色を変えるC案を、佐藤が担当して進める。', 'wrong_action_owner', '採用する案自体はC案で合っているが、担当は佐藤ではなく田中に変わっている。', null),
       ('a786957ed9', 3, '文字サイズを変えるA案を採用して進める。', 'stated_by_wrong_speaker', '同僚Aが思いつきで挙げただけで、同僚Bが前回すでに見送りが決まっていると答えており、採用された案ではない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
