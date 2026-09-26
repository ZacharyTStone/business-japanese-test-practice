-- hyougen_J1_002: 6 × hyougen (J1)
-- generated 2026-09-21T13:11:08+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hyougen_J1_002', 'hyougen', 'J1', 'manual-load', '2026-09-21T13:11:08+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('3907ae553c', 'hyougen_J1_002', 'hyougen', 'J1', 'phone_call+staff_to_client+schedule_change@J1', 'phone_call', 'staff_to_client', 'schedule_change', 'phone', null, null, null, '電話で取引先に納品日の変更を伝える', '取引先との電話で、来週予定していた納品日を、配送の都合により二日後ろにずらすことを伝えます。最も適切な表現はどれですか。', 1, '自社の都合による変更の連絡は、まず用件を述べ、詫びたうえで明確に伝える。「拝受いただく」は謙譲語を相手の行為に向けた誤りで、「なんですけど」は電話の相手が取引先である以上くだけすぎる。「よろしいでしょうか」はすでに決めた変更を許可を求める形にしており、伝えるべき通知になっていない。', 'A notice of a change caused by one''s own circumstances states the fact plainly with an apology; it is not phrased as a request for permission, and humble forms are never pointed at the other party''s own actions.', '[{"term": "拝受", "reading": "はいじゅ", "meaning": "to receive (humble, self-directed)"}, {"term": "恐れ入りますが", "reading": "おそれいりますが", "meaning": "I''m sorry to say / if I may"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('dd10b2c7f9', 'hyougen_J1_002', 'hyougen', 'J1', 'meeting_room+staff_to_client+handle_complaint@J1', 'meeting_room', 'staff_to_client', 'handle_complaint', 'in_person', null, null, null, '会議室で取引先の苦情にまず謝罪して応対する', '取引先が来社し、会議室で、先日納品した製品に不具合があったと苦情を述べています。自社担当者として、まず謝罪の言葉を述べます。最も適切な表現はどれですか。', 3, '苦情対応はまず謝罪し、原因を決めつけずに状況を尋ねる。「参っていただき」は謙譲語を取引先の行為に向けた誤り、「すみません」以下は話し言葉が過ぎる。「使い方を誤られたのでは」は原因を相手のせいにしており、苦情対応として不適切。', 'Handling a complaint opens with an apology and asks for the facts without assigning blame; a humble verb is never pointed at the visitor''s own coming.', '[{"term": "不具合", "reading": "ふぐあい", "meaning": "a defect / malfunction"}, {"term": "参る", "reading": "まいる", "meaning": "to go/come (humble, self-directed)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('b85cc7b1d0', 'hyougen_J1_002', 'hyougen', 'J1', 'email_internal+junior_to_senior+ask_permission@J1', 'email_internal', 'junior_to_senior', 'ask_permission', 'written', null, null, null, '後輩が先輩に社内メールで早退の許可を求める', '後輩が、先輩社員あての社内メールで、明日の午後、私用のため早退する許可を求めます。最も適切な表現はどれですか。', 2, '後輩から先輩への依頼は、恐縮の一言を添えて許可を求め、仕事への対応も示す。「いいですか？」は話し言葉が過ぎ、「何もおっしゃらないでください」は先輩の意見を封じる失礼な言い方。「させていただきます」だけでは許可を求めず、通告になっている。', 'A request for permission names the imposition, asks rather than announces, and shows the requester has covered their own work.', '[{"term": "恐縮ですが", "reading": "きょうしゅくですが", "meaning": "I''m sorry for the imposition, but"}, {"term": "早退", "reading": "そうたい", "meaning": "leaving work early"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('6a3ca7f70f', 'hyougen_J1_002', 'hyougen', 'J1', 'client_office+staff_to_client+introduce_self@J1', 'client_office', 'staff_to_client', 'introduce_self', 'in_person', null, null, null, '担当替えで取引先に初訪問し引き継ぎの挨拶をする', '担当替えにより、新しい担当者として取引先のオフィスを初めて訪問し、前任の後任であることを伝えて挨拶します。最も適切な表現はどれですか。', 3, '引き継ぎの挨拶は、前任者名と自分の名前を示し、謙遜の一言を添えて型どおりに締める。「担当なさる」は尊敬語を自分の行為に向けた誤り、「もう関係ありません」は前任者やこれまでの関係を軽んじる失礼な言い方。「お付き合いいただけますでしょうか」は敬語こそ正しいが、挨拶を確認の問いに変えてしまっている。', 'A handover greeting names the predecessor and oneself and closes with the set humble phrase; it is not turned into a question, and honorific forms are never pointed at one''s own act of taking over.', '[{"term": "前任", "reading": "ぜんにん", "meaning": "one''s predecessor"}, {"term": "至らぬ点", "reading": "いたらぬてん", "meaning": "shortcomings"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('8cfab53b8d', 'hyougen_J1_002', 'hyougen', 'J1', 'video_call+subordinate_to_superior+apologize_report@J1', 'video_call', 'subordinate_to_superior', 'apologize_report', 'video', null, null, null, 'オンライン会議で部下が対応ミスを上司に謝罪報告する', 'オンライン会議で、部下が、自分の対応ミスにより顧客への納品が遅れたことを上司に謝罪しながら報告します。最も適切な表現はどれですか。', 3, '謝罪報告は、落ち度を認めて詫びたうえで、原因と現状の対応まで述べる。「拝承いただければ」は謙譲語を上司の行為に向けた誤り、「すみません」以下は話し言葉が過ぎる。「お許しいただけますでしょうか」は謝罪だけで終わり、報告すべき状況と対応が抜けている。', 'An apology-and-report names the fault, the current state, and what is being done about it; it is not an apology alone, and humble forms are never pointed at the listener''s own act.', '[{"term": "確認漏れ", "reading": "かくにんもれ", "meaning": "a missed check"}, {"term": "代替", "reading": "だいたい", "meaning": "a substitute / alternative"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('042637ac83', 'hyougen_J1_002', 'hyougen', 'J1', 'chat_internal+peer_to_peer+propose@J1', 'chat_internal', 'peer_to_peer', 'propose', 'written', null, null, null, '社内チャットで同僚に展示会準備の前倒しを提案する', '社内チャットで、同僚に対して、来週の展示会の準備を今週中に前倒しで始めることを提案します。最も適切な表現はどれですか。', 0, '同僚への提案は、理由を添えたうえで相手の判断に委ねる柔らかい形にする。「ヤバくない？」以下は社内チャットとしてもくだけすぎ、「普段からもっと早めに」は相手を非難する一言が余計。「させていただいてもよろしいでしょうか」は敬語こそ丁寧だが、提案ではなく許可を求める形になっている。', 'A proposal between colleagues stays soft and leaves the decision with the other person; it is not a command dressed as a question, a jab at their habits, or a formal request for permission.', '[{"term": "前倒し", "reading": "まえだおし", "meaning": "moving something earlier / advancing a schedule"}, {"term": "詰まる", "reading": "つまる", "meaning": "to get packed / tight (of a schedule)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('3907ae553c', 'dd10b2c7f9', 'b85cc7b1d0', '6a3ca7f70f', '8cfab53b8d', '042637ac83');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('3907ae553c', 0, '来週の納品日でございますが、配送の都合により、二日ほど遅れて拝受いただくことになります。何とぞご了承くださいませ。', 'wrong_honorific_direction', '「拝受」は自分がへりくだって受け取る際に使う謙譲語で、取引先が受け取る行為に使うと敬意の向きが逆になる。', null),
       ('3907ae553c', 1, '来週の納品日の件でご連絡いたしました。配送の都合により、恐れ入りますが二日ほど遅らせていただきたく存じます。', 'correct', '自分側の都合による変更であることを詫びたうえで明確に伝えており、電話での通知として過不足がない。', null),
       ('3907ae553c', 2, '来週の納品なんですけど、配送の都合で二日遅れます。すみません。', 'register_too_casual', '内容は正確だが話し言葉が多く、取引先への電話としては丁寧さが足りない。', null),
       ('3907ae553c', 3, '来週の納品日を二日ほど遅らせてもよろしいでしょうか。', 'correct_keigo_wrong_speech_act', '敬語は整っているが、自社の都合ですでに決まっている変更を許可を求める形にしており、通知になっていない。', null),
       ('dd10b2c7f9', 0, 'この度はご不便をおかけし、申し訳ございませんでした。本日はわざわざ参っていただき、状況を詳しく伺います。', 'wrong_honorific_direction', '「参る」は自分側が行く際に使う謙譲語で、取引先が来社した行為に使うと敬意の向きが逆になる。', null),
       ('dd10b2c7f9', 1, 'すみません、不具合があったんですね。ちょっと詳しく教えてもらえますか。', 'register_too_casual', '謝罪も対応も内容は合っているが、取引先との会議室でのやりとりとしては話し言葉が過ぎる。', null),
       ('dd10b2c7f9', 2, 'ご不便をおかけし申し訳ございません。何か使い方を誤られたのではないでしょうか。まずは確認させてください。', 'register_insulting', '謝罪の形は取っているが、原因を取引先の使い方のせいにしており、苦情対応として相手を疑う言い方になっている。', null),
       ('dd10b2c7f9', 3, 'ご不便をおかけし、誠に申し訳ございません。まずは状況を詳しくお聞かせいただけますでしょうか。', 'correct', '具体的な言い訳をせずにまず謝罪し、状況を尋ねる形で対応を始めており、苦情への初動として適切。', null),
       ('b85cc7b1d0', 0, '明日の午後、私用で早退したいんですけど、いいですか？', 'register_too_casual', '内容は同じだが話し言葉が多く、先輩へのメールとしては丁寧さが足りない。', null),
       ('b85cc7b1d0', 1, '明日の午後は私用のため早退しますので、特に何もおっしゃらないでください。', 'register_insulting', '許可を求める形になっておらず、先輩の意見を封じるような言い方で、失礼にあたる。', null),
       ('b85cc7b1d0', 2, '急なお願いで恐縮ですが、明日の午後、私用のため早退させていただいてもよろしいでしょうか。担当分は今日中に片付けておきます。', 'correct', '恐縮の一言を添えたうえで許可を求め、自分の担当への対応も示しており、後輩から先輩への依頼として過不足がない。', null),
       ('b85cc7b1d0', 3, '明日の午後、私用のため早退させていただきます。よろしくお願いいたします。', 'correct_keigo_wrong_speech_act', '敬語は丁寧だが、許可を求めず、すでに決めたことのように伝えており、依頼になっていない。', null),
       ('6a3ca7f70f', 0, '本日より、前任の田中に代わりまして担当なさることになりました、鈴木でございます。', 'wrong_honorific_direction', '「担当なさる」は相手の行為に使う尊敬語で、自分が担当を引き継ぐという自分側の行為に使うと敬意の向きが逆になる。', null),
       ('6a3ca7f70f', 1, '田中はもう異動しましたので、今日から私が担当します。前の件はもう関係ありません。', 'register_insulting', '前任者やこれまでのやり取りを軽んじる言い方になっており、初対面の挨拶として失礼にあたる。', null),
       ('6a3ca7f70f', 2, '本日より、前任の田中に代わりまして担当させていただくことになりました鈴木と申します。今後ともお付き合いいただけますでしょうか。', 'correct_keigo_wrong_speech_act', '敬語も自己紹介も正しいが、型どおりの挨拶ではなく、今後も取引を続けてもらえるかを確認する問いの形になっており、初訪問の挨拶としては不自然。', null),
       ('6a3ca7f70f', 3, '本日より、前任の田中に代わりまして担当させていただくことになりました、鈴木と申します。至らぬ点もあるかと存じますが、よろしくお願いいたします。', 'correct', '前任者名と自分の名前を明確にし、謙遜の一言を添えて挨拶しており、初訪問の引き継ぎとして丁寧かつ自然。', null),
       ('8cfab53b8d', 0, '申し訳ございません。私の確認漏れにより、A社への納品が二日遅れておりますことを、拝承いただければと存じます。', 'wrong_honorific_direction', '「拝承」は自分がへりくだって承知する際に使う謙譲語で、上司にそう求める行為に使うと敬意の向きが逆になる。', null),
       ('8cfab53b8d', 1, 'すみません、確認忘れてて、A社への納品が二日遅れてます。今、代わりの手配してます。', 'register_too_casual', '内容は正確だが話し言葉が多く、上司への報告としては丁寧さが足りない。', null),
       ('8cfab53b8d', 2, '申し訳ございません。私の確認漏れがございまして、お許しいただけますでしょうか。', 'correct_keigo_wrong_speech_act', '敬語は整っているが、謝罪だけで終わっており、遅れの状況や対応という報告すべき内容が伝わっていない。', null),
       ('8cfab53b8d', 3, '申し訳ございません。私の確認漏れにより、A社への納品が二日遅れております。現在、代替の手配を進めております。', 'correct', '自分の落ち度を明確に認めて謝罪し、原因と現状の対応まで簡潔に報告しており、上司への謝罪報告として適切。', null),
       ('042637ac83', 0, '展示会の準備、来週からだと少し詰まりそうだから、今週のうちに少し始めておかない？', 'correct', '同僚どうしのチャットにふさわしい柔らかさで、理由を添えたうえで相手の判断に委ねる提案の形になっている。', null),
       ('042637ac83', 1, '展示会の準備、来週じゃヤバくない？今週からやっちゃおうよ。', 'register_too_casual', '同僚どうしでも、社内チャットとして使うにはくだけすぎており、仕事の連絡としての体裁を欠く。', null),
       ('042637ac83', 2, '展示会の準備、来週からじゃ絶対間に合わないでしょ。今週からやったほうがいいんじゃない？普段からもっと早めに動いてよ。', 'register_insulting', '提案の形にはなっているが、相手の普段の仕事ぶりを非難する一言が加わっており、同僚への言い方として失礼にあたる。', null),
       ('042637ac83', 3, '展示会の準備について、今週中に始めさせていただいてもよろしいでしょうか。', 'correct_keigo_wrong_speech_act', '敬語としては誤りではないが、対等な同僚への提案ではなく許可を求める形になっており、一緒に進めようという提案の趣旨からずれている。', null)
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
 where id in ('3907ae553c', 'b85cc7b1d0', '6a3ca7f70f');

commit;
