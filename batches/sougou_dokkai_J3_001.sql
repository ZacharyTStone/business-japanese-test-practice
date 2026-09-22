-- sougou_dokkai_J3_001: 2 × sougou_dokkai (J3)
-- generated 2026-09-18T08:50:51+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_dokkai_J3_001', 'sougou_dokkai', 'J3', 'manual-load', '2026-09-18T08:50:51+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('f0575e4dfd', 'sougou_dokkai_J3_001', 'sougou_dokkai', 'J3', 'project_update+peer_to_peer+infer_next_step@J3', 'project_update', 'peer_to_peer', 'infer_next_step', 'written', null, null, null, '議事録を読んでまずすること', 'この議事録を読んだ出席者は、まず何をしますか。', 3, '決まったことは順番になっていて、まず全員がコメント、そのあとで佐藤が発注する。コメントの書き方は注記にあり、メールではなく共有フォルダのファイルに書く。期限とやり方の両方を読み取る。', 'The first numbered decision is everyone''s comment; the callout says where it goes and where it must not.', '[{"term": "発注", "reading": "はっちゅう", "meaning": "placing an order"}, {"term": "共有フォルダ", "reading": "きょうゆうフォルダ", "meaning": "shared folder"}]'::jsonb, '[{"template": "meeting_minutes", "title": "チラシ作成 打ち合わせ 議事録", "meta": [{"label": "日時", "value": "9月15日 10時"}, {"label": "場所", "value": "第二会議室"}, {"label": "出席者", "value": "佐藤、田中、山本"}], "blocks": [{"type": "heading", "level": 2, "text": "決まったこと"}, {"type": "numbered", "items": ["チラシの案は、木曜日までに全員がコメントを入れる。", "金曜日に佐藤が印刷を発注する。"]}, {"type": "callout", "tone": "action", "text": "コメントは共有フォルダのファイルに直接書き込むこと。メールでは送らないでください。"}]}]'::jsonb, '[]'::jsonb, null, null),
       ('e6cfbc7831', 'sougou_dokkai_J3_001', 'sougou_dokkai', 'J3', 'order_exchange+staff_to_client+infer_risk@J3', 'order_exchange', 'staff_to_client', 'infer_risk', 'written', null, null, null, '注文どおりに納品できない', '佐藤が先方に伝えなければならない問題は何ですか。', 1, '佐藤のメールには在庫30個と入荷25日、先方のメールには50個と納期20日がある。二つを合わせると、20日までに50個は無理で、20個は25日以降になる。どちらのメールにも「問題」とは書かれていないが、読み比べると分かる。', 'Neither email names a problem; putting the stock and the order side by side shows the deadline cannot be met in full.', '[{"term": "在庫", "reading": "ざいこ", "meaning": "stock / inventory"}, {"term": "入荷", "reading": "にゅうか", "meaning": "arrival of goods"}]'::jsonb, '[{"template": "email_thread", "title": "Re: 部品Aのご注文", "meta": [{"label": "差出人", "value": "みどり物産 購買部 田中"}, {"label": "宛先", "value": "山川商事 営業部 佐藤様"}, {"label": "件名", "value": "Re: 部品Aのご注文"}, {"label": "日時", "value": "9月12日 11時"}], "blocks": [{"type": "paragraph", "text": "佐藤様　お世話になっております。部品Aを50個、注文いたします。9月20日までに納品をお願いします。注文書は別途お送りします。"}, {"type": "quoted_message", "sender": "山川商事 佐藤", "sent_at": "9月11日 16時", "depth": 1, "text": "田中様　部品Aの在庫は現在30個です。追加の入荷は9月25日の予定です。ご注文の数量と納期をお知らせください。"}]}]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('f0575e4dfd', 'e6cfbc7831');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('f0575e4dfd', 0, '木曜日までに、コメントをメールで佐藤に送る。', 'surface_keyword_match', 'コメントと期限は合っているが、注記は「メールでは送らない」と書いている。', null),
       ('f0575e4dfd', 1, '金曜日に、印刷を発注する。', 'wrong_timeframe', '発注は金曜日で、佐藤の担当。コメントのあとの話で、まずすることではない。', null),
       ('f0575e4dfd', 2, 'チラシの案を新しく作り直す。', 'unsupported_but_plausible', '作り直すという話は議事録のどこにも書かれていない。', null),
       ('f0575e4dfd', 3, '木曜日までに、共有フォルダのファイルにコメントを書き込む。', 'correct', '決まったことの一つ目が全員のコメントで、注記が書き込む場所を共有フォルダのファイルと定めている。', null),
       ('e6cfbc7831', 0, '部品Aの値段が上がること', 'unsupported_but_plausible', '値段の話はどちらのメールにも出ていない。', null),
       ('e6cfbc7831', 1, '20日までには30個しか納品できず、残りは25日以降になること', 'correct', '在庫は30個で追加の入荷は25日なのに、先方は50個を20日までと頼んでいる。二つのメールを合わせると、注文どおりには納品できない。', null),
       ('e6cfbc7831', 2, '注文の数量が50個であること', 'stated_but_answers_different_question', 'メールに書かれている事実だが、それ自体は問題ではない。', null),
       ('e6cfbc7831', 3, '追加の入荷が25日より遅れること', 'wrong_timeframe', '入荷は25日の予定と書かれているだけで、遅れるとは書かれていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
