-- sougou_dokkai_J1_001: 2 × sougou_dokkai (J1)
-- generated 2026-09-18T08:50:50+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_dokkai_J1_001', 'sougou_dokkai', 'J1', 'manual-load', '2026-09-18T08:50:50+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('807d62e9b4', 'sougou_dokkai_J1_001', 'sougou_dokkai', 'J1', 'scheduling+subordinate_to_superior+infer_owner@J1', 'scheduling', 'subordinate_to_superior', 'infer_owner', 'written', null, null, null, '日程調整を誰が引き取るか', '先方への返事は、誰がどのようにすることになりますか。', 2, '課長のメールは、先方の候補日を転送したうえで、自分の都合を伝え、調整と返事を佐藤に頼んでいる。先方の希望する技術担当の同席は、佐藤が確かめる条件の一つであって、技術担当が返事をするわけではない。課長の空きは先方の希望する午後と合わないので、課長自身が日程を決めて返事をする流れにもならない。', 'The manager forwards the request, states his own constraints and delegates the reply; the engineer''s presence is a condition to check, not the reply itself.', '[{"term": "同席", "reading": "どうせき", "meaning": "attending together"}, {"term": "踏まえる", "reading": "ふまえる", "meaning": "to take into account"}]'::jsonb, '[{"template": "email_thread", "title": "Re: 打ち合わせ日程のご相談", "meta": [{"label": "差出人", "value": "営業部 課長 川口"}, {"label": "宛先", "value": "営業部 佐藤"}, {"label": "件名", "value": "Re: 打ち合わせ日程のご相談"}, {"label": "日時", "value": "九月九日 九時十分"}], "blocks": [{"type": "paragraph", "text": "佐藤さん　下記、先方から日程の候補が来ています。私は十四日は終日外出、十六日は午前しか空いていません。先方は技術の話も聞きたいそうなので、その点も踏まえて調整をお願いします。返事は今日中に。"}, {"type": "quoted_message", "sender": "あさひ工業 鈴木", "sent_at": "九月八日 十七時二十分", "depth": 1, "text": "川口様　次回の打ち合わせですが、十四日か十六日の午後でいかがでしょうか。可能でしたら、技術のご担当の方にもご同席いただけると助かります。"}]}]'::jsonb, '[]'::jsonb, null, null),
       ('a151810e90', 'sougou_dokkai_J1_001', 'sougou_dokkai', 'J1', 'project_update+junior_to_senior+infer_risk@J1', 'project_update', 'junior_to_senior', 'infer_risk', 'written', null, null, null, '報告書に隠れた日程の問題', '先輩に報告しておくべき問題は何ですか。', 0, '報告書は「予定どおり」と書くが、表と備考を突き合わせると、検査の開始日より測定器の戻りが五日遅い。書き手はそれを問題として挙げていないので、読む側が気づいて報告する必要がある。製造の八割は予定の範囲内、設計は完了済みで、人手の話は出ていない。', 'The report says on schedule, but the instrument returns five days after inspection is due to start; the risk is implied by two lines, not stated.', '[{"term": "校正", "reading": "こうせい", "meaning": "calibration"}, {"term": "着手", "reading": "ちゃくしゅ", "meaning": "starting (work)"}]'::jsonb, '[{"template": "progress_report", "title": "案件N 進捗報告", "meta": [{"label": "報告者", "value": "技術部 後藤"}, {"label": "報告日", "value": "九月二十二日"}, {"label": "案件", "value": "案件N（ひかり製作所）"}], "blocks": [{"type": "paragraph", "text": "全体としては予定どおり進んでいます。"}, {"type": "table", "columns": ["工程", "状況", "予定"], "rows": [["設計", "完了", "九月五日 完了済み"], ["製造", "進行中（八割）", "九月三十日 完了予定"], ["検査", "未着手", "十月一日 開始予定"]]}, {"type": "bullets", "items": ["検査に使う測定器は、九月末まで業者で校正中。戻りは十月六日の見込み。", "納品は十月二十日で先方と合意済み。"]}]}]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('807d62e9b4', 'a151810e90');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('807d62e9b4', 0, '課長が、十六日の午後に先方を訪ねる旨を返事をする。', 'wrong_timeframe', '課長は十六日は午前しか空いておらず、先方の希望は午後なので、その日程は成り立たない。', null),
       ('807d62e9b4', 1, '先方の担当者が、技術担当に直接連絡して日程を決める。', 'unsupported_but_plausible', '先方は同席を頼んでいるだけで、自分から技術担当に連絡するとは書いていない。', null),
       ('807d62e9b4', 2, '佐藤が、技術担当の予定を確かめたうえで、今日中に先方へ返事をする。', 'correct', '課長は「調整をお願いします」「返事は今日中に」と佐藤に振っており、先方の希望する技術担当の同席も踏まえるよう求めている。', null),
       ('807d62e9b4', 3, '技術の担当者が、自分の空いている日を先方へ直接返事をする。', 'surface_keyword_match', '「技術のご担当」は先方が同席を望んだ相手で、返事をする役割は課長から佐藤に振られている。', null),
       ('a151810e90', 0, '測定器の戻りが検査の開始予定より遅く、検査の着手が遅れること', 'correct', '検査は十月一日開始の予定だが、測定器は十月六日まで戻らないと書かれており、予定どおりには始められない。報告書はそれを問題として書いていない。', null),
       ('a151810e90', 1, '製造がまだ八割までしか進んでいないこと', 'stated_but_answers_different_question', '報告書に書かれた事実だが、完了予定は九月三十日でまだ先であり、遅れとは言えない。', null),
       ('a151810e90', 2, '設計の完了が予定より遅れたこと', 'wrong_timeframe', '設計は九月五日に完了済みで、遅れたとはどこにも書かれていない。', null),
       ('a151810e90', 3, '製造の人手が足りず、製造が遅れること', 'unsupported_but_plausible', '遅れの原因としてはありがちだが、人手については報告書に何も書かれていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
