-- hyougen_J3_001: 2 × hyougen (J3)
-- generated 2026-09-18T08:50:49+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hyougen_J3_001', 'hyougen', 'J3', 'manual-load', '2026-09-18T08:50:49+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('3aff966c5c', 'hyougen_J3_001', 'hyougen', 'J3', 'client_office+staff_to_customer+introduce_self@J3', 'client_office', 'staff_to_customer', 'introduce_self', 'in_person', null, null, null, '新しい担当者として挨拶する', '担当が代わり、前の担当者の田中と一緒に、初めて顧客の会社を訪ねました。自分が新しい担当だと名乗って挨拶します。最も適切な表現はどれですか。', 1, '顧客の前では、自社の人は呼び捨てにし、自分は「〜と申します」と名乗る。「よろしく」で終わる言い方は丁寧さが足りない。「田中さん」「佐藤様」は敬意の向きが逆。挨拶だけで名前を言わない言い方は、自己紹介という目的を果たしていない。', 'Introduce yourself with 〜と申します, drop honorifics from your own colleague''s name, and actually give your name.', '[{"term": "〜に代わりまして", "reading": "〜にかわりまして", "meaning": "in place of (someone)"}, {"term": "申す", "reading": "もうす", "meaning": "to be called (humble)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('4018d43df2', 'hyougen_J3_001', 'hyougen', 'J3', 'meeting_room+other_department+request@J3', 'meeting_room', 'other_department', 'request', 'in_person', null, null, null, '他部署の人に資料を頼む', '社内の会議室で、他の部署の担当者が資料を配りました。あとで自分の部署にも一部送ってほしいと頼みます。最も適切な表現はどれですか。', 3, '相手にしてもらうことを頼むので「送っていただけますか」。「送っといて」は丁寧さが足りず、「当然ですよね」は頼むのではなく責める言い方。「お送りしましょうか」は自分が送る申し出で、頼みたいことと向きが逆になる。', 'A request to a colleague from another department uses 〜ていただけますか; an offer (〜しましょうか) points the action the wrong way.', '[{"term": "一部", "reading": "いちぶ", "meaning": "one copy"}, {"term": "うちの部", "reading": "うちのぶ", "meaning": "our department"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('3aff966c5c', '4018d43df2');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('3aff966c5c', 0, '田中がいつもお世話になっております。本日はご挨拶に伺いました。', 'correct_keigo_wrong_speech_act', '丁寧ではあるが、自分の名前も新しい担当であることも言っておらず、自己紹介になっていない。', null),
       ('3aff966c5c', 1, 'このたび田中に代わりまして担当させていただきます、山川商事の佐藤と申します。よろしくお願いいたします。', 'correct', '自社の田中を呼び捨てにし、自分を「〜と申します」と名乗る、引き継ぎの挨拶の型どおりの言い方。', null),
       ('3aff966c5c', 2, '今度から田中の代わりに担当になった佐藤です。よろしく。', 'register_too_casual', '顧客に対する初めての挨拶としては言葉が短く、「よろしく」だけでは丁寧さが足りない。', null),
       ('3aff966c5c', 3, 'このたび田中さんに代わりまして担当いたします、山川商事の佐藤様と申します。', 'wrong_honorific_direction', '顧客の前で自社の田中に「さん」を付け、自分に「様」を付けており、敬意の向きが逆になっている。', null),
       ('4018d43df2', 0, 'その資料、あとでうちにも送っといて。', 'register_too_casual', '「送っといて」はくだけた命令の形で、他の部署の人に頼む言い方としては丁寧さが足りない。', null),
       ('4018d43df2', 1, 'その資料、うちの部にも送るのが当然ですよね。', 'register_insulting', '頼む形になっておらず、相手が当然すべきだと決めつけて責める言い方になっている。', null),
       ('4018d43df2', 2, 'その資料、あとで一部うちの部にもお送りしましょうか。', 'correct_keigo_wrong_speech_act', '丁寧ではあるが、自分が送ると申し出る形になっており、相手に送ってもらう依頼ではない。', null),
       ('4018d43df2', 3, 'すみません、その資料、あとで一部うちの部にも送っていただけますか。', 'correct', '「〜ていただけますか」で相手にしてもらうことを丁寧に頼んでおり、他部署の人への依頼として自然。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
