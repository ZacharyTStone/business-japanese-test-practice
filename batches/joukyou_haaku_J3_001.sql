-- joukyou_haaku_J3_001: 2 × joukyou_haaku (J3)
-- generated 2026-09-18T08:50:49+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_corridor', 'オフィスの廊下'),
       ('scene_phone_desk', 'デスクで固定電話')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('6d87427e661a0396', '上司が掲示を見ながら、部下にこう言いました。「明日の十時から第二会議室でお客様と打ち合わせをする。お客様は三人だ。部屋は私たちの部で予約してある。準備は誰がやるのか、確認しておいてくれ。」準備は誰がすればいいですか。', 'narrator_f', 'in_person'),
       ('4d660023c95c3c22', '外出中の先輩から電話がありました。「今日の三時からの会議で使うプロジェクターを、総務で借りておいてもらえるかな。今、一時を過ぎたところだよね。」どうすればいいですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('joukyou_haaku_J3_001', 'joukyou_haaku', 'J3', 'manual-load', '2026-09-18T08:50:49+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('d1f4df0c3f', 'joukyou_haaku_J3_001', 'joukyou_haaku', 'J3', 'meeting_room_board+subordinate_to_superior+choose_owner@J3', 'meeting_room_board', 'subordinate_to_superior', 'choose_owner', 'in_person', 'scene_corridor', null, null, '会議室の準備を誰がするか', '上司が掲示を見ながら、部下にこう言いました。「明日の十時から第二会議室でお客様と打ち合わせをする。お客様は三人だ。部屋は私たちの部で予約してある。準備は誰がやるのか、確認しておいてくれ。」準備は誰がすればいいですか。', 3, '掲示では、準備は予約した部署、飲み物は来客のときに総務部、片付けは使った部署と、三つが分かれている。上司の話から、予約したのは自分たちの部で、お客様が3人来ると分かる。だから準備は自分たちで、飲み物は総務部に頼む。片付けの話は聞かれていない。', 'The sign splits the work three ways; the manager''s words say who booked the room and that guests are coming, which decides who does what.', '[{"term": "予約", "reading": "よやく", "meaning": "reservation / booking"}, {"term": "片付け", "reading": "かたづけ", "meaning": "tidying up"}]'::jsonb, '[{"template": "office_sign", "title": "会議室のご利用について", "meta": [{"label": "掲示者", "value": "総務部"}], "blocks": [{"type": "bullets", "items": ["机、椅子、プロジェクターの準備は、予約した部署が行ってください。", "お客様がいらっしゃる場合は、総務部が飲み物を用意します。前日までに人数をお知らせください。", "使ったあとの片付けは、使った部署が行ってください。"]}]}]'::jsonb, '[]'::jsonb, '6d87427e661a0396', null),
       ('00f53e44f4', 'joukyou_haaku_J3_001', 'joukyou_haaku', 'J3', 'phone_with_notice+junior_to_senior+choose_action@J3', 'phone_with_notice', 'junior_to_senior', 'choose_action', 'phone', 'scene_phone_desk', null, null, '備品の貸し出し時間を過ぎている', '外出中の先輩から電話がありました。「今日の三時からの会議で使うプロジェクターを、総務で借りておいてもらえるかな。今、一時を過ぎたところだよね。」どうすればいいですか。', 1, '通知では、当日の貸し出しは正午までの申し込みが条件。電話で今が1時過ぎだと分かるので、今日は借りられない。明日の申し込みは今日の会議には役に立たない。まず先輩に借りられないことを伝えるのが先。', 'The notice sets a noon cut-off; the call tells you it is already past one, so today''s loan is impossible and the senior needs to know.', '[{"term": "備品", "reading": "びひん", "meaning": "office equipment"}, {"term": "正午", "reading": "しょうご", "meaning": "noon"}]'::jsonb, '[{"template": "memo_notice", "title": "備品の貸し出しについて", "meta": [{"label": "発信者", "value": "総務部"}, {"label": "発信日", "value": "4月1日"}, {"label": "対象", "value": "全社員"}], "blocks": [{"type": "paragraph", "text": "プロジェクターなどの備品を借りるときは、次のとおりお願いします。"}, {"type": "numbered", "items": ["使う日の正午までに、総務部の窓口で申し込んでください。", "正午を過ぎた申し込みは、翌日以降の貸し出しになります。", "返却は、使った日の17時までにお願いします。"]}]}]'::jsonb, '[]'::jsonb, '4d660023c95c3c22', null)
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
delete from public.item_options where item_id in ('d1f4df0c3f', '00f53e44f4');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('d1f4df0c3f', 0, '机や椅子も飲み物も、すべて総務部に用意してもらう。', 'wrong_action_owner', '総務部がするのは飲み物だけで、机や椅子などの準備は予約した部署がすると掲示にある。', null),
       ('d1f4df0c3f', 1, '机や椅子も飲み物も、すべて自分たちの部署で用意する。', 'ignores_the_document', '上司の指示だけを考えた答えで、お客様がいるときは総務部が飲み物を用意するという掲示を見ていない。', null),
       ('d1f4df0c3f', 2, '使ったあとの片付けを、自分たちの部署で行う。', 'ignores_the_request', '掲示のとおりではあるが、上司が聞いているのは準備のことで、片付けのことではない。', null),
       ('d1f4df0c3f', 3, '机や椅子は自分たちの部署で準備し、飲み物は人数を伝えて総務部に用意してもらう。', 'correct', '掲示は、準備は予約した部署、飲み物は来客のときに総務部と分けており、予約したのは自分たちの部で、お客様も来る。', null),
       ('00f53e44f4', 0, '総務部に頼んで、会議室までプロジェクターを届けてもらう。', 'wrong_action_owner', '通知は窓口で申し込むと定めており、総務部が届けるとは書かれていない。しかも時間の条件は変わらない。', null),
       ('00f53e44f4', 1, '正午を過ぎているので今日は借りられないと、先輩に伝える。', 'correct', '通知では正午を過ぎた申し込みは翌日以降になり、今は1時を過ぎているので、今日の3時には間に合わない。', null),
       ('00f53e44f4', 2, '総務部の窓口に行って、今から今日の分を借りる。', 'ignores_the_document', '先輩の頼みどおりにしているが、正午を過ぎた申し込みは翌日以降という通知に反している。', null),
       ('00f53e44f4', 3, '明日の分として、総務部に申し込んでおく。', 'right_action_wrong_condition', '正午を過ぎたあとの申し込み方としては正しいが、先輩が使うのは今日の3時で、明日では役に立たない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
