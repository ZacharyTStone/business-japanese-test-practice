-- hatsugen_choukai_J3_001: 10 × hatsugen_choukai (J3)
-- generated 2026-09-15T17:20:43+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_office_sofa', '取引先の応接ソファ'),
       ('scene_corridor', 'オフィスの廊下'),
       ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人'),
       ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_reception_counter', '自社の受付カウンター'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('239353dd4532e131', '会議室を使いたいのですが、鍵が見当たりません。鍵は課長が持っていると聞きました。近くに課長がいます。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('25c7c1a4fbc76235', 'いち', 'narrator_f', 'in_person'),
       ('d775217875790d2b', '課長、すみません。会議室の鍵をお借りできますか。', 'staff_junior_m', 'in_person'),
       ('6e34bf5479a4824e', 'に', 'narrator_f', 'in_person'),
       ('7d5a7b0cae3cc0a1', '課長、会議室の鍵をお借りになってもよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('a94822f17a881031', 'さん', 'narrator_f', 'in_person'),
       ('1539164858fecb53', '課長、会議室の鍵、ちょっと貸してもらえますか。', 'staff_junior_m', 'in_person'),
       ('5577d7cacee29a6c', 'よん', 'narrator_f', 'in_person'),
       ('2e0502f8ea6b8422', '課長、会議室の鍵をお借りさせていただかせていただいてもよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('3cc88f8ba5836f6c', '取引先の方が、今日はじめて会社にいらっしゃいました。受付であなたが応対します。相手はまだ名乗っていません。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('bce2bdb74ca5a6b2', '毎度ありがとうございます。少々お待ちください。', 'reception_f', 'in_person'),
       ('84faf20e0c74aae6', 'いらっしゃいませ。恐れ入りますが、お名前とお約束のお時間をうかがえますでしょうか。', 'reception_f', 'in_person'),
       ('aa3534f6339ffd4d', 'いらっしゃいませ。お忙しいところありがとうございます。', 'reception_f', 'in_person'),
       ('85280c90ffcda7ac', 'いらっしゃいませ。恐れ入りますが、お名前をお伺いさせていただかせていただいてもよろしいでしょうか。', 'reception_f', 'in_person'),
       ('fd843c0ba8cf68f0', '内線で経理部に電話をかけました。担当の鈴木さんが席におらず、戻ったら電話がほしいと伝えたいです。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('e957ca0a6154e8c0', '恐れ入りますが、鈴木さんの携帯番号を教えていただけますか。', 'staff_mid_m', 'phone'),
       ('3d520ab208c99584', '鈴木さんがお戻りになりましたら、私からまたおかけ直しします。', 'staff_mid_m', 'phone'),
       ('26df4fa12bee72d8', '恐れ入りますが、鈴木さんがお戻りになりましたら、お電話をいただきたいとお伝えいただけますか。', 'staff_mid_m', 'phone'),
       ('9ca1a6edeae9ce26', '恐れ入りますが、鈴木さんに、見積もりの件で電話しましたとだけお伝えいただけますか。', 'staff_mid_m', 'phone'),
       ('c0ea4821898076ec', '先輩に、仕事で分からないことを教えてもらいました。廊下で先輩と会ったので、お礼を言いたいです。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('4e374f82ddbb3b06', '先輩、いつもお世話になっております。', 'staff_junior_f', 'in_person'),
       ('412a9593745579d6', '先輩、今度何かあったら聞いてください。', 'staff_junior_f', 'in_person'),
       ('f930648f849129f1', '先輩、この前はどうも!助かりました。', 'staff_junior_f', 'in_person'),
       ('56d3394d1c072e9e', '先輩、先日は教えていただき、ありがとうございました。', 'staff_junior_f', 'in_person'),
       ('08c25c15b8a9bcd2', '明日の会議が、午後2時からか3時からか、はっきり覚えていません。近くにいる課長に確認したいです。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('67bf77e85d5a8a16', '課長、明日の会議は何時からか、確認してもよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('381608922dd6c3ed', '課長、明日の会議は何時からか、ご確認になってもよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('f3662c4349cc13de', '課長、明日の会議、何時でしたっけ?', 'staff_junior_m', 'in_person'),
       ('f0290ae370ec8e75', '課長、明日の会議は何時からか、ご確認させていただかせていただいてもよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('77ff0c1d78e017c9', '取引先の佐藤さんに電話をかけました。佐藤さんが電話に出ました。こんなとき、最初に何と言いますか。', 'narrator_f', 'in_person'),
       ('e5c39471af1a89b6', 'もしもし、佐藤さんですか。', 'staff_mid_m', 'phone'),
       ('eb8b3749ef4393d4', 'いつもお世話になっております。〇〇商事の田中です。', 'staff_mid_m', 'phone'),
       ('4b1c0ece00ea57de', 'いつもお世話になっております。〇〇商事の田中です。ご用件をうかがいます。', 'staff_mid_m', 'phone'),
       ('f372a9e4f1c63cc3', 'もしもし、田中だけど、佐藤さんいる?', 'staff_mid_m', 'phone'),
       ('1023b8b7ddb9fb58', '隣の席の同僚が、資料作りに苦労している様子です。あなたは今、手が空いています。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('dfe66946bd4337e6', '何かお手伝いさせていただいてもよろしいでしょうか。', 'staff_mid_f', 'in_person'),
       ('58dd21c6134d54d2', '大変そうですね。私も忙しいので、また今度手伝いますね。', 'staff_mid_f', 'in_person'),
       ('fba3e08d573c9a84', '何か手伝いましょうか。', 'staff_mid_f', 'in_person'),
       ('4920cba115af8fa3', '手伝ってやろうか?', 'staff_mid_f', 'in_person'),
       ('42524b6df37d3651', '少し体調が悪く、今日は早く帰りたいと思っています。廊下で課長に会いました。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('8ca6ea1453949b55', '課長、ちょっと具合悪いんで、今日早退していいですか。', 'staff_junior_m', 'in_person'),
       ('1fe18e6515a3de9e', '課長、少し体調が悪いので、今日は早退します。', 'staff_junior_m', 'in_person'),
       ('3e0e2293bcf9b3c9', '課長、少し体調が悪いので、今日は早退させていただかせていただいてもよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('5b18226f23d53f76', '課長、少し体調が悪いので、今日は早退してもよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('3374d484c3cb2e8c', '取引先での打ち合わせが終わりました。時間をとってもらったので、帰る前にお礼を言いたいです。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('2cd3ebc98f0b5e7e', '本日はお忙しい中、お時間をいただき、ありがとうございました。', 'staff_mid_m', 'in_person'),
       ('d74fd365cc133eb4', '本日はご足労いただき、ありがとうございました。', 'staff_mid_m', 'in_person'),
       ('51d73e327c86da5a', '本日はお疲れさまでした。', 'staff_mid_m', 'in_person'),
       ('cb448908433dcd99', '本日はお忙しい中、お時間をいただかれまして、ありがとうございました。', 'staff_mid_m', 'in_person'),
       ('9741bcd66cf8eb34', 'オンライン会議で、取引先の新しい担当者と初めて顔を合わせます。会議が始まり、まず自己紹介をします。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('54340baf2b04c8df', 'いつもお世話になっております。〇〇商事の田中です。', 'staff_mid_m', 'video'),
       ('f397de59386e87ec', 'はじめまして。〇〇商事の田中と申します。よろしくお願いいたします。', 'staff_mid_m', 'video'),
       ('e6d39827ba98df46', '本日はお忙しい中お集まりいただき、ありがとうございます。〇〇商事です。', 'staff_mid_m', 'video'),
       ('a8b08ab8b3ce7538', 'はじめまして。〇〇商事の田中と仰います。よろしくお願いいたします。', 'staff_mid_m', 'video')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'author-composed', '2026-09-15T17:20:43+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('3b2ba9c2cc', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'office_desk+subordinate_to_superior+request@J3', 'office_desk', 'subordinate_to_superior', 'request', 'in_person', 'scene_office_desk_pair', '若手社員', '直属の上司（課長）', '上司に会議室の鍵を貸してもらう', '会議室を使いたいのですが、鍵が見当たりません。鍵は課長が持っていると聞きました。近くに課長がいます。こんなとき、何と言いますか。', 0, '自分が何かをする許可や助けを求めるときは、自分の行為をへりくだって述べる。「お借りできますか」はその型どおりで、簡潔にも配慮している。「お借りになって」は尊敬語を自分の行為に使っており、敬意の方向が逆になっている。「ちょっと貸してもらえますか」は話し言葉が崩れており、上司に向ける丁寧さに欠ける。「お借りさせていただかせていただいて」は「させていただく」を二重に重ねた誤りで、丁寧さが行き過ぎている。', 'Ask to borrow with a modest, humble form — honorifics on your own act, casual speech, or doubled させていただく all fail.', '[{"term": "お借りできますか", "reading": "おかりできますか", "meaning": "may I borrow (humble request form)"}, {"term": "二重敬語", "reading": "にじゅうけいご", "meaning": "doubled honorifics — excessive politeness that becomes an error"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '239353dd4532e131', null),
       ('6ad0f15b5f', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'reception+staff_to_visitor+greet_first_meet@J3', 'reception', 'staff_to_visitor', 'greet_first_meet', 'in_person', 'scene_reception_counter', '受付で応対する社員', 'はじめて来社した取引先の担当者', '受付で初めての来客を迎える', '取引先の方が、今日はじめて会社にいらっしゃいました。受付であなたが応対します。相手はまだ名乗っていません。こんなとき、何と言いますか。', 1, '初めての来客には、迎える決まり文句のあとに名前と約束の時間を確認するのが基本の型。正解はこの型どおりで、次の対応に必要な情報がそろう。「毎度ありがとうございます」はすでに何度も来ている相手に使う言い方で、初対面には合わない。「お忙しいところありがとうございます」は丁寧だが名前も約束も確認しておらず、応対が進まない。「お伺いさせていただかせていただいて」は「させていただく」の重ね使いで、丁寧さが行き過ぎている。', 'Greet, then confirm name and appointment time — a regular-customer phrase, a reply with no check-in, or doubled させていただく all miss the mark.', '[{"term": "いらっしゃいませ", "reading": "いらっしゃいませ", "meaning": "welcome (standard greeting to a visitor/customer)"}, {"term": "お約束のお時間", "reading": "おやくそくのおじかん", "meaning": "your appointment time"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '3cc88f8ba5836f6c', null),
       ('c1fcf0a342', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'phone_internal+other_department+phone_message@J3', 'phone_internal', 'other_department', 'phone_message', 'phone', 'scene_phone_desk', '内線をかけた社員', '経理部で電話に出た社員', '他部署に電話し、担当者への伝言を頼む', '内線で経理部に電話をかけました。担当の鈴木さんが席におらず、戻ったら電話がほしいと伝えたいです。こんなとき、何と言いますか。', 2, '伝言を頼むときは、戻る時点、してほしいこと、伝言の依頼を一文にまとめて言うと、取り次いだ相手がそのまま伝えられる。正解はこの型どおり。「携帯番号を教えて」は取り次いだ相手に求めることではなく、電話の作法を外れている。「私からまたおかけ直しします」は丁寧だが自分からかける申し出で、電話をもらいたいという依頼とは逆になっている。「電話しましたとだけお伝えください」は電話があったことは伝わるが、折り返してほしいという要件が抜けている。', 'A callback request names when they''ll be back, what you need, and the relay — asking for a cell number, offering to call back yourself, or leaving out the callback ask all fail.', '[{"term": "折り返し", "reading": "おりかえし", "meaning": "a return call / calling back"}, {"term": "お伝えいただけますか", "reading": "おつたえいただけますか", "meaning": "could you please pass this along (humble request)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'fd843c0ba8cf68f0', null),
       ('22487a1794', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'corridor+junior_to_senior+thank@J3', 'corridor', 'junior_to_senior', 'thank', 'in_person', 'scene_corridor', '後輩社員', '先輩社員', '先輩に教えてもらったお礼を言う', '先輩に、仕事で分からないことを教えてもらいました。廊下で先輩と会ったので、お礼を言いたいです。こんなとき、何と言いますか。', 3, 'お礼を言うときは、何をしてもらったかを添えて述べると気持ちが伝わる。正解はこの型どおり。「いつもお世話になっております」は社外向けのあいさつで、教えてもらったお礼にはならない。「今度何かあったら聞いてください」はお礼ではなく手伝いの申し出になっており、場面の目的からずれている。「どうも!助かりました」は「どうも」だけで済ませており、先輩に向けるには丁寧さが足りない。', 'Thank someone by naming what they did for you — a client greeting, an offer of help instead of thanks, or a bare どうも all miss it.', '[{"term": "教えていただき、ありがとうございました", "reading": "おしえていただき、ありがとうございました", "meaning": "thank you for teaching/showing me (humble)"}, {"term": "先日は", "reading": "せんじつは", "meaning": "the other day — refers back to a recent specific occasion"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'c0ea4821898076ec', null),
       ('43f67d1f13', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'meeting_room+subordinate_to_superior+confirm@J3', 'meeting_room', 'subordinate_to_superior', 'confirm', 'in_person', 'scene_meeting_room_table', '部下', '課長', '会議の開始時刻を課長に確認する', '明日の会議が、午後2時からか3時からか、はっきり覚えていません。近くにいる課長に確認したいです。こんなとき、何と言いますか。', 0, '自分が確認したいときは、自分の行為をへりくだって尋ねる。正解はこの型どおりで簡潔にも配慮している。「ご確認になって」は尊敬語を自分の行為に使っており、敬意の方向が逆になっている。「何時でしたっけ」は話し言葉が崩れており、上司への確認としては軽すぎる。「ご確認させていただかせていただいて」は「させていただく」の重ね使いで、丁寧さが行き過ぎている。', 'Confirm something yourself with a humble ask — honorifics on your own act, casual speech, or doubled させていただく all fail.', '[{"term": "確認してもよろしいでしょうか", "reading": "かくにんしてもよろしいでしょうか", "meaning": "may I confirm (polite request to check something)"}, {"term": "〜でしたっけ", "reading": "でしたっけ", "meaning": "wasn''t it...? — a casual filler for recalling something"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '08c25c15b8a9bcd2', null),
       ('91a3dbc338', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'phone_external+staff_to_client+phone_open@J3', 'phone_external', 'staff_to_client', 'phone_open', 'phone', 'scene_phone_desk', '電話をかけた社員', '取引先の担当者（佐藤さん）', '取引先に電話をかけて名乗る', '取引先の佐藤さんに電話をかけました。佐藤さんが電話に出ました。こんなとき、最初に何と言いますか。', 1, 'こちらから電話をかけたときは、あいさつのあとに社名と自分の名前を名乗る。正解はこの型どおり。「もしもし、佐藤さんですか」は名乗りが抜けており、相手は誰からの電話か分からない。「ご用件をうかがいます」は名乗りは正しいが、電話を受けた側の言葉であり、かけた本人が言うと立場が逆になる。「田中だけど、佐藤さんいる?」は話し言葉が崩れすぎており、取引先には使えない。', 'An outgoing call opens with the greeting, then your company and name — skipping the name, using the receiver''s line, or casual speech all fail.', '[{"term": "いつもお世話になっております", "reading": "いつもおせわになっております", "meaning": "the standard opening to a client"}, {"term": "ご用件をうかがいます", "reading": "ごようけんをうかがいます", "meaning": "I will hear your business (said by the side taking the call)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '77ff0c1d78e017c9', null),
       ('0e6c106a8e', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'office_desk+peer_to_peer+offer_help@J3', 'office_desk', 'peer_to_peer', 'offer_help', 'in_person', 'scene_office_desk_pair', '同僚', '隣の席の同僚', '困っている同僚に手伝いを申し出る', '隣の席の同僚が、資料作りに苦労している様子です。あなたは今、手が空いています。こんなとき、何と言いますか。', 2, '同僚に手伝いを申し出るときは、かしこまりすぎず、今すぐ手伝う意思がはっきり伝わる言い方がよい。正解はその型どおり。「お手伝いさせていただいても」は同僚には敬語が過剰で不自然。「また今度手伝いますね」は今は手伝わないと言っているに等しく、申し出になっていない。「手伝ってやろうか」は上から目線に響く言い方で、同僚への配慮を欠く。', 'Offer help to a peer plainly and now — over-formal keigo, a deferred offer, or a condescending tone all miss it.', '[{"term": "手伝いましょうか", "reading": "てつだいましょうか", "meaning": "shall I help? (a natural offer among equals)"}, {"term": "〜てやろうか", "reading": "てやろうか", "meaning": "shall I do ... for you — can sound condescending"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '1023b8b7ddb9fb58', null),
       ('2099bba427', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'corridor+subordinate_to_superior+ask_permission@J3', 'corridor', 'subordinate_to_superior', 'ask_permission', 'in_person', 'scene_corridor', '部下', '課長', '体調不良で早退の許可を求める', '少し体調が悪く、今日は早く帰りたいと思っています。廊下で課長に会いました。こんなとき、何と言いますか。', 3, '許可を求めるときは、理由を短く添えたうえで、許可を尋ねる形で述べる。正解はこの型どおり。「早退していいですか」は話し言葉が崩れており、上司への言い方として軽すぎる。「早退します」は言い切りで、許可を求める場面なのに報告になってしまっている。「早退させていただかせていただいて」は「させていただく」の重ね使いで、丁寧さが行き過ぎている。', 'Ask permission with a short reason and a genuine question — casual speech, a flat announcement, or doubled させていただく all fail.', '[{"term": "早退してもよろしいでしょうか", "reading": "そうたいしてもよろしいでしょうか", "meaning": "may I leave early (polite request for permission)"}, {"term": "体調が悪い", "reading": "たいちょうがわるい", "meaning": "not feeling well"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '42524b6df37d3651', null),
       ('325876c7a8', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'client_office+staff_to_client+thank@J3', 'client_office', 'staff_to_client', 'thank', 'in_person', 'scene_client_office_sofa', '訪問した営業担当', '取引先の担当者', '訪問先での打ち合わせを終えてお礼を言う', '取引先での打ち合わせが終わりました。時間をとってもらったので、帰る前にお礼を言いたいです。こんなとき、何と言いますか。', 0, '訪問先でお礼を言うときは、相手が時間をとってくれたことに触れる。正解はこの型どおり。「ご足労いただき」はこちらまで来てもらった相手への言葉で、自分が訪問した今回の場面には合わない。「お疲れさまでした」は身内どうしのねぎらいの言葉で、社外の取引先に使うと身内扱いになってしまう。「いただかれまして」は謙譲語と尊敬語を重ねた誤った形で、敬語として成り立っていない。', 'Thank a client by naming their time — a phrase for someone who came to you, an in-group colleague''s line, or a broken doubled-honorific form all fail.', '[{"term": "お時間をいただき", "reading": "おじかんをいただき", "meaning": "thank you for your time (humble)"}, {"term": "ご足労いただき", "reading": "ごそくろういただき", "meaning": "thank you for taking the trouble to come (said to a visitor)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '3374d484c3cb2e8c', null),
       ('f1c44b24eb', 'hatsugen_choukai_J3_001', 'hatsugen_choukai', 'J3', 'video_call+staff_to_client+greet_first_meet@J3', 'video_call', 'staff_to_client', 'greet_first_meet', 'video', 'scene_video_call_laptop', '自社の担当者', 'オンライン会議で初めて会う取引先の担当者', 'オンライン会議で取引先に初めてあいさつする', 'オンライン会議で、取引先の新しい担当者と初めて顔を合わせます。会議が始まり、まず自己紹介をします。こんなとき、何と言いますか。', 1, '初対面の自己紹介は、あいさつ、社名と名前の名乗り、結びの言葉をそろえるのが基本。正解はこの型どおり。「いつもお世話になっております」は継続的な取引先に使うあいさつで、初対面には合わない。「お忙しい中お集まりいただき」は会議の開始のあいさつとしては自然だが、自分の名前を名乗っておらず自己紹介になっていない。「仰います」は相手に使う尊敬語を自分の名乗りに使っており、敬意の方向が逆になっている。', 'A first-meeting self-introduction pairs greeting, name and company, and a closing line — a regular-client phrase, a name-less opener, or an honorific pointed at yourself all miss it.', '[{"term": "はじめまして", "reading": "はじめまして", "meaning": "nice to meet you (genuine first meeting only)"}, {"term": "よろしくお願いいたします", "reading": "よろしくおねがいいたします", "meaning": "standard polite closing after a self-introduction"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '9741bcd66cf8eb34', null)
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
delete from public.item_options where item_id in ('3b2ba9c2cc', '6ad0f15b5f', 'c1fcf0a342', '22487a1794', '43f67d1f13', '91a3dbc338', '0e6c106a8e', '2099bba427', '325876c7a8', 'f1c44b24eb');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('3b2ba9c2cc', 0, '課長、すみません。会議室の鍵をお借りできますか。', 'correct', '自分がへりくだって借りる意向を伝える、簡潔で失礼のない依頼の言い方になっている。', 'd775217875790d2b'),
       ('3b2ba9c2cc', 1, '課長、会議室の鍵をお借りになってもよろしいでしょうか。', 'wrong_honorific_direction', '「お借りになる」は相手が借りるときに使う尊敬語。借りるのは自分なので、自分の行為を高めてしまっている。', '7d5a7b0cae3cc0a1'),
       ('3b2ba9c2cc', 2, '課長、会議室の鍵、ちょっと貸してもらえますか。', 'register_too_casual', '内容は正しいが「ちょっと」「もらえますか」と話し言葉的で、上司に向けるには丁寧さが足りない。', '1539164858fecb53'),
       ('3b2ba9c2cc', 3, '課長、会議室の鍵をお借りさせていただかせていただいてもよろしいでしょうか。', 'over_polite_misfit', '「させていただく」を二重に重ねており、丁寧にしようとしてかえって不自然な言い方になっている。', '2e0502f8ea6b8422'),
       ('6ad0f15b5f', 0, '毎度ありがとうございます。少々お待ちください。', 'set_phrase_wrong_situation', '「毎度ありがとうございます」は繰り返し来る取引先に使う言い方で、はじめて来社した相手への最初の一言としては場面が合わない。', 'bce2bdb74ca5a6b2'),
       ('6ad0f15b5f', 1, 'いらっしゃいませ。恐れ入りますが、お名前とお約束のお時間をうかがえますでしょうか。', 'correct', '来客を迎える決まり文句のあと、名前と約束の時間を確認しており、初対面の来客への応対として過不足がない。', '84faf20e0c74aae6'),
       ('6ad0f15b5f', 2, 'いらっしゃいませ。お忙しいところありがとうございます。', 'content_mismatch', 'あいさつとしては丁寧だが、名前や約束の確認という、この場面でまず必要なことに答えていない。', 'aa3534f6339ffd4d'),
       ('6ad0f15b5f', 3, 'いらっしゃいませ。恐れ入りますが、お名前をお伺いさせていただかせていただいてもよろしいでしょうか。', 'over_polite_misfit', '「させていただく」を二重に重ねており、丁寧にしようとしてかえって不自然な言い方になっている。', '85280c90ffcda7ac'),
       ('c1fcf0a342', 0, '恐れ入りますが、鈴木さんの携帯番号を教えていただけますか。', 'phone_protocol_violation', '取り次いだ相手に担当者個人の連絡先を求めるのは電話の作法から外れており、頼むべきは伝言である。', 'e957ca0a6154e8c0'),
       ('c1fcf0a342', 1, '鈴木さんがお戻りになりましたら、私からまたおかけ直しします。', 'wrong_speech_act', '丁寧ではあるが、自分からかけ直すという申し出になっており、電話がほしいという依頼にはなっていない。', '3d520ab208c99584'),
       ('c1fcf0a342', 2, '恐れ入りますが、鈴木さんがお戻りになりましたら、お電話をいただきたいとお伝えいただけますか。', 'correct', '戻る時点、してほしいこと、伝言の依頼が一文にそろっており、取り次いだ相手がそのまま伝えられる。', '26df4fa12bee72d8'),
       ('c1fcf0a342', 3, '恐れ入りますが、鈴木さんに、見積もりの件で電話しましたとだけお伝えいただけますか。', 'content_mismatch', '電話があったことは伝わるが、折り返してほしいという肝心の依頼が抜けており、用件が完結しない。', '9ca1a6edeae9ce26'),
       ('22487a1794', 0, '先輩、いつもお世話になっております。', 'set_phrase_wrong_situation', '取引先など社外の相手に使うあいさつで、教えてもらったことへのお礼にはなっておらず、場面に合わない。', '4e374f82ddbb3b06'),
       ('22487a1794', 1, '先輩、今度何かあったら聞いてください。', 'wrong_speech_act', 'お礼の代わりに手伝いを申し出る言葉になっており、教えてもらったことに対するお礼という場面の目的を果たしていない。', '412a9593745579d6'),
       ('22487a1794', 2, '先輩、この前はどうも!助かりました。', 'register_too_casual', '「どうも」だけでお礼を済ませており、先輩に向けるお礼の言葉としては軽すぎる。', 'f930648f849129f1'),
       ('22487a1794', 3, '先輩、先日は教えていただき、ありがとうございました。', 'correct', '教えてもらったという具体的な内容を添えたうえでお礼を述べており、先輩への言葉として過不足がない。', '56d3394d1c072e9e'),
       ('43f67d1f13', 0, '課長、明日の会議は何時からか、確認してもよろしいでしょうか。', 'correct', '自分が確認したいという意向を、へりくだった形で丁寧に尋ねており、上司への質問として自然である。', '67bf77e85d5a8a16'),
       ('43f67d1f13', 1, '課長、明日の会議は何時からか、ご確認になってもよろしいでしょうか。', 'wrong_honorific_direction', '「ご確認になる」は相手が確認するときの尊敬語。確認したいのは自分なので、自分の行為を高めてしまっている。', '381608922dd6c3ed'),
       ('43f67d1f13', 2, '課長、明日の会議、何時でしたっけ?', 'register_too_casual', '「でしたっけ」と話し言葉が崩れており、上司に向けて確認するには丁寧さが足りない。', 'f3662c4349cc13de'),
       ('43f67d1f13', 3, '課長、明日の会議は何時からか、ご確認させていただかせていただいてもよろしいでしょうか。', 'over_polite_misfit', '「させていただく」を二重に重ねており、丁寧にしようとしてかえって不自然な言い方になっている。', 'f0290ae370ec8e75'),
       ('91a3dbc338', 0, 'もしもし、佐藤さんですか。', 'phone_protocol_violation', '相手の確認だけで自分の社名や名前を名乗っておらず、相手は誰からの電話か分からないまま話が進んでしまう。', 'e5c39471af1a89b6'),
       ('91a3dbc338', 1, 'いつもお世話になっております。〇〇商事の田中です。', 'correct', 'あいさつのあと、自社の名前と自分の名前を名乗っており、電話をかけた側が最初にすべきことができている。', 'eb8b3749ef4393d4'),
       ('91a3dbc338', 2, 'いつもお世話になっております。〇〇商事の田中です。ご用件をうかがいます。', 'wrong_speech_act', '名乗りまでは正しいが、「ご用件をうかがいます」は電話を受けた側の言葉で、かけた本人が言うと話が逆になる。', '4b1c0ece00ea57de'),
       ('91a3dbc338', 3, 'もしもし、田中だけど、佐藤さんいる?', 'register_too_casual', '「だけど」「いる?」と話し言葉が崩れており、取引先に向ける電話としては丁寧さが足りない。', 'f372a9e4f1c63cc3'),
       ('0e6c106a8e', 0, '何かお手伝いさせていただいてもよろしいでしょうか。', 'over_polite_misfit', '同じ立場の同僚に対して敬語を重ねすぎており、かしこまりすぎて逆に不自然な言い方になっている。', 'dfe66946bd4337e6'),
       ('0e6c106a8e', 1, '大変そうですね。私も忙しいので、また今度手伝いますね。', 'content_mismatch', '大変な様子には触れているが、今手伝う気がないと言っているのと同じで、この場面で求められている申し出になっていない。', '58dd21c6134d54d2'),
       ('0e6c106a8e', 2, '何か手伝いましょうか。', 'correct', '同僚に対して自然な丁寧さで、今すぐ手伝う意思をはっきり示した申し出になっている。', 'fba3e08d573c9a84'),
       ('0e6c106a8e', 3, '手伝ってやろうか?', 'register_too_casual', '「〜てやろうか」は上から目線に聞こえる言い方で、同じ立場の同僚に対しても配慮に欠ける。', '4920cba115af8fa3'),
       ('2099bba427', 0, '課長、ちょっと具合悪いんで、今日早退していいですか。', 'register_too_casual', '「悪いんで」「いいですか」と話し言葉が崩れており、上司に許可を求める言い方としては丁寧さが足りない。', '8ca6ea1453949b55'),
       ('2099bba427', 1, '課長、少し体調が悪いので、今日は早退します。', 'wrong_speech_act', '許可を求める場面なのに、すでに決めたことのように言い切っており、依頼ではなく報告になっている。', '1fe18e6515a3de9e'),
       ('2099bba427', 2, '課長、少し体調が悪いので、今日は早退させていただかせていただいてもよろしいでしょうか。', 'over_polite_misfit', '「させていただく」を二重に重ねており、丁寧にしようとしてかえって不自然な言い方になっている。', '3e0e2293bcf9b3c9'),
       ('2099bba427', 3, '課長、少し体調が悪いので、今日は早退してもよろしいでしょうか。', 'correct', '理由を短く添えたうえで許可を求めており、上司への依頼として過不足がない。', '5b18226f23d53f76'),
       ('325876c7a8', 0, '本日はお忙しい中、お時間をいただき、ありがとうございました。', 'correct', '相手が忙しい中で時間をとってくれたことに触れてお礼を述べており、訪問後のあいさつとして自然である。', '2cd3ebc98f0b5e7e'),
       ('325876c7a8', 1, '本日はご足労いただき、ありがとうございました。', 'set_phrase_wrong_situation', '「ご足労いただき」はこちらまで来てもらった相手に使う言い方で、自分が訪問した今回の場面には合わない。', 'd74fd365cc133eb4'),
       ('325876c7a8', 2, '本日はお疲れさまでした。', 'wrong_uchi_soto', '「お疲れさま」は同じ職場の身内どうしでねぎらう言い方で、社外の取引先に向けると身内扱いになってしまう。', '51d73e327c86da5a'),
       ('325876c7a8', 3, '本日はお忙しい中、お時間をいただかれまして、ありがとうございました。', 'over_polite_misfit', '「いただかれる」は謙譲語「いただく」に尊敬語「れる」を重ねた誤った形で、敬語として成立していない。', 'cb448908433dcd99'),
       ('f1c44b24eb', 0, 'いつもお世話になっております。〇〇商事の田中です。', 'set_phrase_wrong_situation', '「いつもお世話になっております」はすでに取引のある相手に使うあいさつで、正真正銘の初対面には合わない。', '54340baf2b04c8df'),
       ('f1c44b24eb', 1, 'はじめまして。〇〇商事の田中と申します。よろしくお願いいたします。', 'correct', '初対面のあいさつ、社名と名前の名乗り、結びの言葉がそろっており、自己紹介として過不足がない。', 'f397de59386e87ec'),
       ('f1c44b24eb', 2, '本日はお忙しい中お集まりいただき、ありがとうございます。〇〇商事です。', 'content_mismatch', '会議を開く側の言葉としては自然だが、自分の名前を名乗っておらず、自己紹介という場面の目的を果たしていない。', 'e6d39827ba98df46'),
       ('f1c44b24eb', 3, 'はじめまして。〇〇商事の田中と仰います。よろしくお願いいたします。', 'wrong_honorific_direction', '「仰る」は相手の発言に使う尊敬語。自分の名前を名乗る場面で使うと、自分の行為を高めてしまっている。', 'a8b08ab8b3ce7538')
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
 where id in ('3b2ba9c2cc', '6ad0f15b5f', '43f67d1f13', '91a3dbc338', '2099bba427', '325876c7a8', 'f1c44b24eb');

commit;
