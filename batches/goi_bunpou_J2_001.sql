-- goi_bunpou_J2_001: 6 × goi_bunpou (J2)
-- generated 2026-09-15T17:47:14+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('goi_bunpou_J2_001', 'goi_bunpou', 'J2', 'author-composed', '2026-09-15T17:47:14+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('a8b230ec98', 'goi_bunpou_J2_001', 'goi_bunpou', 'J2', 'email_external+staff_to_client+causative_permission@J2', 'email_external', 'staff_to_client', 'causative_permission', 'written', null, null, null, '訪問日時の希望を伝える', '来週の火曜日、午後二時に御社へ＿＿＿と存じますが、ご都合はいかがでしょうか。', 2, '自分が相手のところへ行く許可を求める場面。「伺う」＋「〜させていただく」で、行為も許可の求め方も謙譲になる。「伺われたい」は謙譲語に尊敬の助動詞を重ねた誤り、「お伺いさせられたい」は語として存在せず、「伺わせてくださりたい」は「くださる」の主語が相手なのに「〜たい」で自分の希望を述べており、ねじれている。', '伺わせていただく is the standard humble way to ask permission to visit.', '[{"term": "伺う", "reading": "うかがう", "meaning": "to visit / to ask (humble)"}, {"term": "存じる", "reading": "ぞんじる", "meaning": "to think (humble)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('016554fd7e', 'goi_bunpou_J2_001', 'goi_bunpou', 'J2', 'quote_document+staff_to_customer+juju_expression@J2', 'quote_document', 'staff_to_customer', 'juju_expression', 'written', null, null, null, '見積書の確認依頼', 'お見積書を同封いたしましたので、ご確認＿＿＿ようお願い申し上げます。', 0, '確認するのは相手なので、相手の行為を自分が受け取る「ご〜いただく」を使う。「ご確認いただきますよう」は文書の定型。「さしあげます」「いたします」は自分の行為を表すので向きが逆。「くださいますよう」も存在する形だが、「お願い申し上げます」と組むのは「いただきますよう」のほうが据わる。', 'The customer does the checking, so the humble receiving form いただく is what pairs with お願い申し上げます.', '[{"term": "同封", "reading": "どうふう", "meaning": "enclosure (in a letter)"}, {"term": "お見積書", "reading": "おみつもりしょ", "meaning": "quotation"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('dfdab44d2a', 'goi_bunpou_J2_001', 'goi_bunpou', 'J2', 'desk_conversation+subordinate_to_superior+counter_and_quantity@J2', 'desk_conversation', 'subordinate_to_superior', 'counter_and_quantity', 'in_person', null, null, null, '会議室の椅子の数を報告する', '会議室に椅子を＿＿＿並べておきました。', 3, '椅子は「脚」で数える。「台」は機械や車両、「枚」は薄いもので、どちらも椅子には合わない。「十二脚ら」という形は日本語にない。助数詞は場面よりも数える対象で決まる。', 'Chairs take the counter 脚; 台 is for machines and 枚 for flat things.', '[{"term": "脚", "reading": "きゃく", "meaning": "counter for chairs"}, {"term": "並べる", "reading": "ならべる", "meaning": "to line up / arrange"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('873ae90bf2', 'goi_bunpou_J2_001', 'goi_bunpou', 'J2', 'phone_call+staff_to_client+keigo_courteous@J2', 'phone_call', 'staff_to_client', 'keigo_courteous', 'phone', null, null, null, '電話で自社の場所を説明する', '弊社は駅の南口を出まして、まっすぐ三分ほどの場所に＿＿＿。', 1, '場所の存在を丁重に述べるので「ございます」。「いらっしゃる」は人に使う尊敬語、「おありになる」は相手の所有を高める形で、どちらも自社の所在地には合わない。「ありでございます」は日本語として成立しない。', 'ございます is the courteous form of ある for things and places; いらっしゃる is for people.', '[{"term": "弊社", "reading": "へいしゃ", "meaning": "our company (humble)"}, {"term": "南口", "reading": "みなみぐち", "meaning": "south exit"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('c1e08d21fa', 'goi_bunpou_J2_001', 'goi_bunpou', 'J2', 'report_document+other_department+conditional_form@J2', 'report_document', 'other_department', 'conditional_form', 'written', null, null, null, '議事録に条件つきの決定を書く', '先方の承認が＿＿＿、来月一日から新しい手順に切り替える。', 3, '承認はまだ出ていないので、仮定の条件を表す「〜れば」を使う。「〜たら」は意味こそ近いが話し言葉寄りで、議事録には向かない。「〜なら」は相手の発言を受ける形、「〜ので」は理由で、どちらも未確定の条件を表さない。', '〜れば states an as-yet-unmet condition, which is what minutes need here.', '[{"term": "承認", "reading": "しょうにん", "meaning": "approval"}, {"term": "切り替える", "reading": "きりかえる", "meaning": "to switch over"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('33afdbce1f', 'goi_bunpou_J2_001', 'goi_bunpou', 'J2', 'client_visit+peer_to_peer+transitive_intransitive@J2', 'client_visit', 'peer_to_peer', 'transitive_intransitive', 'in_person', null, null, null, '訪問先で資料の不足に気づく', 'すみません、資料が一部＿＿＿ようです。すぐに取ってきます。', 0, '資料が足りない状態は自動詞「抜ける」で述べる。他動詞の「抜いている」は誰かが意図して抜いたことになり、受身の「抜かれている」は第三者の仕業という含みが出て、訪問先では相手を疑う言い方になる。「抜けてある」は接続が成立しない。', 'The intransitive 抜ける reports the state without assigning blame.', '[{"term": "抜ける", "reading": "ぬける", "meaning": "to be missing (intransitive)"}, {"term": "一部", "reading": "いちぶ", "meaning": "a part / one copy"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('a8b230ec98', '016554fd7e', 'dfdab44d2a', '873ae90bf2', 'c1e08d21fa', '33afdbce1f');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('a8b230ec98', 0, '伺われたい', 'wrong_grammatical_category', '「伺う」はすでに謙譲語で、そこに尊敬の「〜れる」は付かない。自分の行為に尊敬を使うことにもなる。', null),
       ('a8b230ec98', 1, 'お伺いさせられたい', 'nonexistent_form', '使役受身の「させられる」を謙譲の形に混ぜた形で、日本語として成立していない。', null),
       ('a8b230ec98', 2, '伺わせていただきたい', 'correct', '相手の許可を得て自分が行く場面で、「伺う」に「〜させていただく」を重ねた形が社外あて文書の型どおりの言い方。', null),
       ('a8b230ec98', 3, '伺わせてくださりたい', 'real_form_wrong_context', '「くださる」は相手の行為を高める語で、「〜たい」という自分の希望とは主語が食い違う。', null),
       ('016554fd7e', 0, 'いただきます', 'correct', '相手にしてもらう行為を「ご〜いただく」で受け、「〜ますようお願い申し上げます」の定型につながる。', null),
       ('016554fd7e', 1, 'くださいます', 'real_form_wrong_context', '「ご確認くださいますよう」も実在の形だが、ここは「お願い申し上げます」の前で「〜いただきますよう」が対になる。文の据わりが悪い。', null),
       ('016554fd7e', 2, 'さしあげます', 'opposite_valence', '「さしあげる」は自分が相手にする行為で、確認するのは相手なので、行為の向きが逆になる。', null),
       ('016554fd7e', 3, 'いたします', 'wrong_grammatical_category', '「いたす」は自分の行為の謙譲語。相手に確認を求める文で使うと、自分が確認することになってしまう。', null),
       ('dfdab44d2a', 0, '十二台', 'real_form_wrong_context', '「台」は機械や車両を数える助数詞で、椅子には使わない。', null),
       ('dfdab44d2a', 1, '十二枚', 'opposite_valence', '「枚」は紙や板など薄いものを数える語で、立体の椅子には合わない。', null),
       ('dfdab44d2a', 2, '十二脚ら', 'nonexistent_form', '助数詞に「〜ら」を付けて複数を表す言い方は存在しない。', null),
       ('dfdab44d2a', 3, '十二脚', 'correct', '椅子を数える助数詞は「脚」で、業務の報告として自然な言い方。', null),
       ('873ae90bf2', 0, 'いらっしゃいます', 'opposite_valence', '「いらっしゃる」は人に対する尊敬語で、場所や建物の存在には使わない。', null),
       ('873ae90bf2', 1, 'ございます', 'correct', '「ある」の丁重語で、取引先との電話で自社について述べるときの標準的な言い方。', null),
       ('873ae90bf2', 2, 'おありになります', 'set_phrase_misfit', '「おありになる」は相手の所有を高める形。自社の所在地を高めることになり、場面に合わない。', null),
       ('873ae90bf2', 3, 'ありでございます', 'nonexistent_form', '「あり」に「でございます」を続けた形で、語として成立していない。', null),
       ('c1e08d21fa', 0, '得られたら', 'real_form_wrong_context', '意味は近いが「〜たら」は話し言葉寄りで、議事録の書き言葉としては「〜れば」が据わる。', null),
       ('c1e08d21fa', 1, '得られるなら', 'opposite_valence', '「〜なら」は相手の発言や前提を受けて述べる形で、これから起こるかどうかの条件を書く文には合わない。', null),
       ('c1e08d21fa', 2, '得られるので', 'wrong_grammatical_category', '「〜ので」は理由を表し、まだ承認が出ていないのに出たことを前提にしてしまう。', null),
       ('c1e08d21fa', 3, '得られれば', 'correct', 'まだ決まっていない条件が満たされた場合を述べる仮定条件で、議事録の書き方として自然。', null),
       ('33afdbce1f', 0, '抜けている', 'correct', '自動詞「抜ける」で、資料の状態をそのまま述べており、誰の責任かを言わずに事実だけを伝えられる。', null),
       ('33afdbce1f', 1, '抜いている', 'opposite_valence', '他動詞「抜く」で、誰かが意図して抜き取ったことになり、事故を故意に変えてしまう。', null),
       ('33afdbce1f', 2, '抜かれている', 'real_form_wrong_context', '受身で、第三者が抜き取ったという含みが出る。訪問先で言えば相手を疑うことになる。', null),
       ('33afdbce1f', 3, '抜けてある', 'nonexistent_form', '「〜てある」は他動詞に付いて結果の状態を表す形で、自動詞「抜ける」には接続しない。', null)
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
 where id in ('016554fd7e', 'c1e08d21fa');

commit;
