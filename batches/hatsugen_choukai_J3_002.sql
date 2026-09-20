-- hatsugen_choukai_J3_002: 10 × hatsugen_choukai (J3)
-- generated 2026-09-15T17:20:43+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_office_sofa', '取引先の応接ソファ'),
       ('scene_elevator_hall', 'エレベーターホール'),
       ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人'),
       ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_reception_counter', '自社の受付カウンター'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('c902476155c11126', '受付に立っていると、二時にお約束のあるお客様が到着しました。これから応接室へご案内します。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('d08f3de5649eec59', 'エー', 'narrator_f', 'in_person'),
       ('c4ca0150f1ef34cf', 'お待ちしておりました。応接室へご案内いたします。どうぞこちらへ。', 'staff_mid_f', 'in_person'),
       ('da4df49bf7f00ab2', 'ビー', 'narrator_f', 'in_person'),
       ('669de1c7396e8dd9', 'お待ちしてました。応接室まで案内しますね。こっちです。', 'staff_mid_f', 'in_person'),
       ('d690aea8d6cb91f1', 'シー', 'narrator_f', 'in_person'),
       ('b96387c2d668a7e7', 'お待ちしておりました。応接室へご案内させていただきますので、どうぞお越しになられてください。', 'staff_mid_f', 'in_person'),
       ('134df096a9c7dc0a', 'デー', 'narrator_f', 'in_person'),
       ('44ed51be02541011', 'お待ちしておりました。本日はどのようなご用件でしょうか。', 'staff_mid_f', 'in_person'),
       ('4abf43d914d25a1b', '取引先から電話があり、営業部の佐藤に代わってほしいと言われました。佐藤は席にいます。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('642916a0e9326537', 'はい、佐藤さんですね。佐藤さーん、お電話ですよ。', 'staff_mid_m', 'phone'),
       ('56ee357b38d78966', 'かしこまりました。佐藤部長は在席されておりますので、少々お待ちください。', 'staff_mid_m', 'phone'),
       ('093984c18f5ffb57', 'かしこまりました。佐藤でございますね。少々お待ちくださいませ。', 'staff_mid_m', 'phone'),
       ('9a30fed0e44d142d', 'かしこまりました。ご用件は確かに承りましたので、佐藤に申し伝えます。', 'staff_mid_m', 'phone'),
       ('112e3e31a0b2d243', '作り方が分からなかった見積書を、先輩が自分の手を止めて一から教えてくれました。作業が終わったところです。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('8eb0b8dad06064a4', 'このたびは格別のご高配を賜りまして、誠にありがとうございました。', 'staff_junior_f', 'in_person'),
       ('d79a140cb1993f40', 'お忙しいところ教えていただき、ありがとうございました。', 'staff_junior_f', 'in_person'),
       ('421422d2735d5c62', '助かった、ありがとね。', 'staff_junior_f', 'in_person'),
       ('7d42f532bef94379', 'お忙しいところ、お教えしてくださり、ありがとうございました。', 'staff_junior_f', 'in_person'),
       ('4cb48d9770350834', '自分の席で課長から急ぎの作業を頼まれましたが、締め切りが今日なのか明日なのか聞き取れませんでした。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('341e0c2caf2b8e7d', 'その作業でしたら、明日までにやっておきましょうか。', 'staff_junior_m', 'in_person'),
       ('264e5e6cf555d14f', 'え、それって今日まででしたっけ、明日まででしたっけ。', 'staff_junior_m', 'in_person'),
       ('cf15dcdaa6d51eec', '恐れ入りますが、ただいまおっしゃられた期日をもう一度お聞かせ願えませんでしょうか。', 'staff_junior_m', 'in_person'),
       ('ccb8f5811bf72120', '確認させてください。締め切りは本日中でしょうか、明日でしょうか。', 'staff_junior_m', 'in_person'),
       ('7648bd10a451e987', '打ち合わせが終わり、来客をエレベーターホールまで見送りました。エレベーターの扉が開いたところです。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('d014f7d625b54919', '本日はありがとうございました。どうぞお気をつけてお帰りくださいませ。', 'reception_f', 'in_person'),
       ('777e252e4947bcbe', '本日はありがとうございました。行ってらっしゃいませ。', 'reception_f', 'in_person'),
       ('005a9813bb727d1b', 'ありがとうございました。じゃ、また今度よろしくお願いします。', 'reception_f', 'in_person'),
       ('a88d75e7c4ebbd5d', '本日はありがとうございました。弊社の田中部長にもよろしくお伝えください。', 'reception_f', 'in_person'),
       ('dadcfabefc57e2a4', '別のフロアにいる先輩に内線をかけました。先輩の机の上にある資料を、こちらまで持ってきてほしいと頼みます。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('6638ac682d6b542d', 'あ、先輩ですか。机の上の資料、こっち持ってきてもらえます？', 'staff_junior_f', 'phone'),
       ('bb33697e590f669b', '営業部の山田です。お手数ですが、その資料をお持ちしましょうか。', 'staff_junior_f', 'phone'),
       ('cfacf5206ba06047', '営業部の山田です。お手数ですが、机の上の資料を持ってきていただけますか。', 'staff_junior_f', 'phone'),
       ('80cd360f1125f982', '営業部の山田でございます。恐れ入りますが、資料をお持ちになっていただけますでしょうか。', 'staff_junior_f', 'phone'),
       ('9c394d0dfbc40931', '取引先を初めて訪問し、応接室で担当の方と向かい合いました。これから名刺を差し出します。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('4189559eccd2e335', 'いつもお世話になっております。本日はお忙しいところ恐れ入ります。', 'staff_mid_m', 'in_person'),
       ('0c1ed54107aad435', 'はじめまして。株式会社みどり商事の山田と申します。よろしくお願いいたします。', 'staff_mid_m', 'in_person'),
       ('614ceca50fc0c4d8', 'はじめまして。株式会社みどり商事の山田部長と申します。', 'staff_mid_m', 'in_person'),
       ('a40fb2be440b628d', 'はじめまして、山田です。今日はよろしくお願いします。', 'staff_mid_m', 'in_person'),
       ('0412927cdfdec63d', '同僚と二人で、来週の展示会の準備をどう分担するか相談しています。自分は会場の設営を引き受けたいと思っています。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('38a0a3382c6650c9', '差し支えなければ、設営のほうは私にお任せいただけませんでしょうか。', 'staff_mid_f', 'in_person'),
       ('eba66e478c1df1c4', '設営は大変そうですね。誰がやることになるんでしょうね。', 'staff_mid_f', 'in_person'),
       ('6b911f01c3d6e0f6', '設営は、どなたにお願いすればよろしいでしょうか。', 'staff_mid_f', 'in_person'),
       ('3ba244346a149997', '設営は私がやろうか。去年も同じ会場でやったから、勝手が分かるし。', 'staff_mid_f', 'in_person'),
       ('b3adf2d68a8288b8', 'オンライン会議の途中で、宅配便が届いて呼び鈴が鳴りました。数分だけ席を外したいと思います。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('eb64cd775bf70ae7', 'すみません、ちょっと宅配来たんで、抜けますね。', 'staff_junior_m', 'video'),
       ('15e15d8bcdf7cc3c', '申し訳ございません、宅配便が参りましたので、五分ほど席を外してまいります。', 'staff_junior_m', 'video'),
       ('e91f602a90bec0db', '恐れ入ります。宅配便が参りましたので、五分ほど席を外してもよろしいでしょうか。', 'staff_junior_m', 'video'),
       ('e6086309321b328a', '恐れ入ります。ただいま宅配便がお見えになりましたので、少々お時間を頂戴させていただきたく存じます。', 'staff_junior_m', 'video'),
       ('9ef7f969eb29f48a', '課長から今夜の食事に誘われましたが、今日は家族との約束があって行けません。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('3555e124d9815f07', 'せっかくお誘いいただいたのですが、本日は外せない用がありまして、申し訳ございません。', 'staff_junior_m', 'in_person'),
       ('b31f05d262da9a8c', 'あ、今日はちょっと無理です。すみません。', 'staff_junior_m', 'in_person'),
       ('5084e1518b6a7cc2', 'ありがとうございます。ぜひご一緒させてください。', 'staff_junior_m', 'in_person'),
       ('e3ee55637956de56', 'せっかくのお誘いを賜りましたが、遺憾ながら本日は参上いたしかねる次第でございます。', 'staff_junior_m', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'author-composed', '2026-09-15T17:20:43+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('995396318a', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'reception+staff_to_customer+greet_and_guide@J3', 'reception', 'staff_to_customer', 'greet_and_guide', 'in_person', 'scene_reception_counter', '受付の社員', '約束のあるお客様', '受付でお客様を迎えて応接室へ案内する', '受付に立っていると、二時にお約束のあるお客様が到着しました。これから応接室へご案内します。こんなとき、何と言いますか。', 0, '受付の来客対応は順番が決まっている。待っていたことを伝え、行き先を告げ、体の向きで誘導する。正解はその三つが短く収まっている。「こっちです」は社内の同僚どうしの言い方で、初対面の客には使えない。「お越しになられて」は「お越しになる」にさらに「られる」を重ねた二重敬語で、丁寧にしようとして誤っている典型。「ご用件でしょうか」は丁寧だが、約束のある相手を足止めしてしまい、案内という役割を果たしていない。', 'A reception greeting has a fixed shape: say you were expecting them, name where you are taking them, and lead. Casual speech, doubled honorifics, and asking their business all break it.', '[{"term": "お待ちしておりました", "reading": "おまちしておりました", "meaning": "we have been expecting you (humble)"}, {"term": "二重敬語", "reading": "にじゅうけいご", "meaning": "stacking two honorific forms on one verb — an error, not extra politeness"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'c902476155c11126', null),
       ('70aa5a4577', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'phone_external+staff_to_client+phone_transfer@J3', 'phone_external', 'staff_to_client', 'phone_transfer', 'phone', 'scene_phone_desk', '電話を受けた社員', '取引先の担当者', '取引先からの電話を担当者に取り次ぐ', '取引先から電話があり、営業部の佐藤に代わってほしいと言われました。佐藤は席にいます。こんなとき、何と言いますか。', 2, '取り次ぎは、相手の求めた人物を呼び捨てで復唱し、保留に入ることを断ってから代わる、という形が決まっている。正解はその形どおり。「佐藤さん」「佐藤部長」はどちらも社外に対して身内を高めており、電話では特に目立つ誤り。最後の選択肢は敬語もウチ・ソトも正しいが、取り次いでほしいという要求に答えず伝言にすり替えている。', 'Transferring a call has a fixed shape: repeat the name without any title, say you are putting them on hold, then transfer. Titles on your own colleague, shouting across the floor, or switching to a message all fail.', '[{"term": "少々お待ちくださいませ", "reading": "しょうしょうおまちくださいませ", "meaning": "one moment please (the standard hold phrase)"}, {"term": "申し伝える", "reading": "もうしつたえる", "meaning": "to pass on a message (humble, of one''s own side)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '4abf43d914d25a1b', null),
       ('79a2a86cd8', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'office_desk+junior_to_senior+thank@J3', 'office_desk', 'junior_to_senior', 'thank', 'in_person', 'scene_office_desk_pair', '入社一年目の社員', '先輩社員', '見積書の作り方を教えてくれた先輩に礼を言う', '作り方が分からなかった見積書を、先輩が自分の手を止めて一から教えてくれました。作業が終わったところです。こんなとき、何と言いますか。', 1, '礼は、相手が割いてくれたものに触れ、その行為を「〜ていただく」で受けるのが基本の形。正解はその形で、長さも席で交わすやりとりに合っている。「ご高配を賜り」は文書の言葉で、目の前の先輩には浮く。「お教えしてくださり」は謙譲語の「お教えする」に「くださる」を付けたもので、敬意の向きが逆になっている。「助かった、ありがとね」は内容は同じでも、先輩との距離を無視している。', 'Thanks to a senior: name what they gave up, then receive their action with 〜ていただく. Document-register phrases, humble forms pointed at the other party, and plain speech all miss.', '[{"term": "教えていただく", "reading": "おしえていただく", "meaning": "to receive the favour of being taught (humble, correct direction)"}, {"term": "お教えする", "reading": "おおしえする", "meaning": "for ME to teach (humble) — wrong for the other party''s action"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '112e3e31a0b2d243', null),
       ('5ce5d0c9b9', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'office_desk+subordinate_to_superior+confirm@J3', 'office_desk', 'subordinate_to_superior', 'confirm', 'in_person', 'scene_office_desk_pair', '部下', '直属の上司（課長）', '聞き取れなかった締め切りを上司に確認する', '自分の席で課長から急ぎの作業を頼まれましたが、締め切りが今日なのか明日なのか聞き取れませんでした。こんなとき、何と言いますか。', 3, '聞き取れなかったときは、確認であることを先に示し、答えを選ぶだけで済む形にするのが早い。正解はその二段構え。申し出に変えてしまうと、肝心の期日が分からないまま作業が始まる。「おっしゃられた」は「おっしゃる」に「れる」を重ねた二重敬語で、丁寧にしようとして誤る典型例。崩れた話し方は、内容が正しくても会議の場では通らない。', 'When you missed something, flag that you are confirming and offer the alternatives so the answer is one word. Turning it into an offer leaves the deadline unknown.', '[{"term": "確認させてください", "reading": "かくにんさせてください", "meaning": "let me confirm — flags what follows as a check, not a challenge"}, {"term": "おっしゃられた", "reading": "おっしゃられた", "meaning": "doubled honorific of 言う — an error; 「おっしゃった」 is correct"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '4cb48d9770350834', null),
       ('33cd2ddb1e', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'corridor+staff_to_visitor+farewell@J3', 'corridor', 'staff_to_visitor', 'farewell', 'in_person', 'scene_elevator_hall', '打ち合わせを担当した社員', '帰る来客', 'エレベーターホールで来客を見送る', '打ち合わせが終わり、来客をエレベーターホールまで見送りました。エレベーターの扉が開いたところです。こんなとき、何と言いますか。', 0, '見送りは、来てくれたことへの礼と、帰り道への気遣いの二つで足りる。扉が開いている数秒で言い切れることが条件なので、長い言葉は選べない。「行ってらっしゃいませ」は実在する定型だが、これから出かける人に向ける言葉で、場面が違う。身内に役職を付けて社外の人に伝言を頼むのは、ウチ・ソトの典型的な誤り。', 'A send-off is two beats: thanks for coming, and care for the trip back. 行ってらっしゃいませ is a real set phrase for someone heading out, not someone heading home.', '[{"term": "お気をつけてお帰りください", "reading": "おきをつけておかえりください", "meaning": "please get home safely — the standard send-off"}, {"term": "弊社", "reading": "へいしゃ", "meaning": "our company (humble) — takes no titles on its people"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '7648bd10a451e987', null),
       ('21645856a6', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'phone_internal+junior_to_senior+request@J3', 'phone_internal', 'junior_to_senior', 'request', 'phone', 'scene_phone_desk', '後輩社員', '別のフロアにいる先輩', '内線で先輩に資料を持ってきてもらうよう頼む', '別のフロアにいる先輩に内線をかけました。先輩の机の上にある資料を、こちらまで持ってきてほしいと頼みます。こんなとき、何と言いますか。', 2, '内線はまず名乗る。相手には誰からの電話か見えていないからで、これは社内でも省かない。次に手間をかけることへのひと言、最後に依頼、という順が決まっている。正解はその三つが並んでいる。「お持ちしましょうか」は自分が運ぶ申し出で、頼みたいことと逆。「お持ちになっていただけますか」は尊敬語と謙譲の受け方を混ぜた形で、正しくは「持ってきていただけますか」。', 'An internal call starts with your name — the other end cannot see who is calling. Then the apology for the trouble, then the request. Offering to fetch it yourself inverts the whole point.', '[{"term": "お手数ですが", "reading": "おてすうですが", "meaning": "sorry to trouble you — the standard lead-in to a request"}, {"term": "持ってきていただけますか", "reading": "もってきていただけますか", "meaning": "could you bring it — receives the other party''s action correctly"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'dadcfabefc57e2a4', null),
       ('daa75dd6f7', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'client_office+staff_to_client+greet_first_meet@J3', 'client_office', 'staff_to_client', 'greet_first_meet', 'in_person', 'scene_client_office_sofa', '初めて訪問した営業担当', '取引先の担当者', '初訪問の取引先で名刺を渡してあいさつする', '取引先を初めて訪問し、応接室で担当の方と向かい合いました。これから名刺を差し出します。こんなとき、何と言いますか。', 1, '名刺交換のあいさつは、はじめまして・社名・氏名・今後の依頼、という順が固まっている。正解はその順どおり。「いつもお世話になっております」は実在する定型だが、すでに取引のある相手に使うもので、初対面では場面が合わない。自分に「部長」と付けるのは社外に対して自社を高める誤りで、名乗りでは特に目立つ。', 'A first-meeting exchange is fixed: はじめまして, company, name, request for the future. いつもお世話になっております is a real phrase for an existing relationship, not a first meeting.', '[{"term": "と申します", "reading": "ともうします", "meaning": "my name is (humble) — how you name yourself outside your company"}, {"term": "いつもお世話になっております", "reading": "いつもおせわになっております", "meaning": "thank you for your continued business — only with an existing counterpart"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '9c394d0dfbc40931', null),
       ('feeae3d00f', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'meeting_room+peer_to_peer+propose@J3', 'meeting_room', 'peer_to_peer', 'propose', 'in_person', 'scene_meeting_room_table', '同僚', '同僚', '展示会の準備の分担を同僚に提案する', '同僚と二人で、来週の展示会の準備をどう分担するか相談しています。自分は会場の設営を引き受けたいと思っています。こんなとき、何と言いますか。', 3, '分担の相談で役に立つのは、引き受ける範囲と、なぜ自分なのかの二つ。正解はそれを一息で言い切っている。敬語が正解とはかぎらず、「お任せいただけませんでしょうか」は同僚に向けると距離を置きすぎで、相談の速さを殺す。「どなたにお願いすれば」は丁寧だが、提案する場面で相手に決めさせており、自分が引き受けたいことが伝わらない。感想だけ述べる言い方は、話に加わってはいるが何も引き受けていない。', 'Splitting work between peers needs two things: what you will take, and why you. Keigo is not automatically the answer — hedged politeness here reads as distance and slows the conversation down.', '[{"term": "勝手が分かる", "reading": "かってがわかる", "meaning": "to know how a place or job works from experience"}, {"term": "お任せいただけませんでしょうか", "reading": "おまかせいただけませんでしょうか", "meaning": "could you leave it to me — for a client, too distant for a colleague"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '0412927cdfdec63d', null),
       ('3ecbdc1b0b', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'video_call+subordinate_to_superior+ask_permission@J3', 'video_call', 'subordinate_to_superior', 'ask_permission', 'video', 'scene_video_call_laptop', '部下', '部長', 'オンライン会議の途中で席を外す許可を求める', 'オンライン会議の途中で、宅配便が届いて呼び鈴が鳴りました。数分だけ席を外したいと思います。こんなとき、何と言いますか。', 2, '会議を抜けるときは、理由・どれくらい・許可を求める言葉、の三つが要る。どれくらいかが分かって初めて、上司は待つか先に進めるかを決められる。正解はその三つが揃っている。「外してまいります」は敬語としては正しいが、決定を自分でしてしまっており、許可を求めていない。「お見えになる」は人に使う尊敬語で、宅配便には向かない。', 'Leaving a meeting needs three parts: why, how long, and asking rather than announcing. Without the duration the chair cannot decide whether to wait.', '[{"term": "よろしいでしょうか", "reading": "よろしいでしょうか", "meaning": "may I — turns an announcement into a request for permission"}, {"term": "お見えになる", "reading": "おみえになる", "meaning": "to come (honorific) — for people, not parcels"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'b3adf2d68a8288b8', null),
       ('18e6d49f21', 'hatsugen_choukai_J3_002', 'hatsugen_choukai', 'J3', 'office_desk+subordinate_to_superior+decline@J3', 'office_desk', 'subordinate_to_superior', 'decline', 'in_person', 'scene_office_desk_pair', '部下', '直属の上司（課長）', '上司からの食事の誘いを断る', '課長から今夜の食事に誘われましたが、今日は家族との約束があって行けません。こんなとき、何と言いますか。', 0, '断りは、礼・理由・わびの順に置くと角が立たない。理由は詳しく述べる必要はなく、「外せない用」で足りる。正解はこの形。礼を落として「無理です」だけにすると、誘い自体を迷惑がっているように聞こえる。「賜りました」「参上いたしかねる次第でございます」は文書の言葉で、席での短いやりとりには重い。受けてしまう返事は丁寧でも、断るという場面の要求に答えていない。', 'A refusal goes thanks, reason, apology. The reason need not be detailed. Dropping the thanks makes the invitation itself sound unwelcome.', '[{"term": "せっかくお誘いいただいたのですが", "reading": "せっかくおさそいいただいたのですが", "meaning": "thank you for inviting me, but — the standard opening of a refusal"}, {"term": "外せない用", "reading": "はずせないよう", "meaning": "an unavoidable commitment — enough of a reason without details"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '9ef7f969eb29f48a', null)
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
delete from public.item_options where item_id in ('995396318a', '70aa5a4577', '79a2a86cd8', '5ce5d0c9b9', '33cd2ddb1e', '21645856a6', 'daa75dd6f7', 'feeae3d00f', '3ecbdc1b0b', '18e6d49f21');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('995396318a', 0, 'お待ちしておりました。応接室へご案内いたします。どうぞこちらへ。', 'correct', '待っていたことを「お待ちしておりました」と謙譲語で伝え、案内する自分の行為も「ご案内いたします」と低めている。受付の定型どおり。', 'c4ca0150f1ef34cf'),
       ('995396318a', 1, 'お待ちしてました。応接室まで案内しますね。こっちです。', 'register_too_casual', '「してました」「こっち」と話し言葉が崩れており、初めて会うお客様に向ける丁寧さがない。', '669de1c7396e8dd9'),
       ('995396318a', 2, 'お待ちしておりました。応接室へご案内させていただきますので、どうぞお越しになられてください。', 'over_polite_misfit', '「お越しになられて」は尊敬語を二重に重ねた形で誤り。受付で交わす短いやりとりには言葉数も多すぎる。', 'b96387c2d668a7e7'),
       ('995396318a', 3, 'お待ちしておりました。本日はどのようなご用件でしょうか。', 'content_mismatch', '言い方は丁寧だが、約束のある客に用件を聞き直しており、案内するというこの場面の役割を果たしていない。', '44ed51be02541011'),
       ('70aa5a4577', 0, 'はい、佐藤さんですね。佐藤さーん、お電話ですよ。', 'phone_protocol_violation', '社外の相手に自社の人間を「佐藤さん」と呼び、保留にもせず社内に呼びかけている。取り次ぎの手順を踏んでいない。', '642916a0e9326537'),
       ('70aa5a4577', 1, 'かしこまりました。佐藤部長は在席されておりますので、少々お待ちください。', 'wrong_uchi_soto', '社外に対して身内の佐藤を役職名と尊敬語で高めており、ウチ・ソトの扱いが逆になっている。', '56ee357b38d78966'),
       ('70aa5a4577', 2, 'かしこまりました。佐藤でございますね。少々お待ちくださいませ。', 'correct', '取り次ぐ相手を呼び捨てで復唱して確認し、保留に入る前のひと言も添えている。取り次ぎの型どおり。', '093984c18f5ffb57'),
       ('70aa5a4577', 3, 'かしこまりました。ご用件は確かに承りましたので、佐藤に申し伝えます。', 'content_mismatch', '身内の扱いは正しいが、相手は取り次ぎを求めているのに伝言に切り替えており、頼まれたことをしていない。', '9a30fed0e44d142d'),
       ('79a2a86cd8', 0, 'このたびは格別のご高配を賜りまして、誠にありがとうございました。', 'over_polite_misfit', '取引先への文書で使う堅い言い方で、隣の席の先輩に口頭で述べる礼としては大げさすぎる。', '8eb0b8dad06064a4'),
       ('79a2a86cd8', 1, 'お忙しいところ教えていただき、ありがとうございました。', 'correct', '相手の行為を「教えていただき」と受け、手を止めさせた点にも触れている。先輩への礼として過不足がない。', 'd79a140cb1993f40'),
       ('79a2a86cd8', 2, '助かった、ありがとね。', 'register_too_casual', '同期や友人への言い方で、先輩に向ける敬意がまったくない。', '421422d2735d5c62'),
       ('79a2a86cd8', 3, 'お忙しいところ、お教えしてくださり、ありがとうございました。', 'wrong_honorific_direction', '「お教えする」は自分が教えるときの謙譲語。教えたのは先輩なので、相手の行為を低めてしまっている。', '7d42f532bef94379'),
       ('5ce5d0c9b9', 0, 'その作業でしたら、明日までにやっておきましょうか。', 'wrong_speech_act', '確認すべき場面なのに自分から申し出ており、聞き取れなかった締め切りは分からないままになる。', '341e0c2caf2b8e7d'),
       ('5ce5d0c9b9', 1, 'え、それって今日まででしたっけ、明日まででしたっけ。', 'register_too_casual', '「それって」「でしたっけ」は友人どうしの言い方で、会議の場で上司に向ける言葉ではない。', '264e5e6cf555d14f'),
       ('5ce5d0c9b9', 2, '恐れ入りますが、ただいまおっしゃられた期日をもう一度お聞かせ願えませんでしょうか。', 'over_polite_misfit', '「おっしゃられた」は二重敬語。ひと言の確認にしては言葉が重く、会議の流れを止めてしまう。', 'cf15dcdaa6d51eec'),
       ('5ce5d0c9b9', 3, '確認させてください。締め切りは本日中でしょうか、明日でしょうか。', 'correct', '確認だと先に断ったうえで二つの候補を並べており、上司は一語で答えられる。会議を止めない形になっている。', 'ccb8f5811bf72120'),
       ('33cd2ddb1e', 0, '本日はありがとうございました。どうぞお気をつけてお帰りくださいませ。', 'correct', '来訪への礼と帰り道への気遣いが並んだ見送りの定型。扉が開いている短い時間に収まる長さでもある。', 'd014f7d625b54919'),
       ('33cd2ddb1e', 1, '本日はありがとうございました。行ってらっしゃいませ。', 'set_phrase_wrong_situation', '「行ってらっしゃいませ」は出かける人を送り出す言葉で、用が済んで帰る来客には使わない。', '777e252e4947bcbe'),
       ('33cd2ddb1e', 2, 'ありがとうございました。じゃ、また今度よろしくお願いします。', 'register_too_casual', '「じゃ、また今度」は社内の同僚どうしの別れ方で、来客を見送る場面には軽すぎる。', '005a9813bb727d1b'),
       ('33cd2ddb1e', 3, '本日はありがとうございました。弊社の田中部長にもよろしくお伝えください。', 'wrong_uchi_soto', '身内である田中に役職を付けたうえ、来客に伝言を頼んでおり、ウチ・ソトが逆になっている。', 'a88d75e7c4ebbd5d'),
       ('21645856a6', 0, 'あ、先輩ですか。机の上の資料、こっち持ってきてもらえます？', 'register_too_casual', '名乗らずに用件へ入り、「こっち」「もらえます？」と崩れている。内線でも先輩への頼み方にはならない。', '6638ac682d6b542d'),
       ('21645856a6', 1, '営業部の山田です。お手数ですが、その資料をお持ちしましょうか。', 'wrong_speech_act', '敬語は整っているが、持ってきてほしい場面で自分が持っていくと申し出ており、用件が逆になっている。', 'bb33697e590f669b'),
       ('21645856a6', 2, '営業部の山田です。お手数ですが、机の上の資料を持ってきていただけますか。', 'correct', '先に名乗り、恐縮の言葉を置いてから依頼の形にしている。内線の頼みごとの型どおり。', 'cfacf5206ba06047'),
       ('21645856a6', 3, '営業部の山田でございます。恐れ入りますが、資料をお持ちになっていただけますでしょうか。', 'over_polite_misfit', '尊敬語の「お持ちになる」に「いただく」を重ねた形で誤り。社内の先輩への内線としても重すぎる。', '80cd360f1125f982'),
       ('daa75dd6f7', 0, 'いつもお世話になっております。本日はお忙しいところ恐れ入ります。', 'set_phrase_wrong_situation', '「いつもお世話になっております」は取引のある相手への言葉で、初対面の名刺交換では使わない。', '4189559eccd2e335'),
       ('daa75dd6f7', 1, 'はじめまして。株式会社みどり商事の山田と申します。よろしくお願いいたします。', 'correct', '初対面のあいさつ、社名と名前、今後への依頼が順に並んだ名刺交換の型どおりになっている。', '0c1ed54107aad435'),
       ('daa75dd6f7', 2, 'はじめまして。株式会社みどり商事の山田部長と申します。', 'wrong_uchi_soto', '自分に役職を付けて名乗っており、社外に対して自分側を高めてしまっている。', '614ceca50fc0c4d8'),
       ('daa75dd6f7', 3, 'はじめまして、山田です。今日はよろしくお願いします。', 'register_too_casual', '社名を名乗らず、初対面の取引先に向ける丁寧さも足りない。名刺交換の場では通らない。', 'a40fb2be440b628d'),
       ('feeae3d00f', 0, '差し支えなければ、設営のほうは私にお任せいただけませんでしょうか。', 'over_polite_misfit', '取引先に向けるような回りくどい言い方で、同僚どうしの分担の相談には重すぎる。', '38a0a3382c6650c9'),
       ('feeae3d00f', 1, '設営は大変そうですね。誰がやることになるんでしょうね。', 'content_mismatch', '話題には触れているが自分が引き受けるとは言っておらず、分担は一つも決まらない。', 'eba66e478c1df1c4'),
       ('feeae3d00f', 2, '設営は、どなたにお願いすればよろしいでしょうか。', 'wrong_speech_act', '敬語は整っているが、提案せずに相手へ尋ね返しており、引き受けたいことが伝わらない。', '6b911f01c3d6e0f6'),
       ('feeae3d00f', 3, '設営は私がやろうか。去年も同じ会場でやったから、勝手が分かるし。', 'correct', '引き受ける範囲と、自分が適任である理由が短く並んでいる。同僚どうしの相談はこれで通る。', '3ba244346a149997'),
       ('3ecbdc1b0b', 0, 'すみません、ちょっと宅配来たんで、抜けますね。', 'register_too_casual', '「来たんで」「抜けますね」と崩れており、部長に許可を求める言い方になっていない。', 'eb64cd775bf70ae7'),
       ('3ecbdc1b0b', 1, '申し訳ございません、宅配便が参りましたので、五分ほど席を外してまいります。', 'wrong_speech_act', '敬語は正しいが、許可を求めず自分で決めて告げており、会議を抜ける断りとしては一方的。', '15e15d8bcdf7cc3c'),
       ('3ecbdc1b0b', 2, '恐れ入ります。宅配便が参りましたので、五分ほど席を外してもよろしいでしょうか。', 'correct', '理由と離席の長さを示したうえで「よろしいでしょうか」と許可を求めている。相手が可否を判断できる。', 'e91f602a90bec0db'),
       ('3ecbdc1b0b', 3, '恐れ入ります。ただいま宅配便がお見えになりましたので、少々お時間を頂戴させていただきたく存じます。', 'over_polite_misfit', '宅配便に「お見えになる」と尊敬語を使っており、「頂戴させていただきたく存じます」も回りくどい。', 'e6086309321b328a'),
       ('18e6d49f21', 0, 'せっかくお誘いいただいたのですが、本日は外せない用がありまして、申し訳ございません。', 'correct', '誘いへの礼を先に置き、理由を簡単に添えてから断っている。次に誘いにくくならない形になっている。', '3555e124d9815f07'),
       ('18e6d49f21', 1, 'あ、今日はちょっと無理です。すみません。', 'register_too_casual', '誘ってくれたことへの礼がなく、「ちょっと無理です」だけでは上司への断りとして足りない。', 'b31f05d262da9a8c'),
       ('18e6d49f21', 2, 'ありがとうございます。ぜひご一緒させてください。', 'content_mismatch', '丁寧だが誘いを受けており、行けないという肝心のことを伝えていない。', '5084e1518b6a7cc2'),
       ('18e6d49f21', 3, 'せっかくのお誘いを賜りましたが、遺憾ながら本日は参上いたしかねる次第でございます。', 'over_polite_misfit', '書き言葉のように硬い言い方で、席で交わす短い断りには大げさすぎる。', 'e3ee55637956de56')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
