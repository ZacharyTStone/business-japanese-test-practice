-- shiryou_choudokkai_J1_002: 1 × shiryou_choudokkai (J1)
-- generated 2026-09-23T21:01:28+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('e25a16407ece390d', '取引先からの確認メールを見ながら、部下が電話でこう報告しました。「さきほど先方に確認しましたところ、継手金具Bの単価は480円ではなく520円に訂正するとのことでした。金具Aの単価は変更ありません。」上司は、今回の注文の合計金額をいくらだと理解すればよいですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J1_002', 'shiryou_choudokkai', 'J1', 'claude-sonnet-5', '2026-09-23T21:01:28+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('753c57209e', 'shiryou_choudokkai_J1_002', 'shiryou_choudokkai', 'J1', 'delivery_email+subordinate_to_superior+find_the_conflict@J1', 'delivery_email', 'subordinate_to_superior', 'find_the_conflict', 'phone', null, null, null, '納品確認メールの単価訂正', '取引先からの確認メールを見ながら、部下が電話でこう報告しました。「さきほど先方に確認しましたところ、継手金具Bの単価は480円ではなく520円に訂正するとのことでした。金具Aの単価は変更ありません。」上司は、今回の注文の合計金額をいくらだと理解すればよいですか。', 0, 'メールの合計142,000円は単価480円を前提にした数字だが、電話でBの単価が520円に訂正されたと伝えられたため、Bの金額を78,000円に直して計算し直す必要がある。Aは70,000円のままなので、正しい合計は148,000円。142,000円はメールの数字をそのまま使った誤り、176,000円は訂正をAの行に誤って当てはめた誤り、83,000円は来月分の見込み額であり今回の注文額ではない。メールだけでは訂正の事実が分からず、電話だけではAとBの元の金額が分からないため、両方の情報が必要になる。', 'The email''s total assumes the old unit price; the call revises only item B''s price, so the total must be recalculated using the email''s figures for A and the corrected figure for B.', '[{"term": "単価", "reading": "たんか", "meaning": "unit price"}, {"term": "据え置き", "reading": "すえおき", "meaning": "kept unchanged"}, {"term": "月末締め翌月末払い", "reading": "げつまつじめよくげつまつばらい", "meaning": "payment terms: closed at month-end, paid at the end of the following month"}]'::jsonb, '[{"template": "email_external", "title": "発注No.245 ご注文の確認", "meta": [{"label": "差出人", "value": "さくら精密株式会社 営業部 中村"}, {"label": "宛先", "value": "山川商事株式会社 資材部 佐藤様"}, {"label": "件名", "value": "発注No.245 ご注文の確認"}, {"label": "日時", "value": "9月10日 11時"}], "blocks": [{"type": "paragraph", "text": "いつもお世話になっております。ご注文いただきました商品について、下記のとおりご確認申し上げます。"}, {"type": "table", "caption": "ご注文内容", "columns": ["品目", "数量", "単価", "金額"], "rows": [["継手金具A", "200個", "350円", "70,000円"], ["継手金具B", "150個", "480円", "72,000円"]]}, {"type": "key_values", "pairs": [{"label": "合計金額", "value": "142,000円"}, {"label": "支払条件", "value": "月末締め翌月末払い"}]}]}]'::jsonb, '[]'::jsonb, 'e25a16407ece390d', 1.0)
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
delete from public.item_options where item_id in ('753c57209e');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('753c57209e', 0, '148,000円', 'correct', 'Aは70,000円のまま、Bを150個×520円の78,000円に直して合計すると148,000円になる。', null),
       ('753c57209e', 1, '142,000円', 'ignores_the_spoken_change', 'メールに書かれた元の単価480円のままの合計で、電話で伝えられた520円への訂正が反映されていない。', null),
       ('753c57209e', 2, '83,000円', 'wrong_timeframe', 'これは来月の追加発注分の見込み合計であり、今回すでに確定している今月分の注文額ではない。', null),
       ('753c57209e', 3, '176,000円', 'reads_wrong_row', '単価の訂正をAの行に当てはめて計算した数字で、実際に訂正されたのはBの単価であってAではない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
