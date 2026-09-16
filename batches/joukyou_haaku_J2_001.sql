-- joukyou_haaku_J2_001: 6 × joukyou_haaku (J2)
-- generated 2026-09-15T17:54:58+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_corridor', 'オフィスの廊下'),
       ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人'),
       ('scene_office_open_floor', '執務フロア全体'),
       ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_reception_counter', '自社の受付カウンター')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('bb6eaa12c9e6836a', '受付に来た顧客が、こう言いました。「今日の二時から資料を見たいのですが。身分証は持っています。申し込みはしていません。」受付の社員はどうすればいいですか。', 'narrator_f', 'in_person'),
       ('c378d815d1268bed', '他部署の担当者がこう言いました。「今日の午後、社内だけで六人ほど集まりたいのですが、どこか取れますか。時間は三時からでも一時からでも構いません。」どうすればいいですか。', 'narrator_f', 'in_person'),
       ('772c599131c5ec56', '上司が部下にこう言いました。「十二日に伝票をまとめて登録しておいてほしいんですが、一時間くらいかかります。いつやってもらうのがいいですか。」', 'narrator_f', 'in_person'),
       ('41ce410bdde65037', '取引先から電話がありました。「見本品を四点、金曜日にお願いできますか。送り先はいつもの住所で結構です。」電話を切る前に、何を確認しておくべきですか。', 'narrator_f', 'in_person'),
       ('6165794d2abe94ac', '他部署の担当者がこう言いました。「一時に、あさひ工業の鈴木さんという方が受付にいらしています。佐藤さんは席を外していますが、どこへご案内すればいいですか。」', 'narrator_f', 'in_person'),
       ('7bc55a7bef686ea9', '同僚がこう言いました。「第一会議室、うちの部署が三時から予約していて、鍵ももう借りてあります。そのあと四時から経理部が続けて使うそうです。終わるのは五時ごろだとか。鍵は誰が返すことになりますか。」', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('joukyou_haaku_J2_001', 'joukyou_haaku', 'J2', 'author-composed', '2026-09-15T17:54:58+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('4bff58fe54', 'joukyou_haaku_J2_001', 'joukyou_haaku', 'J2', 'reception_sign+staff_to_customer+check_condition@J2', 'reception_sign', 'staff_to_customer', 'check_condition', 'in_person', 'scene_reception_counter', null, null, '受付での入館条件', '受付に来た顧客が、こう言いました。「今日の二時から資料を見たいのですが。身分証は持っています。申し込みはしていません。」受付の社員はどうすればいいですか。', 2, '条件は三つあり、顧客は身分証と時間帯の条件は満たしているが、前日までの申し込みを欠いている。一つでも欠ければ当日利用はできず、掲示は翌日以降の案内になると明記している。満たしている条件のほうに目を奪われると誤る。', 'Two of three conditions are met; the missing one is the one the notice says is disqualifying.', '[{"term": "閲覧", "reading": "えつらん", "meaning": "inspection / viewing"}, {"term": "身分証", "reading": "みぶんしょう", "meaning": "identification"}]'::jsonb, '[{"template": "office_sign", "title": "資料閲覧室のご利用について", "meta": [{"label": "掲示者", "value": "総務部"}], "blocks": [{"type": "paragraph", "text": "資料閲覧室は、次の条件を満たす方にご利用いただけます。"}, {"type": "numbered", "items": ["前日までにお申し込みいただいていること", "当日、受付で身分証をご提示いただけること", "ご利用は午前十時から午後四時まで（正午から一時は閉室）"]}, {"type": "callout", "tone": "warning", "text": "お申し込みのない方は、当日のご利用はできません。翌日以降のご案内となります。"}]}]'::jsonb, '[]'::jsonb, 'bb6eaa12c9e6836a', null),
       ('5183736ad7', 'joukyou_haaku_J2_001', 'joukyou_haaku', 'J2', 'meeting_room_board+other_department+choose_action@J2', 'meeting_room_board', 'other_department', 'choose_action', 'in_person', 'scene_meeting_room_table', null, null, '会議室が埋まっている', '他部署の担当者がこう言いました。「今日の午後、社内だけで六人ほど集まりたいのですが、どこか取れますか。時間は三時からでも一時からでも構いません。」どうすればいいですか。', 0, '午後の空きは第一会議室の十三時からと、応接室の二枠。ただし注記により応接室は社外の方がいる場合に限られ、今回は社内だけなので使えない。第一会議室は午前も空いているが、頼まれたのは午後。表の「空き」だけを見ると注記を、依頼だけを見ると表を見落とす。', 'The grid shows three free slots; the note disqualifies two of them.', '[{"term": "応接室", "reading": "おうせつしつ", "meaning": "reception room"}, {"term": "押さえる", "reading": "おさえる", "meaning": "to reserve / hold"}]'::jsonb, '[{"template": "schedule", "title": "会議室 予約状況（九月九日）", "meta": [{"label": "期間", "value": "九月九日（火）"}, {"label": "作成者", "value": "総務部"}], "blocks": [{"type": "table", "columns": ["会議室", "十時〜十二時", "十三時〜十五時", "十五時〜十七時"], "rows": [["第一会議室", "空き", "空き", "営業部"], ["第二会議室", "採用面接", "採用面接", "採用面接"], ["応接室", "空き", "来客", "空き"]]}, {"type": "callout", "tone": "info", "text": "応接室は社外の方がいらっしゃる場合のみご利用ください。"}]}]'::jsonb, '[]'::jsonb, 'c378d815d1268bed', null),
       ('d6bb06d3b8', 'joukyou_haaku_J2_001', 'joukyou_haaku', 'J2', 'office_notice+superior_to_subordinate+choose_time@J2', 'office_notice', 'superior_to_subordinate', 'choose_time', 'in_person', 'scene_office_open_floor', null, null, 'システム停止と作業の時間', '上司が部下にこう言いました。「十二日に伝票をまとめて登録しておいてほしいんですが、一時間くらいかかります。いつやってもらうのがいいですか。」', 3, '停止は九時から三時まで。さらに「前後三十分は不安定」とあるので、安全に一時間使えるのは三時半以降。八時半開始は不安定な時間帯に入るうえ、一時間の作業が九時の停止をまたぐ。注記が答えの範囲を狭めている点がこの型の要。', 'The note about the surrounding thirty minutes is what narrows the window.', '[{"term": "基幹システム", "reading": "きかんシステム", "meaning": "core business system"}, {"term": "伝票", "reading": "でんぴょう", "meaning": "slip / voucher"}]'::jsonb, '[{"template": "memo_notice", "title": "基幹システム停止のお知らせ", "meta": [{"label": "発信者", "value": "情報システム部"}, {"label": "発信日", "value": "九月五日"}, {"label": "対象", "value": "全社員"}], "blocks": [{"type": "paragraph", "text": "設備更新のため、次のとおり基幹システムを停止いたします。"}, {"type": "key_values", "pairs": [{"label": "停止日", "value": "九月十二日（金）"}, {"label": "停止時間", "value": "午前九時から午後三時まで"}]}, {"type": "bullets", "items": ["停止中は伝票の登録・照会ができません。", "停止の前後三十分は、動作が不安定になることがあります。"]}]}]'::jsonb, '[]'::jsonb, '772c599131c5ec56', null),
       ('1deef9802d', 'joukyou_haaku_J2_001', 'joukyou_haaku', 'J2', 'phone_with_notice+staff_to_client+what_to_confirm@J2', 'phone_with_notice', 'staff_to_client', 'what_to_confirm', 'phone', 'scene_phone_desk', null, null, '電話で確認すべきこと', '取引先から電話がありました。「見本品を四点、金曜日にお願いできますか。送り先はいつもの住所で結構です。」電話を切る前に、何を確認しておくべきですか。', 1, '手順は三つあるが、この電話の場で相手に確認すべきなのは受取担当者名だけ。承認は自社内で取るもの、住所はすでに述べられており、繰り越しの規定は相手に聞くことではない。「確認すべきこと」は、誰に対して行う行為かまで含めて選ぶ。', 'Three rules apply, but only one of them is a question for the person on the phone.', '[{"term": "見本品", "reading": "みほんひん", "meaning": "sample product"}, {"term": "翌営業日", "reading": "よくえいぎょうび", "meaning": "the next business day"}]'::jsonb, '[{"template": "memo_notice", "title": "見本品の発送手順の変更", "meta": [{"label": "発信者", "value": "営業部"}, {"label": "発信日", "value": "九月一日"}, {"label": "対象", "value": "営業部員"}], "blocks": [{"type": "paragraph", "text": "九月より、見本品の発送手順を次のとおり変更します。"}, {"type": "numbered", "items": ["先方の受取担当者名を必ず控えること。", "発送は申込の翌営業日。土日祝は翌営業日に繰り越す。", "三点を超える場合は課長の承認を得ること。"]}]}]'::jsonb, '[]'::jsonb, '41ce410bdde65037', null),
       ('2a8263856b', 'joukyou_haaku_J2_001', 'joukyou_haaku', 'J2', 'desk_schedule+other_department+choose_destination@J2', 'desk_schedule', 'other_department', 'choose_destination', 'in_person', 'scene_office_desk_pair', null, null, '来客をどこへ通すか', '他部署の担当者がこう言いました。「一時に、あさひ工業の鈴木さんという方が受付にいらしています。佐藤さんは席を外していますが、どこへご案内すればいいですか。」', 0, '予定表の行は、時刻・来客・対応者・場所が組になっている。同じ佐藤が対応する行が二つあるので、対応者だけで選ぶと十時の行を取ってしまう。来客名と時刻の両方が合う行は一つだけで、担当者が不在であることは案内先を変える理由にならない。', 'Two rows share a host; only one shares the visitor and the time.', '[{"term": "席を外す", "reading": "せきをはずす", "meaning": "to be away from one''s desk"}, {"term": "求職者", "reading": "きゅうしょくしゃ", "meaning": "job applicant"}]'::jsonb, '[{"template": "schedule", "title": "本日の来客予定", "meta": [{"label": "期間", "value": "九月十日（水）"}, {"label": "作成者", "value": "営業部 川口"}], "blocks": [{"type": "table", "columns": ["時刻", "来客", "対応", "場所"], "rows": [["十時", "みどり物産 田中様", "営業部 佐藤", "第一会議室"], ["十三時", "あさひ工業 鈴木様（二名）", "営業部 佐藤", "応接室"], ["十五時", "求職者 三名", "人事部", "第二会議室"]]}]}]'::jsonb, '[]'::jsonb, '6165794d2abe94ac', null),
       ('4ff5cfd876', 'joukyou_haaku_J2_001', 'joukyou_haaku', 'J2', 'meeting_room_board+peer_to_peer+choose_owner@J2', 'meeting_room_board', 'peer_to_peer', 'choose_owner', 'in_person', 'scene_corridor', null, null, '誰が鍵を返すか', '同僚がこう言いました。「第一会議室、うちの部署が三時から予約していて、鍵ももう借りてあります。そのあと四時から経理部が続けて使うそうです。終わるのは五時ごろだとか。鍵は誰が返すことになりますか。」', 0, '受け取る部署と返す部署が別に定められている点が一つ目の分かれ目、返す先が時刻で変わる点が二つ目。最後に使うのは経理部で、終了は五時ごろなので六時前、したがって総務部に返す。二つの条件を順に当てはめる必要がある。', 'Who collects and who returns are different rules; where to return depends on the time.', '[{"term": "返却", "reading": "へんきゃく", "meaning": "return (of a borrowed thing)"}, {"term": "警備室", "reading": "けいびしつ", "meaning": "security office"}]'::jsonb, '[{"template": "office_sign", "title": "会議室の鍵について", "meta": [{"label": "掲示者", "value": "総務部"}], "blocks": [{"type": "bullets", "items": ["鍵は予約した部署が総務部で受け取ってください。", "返却は、その日の最後に使った部署が行ってください。", "午後六時以降は、警備室にお返しください。"]}]}]'::jsonb, '[]'::jsonb, '7bc55a7bef686ea9', null)
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
delete from public.item_options where item_id in ('4bff58fe54', '5183736ad7', 'd6bb06d3b8', '1deef9802d', '2a8263856b', '4ff5cfd876');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('4bff58fe54', 0, '身分証が確認できたので、二時からの利用を認める。', 'ignores_the_document', '身分証の条件は満たしているが、前日までの申し込みという条件を満たしていない。', null),
       ('4bff58fe54', 1, '正午から一時は閉室なので、一時以降に来るよう伝える。', 'right_action_wrong_condition', '閉室の条件は本当だが、二時の希望はもともとその時間帯を外しており、断る理由にならない。', null),
       ('4bff58fe54', 2, '申し込みがないため当日は利用できないと伝え、翌日以降の利用を案内する。', 'correct', '掲示は申し込みのない当日利用を明確に断り、翌日以降の案内になると書いている。', null),
       ('4bff58fe54', 3, '総務部の担当者に、代わりに申し込みをしてもらう。', 'wrong_action_owner', '申し込みは利用者本人がするもので、掲示にも代理申し込みの定めはない。', null),
       ('5183736ad7', 0, '第一会議室の十三時からを取る。', 'correct', '午後で空いているのは第一会議室の十三時からと応接室の二枠だが、応接室は社外の方がいる場合に限られるので、残るのはここだけ。', null),
       ('5183736ad7', 1, '応接室の十五時からを取る。', 'ignores_the_document', '表の上では空いているが、注記が応接室の利用を社外の方がいる場合に限っており、社内だけの集まりには使えない。', null),
       ('5183736ad7', 2, '第一会議室の十時からを取る。', 'ignores_the_request', '表のうえでは空いているが、頼まれたのは午後で、一時からでも三時からでも構わないと言われている。', null),
       ('5183736ad7', 3, '第二会議室を使えるよう、人事部に面接をずらしてもらう。', 'wrong_action_owner', '部屋を空けさせる相手が違う。予約表は人事部の面接を終日押さえており、こちらの都合で動かすものではない。', null),
       ('d6bb06d3b8', 0, '午後三時ちょうどに始める。', 'right_action_wrong_condition', '停止そのものは終わっているが、前後三十分は不安定と書かれており、一時間の作業には向かない。', null),
       ('d6bb06d3b8', 1, '午前九時前の、八時半に始める。', 'ignores_the_document', '停止前ではあるが、こちらも「前後三十分」に入っており、しかも一時間の作業は停止時刻をまたいでしまう。', null),
       ('d6bb06d3b8', 2, '情報システム部に停止を延期してもらう。', 'wrong_action_owner', '通知は全社員あての決定事項で、一件の作業のために動かすものではない。', null),
       ('d6bb06d3b8', 3, '午後三時半より後に始める。', 'correct', '停止は午後三時までで、前後三十分は不安定になるとあるので、確実に動くのは三時半以降。', null),
       ('1deef9802d', 0, '送り先の住所', 'ignores_the_request', '手順に住所の確認はなく、相手も「いつもの住所で結構です」と述べている。', null),
       ('1deef9802d', 1, '先方の受取担当者の名前', 'correct', '手順の一つ目が受取担当者名を必ず控えることと定めており、相手はまだ名前を告げていない。', null),
       ('1deef9802d', 2, '課長が承認したかどうか', 'wrong_action_owner', '三点を超えるので承認は必要だが、それは電話のあとに自分が課長から取るもので、相手に聞くことではない。', null),
       ('1deef9802d', 3, '土日を挟んだ場合に受け取れるかどうか', 'right_action_wrong_condition', '繰り越しの定めは本当だが、金曜の申込なら発送は翌営業日で、相手に確認を求める点ではない。', null),
       ('2a8263856b', 0, '応接室へ案内する。', 'correct', '予定表の十三時の行に、あさひ工業 鈴木様の場所として応接室が書かれている。', null),
       ('2a8263856b', 1, '第一会議室へ案内する。', 'ignores_the_request', '予定表にある部屋ではあるが、それは十時のみどり物産の行で、受付に来ているのは鈴木様。', null),
       ('2a8263856b', 2, '人事部の担当者に、代わりに案内してもらう。', 'wrong_action_owner', '人事部が対応するのは十五時の求職者で、この来客の案内を頼む相手ではない。', null),
       ('2a8263856b', 3, '佐藤が戻るまで受付で待ってもらう。', 'ignores_the_document', '予定表は場所を定めており、担当者の不在は案内先を変える理由にならない。', null),
       ('4ff5cfd876', 0, '経理部が、総務部に返す。', 'correct', '返却はその日の最後に使った部署が行うと定められており、最後は経理部。終わるのは五時ごろで六時前なので、返す先は総務部。', null),
       ('4ff5cfd876', 1, '自分の部署が、総務部に返す。', 'wrong_action_owner', '鍵を受け取るのは予約した部署だが、返すのは最後に使った部署で、規則が分けて書かれている。', null),
       ('4ff5cfd876', 2, '経理部が、警備室に返す。', 'right_action_wrong_condition', '警備室に返すのは午後六時以降の場合で、終わるのは五時ごろなのでこの条件に当たらない。', null),
       ('4ff5cfd876', 3, '総務部が、使い終わった会議室から回収する。', 'ignores_the_document', '掲示は返しに行くよう定めており、総務部が回収するとはどこにも書かれていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
