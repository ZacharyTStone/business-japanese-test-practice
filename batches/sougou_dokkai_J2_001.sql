-- sougou_dokkai_J2_001: 6 × sougou_dokkai (J2)
-- generated 2026-09-15T17:59:51+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_dokkai_J2_001', 'sougou_dokkai', 'J2', 'author-composed', '2026-09-15T17:59:51+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id)
values ('5d536c8392', 'sougou_dokkai_J2_001', 'sougou_dokkai', 'J2', 'client_escalation+staff_to_visitor+infer_cause@J2', 'client_escalation', 'staff_to_visitor', 'infer_cause', 'written', null, null, null, '苦情の本当の理由', '先方が困っているのは、何が原因ですか。', 2, '「品物そのものに問題はございませんでした」「数量も注文どおり」と、何が原因でないかを先に並べてから「ただ、」で本題に入る型。原因は到着時刻で、そのために検品が翌朝になり、立ち上げが一日ずれている。丁寧な苦情ほど、原因は「ただ」のあとに来る。', 'A polite complaint clears away what is not the problem first; the cause follows ただ.', '[{"term": "検品", "reading": "けんぴん", "meaning": "goods inspection"}, {"term": "立ち上げ", "reading": "たちあげ", "meaning": "starting up (a line)"}]'::jsonb, '[{"template": "email_thread", "title": "Re: 先日の納品について", "meta": [{"label": "差出人", "value": "あさひ工業 資材課 鈴木"}, {"label": "宛先", "value": "山川商事 営業部 佐藤様"}, {"label": "件名", "value": "Re: 先日の納品について"}, {"label": "日時", "value": "九月十一日 十時三十分"}], "blocks": [{"type": "paragraph", "text": "佐藤様　お世話になっております。あさひ工業の鈴木です。"}, {"type": "paragraph", "text": "先日の納品ですが、品物そのものに問題はございませんでした。数量も注文どおりで、状態も良好です。"}, {"type": "paragraph", "text": "ただ、到着が午後四時を過ぎておりまして、当日中の検品ができませんでした。検品は翌朝になり、その分ラインの立ち上げが一日ずれております。"}, {"type": "quoted_message", "sender": "山川商事 佐藤", "sent_at": "九月十日 十八時", "depth": 1, "text": "本日、ご注文の品を納品いたしました。ご確認のほどよろしくお願いいたします。"}]}]'::jsonb, '[]'::jsonb, null),
       ('5165a67c41', 'sougou_dokkai_J2_001', 'sougou_dokkai', 'J2', 'internal_change+junior_to_senior+infer_next_step@J2', 'internal_change', 'junior_to_senior', 'infer_next_step', 'written', null, null, null, '手続き変更後にすべきこと', '九月中に使った経費がまだ精算されていない社員は、まず何をすべきですか。', 0, '通知には、新しい手続きと、移行期間の扱いの二つが書かれている。九月分は移行前の分なので、紙で九月三十日までに出す。新しい手続きの条項だけを読むと、十月を待つ答えを選んでしまう。', 'The notice describes a new procedure and a transitional rule; September falls under the second.', '[{"term": "精算", "reading": "せいさん", "meaning": "settlement of expenses"}, {"term": "原本", "reading": "げんぽん", "meaning": "the original document"}]'::jsonb, '[{"template": "memo_notice", "title": "経費精算の手続き変更について", "meta": [{"label": "発信者", "value": "経理部"}, {"label": "発信日", "value": "九月一日"}, {"label": "対象", "value": "全社員"}], "blocks": [{"type": "paragraph", "text": "十月一日より、経費精算の手続きを次のとおり変更します。"}, {"type": "numbered", "items": ["紙の申請書は廃止し、社内システムから申請してください。", "領収書は撮影して添付してください。原本の提出は不要です。", "九月分までの精算は、九月三十日までに紙の申請書で提出してください。"]}, {"type": "callout", "tone": "warning", "text": "九月三十日を過ぎた紙の申請書は受け付けられません。"}]}]'::jsonb, '[]'::jsonb, null),
       ('d0f01bbe08', 'sougou_dokkai_J2_001', 'sougou_dokkai', 'J2', 'order_exchange+subordinate_to_superior+infer_intent@J2', 'order_exchange', 'subordinate_to_superior', 'infer_intent', 'written', null, null, null, '先方が本当に求めていること', '先方がこのメールで求めていることは何ですか。', 3, '丁寧な依頼は、第一希望と代案を並べて書くことが多い。ここでは「一回にまとめる」が第一希望、「日程だけ早めに」が代案。金額は了承済みと明記されており、論点になっていない。理由として述べられた倉庫の事情を依頼と取り違えないこと。', 'A polite request states a first choice and a fallback; the stated reason is not itself the ask.', '[{"term": "了承", "reading": "りょうしょう", "meaning": "consent / approval"}, {"term": "受け入れ体制", "reading": "うけいれたいせい", "meaning": "capacity to receive"}]'::jsonb, '[{"template": "email_thread", "title": "Re: お見積りの件", "meta": [{"label": "差出人", "value": "みどり物産 購買部 田中"}, {"label": "宛先", "value": "山川商事 営業部 佐藤様"}, {"label": "件名", "value": "Re: お見積りの件"}, {"label": "日時", "value": "九月十二日 十五時"}], "blocks": [{"type": "paragraph", "text": "お見積り、ありがとうございました。"}, {"type": "paragraph", "text": "金額については社内で了承が得られました。ただ、納入が三回に分かれる点について、倉庫の受け入れ体制の都合で、一回にまとめていただくことは可能でしょうか。"}, {"type": "paragraph", "text": "難しいようでしたら、回数はそのままで結構ですので、各回の日程だけ早めにお知らせいただけますと助かります。"}, {"type": "quoted_message", "sender": "山川商事 佐藤", "sent_at": "九月十日 十一時", "depth": 1, "text": "ご依頼の件、お見積書を添付いたします。納入は三回に分けて行う想定でございます。"}]}]'::jsonb, '[]'::jsonb, null),
       ('239d687cb0', 'sougou_dokkai_J2_001', 'sougou_dokkai', 'J2', 'project_update+subordinate_to_superior+infer_risk@J2', 'project_update', 'subordinate_to_superior', 'infer_risk', 'written', null, null, null, '報告すべき問題', '上司に報告すべき問題はどれですか。', 1, '表は予定と実績を並べており、食い違っているのは試験準備の行だけ。組み立ての五十パーセントは予定どおりで、数字が小さいことと遅れていることは別。担当者の別件対応は原因であって、報告すべき問題そのものではない。', 'Only one row differs between plan and actual; a small number that matches the plan is not a risk.', '[{"term": "実績", "reading": "じっせき", "meaning": "actual (as against plan)"}, {"term": "未着手", "reading": "みちゃくしゅ", "meaning": "not yet started"}]'::jsonb, '[{"template": "progress_report", "title": "案件K 週次報告", "meta": [{"label": "報告者", "value": "技術部 川口"}, {"label": "報告日", "value": "九月十二日"}, {"label": "案件", "value": "案件K"}], "blocks": [{"type": "paragraph", "text": "今週の進捗は次のとおりです。"}, {"type": "table", "columns": ["工程", "予定", "実績"], "rows": [["設計", "完了", "完了"], ["部材手配", "完了", "完了"], ["組み立て", "五十パーセント", "五十パーセント"], ["試験準備", "着手", "未着手"]]}, {"type": "paragraph", "text": "試験準備は、担当者が別件の対応に入っているため着手できていません。試験そのものの日程は動かせません。"}]}]'::jsonb, '[]'::jsonb, null),
       ('bcf3ee0bf3', 'sougou_dokkai_J2_001', 'sougou_dokkai', 'J2', 'scheduling+subordinate_to_superior+compare_versions@J2', 'scheduling', 'subordinate_to_superior', 'compare_versions', 'written', null, null, null, '変更前後を読み比べる', '変更の結果、研修はどうなりますか。', 3, '一日目だけが七日に動き、二日目は「変更なし」でもともと七日。結果として二日が一日に重なる。変更の一覧は、変更のない行も並べて書くことが多く、そこを読み飛ばすと二日間のままだと思い込む。', 'Only one of the two days moves, onto the other; the unchanged line is the one that decides it.', '[{"term": "会場", "reading": "かいじょう", "meaning": "venue"}, {"term": "案内", "reading": "あんない", "meaning": "notification / guidance"}]'::jsonb, '[{"template": "email_thread", "title": "Re: 研修日程の変更", "meta": [{"label": "差出人", "value": "人事部 山本"}, {"label": "宛先", "value": "営業部 各位"}, {"label": "件名", "value": "Re: 研修日程の変更"}, {"label": "日時", "value": "九月十日 十四時"}], "blocks": [{"type": "paragraph", "text": "先にご案内した研修日程を、次のとおり変更します。"}, {"type": "bullets", "items": ["一日目：十月六日（月）→ 十月七日（火）", "二日目：十月七日（火）→ 変更なし", "会場：第一研修室 → 本社ホール"]}, {"type": "quoted_message", "sender": "人事部 山本", "sent_at": "九月二日 十時", "depth": 1, "text": "十月の研修は、六日（月）と七日（火）の二日間、第一研修室で行います。二日とも午前九時開始です。"}]}]'::jsonb, '[]'::jsonb, null),
       ('7438c97fc1', 'sougou_dokkai_J2_001', 'sougou_dokkai', 'J2', 'project_update+junior_to_senior+infer_owner@J2', 'project_update', 'junior_to_senior', 'infer_owner', 'written', null, null, null, '誰が対応すべきか', 'この議事録のあと、次に動くのは誰ですか。', 0, '議事録は三つの担当を定め、最後の段落で技術の確認が済んだことと、検査への影響がないことを述べている。残っているのは価格の見直しで、これは営業の担当。項目の一覧だけを見ると三人とも動くように見える。', 'The list assigns three tasks; the closing paragraph retires two of them.', '[{"term": "軽微", "reading": "けいび", "meaning": "minor"}, {"term": "見直し", "reading": "みなおし", "meaning": "review / revision"}]'::jsonb, '[{"template": "meeting_minutes", "title": "第四回 案件N 打ち合わせ 議事録", "meta": [{"label": "日時", "value": "九月九日 十六時"}, {"label": "場所", "value": "第二会議室"}, {"label": "出席者", "value": "課長、佐藤（営業）、川口（技術）、山本（品質）"}], "blocks": [{"type": "numbered", "items": ["先方からの仕様変更の申し出は、内容を技術で確認のうえ受けるかどうかを決める。", "受ける場合の価格の見直しは営業が行う。", "検査項目への影響は品質が確認する。"]}, {"type": "paragraph", "text": "技術より、変更内容は軽微で対応可能との回答があった。検査項目にも影響しない見込み。"}]}]'::jsonb, '[]'::jsonb, null)
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
       narration_clip_id = excluded.narration_clip_id;

