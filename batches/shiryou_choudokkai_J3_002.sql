-- shiryou_choudokkai_J3_002: 1 × shiryou_choudokkai (J3)
-- generated 2026-09-22T20:53:23+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('26c0ddb3c98e8b61', '見積書を見ながら、同僚がこう言いました。「展示会は10月9日で、できれば早めに届いてほしいんですが、とにかくそれまでに間に合えば大丈夫です。予算は1個500円以内で、今回は250個以上まとめて発注します。さっき確認したら、タンブラーは単価が上がって550円になるそうです。」条件に合う品はどれですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J3_002', 'shiryou_choudokkai', 'J3', 'claude-sonnet-5', '2026-09-22T20:53:23+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('1d7ad8bafa', 'shiryou_choudokkai_J3_002', 'shiryou_choudokkai', 'J3', 'quotation+peer_to_peer+choose_the_option@J3', 'quotation', 'peer_to_peer', 'choose_the_option', 'in_person', null, null, null, '展示会ノベルティの発注先を選ぶ', '見積書を見ながら、同僚がこう言いました。「展示会は10月9日で、できれば早めに届いてほしいんですが、とにかくそれまでに間に合えば大丈夫です。予算は1個500円以内で、今回は250個以上まとめて発注します。さっき確認したら、タンブラーは単価が上がって550円になるそうです。」条件に合う品はどれですか。', 0, '条件は「500円以内」「10月9日までに間に合う」「250個以上」の三つ。資料だけを見るとタンブラーも480円で条件を満たすように見えるが、同僚の発言で単価が550円に上がったと分かり除外される。トートバッグとメモ帳は数量が250個に届かず不合格。ノベルティペンだけが単価・数量・納期のすべてを満たす。資料だけでは値上げが分からず、話だけでは各品の単価・数量・納期が分からないため、両方を照らし合わせないと答えが決まらない。', 'Only the pen meets all three spoken conditions once the tumbler''s spoken price hike is applied; the other two fail on quantity alone.', '[{"term": "予算", "reading": "よさん", "meaning": "budget"}, {"term": "まとめて発注", "reading": "まとめてはっちゅう", "meaning": "to place a bulk order"}]'::jsonb, '[{"template": "quote_order", "title": "展示会ノベルティ 見積書", "meta": [{"label": "宛先", "value": "営業部 販促担当者様"}, {"label": "発行者", "value": "ノベルティ工房 営業部 高橋"}, {"label": "発行日", "value": "9月20日"}], "blocks": [{"type": "table", "columns": ["品名", "単価", "数量", "納期"], "rows": [["ノベルティペン", "180円", "300本", "10月5日"], ["タンブラー", "480円", "100個", "10月10日"], ["トートバッグ", "460円", "150枚", "10月8日"], ["メモ帳", "220円", "200冊", "10月3日"]]}]}]'::jsonb, '[]'::jsonb, '26c0ddb3c98e8b61', 1.0)
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
delete from public.item_options where item_id in ('1d7ad8bafa');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('1d7ad8bafa', 0, 'ノベルティペン', 'correct', '180円で予算内、数量300本で250個以上、納期10月5日で展示会に間に合う。', null),
       ('1d7ad8bafa', 1, 'トートバッグ', 'reads_wrong_row', '単価460円・納期10月8日は条件に合うが、数量が150枚で250個に届かない。', null),
       ('1d7ad8bafa', 2, 'タンブラー', 'ignores_the_spoken_change', '資料の480円のまま考えれば条件に合うように見えるが、実際は550円に値上がりしており予算をオーバーする。', null),
       ('1d7ad8bafa', 3, 'メモ帳', 'surface_keyword_match', '納期10月3日で「早めに」という言葉に合うが、数量200冊で250個以上という条件を満たさない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
