-- sougou_choukai_J2_001: 6 × sougou_choukai (J2)
-- generated 2026-09-19T17:03:52+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_meeting_room', '取引先の会議室'),
       ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人'),
       ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_seminar_hall', 'セミナー会場'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('e8078990730d2494', '展示会の出展について、結論はどうなりましたか。', 'narrator_f', 'in_person'),
       ('3795edbd23a1def0', '来月の展示会、ブースは去年と同じ二区画で出す方向でしたよね。', 'manager_m', 'in_person'),
       ('4856b028c164b382', 'はい。ただ、予算が去年より一割減っていまして、二区画だと備品が借りられません。', 'staff_junior_m', 'in_person'),
       ('33a77b8d8fa0d517', 'では一区画に減らしますか。', 'manager_m', 'in_person'),
       ('37607d40998c2c37', 'いや、区画は二つのままでいきましょう。備品は社内にあるものを運びます。', 'staff_mid_f', 'in_person'),
       ('631ecc3a8f82c865', '承知しました。運搬の手配をいたします。', 'staff_junior_m', 'in_person'),
       ('25c7c1a4fbc76235', 'いち', 'narrator_f', 'in_person'),
       ('37d1c1197647f26e', '一区画に減らして出展する。', 'narrator_f', 'in_person'),
       ('6e34bf5479a4824e', 'に', 'narrator_f', 'in_person'),
       ('38514cc8ea12f032', '予算を一割増やして備品を借りる。', 'narrator_f', 'in_person'),
       ('a94822f17a881031', 'さん', 'narrator_f', 'in_person'),
       ('4acf7f7296f7d3c9', '二区画のまま出展し、備品は社内から運ぶ。', 'narrator_f', 'in_person'),
       ('5577d7cacee29a6c', 'よん', 'narrator_f', 'in_person'),
       ('42e249f0a811d695', '備品の運搬を外部の業者に頼む。', 'narrator_f', 'in_person'),
       ('e7f22d5c13a68235', '現在、試作品が遅れている原因は何ですか。', 'narrator_f', 'in_person'),
       ('1374320693346177', '試作品、今週中に上がる予定でしたよね。どうなっていますか。', 'manager_m', 'video'),
       ('8659f5961fc3d238', 'すみません、来週に延びそうです。最初は部品の入荷待ちだったのですが。', 'staff_junior_m', 'video'),
       ('939053d7445a8873', '部品は届いたんですか。', 'manager_m', 'video'),
       ('bd80737a971399c5', 'はい、月曜に届きました。ただ、仕様の変更が先週入りまして、図面の引き直しに時間がかかっています。', 'staff_junior_m', 'video'),
       ('154189057d94315c', 'なるほど。では図面が上がり次第、すぐ組み立てに入れますね。', 'manager_m', 'video'),
       ('ef9e70c8a41cffcd', '仕様が変わり、図面を引き直しているから', 'narrator_f', 'in_person'),
       ('ba9897bfc946b048', '部品がまだ届いていないから', 'narrator_f', 'in_person'),
       ('8f9d9b5cb2f8b566', '組み立てを担当する人が足りないから', 'narrator_f', 'in_person'),
       ('ad46f55980cb0115', '先輩社員が図面の確認に時間をかけているから', 'narrator_f', 'in_person'),
       ('a336102a62c5f18f', '外からの問い合わせは、まずどこが受けることになりましたか。', 'narrator_f', 'in_person'),
       ('50c3ca30fc47b30c', '新しい手順について、外からの問い合わせが増えると思います。窓口を決めておきましょう。', 'manager_m', 'in_person'),
       ('6b4962d44ab4bc07', '内容によっては、こちらの部署で受けたほうが早いものもありますが。', 'staff_junior_m', 'in_person'),
       ('428ac52972723145', 'そうですね。ただ、入り口は一つにしたいので、まず営業部で受けます。', 'manager_m', 'in_person'),
       ('3c48304745c92c40', 'では営業部で受けて、技術的な内容だけそちらにお回しする形でよろしいですか。', 'staff_mid_f', 'in_person'),
       ('b97dd9bbb8469fa6', 'はい、それで結構です。', 'staff_junior_m', 'in_person'),
       ('f15ce79da033f79a', '内容によって、営業部と他部署が振り分けて受ける。', 'narrator_f', 'in_person'),
       ('ef109c18347bea2d', '技術的な内容は、はじめから他部署が受ける。', 'narrator_f', 'in_person'),
       ('d8678c498cd0a7c1', '課長がすべての問い合わせを受ける。', 'narrator_f', 'in_person'),
       ('ef58c10a2f6f1c1d', '営業部が受け、技術的な内容だけ他部署に回す。', 'narrator_f', 'in_person'),
       ('f75de607b76ff1f5', '納入はどうなりましたか。', 'narrator_f', 'in_person'),
       ('7e4aec108b24baa4', '先月の注文ですが、五十個を六十個に増やしたいのです。', 'manager_m', 'phone'),
       ('d7faf313036cc39f', '六十個ですね。納期は十五日のままでよろしいでしょうか。', 'staff_junior_m', 'phone'),
       ('5075ddd6856f30a0', 'できれば十日に早めていただきたいのですが。', 'manager_m', 'phone'),
       ('11542aca3bcc8ffe', '十日ですと、四十個までしかご用意できません。六十個でしたら十五日になります。', 'staff_junior_m', 'phone'),
       ('164116fcb0d7a434', '分かりました。では数のほうを優先します。', 'manager_m', 'phone'),
       ('f7a9055874dfea21', '四十個を十日に納入する。', 'narrator_f', 'in_person'),
       ('e247a25ab3b60375', '六十個を十五日に納入する。', 'narrator_f', 'in_person'),
       ('4fb66fcdcdfdb929', '六十個を十日に納入する。', 'narrator_f', 'in_person'),
       ('20deff34267f4234', '五十個を十五日に納入する。', 'narrator_f', 'in_person'),
       ('bca2f430caf21e61', '前回の資料と比べて、変わったのはどの点ですか。', 'narrator_f', 'in_person'),
       ('ae1e971c423a541d', '先方から新しい資料が届きました。前回と比べて、金額は同じでした。', 'manager_m', 'in_person'),
       ('786d2b079f4d85fe', 'では中身は変わっていないということですか。', 'staff_junior_m', 'in_person'),
       ('78e89e9369ac7a9d', 'いえ、合計は同じなんですが、支払いの回数が三回から二回に変わっています。', 'manager_m', 'in_person'),
       ('9767534e99ab2466', 'ということは、一回あたりの支払額が増えるわけですね。経理に伝えておいてください。', 'staff_junior_m', 'in_person'),
       ('70a013f6e97c4297', 'はい、すぐに連絡します。', 'manager_m', 'in_person'),
       ('a3de8593f6d16fe2', '支払いの合計金額が上がった点', 'narrator_f', 'in_person'),
       ('70b49cd2bbc4c842', '支払いの期限が早まった点', 'narrator_f', 'in_person'),
       ('02405a9688849674', '経理の担当者が変わった点', 'narrator_f', 'in_person'),
       ('574c94aa2d8b7e4c', '支払いの回数が三回から二回に減った点', 'narrator_f', 'in_person'),
       ('28dde1b2c8756c6f', '自社の営業担当は、このあとまず何をしますか。', 'narrator_f', 'in_person'),
       ('48971d4c54401230', '本日の内容で、社内の会議にかけてみます。', 'manager_m', 'in_person'),
       ('dfd70558ea0ce0dc', 'ありがとうございます。資料をお送りしたほうがよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('49b42789fc979189', '本日いただいたもので足ります。ただ、価格の内訳だけ、別にいただけますか。', 'manager_m', 'in_person'),
       ('b1ac00ea5f5bce60', '承知しました。明日中にお送りいたします。', 'staff_junior_m', 'in_person'),
       ('6e68aec21d9ca4c7', '助かります。会議は来週の火曜です。', 'manager_m', 'in_person'),
       ('46d0bd8e736c0b68', '価格の内訳を明日中に先方へ送る。', 'narrator_f', 'in_person'),
       ('1362314b485730b6', '本日の資料一式を改めて先方へ送る。', 'narrator_f', 'in_person'),
       ('131cf20416b6da23', '来週の火曜の会議に出席する。', 'narrator_f', 'in_person'),
       ('89791fcc0f5f2957', '社内の会議に本日の内容をかける。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choukai_J2_001', 'sougou_choukai', 'J2', 'author-composed', '2026-09-19T17:03:52+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('8f4b311918', 'sougou_choukai_J2_001', 'sougou_choukai', 'J2', 'team_meeting+junior_to_senior+what_was_decided@J2', 'team_meeting', 'junior_to_senior', 'what_was_decided', 'in_person', 'scene_meeting_room_table', null, null, '展示会の出展規模の結論', '展示会の出展について、結論はどうなりましたか。', 2, '会話の途中で「一区画に減らしますか」という案が出るが、課長が否定して二区画のままに決めている。途中で出た案をそのまま答えにすると誤る。予算を増やす話も、外部業者に頼む話も出ていない。', 'A proposal made mid-conversation is overruled; the decision is the manager''s, at the end.', '[{"term": "区画", "reading": "くかく", "meaning": "a booth section"}, {"term": "手配", "reading": "てはい", "meaning": "arrangements"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "先輩社員", "text": "来月の展示会、ブースは去年と同じ二区画で出す方向でしたよね。", "clip_id": "3795edbd23a1def0"}, {"speaker_role": "後輩社員", "text": "はい。ただ、予算が去年より一割減っていまして、二区画だと備品が借りられません。", "clip_id": "4856b028c164b382"}, {"speaker_role": "先輩社員", "text": "では一区画に減らしますか。", "clip_id": "33a77b8d8fa0d517"}, {"speaker_role": "課長", "text": "いや、区画は二つのままでいきましょう。備品は社内にあるものを運びます。", "clip_id": "37607d40998c2c37"}, {"speaker_role": "後輩社員", "text": "承知しました。運搬の手配をいたします。", "clip_id": "631ecc3a8f82c865"}]'::jsonb, 'e8078990730d2494', null),
       ('0534e27128', 'sougou_choukai_J2_001', 'sougou_choukai', 'J2', 'video_meeting+junior_to_senior+why_delayed@J2', 'video_meeting', 'junior_to_senior', 'why_delayed', 'video', 'scene_video_call_laptop', null, null, '試作品の遅れの原因', '現在、試作品が遅れている原因は何ですか。', 0, '遅れの原因は途中で入れ替わっている。部品の入荷待ちは「最初は」と断ったうえで述べられ、「月曜に届きました」と解消済み。今の原因は仕様変更にともなう図面の引き直し。最初に出た原因をそのまま答えると誤る。', 'The cause changes mid-conversation: the first one is explicitly resolved.', '[{"term": "試作品", "reading": "しさくひん", "meaning": "prototype"}, {"term": "仕様", "reading": "しよう", "meaning": "specification"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "先輩社員", "text": "試作品、今週中に上がる予定でしたよね。どうなっていますか。", "clip_id": "1374320693346177"}, {"speaker_role": "後輩社員", "text": "すみません、来週に延びそうです。最初は部品の入荷待ちだったのですが。", "clip_id": "8659f5961fc3d238"}, {"speaker_role": "先輩社員", "text": "部品は届いたんですか。", "clip_id": "939053d7445a8873"}, {"speaker_role": "後輩社員", "text": "はい、月曜に届きました。ただ、仕様の変更が先週入りまして、図面の引き直しに時間がかかっています。", "clip_id": "bd80737a971399c5"}, {"speaker_role": "先輩社員", "text": "なるほど。では図面が上がり次第、すぐ組み立てに入れますね。", "clip_id": "154189057d94315c"}]'::jsonb, 'e7f22d5c13a68235', null),
       ('1122d7e730', 'sougou_choukai_J2_001', 'sougou_choukai', 'J2', 'presentation+other_department+who_decides@J2', 'presentation', 'other_department', 'who_decides', 'in_person', 'scene_seminar_hall', null, null, '問い合わせ窓口の担当', '外からの問い合わせは、まずどこが受けることになりましたか。', 3, '「入り口は一つにしたい」という課長の言葉が決め手で、窓口は営業部に一本化される。技術的な内容が他部署に回るのは、受けたあとの話。振り分けて受ける案は出たが採用されていない。', '「入り口は一つに」 settles it: one intake point, with a hand-off afterwards.', '[{"term": "窓口", "reading": "まどぐち", "meaning": "point of contact"}, {"term": "回す", "reading": "まわす", "meaning": "to pass on / forward"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "課長", "text": "新しい手順について、外からの問い合わせが増えると思います。窓口を決めておきましょう。", "clip_id": "50c3ca30fc47b30c"}, {"speaker_role": "他部署の担当者", "text": "内容によっては、こちらの部署で受けたほうが早いものもありますが。", "clip_id": "6b4962d44ab4bc07"}, {"speaker_role": "課長", "text": "そうですね。ただ、入り口は一つにしたいので、まず営業部で受けます。", "clip_id": "428ac52972723145"}, {"speaker_role": "先輩社員", "text": "では営業部で受けて、技術的な内容だけそちらにお回しする形でよろしいですか。", "clip_id": "3c48304745c92c40"}, {"speaker_role": "他部署の担当者", "text": "はい、それで結構です。", "clip_id": "b97dd9bbb8469fa6"}]'::jsonb, 'a336102a62c5f18f', null),
       ('bf56a09591', 'sougou_choukai_J2_001', 'sougou_choukai', 'J2', 'conference_call+staff_to_client+dates_and_numbers@J2', 'conference_call', 'staff_to_client', 'dates_and_numbers', 'phone', 'scene_phone_desk', null, null, '納入数量と日付の確定', '納入はどうなりましたか。', 1, '数量と日付が二者択一になっている。十日なら四十個、六十個なら十五日。取引先が「数のほうを優先します」と述べたので、六十個・十五日に決まる。最後の一言が何を選んだのかを言い換えている点が、この型の要。', 'The final line names a priority rather than a number; the pairing has to be reconstructed.', '[{"term": "納入", "reading": "のうにゅう", "meaning": "delivery (to a customer)"}, {"term": "優先", "reading": "ゆうせん", "meaning": "to prioritise"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "取引先の担当者", "text": "先月の注文ですが、五十個を六十個に増やしたいのです。", "clip_id": "7e4aec108b24baa4"}, {"speaker_role": "自社の営業担当", "text": "六十個ですね。納期は十五日のままでよろしいでしょうか。", "clip_id": "d7faf313036cc39f"}, {"speaker_role": "取引先の担当者", "text": "できれば十日に早めていただきたいのですが。", "clip_id": "5075ddd6856f30a0"}, {"speaker_role": "自社の営業担当", "text": "十日ですと、四十個までしかご用意できません。六十個でしたら十五日になります。", "clip_id": "11542aca3bcc8ffe"}, {"speaker_role": "取引先の担当者", "text": "分かりました。では数のほうを優先します。", "clip_id": "164116fcb0d7a434"}]'::jsonb, 'f75de607b76ff1f5', null),
       ('ba7233ff60', 'sougou_choukai_J2_001', 'sougou_choukai', 'J2', 'desk_huddle+junior_to_senior+what_changed@J2', 'desk_huddle', 'junior_to_senior', 'what_changed', 'in_person', 'scene_office_desk_pair', null, null, '前回から変わった点', '前回の資料と比べて、変わったのはどの点ですか。', 3, '合計金額は「同じ」と二度確認され、変わったのは支払いの回数。「一回あたりの支払額が増える」は回数が減った結果であって、合計が上がったわけではない。同じ数字が別の意味で出てくる点が、この型の落とし穴。', 'The total is unchanged; only its division is. The per-instalment rise is a consequence, not a change in total.', '[{"term": "合計", "reading": "ごうけい", "meaning": "total"}, {"term": "経理", "reading": "けいり", "meaning": "accounting (department)"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "後輩社員", "text": "先方から新しい資料が届きました。前回と比べて、金額は同じでした。", "clip_id": "ae1e971c423a541d"}, {"speaker_role": "先輩社員", "text": "では中身は変わっていないということですか。", "clip_id": "786d2b079f4d85fe"}, {"speaker_role": "後輩社員", "text": "いえ、合計は同じなんですが、支払いの回数が三回から二回に変わっています。", "clip_id": "78e89e9369ac7a9d"}, {"speaker_role": "先輩社員", "text": "ということは、一回あたりの支払額が増えるわけですね。経理に伝えておいてください。", "clip_id": "9767534e99ab2466"}, {"speaker_role": "後輩社員", "text": "はい、すぐに連絡します。", "clip_id": "70a013f6e97c4297"}]'::jsonb, 'bca2f430caf21e61', null),
       ('e42ed7e923', 'sougou_choukai_J2_001', 'sougou_choukai', 'J2', 'client_meeting+staff_to_client+next_step@J2', 'client_meeting', 'staff_to_client', 'next_step', 'in_person', 'scene_client_meeting_room', null, null, '打ち合わせのあとの段取り', '自社の営業担当は、このあとまず何をしますか。', 0, '資料一式を送る申し出は断られ、代わりに価格の内訳だけを明日中に送ることになった。社内会議にかけるのは先方の行動で、来週火曜の会議も先方のもの。誰の行動かを取り違えると誤る。', 'The offer is declined and replaced by a narrower one; the meeting belongs to the other side.', '[{"term": "内訳", "reading": "うちわけ", "meaning": "breakdown (of a price)"}, {"term": "会議にかける", "reading": "かいぎにかける", "meaning": "to put before a meeting"}]'::jsonb, '[]'::jsonb, '[{"speaker_role": "取引先の担当者", "text": "本日の内容で、社内の会議にかけてみます。", "clip_id": "48971d4c54401230"}, {"speaker_role": "自社の営業担当", "text": "ありがとうございます。資料をお送りしたほうがよろしいでしょうか。", "clip_id": "dfd70558ea0ce0dc"}, {"speaker_role": "取引先の担当者", "text": "本日いただいたもので足ります。ただ、価格の内訳だけ、別にいただけますか。", "clip_id": "49b42789fc979189"}, {"speaker_role": "自社の営業担当", "text": "承知しました。明日中にお送りいたします。", "clip_id": "b1ac00ea5f5bce60"}, {"speaker_role": "取引先の担当者", "text": "助かります。会議は来週の火曜です。", "clip_id": "6e68aec21d9ca4c7"}]'::jsonb, '28dde1b2c8756c6f', null)
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
delete from public.item_options where item_id in ('8f4b311918', '0534e27128', '1122d7e730', 'bf56a09591', 'ba7233ff60', 'e42ed7e923');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('8f4b311918', 0, '一区画に減らして出展する。', 'superseded_by_later_turn', '先輩が案として出したが、課長が「いや」と明確に否定して二区画のままに決めている。', '37d1c1197647f26e'),
       ('8f4b311918', 1, '予算を一割増やして備品を借りる。', 'unsupported_but_plausible', '予算が一割減ったことは述べられているが、増やすという話は誰もしていない。', '38514cc8ea12f032'),
       ('8f4b311918', 2, '二区画のまま出展し、備品は社内から運ぶ。', 'correct', '課長が「区画は二つのまま」「備品は社内にあるものを運びます」と決めており、後輩もそれを受けている。', '4acf7f7296f7d3c9'),
       ('8f4b311918', 3, '備品の運搬を外部の業者に頼む。', 'stated_by_wrong_speaker', '運搬の手配をすると言ったのは後輩で、社内から運ぶという課長の決定に沿った話。外部業者には触れていない。', '42e249f0a811d695'),
       ('0534e27128', 0, '仕様が変わり、図面を引き直しているから', 'correct', '後輩が「ただ、仕様の変更が先週入りまして、図面の引き直しに時間がかかっています」と、今の原因として述べている。', 'ef9e70c8a41cffcd'),
       ('0534e27128', 1, '部品がまだ届いていないから', 'superseded_by_later_turn', '最初の原因ではあったが、「月曜に届きました」と解消済みであることが述べられている。', 'ba9897bfc946b048'),
       ('0534e27128', 2, '組み立てを担当する人が足りないから', 'unsupported_but_plausible', '遅れの原因としてはありうるが、人手については誰も触れていない。', '8f9d9b5cb2f8b566'),
       ('0534e27128', 3, '先輩社員が図面の確認に時間をかけているから', 'stated_by_wrong_speaker', '図面の話をしているのは後輩で、先輩は確認を担当しているとは述べていない。', 'ad46f55980cb0115'),
       ('1122d7e730', 0, '内容によって、営業部と他部署が振り分けて受ける。', 'superseded_by_later_turn', '他部署の担当者がそう提案したが、課長が「入り口は一つにしたい」と述べて採らなかった。', 'f15ce79da033f79a'),
       ('1122d7e730', 1, '技術的な内容は、はじめから他部署が受ける。', 'surface_keyword_match', '「技術的な内容」は会話に出てくるが、それは営業部が受けたあとに回す分であって、入り口ではない。', 'ef109c18347bea2d'),
       ('1122d7e730', 2, '課長がすべての問い合わせを受ける。', 'stated_by_wrong_speaker', '課長は窓口を決める側であって、自分が受けるとは述べていない。', 'd8678c498cd0a7c1'),
       ('1122d7e730', 3, '営業部が受け、技術的な内容だけ他部署に回す。', 'correct', '課長が「まず営業部で受けます」と決め、先輩の整理に他部署の担当者も同意している。', 'ef58c10a2f6f1c1d'),
       ('bf56a09591', 0, '四十個を十日に納入する。', 'superseded_by_later_turn', '早めた場合の条件として示されたが、取引先が数を優先すると述べて選ばなかった。', 'f7a9055874dfea21'),
       ('bf56a09591', 1, '六十個を十五日に納入する。', 'correct', '「数のほうを優先します」という取引先の言葉が、六十個・十五日という組み合わせを選んだことを意味する。', 'e247a25ab3b60375'),
       ('bf56a09591', 2, '六十個を十日に納入する。', 'unsupported_but_plausible', '取引先の当初の希望を両方かなえた形だが、営業担当が十日では四十個までと明確に述べている。', '4fb66fcdcdfdb929'),
       ('bf56a09591', 3, '五十個を十五日に納入する。', 'surface_keyword_match', '五十個は先月の注文の数で、会話の冒頭で六十個に増やすと述べられている。', '20deff34267f4234'),
       ('ba7233ff60', 0, '支払いの合計金額が上がった点', 'surface_keyword_match', '「一回あたりの支払額が増える」とは言われているが、合計は「同じ」と二度述べられている。', 'a3de8593f6d16fe2'),
       ('ba7233ff60', 1, '支払いの期限が早まった点', 'unsupported_but_plausible', '支払い条件の変更として想像しやすいが、期限については何も述べられていない。', '70b49cd2bbc4c842'),
       ('ba7233ff60', 2, '経理の担当者が変わった点', 'stated_by_wrong_speaker', '経理は連絡先として出てくるだけで、担当が変わったとは誰も言っていない。', '02405a9688849674'),
       ('ba7233ff60', 3, '支払いの回数が三回から二回に減った点', 'correct', '後輩が「支払いの回数が三回から二回に変わっています」と、変わった点として明確に述べている。', '574c94aa2d8b7e4c'),
       ('e42ed7e923', 0, '価格の内訳を明日中に先方へ送る。', 'correct', '「価格の内訳だけ、別にいただけますか」という依頼に「明日中にお送りいたします」と答えている。', '46d0bd8e736c0b68'),
       ('e42ed7e923', 1, '本日の資料一式を改めて先方へ送る。', 'superseded_by_later_turn', '営業担当が申し出たが、「本日いただいたもので足ります」と断られている。', '1362314b485730b6'),
       ('e42ed7e923', 2, '来週の火曜の会議に出席する。', 'surface_keyword_match', '会議の日は述べられているが、出席するのは先方の社内会議で、営業担当が呼ばれてはいない。', '131cf20416b6da23'),
       ('e42ed7e923', 3, '社内の会議に本日の内容をかける。', 'stated_by_wrong_speaker', '社内の会議にかけると言ったのは取引先の担当者で、自社側の行動ではない。', '89791fcc0f5f2957')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