-- Options are replaced wholesale rather than upserted: a corrected item can
-- have fewer options or a different order, and a stale row left behind would
-- be a fifth answer nobody meant to publish.
delete from public.item_options where item_id in ('5d536c8392', '5165a67c41', 'd0f01bbe08', '239d687cb0', 'bcf3ee0bf3', '7438c97fc1');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('5d536c8392', 0, '納品された品物に不具合があったこと', 'unsupported_but_plausible', '苦情の原因として最も想像しやすいが、「品物そのものに問題はございませんでした」と明確に否定されている。', null),
       ('5d536c8392', 1, 'ラインの立ち上げが一日ずれていること', 'stated_but_answers_different_question', 'メールに書かれているとおりだが、これは遅れの結果であって、問われている原因ではない。', null),
       ('5d536c8392', 2, '納品が午後遅くになり、その日のうちに検品できなかったこと', 'correct', '品物と数量に問題はないと明記したうえで、四時過ぎの到着で当日の検品ができなかったと述べている。', null),
       ('5d536c8392', 3, '納品の連絡が届いていなかったこと', 'surface_keyword_match', '引用部分に納品の連絡はあり、それ自体は届いている。問題にされているのは到着の時刻。', null),
       ('5165a67c41', 0, '九月三十日までに、紙の申請書で提出する。', 'correct', '三つ目の項目が九月分までの精算を紙で九月三十日までと定めており、注記がその期限を過ぎたものは受け付けないと念を押している。', null),
       ('5165a67c41', 1, '十月一日を待って、社内システムから申請する。', 'wrong_timeframe', '新しい手続きは十月一日からだが、九月分は紙で九月中に出すよう別に定められている。', null),
       ('5165a67c41', 2, '領収書を撮影して、社内システムに添付する。', 'stated_but_answers_different_question', '変更後の手続きとしては正しいが、九月分の精算にはあてはまらない。', null),
       ('5165a67c41', 3, '領収書の原本を経理部に提出する。', 'surface_keyword_match', '「原本の提出は不要です」と書かれているのは新しい手続きの話で、原本という語だけを拾っている。', null),
       ('d0f01bbe08', 0, '見積金額を下げること。', 'unsupported_but_plausible', '見積りへの返信として最も想像しやすいが、「金額については社内で了承が得られました」と明記されている。', null),
       ('d0f01bbe08', 1, '納入の回数を三回から増やすこと。', 'surface_keyword_match', '回数の話は出てくるが、求められているのはまとめること、つまり減らすほう。', null),
       ('d0f01bbe08', 2, '倉庫の受け入れ体制について相談に乗ること。', 'stated_but_answers_different_question', '倉庫の事情は理由として述べられているだけで、それについての相談は求められていない。', null),
       ('d0f01bbe08', 3, '納入を一回にまとめること。難しければ、各回の日程を早めに知らせること。', 'correct', '第一希望と、それが通らない場合の代案が順に書かれており、どちらも依頼として述べられている。', null),
       ('239d687cb0', 0, '組み立てが五十パーセントしか進んでいないこと', 'stated_but_answers_different_question', '数字としては途中だが、予定も五十パーセントで、予定どおり進んでいる。', null),
       ('239d687cb0', 1, '試験準備に着手できておらず、試験の日程は動かせないこと', 'correct', '予定と実績が食い違っている唯一の工程で、しかも日程を動かして吸収することができないと書かれている。', null),
       ('239d687cb0', 2, '部材の手配が終わっていないこと', 'wrong_timeframe', '部材手配は予定・実績とも「完了」で、すでに済んでいる。', null),
       ('239d687cb0', 3, '担当者が別件の対応に入っていること', 'surface_keyword_match', '未着手の理由として書かれているが、報告すべき問題はそれによって生じた遅れのほう。', null),
       ('bcf3ee0bf3', 0, '十月七日と八日の二日間、本社ホールで行う。', 'unsupported_but_plausible', '一日ずつ後ろにずれたと読めば自然だが、二日目は「変更なし」と明記されている。', null),
       ('bcf3ee0bf3', 1, '十月六日と七日の二日間、本社ホールで行う。', 'wrong_timeframe', '会場の変更だけを反映し、一日目が七日に動いたことを反映していない。', null),
       ('bcf3ee0bf3', 2, '十月七日の一日だけ、第一研修室で行う。', 'surface_keyword_match', '日程は正しいが、会場は本社ホールに変わっている。引用部分の会場をそのまま拾っている。', null),
       ('bcf3ee0bf3', 3, '十月七日の一日だけ、本社ホールで行う。', 'correct', '一日目が七日に動き、二日目はもともと七日で変更なし。同じ日になるので、実質一日になる。', null),
       ('7438c97fc1', 0, '営業の佐藤', 'correct', '技術が対応可能と回答したので変更を受けることになり、受ける場合の価格の見直しは営業の担当と定められている。', null),
       ('7438c97fc1', 1, '技術の川口', 'wrong_timeframe', '技術の確認はすでに終わっており、「対応可能との回答があった」と議事録に書かれている。', null),
       ('7438c97fc1', 2, '品質の山本', 'stated_but_answers_different_question', '検査項目の確認は担当だが、「影響しない見込み」と述べられており、次に動く必要がない。', null),
       ('7438c97fc1', 3, '課長', 'surface_keyword_match', '出席者として名前はあるが、議事録のどの項目でも担当として挙げられていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
