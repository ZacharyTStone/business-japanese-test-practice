-- goi_bunpou_J1_001: 2 × goi_bunpou (J1)
-- generated 2026-09-18T08:51:33+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('goi_bunpou_J1_001', 'goi_bunpou', 'J1', 'manual-load', '2026-09-18T08:51:33+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('bb80c565a1', 'goi_bunpou_J1_001', 'goi_bunpou', 'J1', 'client_visit+staff_to_client+aspect_form@J1', 'client_visit', 'staff_to_client', 'aspect_form', 'in_person', null, null, null, '訪問先で準備済みであることを伝える', '本日ご説明する内容は、事前に御社の担当の方と＿＿＿ので、確認の形で進めさせていただければと存じます。', 2, '「確認の形で進める」と言うからには、すり合わせはすでに済んでいる。過去に行ってきた準備を丁寧に述べるのは「〜てまいりました」。「〜ておきます」は未来の準備で流れが逆、「〜てあります」は物の状態を表す形で人と行う相談には据わらない。「お世話になっております」は挨拶の定型句で、この空欄の文法的な位置に入らない。', '〜てまいりました reports preparation already done; 〜ておく points forward and 〜てある describes the state of a thing.', '[{"term": "すり合わせる", "reading": "すりあわせる", "meaning": "to align (views) in advance"}, {"term": "事前に", "reading": "じぜんに", "meaning": "beforehand"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('db3fa5e7f7', 'goi_bunpou_J1_001', 'goi_bunpou', 'J1', 'meeting_floor+junior_to_senior+passive_adversity@J1', 'meeting_floor', 'junior_to_senior', 'passive_adversity', 'in_person', null, null, null, '会議で先輩に報告する', '実は先週、担当の方に急に＿＿＿、引き継ぎが十分にできておりません。', 0, '相手が急に辞めて自分が困った、という迷惑の受身を丁寧に言うのが「退職されまして」。「いたしまして」は自分の行為になり、「させられまして」は辞めさせられたという別の意味、「なさられまして」は二重敬語で成立しない。', '退職される states the other person''s resignation politely while the passive carries the sense that it inconvenienced the speaker.', '[{"term": "引き継ぎ", "reading": "ひきつぎ", "meaning": "handover"}, {"term": "退職", "reading": "たいしょく", "meaning": "resignation / leaving a job"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('bb80c565a1', 'db3fa5e7f7');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('bb80c565a1', 0, 'お世話になっております', 'set_phrase_misfit', '「お世話になっております」は挨拶の定型句で、「担当の方と」に続けて事前の準備を述べる文の空欄には入らない。', null),
       ('bb80c565a1', 1, 'すり合わせてあります', 'wrong_grammatical_category', '「〜てある」は物に対する結果の状態を表す形で、相手と行う「すり合わせる」には接続しにくく、しかも取引先への言い方として丁寧さが足りない。', null),
       ('bb80c565a1', 2, 'すり合わせてまいりました', 'correct', '「〜てまいる」で、今日の訪問に至るまでに済ませてきた準備として述べており、「確認の形で進める」につながる。', null),
       ('bb80c565a1', 3, 'すり合わせておきます', 'opposite_valence', '「〜ておく」はこれからの準備を表し、すでに済んでいて今日は確認だけという流れと矛盾する。', null),
       ('db3fa5e7f7', 0, '退職されまして', 'correct', '「〜される」で相手の退職を丁寧に述べつつ、それが自分にとって不都合だったことを受身の形で含ませている。', null),
       ('db3fa5e7f7', 1, '退職いたしまして', 'opposite_valence', '「いたす」は自分の行為をへりくだる語で、辞めたのが自分だという意味になってしまう。', null),
       ('db3fa5e7f7', 2, '退職させられまして', 'real_form_wrong_context', '使役受身で「辞めさせられた」という意味になり、相手の会社の事情を勝手に決めつける言い方になる。', null),
       ('db3fa5e7f7', 3, '退職なさられまして', 'nonexistent_form', '「なさる」にさらに「〜られる」を重ねた二重敬語で、標準的な形ではない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

-- Withdrawn after review; batches/withdrawn.txt says why. An unpublish,
-- never a delete, so every answer already given keeps resolving. Nothing
-- here ever sets is_published back to true: a question the owner vetoed
-- in the app stays vetoed however often this file is applied.
update public.items set is_published = false
 where id in ('bb80c565a1');

commit;
