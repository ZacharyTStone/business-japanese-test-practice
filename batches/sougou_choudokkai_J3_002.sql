-- sougou_choudokkai_J3_002: 1 × sougou_choudokkai (J3)
-- generated 2026-09-21T21:43:31+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('c80c4363e4929897', 'この見積りについて、何が問題として残っていますか。', 'narrator_f', 'in_person'),
       ('b205d09efbc6f4ce', '検討会の見積り、パーティションの数量が変わっていますね。', 'manager_m', 'in_person'),
       ('a548d70e0eff879c', 'はい、先方の要望で二十枚から十五枚に減らしました。', 'staff_junior_m', 'in_person'),
       ('794167fa62b3ef8a', 'シェルフの単価がまだ未定になっていますが、あれは決まりましたか。', 'manager_m', 'in_person'),
       ('808e8ab78e1602d7', 'ちょうどメーカーから連絡があって、九千円に決まりました。', 'staff_junior_m', 'in_person'),
       ('f6e0e09411ed7d68', 'よかったです。納品日はどうですか。資料ではパーティションとシェルフ、両方未定でしたが。', 'manager_m', 'in_person'),
       ('97b719f0bb9ae2b2', 'パーティションは来週水曜に入荷すると確定しました。ただ、シェルフのほうはまだメーカーが在庫を確認中で、納品日は分かりません。', 'staff_junior_m', 'in_person'),
       ('5bc6580ceb2446f7', 'では、そこが残る問題ですね。', 'manager_m', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choudokkai_J3_002', 'sougou_choudokkai', 'J3', 'claude-sonnet-5', '2026-09-21T21:43:31+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('b39fb5be07', 'sougou_choudokkai_J3_002', 'sougou_choudokkai', 'J3', 'client_review+peer_to_peer+identify_risk@J3', 'client_review', 'peer_to_peer', 'identify_risk', 'in_person', null, null, null, '検討会後の家具見積りの残課題', 'この見積りについて、何が問題として残っていますか。', 3, '資料には、パーティションとシェルフの納品日が両方未定、シェルフの単価も未定と記載されている。会話では、シェルフの単価が九千円に決まったこと、パーティションの納品日が来週水曜に確定したことが分かる。結果として未解決のまま残るのはシェルフの納品日だけで、これはメーカーが在庫を確認中のためである。資料だけを読むと未定事項が二つ以上あるように見え、会話だけでは元々どの項目が未定だったのか分からない。', 'The document lists both the shelf price and two delivery dates as pending; the conversation resolves the price and one delivery date, leaving only the shelf''s delivery date unresolved.', '[{"term": "在庫確認", "reading": "ざいこかくにん", "meaning": "stock check / inventory confirmation"}, {"term": "入荷", "reading": "にゅうか", "meaning": "arrival of goods (into stock)"}]'::jsonb, '[{"template": "quote_order", "title": "御見積書（オフィス家具一式）", "meta": [{"label": "宛先", "value": "さくら文具株式会社 御中"}, {"label": "発行者", "value": "山川商事株式会社 営業部"}, {"label": "発行日", "value": "十月三日"}], "blocks": [{"type": "table", "columns": ["品目", "数量", "単価", "金額"], "rows": [["デスク", "20台", "15,000円", "300,000円"], ["椅子", "20台", "8,000円", "160,000円"], ["パーティション", "15枚（変更前20枚）", "12,000円", "180,000円"], ["シェルフ", "10台", "未定", "未定"]]}]}]'::jsonb, '[{"speaker_role": "同僚A", "text": "検討会の見積り、パーティションの数量が変わっていますね。", "clip_id": "b205d09efbc6f4ce"}, {"speaker_role": "同僚B", "text": "はい、先方の要望で二十枚から十五枚に減らしました。", "clip_id": "a548d70e0eff879c"}, {"speaker_role": "同僚A", "text": "シェルフの単価がまだ未定になっていますが、あれは決まりましたか。", "clip_id": "794167fa62b3ef8a"}, {"speaker_role": "同僚B", "text": "ちょうどメーカーから連絡があって、九千円に決まりました。", "clip_id": "808e8ab78e1602d7"}, {"speaker_role": "同僚A", "text": "よかったです。納品日はどうですか。資料ではパーティションとシェルフ、両方未定でしたが。", "clip_id": "f6e0e09411ed7d68"}, {"speaker_role": "同僚B", "text": "パーティションは来週水曜に入荷すると確定しました。ただ、シェルフのほうはまだメーカーが在庫を確認中で、納品日は分かりません。", "clip_id": "97b719f0bb9ae2b2"}, {"speaker_role": "同僚A", "text": "では、そこが残る問題ですね。", "clip_id": "5bc6580ceb2446f7"}]'::jsonb, 'c80c4363e4929897', 1.0)
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
delete from public.item_options where item_id in ('b39fb5be07');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('b39fb5be07', 0, 'パーティションの納品日が、まだ決まっていないこと', 'combines_wrong_pair', '資料ではパーティションとシェルフの両方が未定と書かれているが、会話でパーティションは来週水曜に入荷が確定したと述べられている。', null),
       ('b39fb5be07', 1, 'シェルフの納品日を、同僚Bが先方に確認すること', 'wrong_action_owner', '納品日を確認しているのはメーカーであり、同僚Bが先方に確認する話は会話に出ていない。', null),
       ('b39fb5be07', 2, 'シェルフの単価が、まだ決まっていないこと', 'unsupported_but_plausible', '資料では未定と記載されているが、会話でメーカーから連絡があり九千円に決まったと同僚Bが説明している。', null),
       ('b39fb5be07', 3, 'シェルフの納品日が、まだ決まっていないこと', 'correct', '会話で単価とパーティションの納品日は解決したが、シェルフの納品日はメーカーが在庫確認中でまだ分からないと同僚Bが述べている。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
