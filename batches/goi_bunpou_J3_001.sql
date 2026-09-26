-- goi_bunpou_J3_001: 6 × goi_bunpou (J3)
-- generated 2026-09-17T13:19:30+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('goi_bunpou_J3_001', 'goi_bunpou', 'J3', 'author-composed', '2026-09-17T13:19:30+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('a4d0177c61', 'goi_bunpou_J3_001', 'goi_bunpou', 'J3', 'desk_conversation+subordinate_to_superior+counter_and_quantity@J3', 'desk_conversation', 'subordinate_to_superior', 'counter_and_quantity', 'in_person', null, null, null, '来客数を上司に報告する', '本日の会議には、お客様が＿＿＿いらっしゃる予定です。', 0, 'お客様の人数を丁寧に述べるときは助数詞「名」を使う。「人」も誤りではないが「名」のほうが丁寧で、来客について上司に報告する場面に合う。「三名様」は接客時に相手へ直接使う定型表現で、第三者について上司に報告する文には合わない。「三つ」は物を数える助数詞で、人には使えない。', '名 is the polite counter for people, especially guests, in a business report.', '[{"term": "名", "reading": "めい", "meaning": "counter for people (polite)"}, {"term": "お客様", "reading": "おきゃくさま", "meaning": "customer / guest"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('79d1ed2c1c', 'goi_bunpou_J3_001', 'goi_bunpou', 'J3', 'meeting_floor+subordinate_to_superior+juju_expression@J3', 'meeting_floor', 'subordinate_to_superior', 'juju_expression', 'in_person', null, null, null, '上司の手伝いに礼を述べる', 'お忙しい中、資料の作成を手伝って＿＿＿、助かりました。', 1, '上司にしてもらった行為への感謝は「〜ていただき、助かりました」で述べる。「さしあげ」は自分が相手にしてあげる向きの語で逆になる。「くれ」はくだけた言い方で上司の行為には丁寧さが足りない。「いただいてもらい」は受益表現を二重に重ねた、存在しない言い方。', '〜ていただき is the standard humble way to thank a superior for help received.', '[{"term": "資料", "reading": "しりょう", "meaning": "materials / documents"}, {"term": "助かる", "reading": "たすかる", "meaning": "to be helped / to be a relief"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('8ca6af9b58', 'goi_bunpou_J3_001', 'goi_bunpou', 'J3', 'desk_conversation+peer_to_peer+sino_verb_choice@J3', 'desk_conversation', 'peer_to_peer', 'sino_verb_choice', 'in_person', null, null, null, '電話対応の状況を同僚に伝える', 'うん、さっき電話で＿＿＿しておいたから、もう大丈夫だよ。', 3, '電話で実際に処置を終えたことを言うので「対応しておいた」が自然。「検討」はまだ考えている段階を表し、解決済みという内容と合わない。「対応中」は名詞で「〜する」を直接続けられない。「放置」は何もしないことを表し、「もう大丈夫」と正反対の内容になる。', '対応する reports that the matter was actually handled, matching もう大丈夫.', '[{"term": "対応する", "reading": "たいおうする", "meaning": "to handle / to deal with"}, {"term": "放置する", "reading": "ほうちする", "meaning": "to leave unattended / to neglect"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('ecba446bca', 'goi_bunpou_J3_001', 'goi_bunpou', 'J3', 'report_document+other_department+conditional_form@J3', 'report_document', 'other_department', 'conditional_form', 'written', null, null, null, '先方の希望を受けた生産計画の記述', '先方が今月中の納品を希望している＿＿＿、生産スケジュールを前倒しする必要がある。', 3, '先方の意向という、すでに示された前提を受けて対応を述べるので「なら」が適切。「と」は一般的・自動的な因果関係を表し、個別の意向を受ける言い方としては据わりが悪い。「は」は動詞の普通形に直接続けられない。「たらなら」は条件表現を二つ重ねた、存在しない形。', 'なら receives an already-stated premise, which fits reporting the other party''s wish.', '[{"term": "前倒しする", "reading": "まえだおしする", "meaning": "to move up (a schedule)"}, {"term": "先方", "reading": "せんぽう", "meaning": "the other party (business term)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('6cf7f78597', 'goi_bunpou_J3_001', 'goi_bunpou', 'J3', 'phone_call+staff_to_client+keigo_courteous@J3', 'phone_call', 'staff_to_client', 'keigo_courteous', 'phone', null, null, null, '電話で担当者の不在を伝える', '申し訳ございません、田中はただいま席を＿＿＿。', 1, '自社の人間について取引先に述べるときは丁重語の「おる」を使い、「外しております」とする。「いらっしゃる」は尊敬語で身内に使うと立てる向きが逆になる。「外しておりでございます」は動詞の連用形に「でございます」を直接続けており、成立しない。「外しています」は間違いではないが電話応対としては丁寧さが足りない。', '外しております courteously reports one''s own colleague''s absence to an outside client.', '[{"term": "席を外す", "reading": "せきをはずす", "meaning": "to be away from one''s desk"}, {"term": "おる", "reading": "おる", "meaning": "to be (courteous, for one''s own side)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('6674a17ee8', 'goi_bunpou_J3_001', 'goi_bunpou', 'J3', 'email_external+staff_to_client+keigo_honorific@J3', 'email_external', 'staff_to_client', 'keigo_honorific', 'written', null, null, null, '取引先の来場予定を伝える', '田中様には、来週の展示会に＿＿＿と伺っております。', 3, '取引先の田中様の行為を述べるので、尊敬語「いらっしゃる」を使う。「参ります」は自分の行為をへりくだる謙譲語で、相手に使うと立てる向きが逆になる。「参られる」はへりくだる語と立てる語を同時に使っており矛盾する。「いらっしゃられる」はすでに尊敬語であるいらっしゃるに重ねてれるを付けた二重敬語で、標準的な言い方ではない。', 'いらっしゃる is the plain honorific for a client''s own action; 参る is humble and points the wrong way.', '[{"term": "伺う", "reading": "うかがう", "meaning": "to hear / to ask (humble)"}, {"term": "展示会", "reading": "てんじかい", "meaning": "exhibition"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('a4d0177c61', '79d1ed2c1c', '8ca6af9b58', 'ecba446bca', '6cf7f78597', '6674a17ee8');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('a4d0177c61', 0, '三名', 'correct', '「名」は人を丁寧に数える助数詞で、来客について上司に報告する場面にふさわしい言い方。', null),
       ('a4d0177c61', 1, '三人', 'real_form_wrong_context', '「人」自体は正しい助数詞だが、お客様について述べる丁寧な報告では「名」のほうがふさわしく、やや直接的な響きになる。', null),
       ('a4d0177c61', 2, '三名様', 'set_phrase_misfit', '「〜名様」は接客の場で相手に直接人数を尋ねたり伝えたりする定型表現で、上司への報告文にそのまま入れると据わりが悪い。', null),
       ('a4d0177c61', 3, '三つ', 'wrong_grammatical_category', '「つ」は物を数える一般的な助数詞で、人を数えるのには使えない。', null),
       ('79d1ed2c1c', 0, 'さしあげ', 'opposite_valence', '「さしあげる」は自分が相手にしてあげる行為に使う語で、上司にしてもらった行為を述べるここでは向きが逆になる。', null),
       ('79d1ed2c1c', 1, 'いただき', 'correct', '上司にしてもらった行為を「いただく」で受ける、感謝を述べる標準的な言い方。', null),
       ('79d1ed2c1c', 2, 'くれ', 'real_form_wrong_context', '「くれる」自体は実在する語だが、上司の行為について述べるにはくだけすぎており、この場面の丁寧さに合わない。', null),
       ('79d1ed2c1c', 3, 'いただいてもらい', 'nonexistent_form', '「いただく」と「もらう」という同じ働きの受益表現を重ねた形で、実際にはこのような言い方はしない。', null),
       ('8ca6af9b58', 0, '検討', 'real_form_wrong_context', '「検討する」はまだ考えている最中を表す語で、「もう大丈夫」というすでに片付いた状況と食い違う。', null),
       ('8ca6af9b58', 1, '対応中', 'nonexistent_form', '「対応中」は名詞で、そのまま「〜する」を続けて「対応中する」とは言わない。', null),
       ('8ca6af9b58', 2, '放置', 'opposite_valence', '「放置する」は何もせずそのままにしておくことで、問題を片付けたことを表す「もう大丈夫」とは正反対の内容になる。', null),
       ('8ca6af9b58', 3, '対応', 'correct', '電話でクレームなどに実際に処置をしたことを表し、「もう大丈夫」という結果と自然につながる。', null),
       ('ecba446bca', 0, 'と', 'real_form_wrong_context', '「と」は一般的・機械的な条件関係を表す語で、先方の個別の意向という前提を受けて述べるこの文には合わない。', null),
       ('ecba446bca', 1, 'は', 'wrong_grammatical_category', '「は」は動詞の普通形に直接は続かず、この位置には入らない。', null),
       ('ecba446bca', 2, 'たらなら', 'nonexistent_form', '「たら」と「なら」という二つの条件表現を重ねた形で、日本語として存在しない。', null),
       ('ecba446bca', 3, 'なら', 'correct', '相手の意向という前提を受けて対応を述べる言い方で、議事録の記述として自然。', null),
       ('6cf7f78597', 0, '外していらっしゃいます', 'opposite_valence', '「いらっしゃる」は尊敬語で、自社の人間である田中に使うと身内を高めてしまい、取引先を立てるべき向きが逆になる。', null),
       ('6cf7f78597', 1, '外しております', 'correct', '自社の人間の状態を丁重に伝える言い方で、取引先への電話応対の定型表現。', null),
       ('6cf7f78597', 2, '外しておりでございます', 'nonexistent_form', '「おり」は動詞の連用形で、名詞などに続く「でございます」を直接続けることはできない。', null),
       ('6cf7f78597', 3, '外しています', 'real_form_wrong_context', '「外しています」自体は正しい日本語だが、丁重さが足りず、取引先への電話応対としてはくだけた印象になる。', null),
       ('6674a17ee8', 0, '参ります', 'opposite_valence', '「参る」は自分の行為をへりくだる謙譲語で、取引先である田中様の行為に使うと立てる向きが逆になる。', null),
       ('6674a17ee8', 1, '参られる', 'wrong_grammatical_category', 'へりくだる語「参る」に相手を立てる「〜れる」を重ねており、二つの語の働きが矛盾している。', null),
       ('6674a17ee8', 2, 'いらっしゃられる', 'nonexistent_form', 'すでに尊敬語である「いらっしゃる」にさらに「〜れる」を重ねた二重敬語で、標準的な言い方として使われる形ではない。', null),
       ('6674a17ee8', 3, 'いらっしゃる', 'correct', '取引先である田中様の行為を高める尊敬語で、この場面にふさわしい言い方。', null)
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
 where id in ('a4d0177c61');

commit;
