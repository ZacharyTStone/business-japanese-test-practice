-- hatsugen_choukai_J2_001: 10 × hatsugen_choukai (J2)
-- generated 2026-09-13T12:05:28+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_meeting_room', '取引先の会議室'),
       ('scene_corridor', 'オフィスの廊下'),
       ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人'),
       ('scene_office_open_floor', '執務フロア全体'),
       ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_reception_counter', '自社の受付カウンター'),
       ('scene_restaurant_private', '料理店の個室')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('2f8a0ca05b4633b3', '取引先から、上司の田中部長あてに電話がかかってきました。田中部長は外出していて、三時ごろ戻る予定です。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('ed9a3925edc8acbc', '申し訳ございません。田中はただいま外出しておりまして、三時ごろ戻る予定でございます。', 'staff_mid_m', 'phone'),
       ('f4e932c8dc41845d', '申し訳ございません。田中部長はただいま外出されていて、三時ごろお戻りになる予定です。', 'staff_mid_m', 'phone'),
       ('c0727e3faa3d6ee4', 'すみません、田中は今ちょっと出ちゃってて、三時ぐらいには戻ると思います。', 'staff_mid_m', 'phone'),
       ('5c739d8576e237f3', '申し訳ございません。私では分かりかねますので、少々お待ちいただけますでしょうか。', 'staff_mid_m', 'phone'),
       ('b3a2a8e3467e4fe1', '明日の会議で使う資料を作り終えました。提出する前に、課長に内容を見てもらいたいと思っています。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('86a98288e14149a1', 'お忙しいところ恐れ入りますが、明日の会議資料を拝読していただけますでしょうか。', 'staff_junior_m', 'in_person'),
       ('bc17c1a594e28695', 'お忙しいところ恐れ入りますが、明日の会議資料をお読みいたしましょうか。', 'staff_junior_m', 'in_person'),
       ('90fe3e0d7985ae17', 'お忙しいところ恐れ入りますが、明日の会議資料に目を通していただけますでしょうか。', 'staff_junior_m', 'in_person'),
       ('ec8933766ab1f1c6', 'お忙しいところ恐れ入りますが、明日の会議資料をご覧になられていただけますでしょうか。', 'staff_junior_m', 'in_person'),
       ('8f3ce4a24cb5b307', '約束の時間に、取引先の方が受付にいらっしゃいました。あなたが迎えに出て、会議室まで案内します。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('27e02f5b9b4a6d1c', 'お待ちになっておりました。会議室までご案内いたします。', 'reception_f', 'in_person'),
       ('5fa8729a0f1a52d4', 'お待ちしておりました。会議室までご案内いたします。どうぞこちらへ。', 'reception_f', 'in_person'),
       ('e8b70cbdabe96629', '本日はご足労いただき、ありがとうございました。またのお越しをお待ちしております。', 'reception_f', 'in_person'),
       ('4f1b66756ea962ee', 'お待ちしてました。会議室、こちらです。どうぞ。', 'reception_f', 'in_person'),
       ('e09163129aac5201', 'あなたはまだ仕事が残っています。遅くまで会社にいた課長が、帰り支度をして出ていくところです。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('08a1f43b3007be79', 'ご苦労さまでした。失礼いたします。', 'staff_junior_m', 'in_person'),
       ('0f041f547213c8ed', 'お疲れさまです。また明日ね。', 'staff_junior_m', 'in_person'),
       ('5c51f9f6146de3af', 'お先に失礼いたします。', 'staff_junior_m', 'in_person'),
       ('b3c9c7d64fd249b9', 'お疲れさまでした。お気をつけて。', 'staff_junior_m', 'in_person'),
       ('889dcd2da967b7b0', '取引先の山田さんに用件があり、あなたのほうから電話をかけました。山田さんが電話に出ました。こんなとき、最初に何と言いますか。', 'narrator_f', 'in_person'),
       ('f04d84b390030a85', 'いつもお世話になっております。ABC商事の鈴木でございます。ただいまお時間よろしいでしょうか。', 'staff_mid_m', 'phone'),
       ('7eb18ffa211a3797', 'もしもし、山田様でいらっしゃいますか。先日の件でご連絡いたしました。', 'staff_mid_m', 'phone'),
       ('57306d2224845cca', 'いつもお世話になっております。ABC商事の鈴木と申させていただきます。お時間をいただかせていただいてもよろしいでしょうか。', 'staff_mid_m', 'phone'),
       ('e6dbf296df55d7d6', 'いつもお世話になっております。ABC商事の鈴木でございます。ご用件を承ります。', 'staff_mid_m', 'phone'),
       ('1318cb3b2405c723', '取引先を訪問中、先方から納期を一週間早めてほしいと言われました。工場の都合で、その希望には応じられません。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('da3b5e40f30479d4', 'それはちょっと無理ですね。一週間早めるのは厳しいです。', 'staff_mid_m', 'in_person'),
       ('f6039d05cab80e58', '納期の件につきましては、社に持ち帰りまして、あらためてご連絡を差し上げます。', 'staff_mid_m', 'in_person'),
       ('919f7193f807e764', 'ご希望に沿わせていただくことができかねさせていただきます。', 'staff_mid_m', 'in_person'),
       ('2f2005e0fc440777', 'あいにくではございますが、今回はご希望に沿いかねます。', 'staff_mid_m', 'in_person'),
       ('a1c4cfa67b068704', '自分の確認不足で、A社に金額の誤った見積書を送ってしまいました。会議室で課長と二人になったので、すぐに報告します。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('c646525e14f8394f', '申し訳ございません。私がA社に誤った見積書をご送付になってしまいました。', 'staff_junior_m', 'in_person'),
       ('c32af0fd8f50231c', 'A社のご担当者の方が金額を勘違いされたようですので、こちらから先方にご確認いただこうと思っております。', 'staff_junior_m', 'in_person'),
       ('184ff59e75eb487f', '申し訳ございません。私の確認不足で、A社に誤った金額の見積書をお送りしてしまいました。', 'staff_junior_m', 'in_person'),
       ('564ebad2274f9413', 'A社の見積書の件、金額を確認していただけますでしょうか。', 'staff_junior_m', 'in_person'),
       ('cfbdb51d5f482b60', '取引先の部長を会食に招きました。料理が運ばれてきましたが、部長はまだ箸をつけていません。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('4da5892e0596d7db', 'どうぞ、冷めないうちにいただいてください。', 'staff_mid_m', 'in_person'),
       ('17c9cf6c11426e20', 'どうぞ、冷めないうちにお召し上がりください。', 'staff_mid_m', 'in_person'),
       ('a2af458daa540d16', 'どうぞ、冷めないうちにお召し上がりになられてください。', 'staff_mid_m', 'in_person'),
       ('340feaa575165544', 'どうぞ、ごゆっくりお過ごしくださいませ。', 'staff_mid_m', 'in_person'),
       ('fde5df2919e03a9e', '取引先に電話をかけましたが、担当の山田さんは席を外していました。戻ったら電話をもらいたいと伝えたいです。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('803ea13925013f11', '山田様がお戻りになりましたら、弊社の鈴木部長にお電話をくださいますよう、お伝えいただけますでしょうか。', 'staff_mid_m', 'phone'),
       ('cff37b57283a1044', '恐れ入りますが、山田様の携帯電話の番号を教えていただけますでしょうか。', 'staff_mid_m', 'phone'),
       ('82d7739db93c02e5', '恐れ入りますが、山田様に急ぎの用件だとお伝えいただけますでしょうか。', 'staff_mid_m', 'phone'),
       ('2ab24b671688a67c', '恐れ入りますが、お戻りになりましたら、お電話をいただきたい旨、お伝えいただけますでしょうか。', 'staff_mid_m', 'phone'),
       ('da3db6399331e494', '先週、先輩に確認をお願いした書類が、まだ返ってきていません。締め切りは明日です。廊下で先輩に会いました。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('6026e0daced30e8d', 'お忙しいところすみません。先週お願いした書類、その後いかがでしょうか。', 'staff_junior_f', 'in_person'),
       ('4043675685355ce5', 'あの書類、まだですか。明日までなので早めにお願いします。', 'staff_junior_f', 'in_person'),
       ('b4442447cab1e122', '先週お願いした書類、私のほうで進めておきましょうか。', 'staff_junior_f', 'in_person'),
       ('7425cd354aa28ca0', '先週お願いさせていただきました書類は、その後いかがでいらっしゃいますでしょうか。', 'staff_junior_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'author-composed', '2026-09-13T12:05:28+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, narration_clip_id)
values ('db96cb5c00', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'phone_external+staff_to_client+phone_absence@J2', 'phone_external', 'staff_to_client', 'phone_absence', 'phone', 'scene_phone_desk', '電話を受けた社員', '取引先の担当者', '上司の不在を取引先に伝える', '取引先から、上司の田中部長あてに電話がかかってきました。田中部長は外出していて、三時ごろ戻る予定です。こんなとき、何と言いますか。', 0, '社外の相手に自社の人間のことを話すときは、役職名や敬称を付けずに「田中」と呼び、その行為は謙譲語で述べる。正解はこの原則どおりで、さらに戻る時刻を添えている点も実務的である。「田中部長は…外出されて」は、身内である上司を社外に対して高めており、ウチ・ソトの扱いを誤っている。「出ちゃってて」は内容こそ合っているが話し言葉が崩れすぎで、取引先には使えない。「私では分かりかねますので」は丁寧だが、不在を伝えるという場面の要求に答えていない。', 'To an outsider, your own boss is 田中 with no title and humble verbs; honorifics on him, broken speech, or failing to relay the absence all fail.', '[{"term": "外出しております", "reading": "がいしゅつしております", "meaning": "is out (humble, of one''s own side)"}, {"term": "ウチとソト", "reading": "うちとそと", "meaning": "in-group vs out-group — decides which keigo you use"}]'::jsonb, '2f8a0ca05b4633b3'),
       ('ee5a9788b4', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'office_desk+subordinate_to_superior+request@J2', 'office_desk', 'subordinate_to_superior', 'request', 'in_person', 'scene_office_desk_pair', '若手社員', '直属の上司（課長）', '上司に会議資料の確認を頼む', '明日の会議で使う資料を作り終えました。提出する前に、課長に内容を見てもらいたいと思っています。こんなとき、何と言いますか。', 2, '読むのは上司なので、上司の行為を立てる言い方を選ぶ。「目を通していただけますでしょうか」が依頼として最も自然で正解。「拝読していただく」は謙譲語を相手の行為に使っており、敬意の方向が逆。「お読みいたしましょうか」は敬語自体は正しいが、自分が読む申し出になっていて、頼みたい内容と食い違う。「ご覧になられて」は尊敬語を二重に重ねた形で、過剰な敬語はかえって誤りになる。', 'The superior does the reading, so honor his act — humble verbs, an offer instead of a request, or doubled honorifics all misfire.', '[{"term": "目を通す", "reading": "めをとおす", "meaning": "to look over, to run one''s eyes across"}, {"term": "二重敬語", "reading": "にじゅうけいご", "meaning": "doubled honorifics — an error, not extra politeness"}]'::jsonb, 'b3a2a8e3467e4fe1'),
       ('37d1093d48', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'reception+staff_to_visitor+greet_and_guide@J2', 'reception', 'staff_to_visitor', 'greet_and_guide', 'in_person', 'scene_reception_counter', '来客を迎えに出た社員', '約束のある来客', '受付で来客を迎えて案内する', '約束の時間に、取引先の方が受付にいらっしゃいました。あなたが迎えに出て、会議室まで案内します。こんなとき、何と言いますか。', 1, '待つのも案内するのも自分側の行為なので、謙譲語でそろえるのが原則。「お待ちしておりました」「ご案内いたします」に「どうぞこちらへ」を添えた形が正解。「お待ちになっておりました」は自分の行為に尊敬語を使っており、敬意の方向が逆。「ご足労いただき…またのお越しを」は言葉としては正しいが見送りの表現で、迎える場面には使えない。「お待ちしてました」は縮約形で、来客に対する丁寧さが足りない。', 'Waiting and guiding are your own acts, so they take humble forms; honorifics on yourself, a farewell set phrase, or clipped speech all fail.', '[{"term": "ご足労いただく", "reading": "ごそくろういただく", "meaning": "to have someone take the trouble to come"}, {"term": "ご案内いたします", "reading": "ごあんないいたします", "meaning": "I will show you the way (humble)"}]'::jsonb, '8f3ce4a24cb5b307'),
       ('6c4b89f4b8', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'office_desk+subordinate_to_superior+farewell@J2', 'office_desk', 'subordinate_to_superior', 'farewell', 'in_person', 'scene_office_open_floor', '残業している社員', '先に帰る課長', '先に帰る上司に声をかける', 'あなたはまだ仕事が残っています。遅くまで会社にいた課長が、帰り支度をして出ていくところです。こんなとき、何と言いますか。', 3, '目上をねぎらうときは「お疲れさま」を使い、「ご苦労さま」は使わない。帰る相手に「お気をつけて」を添えた形が正解。「ご苦労さまでした」は目上が目下に使う言葉なので、課長に向けると失礼になる。「また明日ね」は丁寧さの度合いが同僚向けで、上司には砕けすぎ。「お先に失礼いたします」は先に帰る本人が言う言葉であり、残る側の発言としては立場が逆である。', 'お疲れさま works upward, ご苦労さま does not; the casual tag and the leaver''s own phrase both put the speaker in the wrong position.', '[{"term": "お疲れさまでした", "reading": "おつかれさまでした", "meaning": "thanks for your work (usable toward superiors)"}, {"term": "ご苦労さまでした", "reading": "ごくろうさまでした", "meaning": "same idea, but only downward — a trap in business Japanese"}]'::jsonb, 'e09163129aac5201'),
       ('5ff8b33d92', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'phone_external+staff_to_client+phone_open@J2', 'phone_external', 'staff_to_client', 'phone_open', 'phone', 'scene_phone_desk', '電話をかけた営業担当', '取引先の担当者（山田さん）', '取引先に電話をかけて名乗る', '取引先の山田さんに用件があり、あなたのほうから電話をかけました。山田さんが電話に出ました。こんなとき、最初に何と言いますか。', 0, 'こちらから電話をかけたときは、あいさつ、社名と氏名の名乗り、相手の都合の確認という順で切り出す。正解はこの型どおり。「もしもし、山田様でいらっしゃいますか」は名乗りが抜けており、電話の型を外している。「申させていただきます」は「させていただく」の重ね使いで、へりくだりが過剰になっている。「ご用件を承ります」は電話を受けた側の言葉で、かけた側が言うと用件を聞く立場が入れ替わってしまう。', 'An outgoing business call opens with the greeting, your company and name, then a check on the other party''s time.', '[{"term": "いつもお世話になっております", "reading": "いつもおせわになっております", "meaning": "the standard opening to a client"}, {"term": "承ります", "reading": "うけたまわります", "meaning": "I receive / I will hear (said by the side taking the call)"}]'::jsonb, '889dcd2da967b7b0'),
       ('3149b15e3d', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'client_office+staff_to_client+decline@J2', 'client_office', 'staff_to_client', 'decline', 'in_person', 'scene_client_meeting_room', '訪問中の営業担当', '取引先の課長', '取引先の納期前倒しの依頼を断る', '取引先を訪問中、先方から納期を一週間早めてほしいと言われました。工場の都合で、その希望には応じられません。こんなとき、何と言いますか。', 3, '断るときは、直接的な否定を避けつつ、応じられないことははっきり伝える。「あいにくではございますが、今回はご希望に沿いかねます」がその型で正解。「それはちょっと無理ですね」は意味は同じでも取引先に対する配慮を欠く。「あらためてご連絡を差し上げます」は返事の先送りで、断るという場面の要求に答えていない。「沿わせていただくことができかねさせていただきます」は敬語を重ねすぎて文が壊れており、丁寧さは度を越すと誤りになる。', 'Decline softly but clearly: hedge the delivery, not the answer — deferring, blunt refusal, and stacked keigo all fail.', '[{"term": "ご希望に沿いかねます", "reading": "ごきぼうにそいかねます", "meaning": "we are unable to meet your request (softened refusal)"}, {"term": "あいにく", "reading": "あいにく", "meaning": "unfortunately — signals bad news is coming"}]'::jsonb, '1318cb3b2405c723'),
       ('be79f604a7', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'meeting_room+subordinate_to_superior+apologize_report@J2', 'meeting_room', 'subordinate_to_superior', 'apologize_report', 'in_person', 'scene_meeting_room_table', '営業担当（若手）', '課長', '見積書のミスを上司に報告する', '自分の確認不足で、A社に金額の誤った見積書を送ってしまいました。会議室で課長と二人になったので、すぐに報告します。こんなとき、何と言いますか。', 2, 'ミスの報告は、謝罪、原因、起きた事実を短くこの順で伝えるのが基本。正解は自分の行為を「お送りして」と謙譲語で述べており、上司がすぐ判断できる。「ご送付になってしまいました」は自分の行為に尊敬語を使っており、敬意の方向が逆。「ご担当者の方が勘違いされた」は敬語こそ整っているが責任を相手に移しており、報告になっていない。「確認していただけますでしょうか」は依頼であって、謝罪も報告も含まれていない。', 'Report a mistake as apology, cause, fact — in humble form, without honoring your own act or shifting the blame.', '[{"term": "確認不足", "reading": "かくにんぶそく", "meaning": "insufficient checking — the standard way to own a slip"}, {"term": "お送りする", "reading": "おおくりする", "meaning": "to send (humble, of one''s own act)"}]'::jsonb, 'a1c4cfa67b068704'),
       ('1a52c8f69c', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'dining+staff_to_client+offer_food@J2', 'dining', 'staff_to_client', 'offer_food', 'in_person', 'scene_restaurant_private', '接待している自社の社員', '取引先の部長', '会食で取引先に料理を勧める', '取引先の部長を会食に招きました。料理が運ばれてきましたが、部長はまだ箸をつけていません。こんなとき、何と言いますか。', 1, '食べるのは相手なので、尊敬語「召し上がる」を使う。「お召し上がりください」に「冷めないうちに」を添えた形が正解。「いただいてください」は謙譲語を相手の行為に使っており、敬意の方向が逆。「お召し上がりになられて」は尊敬語を二重に重ねた形で誤り。「ごゆっくりお過ごしくださいませ」は店員が客に言う言葉であり、料理を勧める発言にはならない。', 'The guest is the one eating, so 召し上がる — not the humble いただく, not doubled honorifics, not a waiter''s line.', '[{"term": "召し上がる", "reading": "めしあがる", "meaning": "to eat (honorific, of the other party)"}, {"term": "冷めないうちに", "reading": "さめないうちに", "meaning": "while it''s still hot — the usual reason given when urging a guest"}]'::jsonb, 'cfbdb51d5f482b60'),
       ('c087f1fe96', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'phone_external+staff_to_client+phone_message@J2', 'phone_external', 'staff_to_client', 'phone_message', 'phone', 'scene_phone_desk', '電話をかけた社員', '電話に出た取引先の社員', '取引先に折り返しの電話を頼む', '取引先に電話をかけましたが、担当の山田さんは席を外していました。戻ったら電話をもらいたいと伝えたいです。こんなとき、何と言いますか。', 3, '伝言を頼むときは、いつ、何をしてほしいかを、取り次ぐ人がそのまま書き留められる形で言う。正解はその三点がそろっている。「弊社の鈴木部長に」は自社の人間に役職を付けており、社外に対して身内を高めている。「携帯電話の番号を教えて」は取り次いだ相手に求めるべきことではなく、電話の作法を外している。「急ぎの用件だとお伝えいただけますでしょうか」は伝言の形だが、折り返しがほしいという用件そのものが抜けている。', 'A callback request names the moment, the action, and the relay — with no title on your own colleague.', '[{"term": "〜旨", "reading": "むね", "meaning": "to the effect that — sets up a message to be relayed"}, {"term": "弊社", "reading": "へいしゃ", "meaning": "our company (humble)"}]'::jsonb, 'fde5df2919e03a9e'),
       ('a425ecc58c', 'hatsugen_choukai_J2_001', 'hatsugen_choukai', 'J2', 'corridor+junior_to_senior+follow_up@J2', 'corridor', 'junior_to_senior', 'follow_up', 'in_person', 'scene_corridor', '後輩社員', '先輩社員', '先輩に確認の遅れを催促する', '先週、先輩に確認をお願いした書類が、まだ返ってきていません。締め切りは明日です。廊下で先輩に会いました。こんなとき、何と言いますか。', 0, '催促は、相手を責めずに状況を尋ねる形にすると角が立たない。「その後いかがでしょうか」に前置きを添えた言い方が正解。「まだですか」は遅れを正面から指摘しており、先輩に向けるには強すぎる。「私のほうで進めておきましょうか」は申し出であって、確認を促す発言になっていない。「いかがでいらっしゃいますでしょうか」は書類に対して人を高める尊敬語を使っており、敬語の向け先を誤っている。', 'Chase by asking after the status, not by naming the delay — and keep honorifics pointed at people, not paperwork.', '[{"term": "その後いかがでしょうか", "reading": "そのごいかがでしょうか", "meaning": "how is it coming along? — the standard soft chaser"}, {"term": "お忙しいところすみません", "reading": "おいそがしいところすみません", "meaning": "sorry to interrupt — the cushion before a request"}]'::jsonb, 'da3db6399331e494')
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
       narration_clip_id = excluded.narration_clip_id;

-- Options are replaced wholesale rather than upserted: a corrected item can
-- have fewer options or a different order, and a stale row left behind would
-- be a fifth answer nobody meant to publish.
delete from public.item_options where item_id in ('db96cb5c00', 'ee5a9788b4', '37d1093d48', '6c4b89f4b8', '5ff8b33d92', '3149b15e3d', 'be79f604a7', '1a52c8f69c', 'c087f1fe96', 'a425ecc58c');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('db96cb5c00', 0, '申し訳ございません。田中はただいま外出しておりまして、三時ごろ戻る予定でございます。', 'correct', '社外の相手には自社の人間を呼び捨てにし、その行為は「おります」と謙譲語で言う。戻る時刻まで添えていて、相手が次の行動を決められる。', 'ed9a3925edc8acbc'),
       ('db96cb5c00', 1, '申し訳ございません。田中部長はただいま外出されていて、三時ごろお戻りになる予定です。', 'wrong_uchi_soto', '「田中部長」と役職で呼び、「外出されて」「お戻りになる」と尊敬語を使っており、社外の相手に対して身内を高めてしまっている。', 'f4e932c8dc41845d'),
       ('db96cb5c00', 2, 'すみません、田中は今ちょっと出ちゃってて、三時ぐらいには戻ると思います。', 'register_too_casual', '呼び捨ての部分は正しいが、「出ちゃってて」「三時ぐらい」と話し言葉が崩れており、取引先に向ける丁寧さがない。', 'c0727e3faa3d6ee4'),
       ('db96cb5c00', 3, '申し訳ございません。私では分かりかねますので、少々お待ちいただけますでしょうか。', 'content_mismatch', '言い方は丁寧だが、不在という肝心の情報を伝えず相手を待たせるだけで、この場面が求めている応答になっていない。', '5c739d8576e237f3'),
       ('ee5a9788b4', 0, 'お忙しいところ恐れ入りますが、明日の会議資料を拝読していただけますでしょうか。', 'wrong_honorific_direction', '「拝読する」は自分が読むときの謙譲語。読むのは課長なので、相手の行為を低めてしまっている。', '86a98288e14149a1'),
       ('ee5a9788b4', 1, 'お忙しいところ恐れ入りますが、明日の会議資料をお読みいたしましょうか。', 'wrong_speech_act', '謙譲語は正しいが「〜いたしましょうか」は自分が読むという申し出で、見てもらいたいという依頼の逆になっている。', 'bc17c1a594e28695'),
       ('ee5a9788b4', 2, 'お忙しいところ恐れ入りますが、明日の会議資料に目を通していただけますでしょうか。', 'correct', '読むのは課長なので「目を通していただく」と相手の行為を立て、「〜ますでしょうか」で押しつけずに依頼している。', '90fe3e0d7985ae17'),
       ('ee5a9788b4', 3, 'お忙しいところ恐れ入りますが、明日の会議資料をご覧になられていただけますでしょうか。', 'over_polite_misfit', '「ご覧になる」に「られる」を重ねた二重敬語で、さらに「いただく」まで続き、丁寧にしようとして壊れている。', 'ec8933766ab1f1c6'),
       ('37d1093d48', 0, 'お待ちになっておりました。会議室までご案内いたします。', 'wrong_honorific_direction', '待っていたのは自分なのに「お待ちになる」と尊敬語を使っており、自分の行為を高めてしまっている。', '27e02f5b9b4a6d1c'),
       ('37d1093d48', 1, 'お待ちしておりました。会議室までご案内いたします。どうぞこちらへ。', 'correct', '待つのも案内するのも自分の行為なので謙譲語でそろえ、最後に進む方向まで示していて案内として過不足がない。', '5fa8729a0f1a52d4'),
       ('37d1093d48', 2, '本日はご足労いただき、ありがとうございました。またのお越しをお待ちしております。', 'set_phrase_wrong_situation', 'どちらも実在する丁寧な定型だが、過去形と「またのお越し」で見送りの言葉になっており、迎える場面では時点が合わない。', 'e8b70cbdabe96629'),
       ('37d1093d48', 3, 'お待ちしてました。会議室、こちらです。どうぞ。', 'register_too_casual', '敬意の方向は正しいが「お待ちしてました」と縮め、案内も体言止めで、来客に向ける言い方としては軽すぎる。', '4f1b66756ea962ee'),
       ('6c4b89f4b8', 0, 'ご苦労さまでした。失礼いたします。', 'set_phrase_wrong_situation', '「ご苦労さま」は目上が目下をねぎらう言葉で、課長に向けると立場が逆転する。', '08a1f43b3007be79'),
       ('6c4b89f4b8', 1, 'お疲れさまです。また明日ね。', 'register_too_casual', '前半は問題ないが、「また明日ね」は同僚や友人に使う言い方で、上司に向ける終わり方ではない。', '0f041f547213c8ed'),
       ('6c4b89f4b8', 2, 'お先に失礼いたします。', 'content_mismatch', '先に帰る側が言う決まり文句。帰るのは課長で自分は残るので、言う人が逆になっている。', '5c51f9f6146de3af'),
       ('6c4b89f4b8', 3, 'お疲れさまでした。お気をつけて。', 'correct', '「お疲れさま」は目上にも使えるねぎらいで、帰る相手への「お気をつけて」も添え言葉として自然。', 'b3c9c7d64fd249b9'),
       ('5ff8b33d92', 0, 'いつもお世話になっております。ABC商事の鈴木でございます。ただいまお時間よろしいでしょうか。', 'correct', 'あいさつ、社名と氏名の名乗り、都合の確認という、かけた側が最初にすべき三つがそろっている。', 'f04d84b390030a85'),
       ('5ff8b33d92', 1, 'もしもし、山田様でいらっしゃいますか。先日の件でご連絡いたしました。', 'phone_protocol_violation', '丁寧ではあるが、かけた側が名乗っておらず、相手は誰と話しているのか分からないまま用件に入られてしまう。', '7eb18ffa211a3797'),
       ('5ff8b33d92', 2, 'いつもお世話になっております。ABC商事の鈴木と申させていただきます。お時間をいただかせていただいてもよろしいでしょうか。', 'over_polite_misfit', '「申させていただく」「いただかせていただく」と「させていただく」を重ね、名乗りが回りくどく不自然になっている。', '57306d2224845cca'),
       ('5ff8b33d92', 3, 'いつもお世話になっております。ABC商事の鈴木でございます。ご用件を承ります。', 'wrong_speech_act', '名乗りまでは正しいが、「ご用件を承ります」は電話を受けた側の言葉で、かけた本人が言うと話が逆になる。', 'e6dbf296df55d7d6'),
       ('3149b15e3d', 0, 'それはちょっと無理ですね。一週間早めるのは厳しいです。', 'register_too_casual', '断る内容は合っているが、「無理ですね」と正面から言い切っており、取引先に向ける言い方として配慮がない。', 'da3b5e40f30479d4'),
       ('3149b15e3d', 1, '納期の件につきましては、社に持ち帰りまして、あらためてご連絡を差し上げます。', 'content_mismatch', '丁寧だが返事を先送りしているだけで、応じられないと分かっている以上、この場で伝えるべきことを伝えていない。', 'f6039d05cab80e58'),
       ('3149b15e3d', 2, 'ご希望に沿わせていただくことができかねさせていただきます。', 'over_polite_misfit', '「させていただく」が二か所に重なり、「できかねる」とも噛み合わず、文として成り立っていない。', '919f7193f807e764'),
       ('3149b15e3d', 3, 'あいにくではございますが、今回はご希望に沿いかねます。', 'correct', '「あいにく」で言いにくさを示し、「沿いかねます」と断定を避けた形で断っており、断りの型として過不足がない。', '2f2005e0fc440777'),
       ('be79f604a7', 0, '申し訳ございません。私がA社に誤った見積書をご送付になってしまいました。', 'wrong_honorific_direction', '「ご送付になる」は尊敬語。送ったのは自分なので、自分の失敗を自分で高めた言い方になっている。', 'c646525e14f8394f'),
       ('be79f604a7', 1, 'A社のご担当者の方が金額を勘違いされたようですので、こちらから先方にご確認いただこうと思っております。', 'content_mismatch', '敬語は整っているが、原因を相手のせいにしており、自分のミスを報告するという場面の要求に答えていない。', 'c32af0fd8f50231c'),
       ('be79f604a7', 2, '申し訳ございません。私の確認不足で、A社に誤った金額の見積書をお送りしてしまいました。', 'correct', '謝罪、原因、起きた事実の順で、自分の行為を謙譲語で述べており、上司が次の手を打てる報告になっている。', '184ff59e75eb487f'),
       ('be79f604a7', 3, 'A社の見積書の件、金額を確認していただけますでしょうか。', 'wrong_speech_act', '丁寧な依頼にはなっているが、謝罪も報告もなく、自分のミスであることが上司に伝わらない。', '564ebad2274f9413'),
       ('1a52c8f69c', 0, 'どうぞ、冷めないうちにいただいてください。', 'wrong_honorific_direction', '「いただく」は自分が食べるときの謙譲語で、相手の食べる行為に使うと敬意の方向が逆になる。', '4da5892e0596d7db'),
       ('1a52c8f69c', 1, 'どうぞ、冷めないうちにお召し上がりください。', 'correct', '食べるのは部長なので尊敬語「召し上がる」を使い、「冷めないうちに」で勧める理由も添えている。', '17c9cf6c11426e20'),
       ('1a52c8f69c', 2, 'どうぞ、冷めないうちにお召し上がりになられてください。', 'over_polite_misfit', '「お召し上がりになる」に「られる」を重ねた二重敬語で、尊敬語としては正しくない形になっている。', 'a2af458daa540d16'),
       ('1a52c8f69c', 3, 'どうぞ、ごゆっくりお過ごしくださいませ。', 'set_phrase_wrong_situation', '丁寧な定型だが店の側が客に言う言葉で、招いた側が料理を勧める場面には合わない。', '340feaa575165544'),
       ('c087f1fe96', 0, '山田様がお戻りになりましたら、弊社の鈴木部長にお電話をくださいますよう、お伝えいただけますでしょうか。', 'wrong_uchi_soto', '折り返し先である自社の人間に「鈴木部長」と役職を付けており、社外に向かって身内を高めてしまっている。', '803ea13925013f11'),
       ('c087f1fe96', 1, '恐れ入りますが、山田様の携帯電話の番号を教えていただけますでしょうか。', 'phone_protocol_violation', '取り次いだ相手に担当者個人の番号を求めるのは電話の作法から外れており、頼むべきは伝言である。', 'cff37b57283a1044'),
       ('c087f1fe96', 2, '恐れ入りますが、山田様に急ぎの用件だとお伝えいただけますでしょうか。', 'content_mismatch', '伝言を頼む形にはなっているが、折り返しの電話がほしいという肝心の用件が伝わらない。', '82d7739db93c02e5'),
       ('c087f1fe96', 3, '恐れ入りますが、お戻りになりましたら、お電話をいただきたい旨、お伝えいただけますでしょうか。', 'correct', '戻る時点、してほしいこと、伝言の依頼が一文にそろっており、取り次いだ相手がそのまま書き留められる。', '2ab24b671688a67c'),
       ('a425ecc58c', 0, 'お忙しいところすみません。先週お願いした書類、その後いかがでしょうか。', 'correct', '前置きを置き、責めずに「その後いかがでしょうか」と状況を尋ねる形で、催促を角が立たない言い方にしている。', '6026e0daced30e8d'),
       ('a425ecc58c', 1, 'あの書類、まだですか。明日までなので早めにお願いします。', 'register_too_casual', '「まだですか」と遅れを直接責める言い方で、先輩に対する催促としてはとげがある。', '4043675685355ce5'),
       ('a425ecc58c', 2, '先週お願いした書類、私のほうで進めておきましょうか。', 'wrong_speech_act', '丁寧だが自分が引き取るという申し出で、確認してほしいという催促にはなっていない。', 'b4442447cab1e122'),
       ('a425ecc58c', 3, '先週お願いさせていただきました書類は、その後いかがでいらっしゃいますでしょうか。', 'over_polite_misfit', '「いらっしゃる」は人に使う尊敬語で、書類の状況に使うと敬語が対象を取り違えている。', '7425cd354aa28ca0')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
