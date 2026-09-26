-- goi_bunpou_J1_002: 8 × goi_bunpou (J1)
-- generated 2026-09-18T13:19:02+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'manual-load', '2026-09-18T13:19:02+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('38191a6640', 'goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'phone_call+staff_to_visitor+keigo_humble@J1', 'phone_call', 'staff_to_visitor', 'keigo_humble', 'phone', null, null, null, '来客からの電話に折り返しを約束する', '恐れ入りますが、山田はただいま席を外しておりますので、戻り次第＿＿＿。', 0, '「戻り次第」の後には、これから行う行為を丁重に述べる謙譲語が続く。自社側の行為には「差し上げる」を使い、「いただく」は相手の行為を受ける形なので方向が逆になる。「さしあがります」は存在しない活用形。「お世話になっております」は冒頭の挨拶であり、この文脈の空欄には入らない。', '差し上げます humbly describes the caller''s own future action; いただきます reverses the direction of benefit, さしあがります isn''t a real conjugation, and お世話になっております is a fixed opening greeting that doesn''t fit this slot.', '[{"term": "差し上げる", "reading": "さしあげる", "meaning": "humble form of \"to give/do for\", used for one''s own action"}, {"term": "戻り次第", "reading": "もどりしだい", "meaning": "as soon as (someone) returns"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('0c5060af4a', 'goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'report_document+peer_to_peer+connective_expression@J1', 'report_document', 'peer_to_peer', 'connective_expression', 'written', null, null, null, '予算減額でも施策継続を報告する', '今期の広告予算は前年比で減額となった。＿＿＿、主要施策への配分は維持する方針である。', 1, '予算は減ったが方針は変えない、という逆接の関係を表すのは「とはいえ」。「そのため」は因果関係になり意味が逆転する。「つきましては」は理由を受けて次の対応を述べる表現で逆接ではない。「とはいえども」は存在しない言い方。', 'とはいえ marks a concessive turn; そのため wrongly implies causation, つきましては introduces a consequent action rather than a contrast, and とはいえども isn''t real usage.', '[{"term": "前年比", "reading": "ぜんねんひ", "meaning": "year-on-year (comparison)"}, {"term": "配分", "reading": "はいぶん", "meaning": "allocation"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('2c702a6023', 'goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'meeting_floor+staff_to_client+causative_permission@J1', 'meeting_floor', 'staff_to_client', 'causative_permission', 'in_person', null, null, null, '取引先との会議で資料確認の経緯を述べる', '本日は、事前にいただいた資料を拝見のうえ、論点を整理＿＿＿。', 2, '許可を得て行った行為をへりくだって述べるのは「させていただきました」。「させられました」は使役受身で不本意なニュアンス、「していただきました」は相手が行ったことになり主体が逆転、「させさせていただきました」は使役を二重に重ねた存在しない形。', 'させていただきました humbly reports an action taken with implicit permission; させられました flips it to an imposed action, していただきました reverses who did the organizing, and させさせていただきました double-stacks the causative incorrectly.', '[{"term": "拝見する", "reading": "はいけんする", "meaning": "humble form of \"to see/read\""}, {"term": "論点", "reading": "ろんてん", "meaning": "point of discussion"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('6b0ed58b79', 'goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'email_internal+junior_to_senior+business_idiom@J1', 'email_internal', 'junior_to_senior', 'business_idiom', 'written', null, null, null, '添付資料の確認を先輩に依頼する', '＿＿＿、添付の資料についてご確認いただけますでしょうか。', 3, '相手の手間を詫びて依頼につなげる言い方は「お忙しいところ恐れ入りますが」。「助かりますが」は自分の利益を述べる形で趣旨が逆転する。「いつもお世話になっております」は社外向けの挨拶で社内メールには合わない。「恐れ多いですが」は相手の厚意への畏れを表す語で、この場面の詫び方としては合わない。', 'お忙しいところ恐れ入りますが politely apologizes before a request; 助かりますが shifts to the speaker''s own benefit, いつもお世話になっております is an external-correspondence greeting, and 恐れ多いですが names a different feeling (being humbled by someone''s grace) than simply taking their time.', '[{"term": "恐れ入る", "reading": "おそれいる", "meaning": "to be sorry for the trouble caused (humble)"}, {"term": "添付", "reading": "てんぷ", "meaning": "attachment"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('a34e031e34', 'goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'notice_document+peer_to_peer+aspect_form@J1', 'notice_document', 'peer_to_peer', 'aspect_form', 'written', null, null, null, '会議室の予約状況を知らせる社内掲示', '来週の全体会議に向けて、大会議室はすでに＿＿＿ので、各自での予約は不要です。', 0, 'すでに済んでいて今もその状態が続いていることを表すのは「てある」。「ておきます」は今後の準備を表し時制が合わない。「確保します」は単純未来で状態の含みがない。「確保しておいてあります」はアスペクトを二重に重ねた存在しない言い方。', 'てある marks a completed action whose resulting state persists, matching すでに; ておきます wrongly points to future preparation, 確保します lacks the state nuance, and 確保しておいてあります stacks two aspect markers that don''t combine this way.', '[{"term": "確保する", "reading": "かくほする", "meaning": "to secure/reserve"}, {"term": "各自", "reading": "かくじ", "meaning": "each person individually"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('5158f0ad6d', 'goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'client_visit+staff_to_client+transitive_intransitive@J1', 'client_visit', 'staff_to_client', 'transitive_intransitive', 'in_person', null, null, null, '訪問先で資料の金額変更を伝える', '恐れ入りますが、３ページ目の金額が一部＿＿＿おりますので、こちらの新しい資料をご覧ください。', 1, '誰の行為かを問わず状態の変化を柔らかく伝えるのは自動詞「変わって」。他動詞「変えて」は対象を取る形で「金額が」に続かない。「戻って」は元に戻る意味で方向が逆。「変わってあり」は自動詞に「てある」を誤って付けた存在しない形。', 'The intransitive 変わって softly reports the change itself; 変えて needs a transitive object, 戻って reverses the direction of change, and 変わってあり misapplies てある to an intransitive verb.', '[{"term": "自動詞・他動詞", "reading": "じどうし・たどうし", "meaning": "intransitive / transitive verb"}, {"term": "金額", "reading": "きんがく", "meaning": "amount of money"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('7dc813c66d', 'goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'quote_document+staff_to_visitor+keigo_honorific@J1', 'quote_document', 'staff_to_visitor', 'keigo_honorific', 'written', null, null, null, '説明会への出席可否を尋ねる送付状', 'つきましては、説明会に＿＿＿場合は、事前に人数のみお知らせいただけますと幸いです。', 2, '相手の行為を立てる尊敬語の型は「ご＋動作性名詞＋になる」で「ご出席になる」。「ご出席いたす」は謙譲語で自分の行為になり方向が逆。「ご出席中」は「の」を伴わないとこの位置に文法的に入らない。「出席させていただきます」は自分の出席を述べる定型句で、相手について尋ねるこの文脈には合わない。', 'ご出席になる is the standard honorific pattern for the other party''s action; ご出席いたす wrongly humbles it as the speaker''s own act, ご出席中 needs の to attach here, and 出席させていただきます is a fixed phrase for stating one''s own attendance, not asking about someone else''s.', '[{"term": "出席", "reading": "しゅっせき", "meaning": "attendance"}, {"term": "幸いです", "reading": "さいわいです", "meaning": "it would be appreciated (polite closing)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('f4dca56dff', 'goi_bunpou_J1_002', 'goi_bunpou', 'J1', 'desk_conversation+subordinate_to_superior+sino_verb_choice@J1', 'desk_conversation', 'subordinate_to_superior', 'sino_verb_choice', 'in_person', null, null, null, 'クレーム対応の状況を上司に報告する', '先ほどのお客様からのご指摘について、担当部署に共有し、すでに＿＿＿を始めております。', 3, 'すでに動き出している処置を表すのは「対応」。「検討」は考える段階を表し、すでに動き出している文脈とは合わない。「対応し」は動詞の形で「を始める」の前に置く名詞の位置に文法的に入らない。「対応化」は存在しない語。', '対応 names the concrete action already underway; 検討 wrongly suggests mere deliberation, 対応し is a verb form that can''t sit before を始める, and 対応化 is not a real word.', '[{"term": "指摘", "reading": "してき", "meaning": "pointing out (an issue)"}, {"term": "対応", "reading": "たいおう", "meaning": "response / handling"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('38191a6640', '0c5060af4a', '2c702a6023', '6b0ed58b79', 'a34e031e34', '5158f0ad6d', '7dc813c66d', 'f4dca56dff');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('38191a6640', 0, '折り返しお電話を差し上げます', 'correct', '「差し上げる」は自社側の行為をへりくだって述べる謙譲語で、電話をかけ直すという未来の行為に自然に接続する。', null),
       ('38191a6640', 1, '折り返しお電話をいただきます', 'real_form_wrong_context', '「いただく」は相手側の行為の恩恵を受ける形で、ここでは自社側からかけ直すという状況と方向が逆になる。', null),
       ('38191a6640', 2, '折り返しお電話をさしあがります', 'nonexistent_form', '「さしあがります」は「差し上げます」と「上がります」が混ざったような形で、実際には存在しない活用である。', null),
       ('38191a6640', 3, 'お世話になっております', 'set_phrase_misfit', '「お世話になっております」は電話の冒頭で使う挨拶の定型句で、「戻り次第」に続けて今後の行動を述べるこの空欄には入らない。', null),
       ('0c5060af4a', 0, 'そのため', 'opposite_valence', '「そのため」は原因と結果をつなぐ言い方で、予算が減ったことを理由に配分も変える、という真逆の含みになってしまう。', null),
       ('0c5060af4a', 1, 'とはいえ', 'correct', '「とはいえ」は前の内容を認めつつ逆接的に続ける表現で、「予算は減額されたが配分方針は変えない」という文意に合う。', null),
       ('0c5060af4a', 2, 'つきましては', 'set_phrase_misfit', '「つきましては」は前の内容を理由として次の依頼や対応を述べる定型表現で、逆接の関係を表すこの文脈には合わない。', null),
       ('0c5060af4a', 3, 'とはいえども', 'nonexistent_form', '「とはいえども」は「とはいえ」を無理に引き延ばしたような言い方で、実際のビジネス文書では使われない。', null),
       ('2c702a6023', 0, 'させられました', 'opposite_valence', '「させられました」は使役受身で、誰かに無理やりやらされたという不本意なニュアンスになり、自分から進んで整理したという文意と食い違う。', null),
       ('2c702a6023', 1, 'していただきました', 'real_form_wrong_context', '「していただきました」は相手にしてもらったという意味になり、論点整理を行ったのが自分ではなく取引先だったことになってしまう。', null),
       ('2c702a6023', 2, 'させていただきました', 'correct', '「させていただきました」は、許可を得て行った行為を丁重に述べる言い方で、事前に資料をいただいたうえで整理を行ったという流れに合う。', null),
       ('2c702a6023', 3, 'させさせていただきました', 'nonexistent_form', '「させさせていただきました」は使役の形を二重に重ねた誤りで、実際には存在しない活用である。', null),
       ('6b0ed58b79', 0, 'お忙しいところ助かりますが', 'opposite_valence', '「助かりますが」は自分が得をする・楽になるという意味合いで、相手に手間をかけることを詫びる本来の趣旨と逆の方向になる。', null),
       ('6b0ed58b79', 1, 'いつもお世話になっております', 'set_phrase_misfit', '「いつもお世話になっております」は社外あての挨拶の定型句で、同じ社内の先輩への依頼メールの書き出しとしては不自然である。', null),
       ('6b0ed58b79', 2, 'お忙しいところ恐れ多いですが', 'real_form_wrong_context', '「恐れ多い」は相手の身分や厚意に対して自分が畏れ多いと感じるときに使う語で、単に手間を取らせることを詫びるこの文脈の言い方としては据わりが悪い。', null),
       ('6b0ed58b79', 3, 'お忙しいところ恐れ入りますが', 'correct', '「お忙しいところ恐れ入りますが」は相手の時間を取ることを詫びたうえで依頼につなげる定型表現で、確認を頼む文脈に合う。', null),
       ('a34e031e34', 0, '確保してあります', 'correct', '「てある」は誰かが意図的に行った結果が今も続いている状態を表し、すでに確保済みで今も部屋が押さえられている、という文意に合う。', null),
       ('a34e031e34', 1, '確保しておきます', 'real_form_wrong_context', '「ておきます」はこれから備えて行う準備を表す形で、「すでに」という完了済みを示す語と時間的にかみ合わない。', null),
       ('a34e031e34', 2, '確保します', 'wrong_grammatical_category', '「確保します」は単純な未来の行為を述べるだけで、すでに済んでいて今もその状態にある、という「てある」の含みを持たない。', null),
       ('a34e031e34', 3, '確保しておいてあります', 'nonexistent_form', '「確保しておいてあります」は「ておく」と「てある」を無理に重ねた言い方で、実際には使われない。', null),
       ('5158f0ad6d', 0, '変えて', 'wrong_grammatical_category', '他動詞「変える」は「〜を変える」のように対象を取る形で、ここでは「金額が」という自動詞の主語に続けて使うと文法的に噛み合わない。', null),
       ('5158f0ad6d', 1, '変わって', 'correct', '自動詞「変わる」は変化そのものを表し、誰が変えたかを問わずに「金額が変わっている」という状態を柔らかく伝えるのに向いている。', null),
       ('5158f0ad6d', 2, '戻って', 'opposite_valence', '「戻って」は元の状態に戻ったという意味で、新しい金額になったことを伝えたいこの文脈とは逆方向の変化になってしまう。', null),
       ('5158f0ad6d', 3, '変わってあり', 'nonexistent_form', '「変わってあり」は自動詞「変わる」に他動詞専用の「てある」を無理に付けた形で、実際には使われない。', null),
       ('7dc813c66d', 0, 'ご出席いたす', 'real_form_wrong_context', '「いたす」は自分の行為をへりくだる謙譲語で、ここで立てるべき相手の行為に使うと方向が逆になる。', null),
       ('7dc813c66d', 1, 'ご出席中', 'wrong_grammatical_category', '「ご出席中」は「〜中の場合は」のように「の」を挟まなければ次に続かない形で、単独で「場合は」の前に置くと文法的に成り立たない。', null),
       ('7dc813c66d', 2, 'ご出席になる', 'correct', '「ご出席になる」は「ご＋動作性名詞＋になる」という尊敬語の型で、相手側の出席という行為を立てて述べるのに合う。', null),
       ('7dc813c66d', 3, '出席させていただきます', 'set_phrase_misfit', '「出席させていただきます」は自分の出席を丁重に述べる決まった言い方で、相手の出席を尋ねるこの空欄には合わない。', null),
       ('f4dca56dff', 0, '検討', 'real_form_wrong_context', '「検討」は行うかどうかを考える段階を表す語で、すでに部署に共有して動き出している状況を述べるこの文脈には合わない。', null),
       ('f4dca56dff', 1, '対応し', 'wrong_grammatical_category', '「対応し」は動詞の連用形で、「＿＿＿を始めております」のように「を」を伴う名詞の位置には文法的に入らない。', null),
       ('f4dca56dff', 2, '対応化', 'nonexistent_form', '「対応化」は「対応」に「化」を無理に付けた言い方で、実際には使われない語である。', null),
       ('f4dca56dff', 3, '対応', 'correct', '「対応」はすでに動き出している具体的な処置を表し、クレームに対して部署で動き始めているという文意に合う。', null)
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
 where id in ('f4dca56dff');

commit;
