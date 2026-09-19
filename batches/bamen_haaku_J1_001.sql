-- bamen_haaku_J1_001: 2 × bamen_haaku (J1)
-- generated 2026-09-19T17:03:51+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_expo_booth', '展示会のブース'),
       ('scene_restaurant_private', '料理店の個室')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('7d3635c26223c62e', '展示会のブースで、担当者が取引先の人と話しています。「新型のカタログですが、あいにく手元の分が切れてしまいまして。ご住所を頂戴できれば戻り次第お送りしますし、お急ぎでしたら会場の端末でデータをご覧いただくこともできます。」「では、データで結構です。」担当者はこのあと何をしますか。', 'narrator_f', 'in_person'),
       ('805a2f7b6a18cada', '会場の端末で、カタログのデータをその場で見せる。', 'narrator_f', 'in_person'),
       ('94e17fbd744096fe', '住所を控えて、会社に戻ってからカタログを送る。', 'narrator_f', 'in_person'),
       ('e3f0fd5ece48002c', '隣のブースからカタログを一部借りてくる。', 'narrator_f', 'in_person'),
       ('b330fd6dd2fc4c64', '取引先に、カタログのデータを送ってもらう。', 'narrator_f', 'in_person'),
       ('9b54696b8cd116ea', '取引先との会食の席で、先方が席を外している間に、ある社員が小声でこう話しています。「さっきはフォローしていただいて助かりました。納期の話はうちの課だけでは答えられませんので。戻ったら、そちらの部からも部長に一言添えていただけますか。」この人は誰に向かって話していますか。', 'narrator_f', 'in_person'),
       ('689037efa7da27ac', '料理を運んできた店の人', 'narrator_f', 'in_person'),
       ('cef581e2dfb676b4', '同じ課の先輩', 'narrator_f', 'in_person'),
       ('8cd46dc82602e0a6', '同じ会食に出ている、他の部署の社員', 'narrator_f', 'in_person'),
       ('da9b1e734101077f', '取引先の担当者', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('bamen_haaku_J1_001', 'bamen_haaku', 'J1', 'manual-load', '2026-09-19T17:03:51+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('72ff3a7b7c', 'bamen_haaku_J1_001', 'bamen_haaku', 'J1', 'event_venue+staff_to_client+identify_next_action@J1', 'event_venue', 'staff_to_client', 'identify_next_action', 'in_person', 'scene_expo_booth', null, null, '展示会でカタログが切れている', '展示会のブースで、担当者が取引先の人と話しています。「新型のカタログですが、あいにく手元の分が切れてしまいまして。ご住所を頂戴できれば戻り次第お送りしますし、お急ぎでしたら会場の端末でデータをご覧いただくこともできます。」「では、データで結構です。」担当者はこのあと何をしますか。', 0, '担当者は「戻り次第お送りする」と「会場の端末でデータを見せる」の二つを並べ、取引先が後者を選んだ。「では、データで結構です」という短い返事がどちらを指すかを、直前の二案と結びつけて聞き取る必要がある。住所を控えて送る案は退けられ、隣のブースや取引先から送ってもらう話は出ていない。', 'Two options are offered; the client''s short reply picks the second, so the next step is showing the data on the spot.', '[{"term": "戻り次第", "reading": "もどりしだい", "meaning": "as soon as (I) get back"}, {"term": "頂戴する", "reading": "ちょうだいする", "meaning": "to receive (humble)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '7d3635c26223c62e', null),
       ('64619d5452', 'bamen_haaku_J1_001', 'bamen_haaku', 'J1', 'dining+other_department+identify_listener_role@J1', 'dining', 'other_department', 'identify_listener_role', 'in_person', 'scene_restaurant_private', null, null, '会食の席で誰に礼を言っているか', '取引先との会食の席で、先方が席を外している間に、ある社員が小声でこう話しています。「さっきはフォローしていただいて助かりました。納期の話はうちの課だけでは答えられませんので。戻ったら、そちらの部からも部長に一言添えていただけますか。」この人は誰に向かって話していますか。', 2, '「うちの課」と「そちらの部」の言い分けが決め手。話し手は自分の課と相手の部を分けて述べており、相手は自社の別の部署の人。先方が席を外している間の小声の話なので取引先ではなく、店の人に納期の話はしない。同じ課の先輩なら「うちの課だけでは」とは言わない。', 'うちの課 versus そちらの部 marks the listener as a colleague from another department, not the client and not one''s own team.', '[{"term": "席を外す", "reading": "せきをはずす", "meaning": "to step away from the table"}, {"term": "一言添える", "reading": "ひとことそえる", "meaning": "to add a word (of support)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '9b54696b8cd116ea', null)
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
delete from public.item_options where item_id in ('72ff3a7b7c', '64619d5452');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('72ff3a7b7c', 0, '会場の端末で、カタログのデータをその場で見せる。', 'correct', '二つの案のうち、取引先が「データで結構です」と選んだのは会場で見るほうで、担当者はその場で見せることになる。', '805a2f7b6a18cada'),
       ('72ff3a7b7c', 1, '住所を控えて、会社に戻ってからカタログを送る。', 'right_scene_wrong_moment', '担当者が最初に示した案だが、取引先はそれを採らずデータを選んでおり、送る段取りには進まない。', '94e17fbd744096fe'),
       ('72ff3a7b7c', 2, '隣のブースからカタログを一部借りてくる。', 'adjacent_setting', '同じ会場の中で済ませる案としてはありそうだが、隣のブースの話は一度も出ていない。', 'e3f0fd5ece48002c'),
       ('72ff3a7b7c', 3, '取引先に、カタログのデータを送ってもらう。', 'wrong_participant', 'データを見せるのは担当者の側で、取引先に何かを送ってもらう向きの話ではない。', 'b330fd6dd2fc4c64'),
       ('64619d5452', 0, '料理を運んできた店の人', 'adjacent_setting', '同じ個室にいるが、納期の話やフォローへの礼は店の人に向けるものではない。', '689037efa7da27ac'),
       ('64619d5452', 1, '同じ課の先輩', 'plausible_but_unmentioned', '礼を言う相手として自然だが、「うちの課だけでは答えられない」と言っており、相手は同じ課の人ではない。', 'cef581e2dfb676b4'),
       ('64619d5452', 2, '同じ会食に出ている、他の部署の社員', 'correct', '「うちの課だけでは」「そちらの部からも」と言い分けており、相手は自社の別の部署の人だと分かる。', '8cd46dc82602e0a6'),
       ('64619d5452', 3, '取引先の担当者', 'wrong_participant', '会食の相手ではあるが、先方が席を外している間の話で、「部長に一言添えて」と頼む相手でもない。', 'da9b1e734101077f')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
