-- hatsugen_choukai_J1_001: 10 × hatsugen_choukai (J1)
-- generated 2026-09-15T17:20:43+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_meeting_room', '取引先の会議室'),
       ('scene_corridor', 'オフィスの廊下'),
       ('scene_elevator_hall', 'エレベーターホール'),
       ('scene_izakaya_table', '居酒屋のテーブル'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人'),
       ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_phone_mobile_outside', '外出先で携帯電話'),
       ('scene_reception_counter', '自社の受付カウンター'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('98ab48d3e0426f9e', '夜九時を過ぎ、自分の担当分は終わりました。先輩はまだ資料の見直しをしています。エレベーターホールで、先に帰る前にひとこと声をかけます。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('e4be594f587fff72', 'お先に失礼します。何かお手伝いできることがあれば、おっしゃってください。', 'staff_junior_f', 'in_person'),
       ('61c24dc88ae517f2', 'お先っす。お疲れした。', 'staff_junior_f', 'in_person'),
       ('fac27328fb6e374e', 'お先に失礼させていただかせていただきます。何かございましたら、いつでもお申し付けくださいませ。', 'staff_junior_f', 'in_person'),
       ('48a898c71cf41e7f', 'お先に失礼します。その資料、今日中に終わりそうですか。', 'staff_junior_f', 'in_person'),
       ('a89c0a9cc89690e7', '隣の席の同僚から、来週の発表を代わってもらえないかと頼まれました。その日はすでに外せない打ち合わせが入っています。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('73df19a847bed706', 'せっかくのお申し出ではございますが、私では役不足でございますので、どうかご容赦くださいませ。', 'staff_mid_f', 'in_person'),
       ('0720f12472338bac', '力になりたいんだけど、その日は外せない打ち合わせがあって。他の人に聞いてみてもらえるかな。', 'staff_mid_f', 'in_person'),
       ('5bad3c42bf3b547d', 'えー、来週ってほんと忙しいんだよねー。', 'staff_mid_f', 'in_person'),
       ('6dafb1df69f37896', '無理無理、絶対ムリだから。', 'staff_mid_f', 'in_person'),
       ('3daac35476b7438c', '出張中の課長の携帯に電話をかけました。取引先へ送ったメールで、添付ファイルを間違えてしまったことを伝えます。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('b54d9ee9e42c854b', 'あ、課長？さっきのメール、添付間違えちゃって。', 'staff_junior_m', 'phone'),
       ('d8dd1ae0cd6e564d', '課長、大変申し訳ございません。先ほどのメールですが、添付ファイルをお間違えになったようで、至急ご確認いただけますでしょうか。', 'staff_junior_m', 'phone'),
       ('fe11e3d08f1e80ee', '課長、営業部の田中です。今、少しよろしいでしょうか。取引先へのメールで添付ファイルを間違えてしまいました。至急ご相談したいのですが。', 'staff_junior_m', 'phone'),
       ('2c4f38a35d92f32a', 'この度は私の不徳の致すところで、誠に慙愧に堪えない失態を演じてしまいましたこと、幾重にもお詫び申し上げます。', 'staff_junior_m', 'phone'),
       ('c4c5a2c66b4ca297', 'オンライン会議中、取引先から共有された見積書に、数量の桁が一つ多い数字がありました。そのことを伝え、修正版を送ってもらいたいと思います。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('d6c8b237a0ee6f7a', '数量のところ、間違っていますよ。直してください。', 'staff_mid_m', 'video'),
       ('38531ca85fbabc09', '実は、弊社の田中さんもこの見積書の数量がおかしいとおっしゃっていました。念のためご確認いただけますか。', 'staff_mid_m', 'video'),
       ('303845455141515e', '誠に僭越ながら申し上げますが、御見積書の数量表記に些少の齟齬が生じておられるやに拝察いたしますゆえ、ご訂正賜れますと幸甚に存じます。', 'staff_mid_m', 'video'),
       ('cfbaf92240106b43', '念のための確認なのですが、数量が一桁多いように見えます。お手数ですが、修正版をいただけますか。', 'staff_mid_m', 'video'),
       ('5ee45a78ed3dc8d0', '取引先との会食も終わりに近づいてきました。次回の商談について、少しだけ本題の話をしておきたいと思います。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('1166099fe887a18a', '楽しい時間に水を差すようで恐縮なのですが、次回の商談について少しだけお話ししてもよろしいでしょうか。', 'staff_mid_m', 'in_person'),
       ('730c042c813813b3', '今日は本当に楽しい時間でした。またこのお店、来たいですね。', 'staff_mid_m', 'in_person'),
       ('adfd66197a21ad9c', 'せっかくですので、弊社の山田部長からも次回の商談についてお話しさせていただければと存じますが、よろしいでしょうか。', 'staff_mid_m', 'in_person'),
       ('e9bf80df3e37a2e9', '誠に恐縮至極ではございますが、僭越ながら次回の商談の件、少々お時間を頂戴いたしたく、伏してお願い申し上げる次第でございます。', 'staff_mid_m', 'in_person'),
       ('f280dea2b5514290', 'お客様から電話があり、届いた商品が破損していたと、かなり強い口調で苦情を言われました。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('f2080054a13b4e4a', 'はい、もしもし。破損ですか。今どちらの倉庫から届いた分か、ちょっと確認しますので、そのまま切らずに待っててもらえます?', 'staff_mid_f', 'phone'),
       ('14f56d351c6161bc', 'この度はご不便をおかけし、誠に申し訳ございません。すぐに状況を確認し、代わりの品をお送りする手配をいたします。', 'staff_mid_f', 'phone'),
       ('bcc1e420e9f9a463', 'それは大変でしたね。私も以前、似たようなことがあって困った経験があります。', 'staff_mid_f', 'phone'),
       ('38852b120076059d', 'うわ、それはひどいですね。すぐ何とかしますんで、ちょっと待っててくださいね。', 'staff_mid_f', 'phone'),
       ('fbd34e76495cee11', '取引先の担当者が来社されました。実は先週お願いした資料がまだ届いていません。受付で出迎えながら、それとなく確認したいと思います。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('5579cc61583e5187', 'いつもお世話になっております。行ってらっしゃいませ。', 'staff_mid_m', 'in_person'),
       ('cc767cfa97c12642', 'お待ちしておりました。あ、そういえば先週お願いした資料、まだっすよね?', 'staff_mid_m', 'in_person'),
       ('735d3d120c259455', 'お待ちしておりました。恐れ入りますが、先日お願いした資料の件、状況はいかがでしょうか。', 'staff_mid_m', 'in_person'),
       ('c38f37e58b9b6eb4', 'お待ちしておりました。本日はお足元の悪い中、遠いところをわざわざお越しいただき、誠にありがとうございます。', 'staff_mid_m', 'in_person'),
       ('c7f067b7ebe20a3c', '取引先を訪問し、会議室で担当者と向かい合って座りました。会議の開始までまだ少し時間があります。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('ff4e850209efcc1a', '早速なのですが、新製品の価格について今すぐご説明させてください。', 'staff_mid_m', 'in_person'),
       ('a2f29df05fdd6c9f', '急に涼しくなりましたね。今年は秋が短いと聞きますが、御社の方はいかがですか。', 'staff_mid_m', 'in_person'),
       ('6f1aae5ed05566b5', '先ほど弊社の佐藤部長も、こちらの会議室は本当に素晴らしいですねと申しておりました。', 'staff_mid_m', 'in_person'),
       ('71a51c94d01107e5', 'いや〜今日めっちゃ暑くないですか、まいっちゃいますよね。', 'staff_mid_m', 'in_person'),
       ('7080c4e79a25f6b4', '廊下で同僚とすれ違いました。さっき共有された提案書に、取引先の社名を一文字間違えているのに気づきました。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('bd89bb5c6403a543', 'さっきの提案書なんだけど、A社の「A」の字、一文字違ってたかも。念のため確認してみて。', 'staff_mid_f', 'in_person'),
       ('714a4da19863e801', 'さっきの提案書、すごく良くできてたね。読みやすかったよ。', 'staff_mid_f', 'in_person'),
       ('ae7b8b40f3b4251f', '大変僭越ながら申し上げますが、貴殿の提案書に誤植が見受けられますので、ご確認いただければ幸いに存じます。', 'staff_mid_f', 'in_person'),
       ('d69942d010196032', 'その提案書、もう一回作り直したほうがいいと思うよ。', 'staff_mid_f', 'in_person'),
       ('8c449ba84ac8bdcc', '課長から、取引先の値引き交渉について「うまく対応しておいて」とだけ指示されました。どこまで判断していいのか確認したいと思います。こんなとき、何と言いますか。', 'narrator_f', 'in_person'),
       ('8536b2f6816ecde0', '私のほうで、今回の値引き幅についてはお決めになってもよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('92a8f7a695f94477', '確認なのですが、値引き交渉について、どのあたりまで私の判断で進めてよろしいでしょうか。', 'staff_junior_m', 'in_person'),
       ('9d7be8360282cbfb', '課長、値引きってどこまでOKすか?', 'staff_junior_m', 'in_person'),
       ('c4ec8a968c46ef30', '承知しました。値引きの件、うまく進めておきます。', 'staff_junior_m', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'author-composed', '2026-09-15T17:20:43+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('95ef217a86', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'corridor+junior_to_senior+farewell@J1', 'corridor', 'junior_to_senior', 'farewell', 'in_person', 'scene_elevator_hall', '後輩社員', '残業中の先輩', '残業中の先輩に声をかけて先に退社する', '夜九時を過ぎ、自分の担当分は終わりました。先輩はまだ資料の見直しをしています。エレベーターホールで、先に帰る前にひとこと声をかけます。こんなとき、何と言いますか。', 0, '先に帰るときの挨拶は「お先に失礼します」で完結する短いものが基本で、そこに一言添えるとすれば相手への気遣いであって詮索ではない。正解はその形。「お先っす」は友人どうしの略式表現で、先輩への敬意を欠く。「させていただかせていただきます」は謙譲表現を不自然に重ねた誤りで、短い挨拶には長すぎる。進捗を尋ねる選択肢は、丁寧ではあるが退出の挨拶という場面の役割から外れ、相手の仕事に踏み込みすぎている。', 'A farewell to someone still working stays short: announce you''re leaving, and if anything follows it''s an offer, not a question about their progress. Doubling a humble form or slipping into slang both miss the mark.', '[{"term": "お先に失礼します", "reading": "おさきにしつれいします", "meaning": "excuse me for leaving first — the standard phrase for leaving before others"}, {"term": "お申し付けください", "reading": "おもうしつけください", "meaning": "please let me know (if you need anything) — a polite offer of help"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '98ab48d3e0426f9e', null),
       ('f82e71e147', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'office_desk+peer_to_peer+decline@J1', 'office_desk', 'peer_to_peer', 'decline', 'in_person', 'scene_office_desk_pair', '同僚', '同僚', '手伝えない依頼を同僚に断る', '隣の席の同僚から、来週の発表を代わってもらえないかと頼まれました。その日はすでに外せない打ち合わせが入っています。こんなとき、何と言いますか。', 1, '同僚どうしの断りは、堅苦しい敬語を並べる必要はなく、手伝いたい気持ち・理由・代案の三つが伝われば十分。正解はその形。過剰に丁寧な言い方は同僚には他人行儀すぎ、逆に崩れすぎた言い方は素っ気なく響く。忙しさを述べるだけの返事は、依頼への答えになっていない点が一番の問題で、頼んだ側を宙に浮かせてしまう。', 'Declining a peer needs no formal keigo — just willingness, a reason, and an alternative. Over-formality reads as distant, bare complaint leaves the request unanswered, and curtness ignores the other person.', '[{"term": "役不足", "reading": "やくぶそく", "meaning": "underqualified for the role (often misused, but here used deliberately as an over-formal excuse)"}, {"term": "外せない打ち合わせ", "reading": "はずせないうちあわせ", "meaning": "a meeting that cannot be skipped — a concrete, sufficient reason"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'a89c0a9cc89690e7', null),
       ('6211b4d620', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'phone_internal+subordinate_to_superior+apologize_report@J1', 'phone_internal', 'subordinate_to_superior', 'apologize_report', 'phone', 'scene_phone_desk', '部下（営業部員）', '出張中の課長', '出張中の上司へ電話でメールの誤送信を報告する', '出張中の課長の携帯に電話をかけました。取引先へ送ったメールで、添付ファイルを間違えてしまったことを伝えます。こんなとき、何と言いますか。', 2, '電話報告は、名乗り・都合の確認・報告・相談、という順が崩れない。正解はその順で、しかも自分の間違いとして責任を引き受けている。名乗らずに始める選択肢は電話の基本を欠く。「お間違えになった」は尊敬語を自分の失敗に向けてしまい、責任の所在をぼかしている点が二重に問題。文書調の詫び言葉は電話の即応性に合わず、報告の中身が後回しになっている。', 'A phone report to a boss follows a fixed order: identify yourself, check the time is convenient, report, then ask for guidance — owning the mistake as your own. Using respectful language for your own error, or skipping the opening, both break the shape.', '[{"term": "至急ご相談したいのですが", "reading": "しきゅうごそうだんしたいのですが", "meaning": "I''d like to discuss this urgently — flags both urgency and that guidance is wanted"}, {"term": "お間違えになる", "reading": "おまちがえになる", "meaning": "to make a mistake (honorific, of the other party) — wrong when the speaker made the mistake"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '3daac35476b7438c', null),
       ('23cc36ccc2', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'video_call+staff_to_client+request@J1', 'video_call', 'staff_to_client', 'request', 'video', 'scene_video_call_laptop', '営業担当', '取引先の担当者', 'オンライン商談で見積書の誤りを指摘し修正を依頼する', 'オンライン会議中、取引先から共有された見積書に、数量の桁が一つ多い数字がありました。そのことを伝え、修正版を送ってもらいたいと思います。こんなとき、何と言いますか。', 3, '取引先の書類の誤りを指摘するときは、断定せず確認の形をとり、そのうえで修正を依頼するのが基本の運び方。正解はその形。直接的な命令は取引先には強すぎる。身内を敬語で立てる言い方はウチ・ソトが逆で、電話やビデオ会議でも変わらない誤り。物事に尊敬語を使う極端に回りくどい言い方は、丁寧さのつもりが趣旨を分かりにくくしている。', 'Pointing out a client''s error works best as a soft confirmation, not an assertion, leading into the request. A direct order is too blunt; honoring one''s own colleague to an outsider inverts in-group/out-group; and honorifics applied to things rather than people bury the point in excess formality.', '[{"term": "念のための確認なのですが", "reading": "ねんのためのかくにんなのですが", "meaning": "just to confirm — softens a correction into a check"}, {"term": "ように見える", "reading": "ようにみえる", "meaning": "it appears that — hedges an observation instead of asserting it as fact"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'c4c5a2c66b4ca297', null),
       ('83b4f2db61', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'dining+staff_to_client+ask_permission@J1', 'dining', 'staff_to_client', 'ask_permission', 'in_person', 'scene_izakaya_table', '営業担当', '取引先の担当者', '会食の終わりに次回商談の話を切り出す許可を求める', '取引先との会食も終わりに近づいてきました。次回の商談について、少しだけ本題の話をしておきたいと思います。こんなとき、何と言いますか。', 0, '会食の場で本題に移るときは、場の空気を変えることへの断りを添えてから許可を求めるのが要る。正解はその二段構え。感想だけで終わる言い方は、頼まれた機能である「切り出す許可を求める」を果たしていない。身内に役職を付けて話に出すのはウチ・ソトの典型的な誤り。文書のような大げさな言い回しは、和やかな席の空気とかみ合わない。', 'Shifting from a social meal to business needs an acknowledgment that the mood is changing, then a request for permission. Praise alone doesn''t do it, a title on one''s own colleague inverts in-group/out-group, and archaic formal language clashes with the relaxed setting.', '[{"term": "水を差すようで恐縮ですが", "reading": "みずをさすようできょうしゅくですが", "meaning": "sorry to break the mood, but — the standard cushion before shifting tone"}, {"term": "少々お時間を頂戴したく", "reading": "しょうしょうおじかんをちょうだいしたく", "meaning": "I would like a moment of your time (humble) — a request to speak"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '5ee45a78ed3dc8d0', null),
       ('c65c0ca0ee', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'phone_external+staff_to_customer+handle_complaint@J1', 'phone_external', 'staff_to_customer', 'handle_complaint', 'phone', 'scene_phone_mobile_outside', 'サポート担当', '一般のお客様', '電話で届いた商品の破損について苦情に対応する', 'お客様から電話があり、届いた商品が破損していたと、かなり強い口調で苦情を言われました。こんなとき、何と言いますか。', 1, '苦情の電話は、まず迷惑をかけたことへの詫び、次にすぐ動くという具体的な対応、の二つが要る。正解はその二つが順に並んでいる。事務的な確認から入る言い方は詫びが抜けており、電話対応の基本を欠く。共感だけで終わる返事は感じがよくても対応になっていない。崩れた話し方は、内容が正しくても怒っているお客様には通らない。', 'A complaint call needs an apology for the inconvenience first, then a concrete next step. Skipping straight to fact-checking, offering only sympathy, or using casual speech all fail to actually handle the complaint.', '[{"term": "ご不便をおかけし", "reading": "ごふべんをおかけし", "meaning": "for the inconvenience caused — apologizes for the trouble without yet assigning fault"}, {"term": "手配をいたします", "reading": "てはいをいたします", "meaning": "I will arrange it (humble) — commits to a concrete next action"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'f280dea2b5514290', null),
       ('d53d14e60e', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'reception+staff_to_client+follow_up@J1', 'reception', 'staff_to_client', 'follow_up', 'in_person', 'scene_reception_counter', '受付担当', '取引先の担当者', '来社した取引先を出迎えながら未提出の資料をそれとなく催促する', '取引先の担当者が来社されました。実は先週お願いした資料がまだ届いていません。受付で出迎えながら、それとなく確認したいと思います。こんなとき、何と言いますか。', 2, '出迎えながらの催促は、まず来訪への礼を述べ、そのあとに「状況はいかがでしょうか」のような柔らかい聞き方で用件へ移るのが要る。正解はその形。実在する送り出しの定型句を出迎えに使うのは場面違い。丁寧に始めても途中で崩れる話し方は一貫性を欠く。挨拶だけで終わる言い方は、催促するという目的そのものを果たしていない。', 'Reminding someone while greeting them needs thanks for coming, then a soft check-in that doubles as the reminder. A send-off phrase used on arrival is the wrong moment for it; slipping into casual speech mid-sentence breaks consistency; and a greeting with no follow-up never raises the point at all.', '[{"term": "状況はいかがでしょうか", "reading": "じょうきょうはいかがでしょうか", "meaning": "how are things going — a soft way to check on something overdue without demanding it"}, {"term": "行ってらっしゃいませ", "reading": "いってらっしゃいませ", "meaning": "have a safe trip — said to someone departing, not arriving"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'fbd34e76495cee11', null),
       ('4aa2abf69f', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'client_office+staff_to_client+small_talk@J1', 'client_office', 'staff_to_client', 'small_talk', 'in_person', 'scene_client_meeting_room', '営業担当', '取引先の担当者', '会議開始前に取引先の担当者と世間話をする', '取引先を訪問し、会議室で担当者と向かい合って座りました。会議の開始までまだ少し時間があります。こんなとき、何と言いますか。', 1, '会議前の間をつなぐ話題は、天候のように当たり障りがなく、相手にも話を振り返せるものが向いている。正解はその条件を満たしている。いきなり本題に入るのは世間話という機能から外れる。身内に役職を付けるのはウチ・ソトの典型的な誤り。くだけすぎた話し方は取引先の会議室の場にそぐわない。', 'Small talk before a meeting wants a safe, shared topic like weather that invites a response. Jumping straight to business skips the function entirely; a title on one''s own colleague inverts in-group/out-group; and slangy speech doesn''t fit a client''s meeting room.', '[{"term": "御社の方はいかがですか", "reading": "おんしゃのほうはいかがですか", "meaning": "how about at your company — turns small talk back to the other party"}, {"term": "弊社", "reading": "へいしゃ", "meaning": "our company (humble) — takes no titles on its own people when speaking to outsiders"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'c7f067b7ebe20a3c', null),
       ('bc9ff36bff', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'corridor+peer_to_peer+correct_mistake@J1', 'corridor', 'peer_to_peer', 'correct_mistake', 'in_person', 'scene_corridor', '同僚', '同僚', '同僚の提案書にある社名の誤字をやんわり指摘する', '廊下で同僚とすれ違いました。さっき共有された提案書に、取引先の社名を一文字間違えているのに気づきました。こんなとき、何と言いますか。', 0, '同僚の小さな間違いを指摘するときは、断定を避けて柔らかく伝えるのが要る。正解はその形で、伝える内容も的確。褒めるだけで終わる言い方は誤りに触れておらず、指摘の役割を果たしていない。格式ばった言い方は廊下での短いやりとりには他人行儀すぎる。一文字の誤字に対して作り直しを勧めるのは、指摘の大きさが場面に合っていない。', 'Pointing out a peer''s small error works best softened, not asserted. Praise alone skips the correction entirely, formal language is too distant for a hallway exchange, and suggesting a full redo overreacts to a one-character typo.', '[{"term": "念のため確認してみて", "reading": "ねんのためかくにんしてみて", "meaning": "just check it, to be safe — a soft way to flag a possible error to a peer"}, {"term": "貴殿", "reading": "きでん", "meaning": "you (very formal, written register) — far too stiff for a spoken hallway exchange"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '7080c4e79a25f6b4', null),
       ('bee26298b6', 'hatsugen_choukai_J1_001', 'hatsugen_choukai', 'J1', 'office_desk+subordinate_to_superior+confirm@J1', 'office_desk', 'subordinate_to_superior', 'confirm', 'in_person', 'scene_office_desk_pair', '部下', '課長', 'あいまいな指示について上司に判断の範囲を確認する', '課長から、取引先の値引き交渉について「うまく対応しておいて」とだけ指示されました。どこまで判断していいのか確認したいと思います。こんなとき、何と言いますか。', 1, 'あいまいな指示への確認は、確認であることを先に示し、判断していい範囲を具体的に尋ねる形が要る。正解はその形。自分の行為に尊敬語を使うのは方向を誤った典型例で、正しくは謙譲語の「お決めしても」。略式の言い方は上司への確認としては崩れすぎている。あいまいなまま引き受ける返事は、確認するべき場面で確認を怠っている。', 'Confirming a vague instruction needs to flag itself as a check and ask for the concrete boundary of discretion. Honorific language pointed at one''s own action gets the direction backwards, casual speech is too loose for a superior, and simply agreeing skips the confirmation the ambiguity calls for.', '[{"term": "どのあたりまで私の判断で", "reading": "どのあたりまでわたしのはんだんで", "meaning": "up to what point at my own discretion — asks for the boundary, not just permission"}, {"term": "お決めしても", "reading": "おきめしても", "meaning": "if I may decide (humble, correct for one''s own action)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '8c449ba84ac8bdcc', null)
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
delete from public.item_options where item_id in ('95ef217a86', 'f82e71e147', '6211b4d620', '23cc36ccc2', '83b4f2db61', 'c65c0ca0ee', 'd53d14e60e', '4aa2abf69f', 'bc9ff36bff', 'bee26298b6');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('95ef217a86', 0, 'お先に失礼します。何かお手伝いできることがあれば、おっしゃってください。', 'correct', '退出のひと言を述べたうえで、先輩がまだ作業中であることに配慮し、さりげなく手伝いを申し出ている。短い挨拶として過不足がない。', 'e4be594f587fff72'),
       ('95ef217a86', 1, 'お先っす。お疲れした。', 'register_too_casual', '「お先っす」「お疲れした」は友人どうしで使う略式の言い方で、まだ作業中の先輩に向ける敬意がない。', '61c24dc88ae517f2'),
       ('95ef217a86', 2, 'お先に失礼させていただかせていただきます。何かございましたら、いつでもお申し付けくださいませ。', 'over_polite_misfit', '謙譲の「〜させていただく」を不自然に重ねたうえに言葉数も多く、ひとことで済ませるべき退出の挨拶として長く回りくどい。', 'fac27328fb6e374e'),
       ('95ef217a86', 3, 'お先に失礼します。その資料、今日中に終わりそうですか。', 'content_mismatch', '退出を告げてはいるが、続けて進捗を尋ねており、先に帰る側が踏み込みすぎている。ひとことの挨拶の場面に合わない。', '48a898c71cf41e7f'),
       ('f82e71e147', 0, 'せっかくのお申し出ではございますが、私では役不足でございますので、どうかご容赦くださいませ。', 'over_polite_misfit', '取引先に向けるような格式ばった言い方で、隣の席の同僚への返事としては大げさすぎ、かえって距離を感じさせる。', '73df19a847bed706'),
       ('f82e71e147', 1, '力になりたいんだけど、その日は外せない打ち合わせがあって。他の人に聞いてみてもらえるかな。', 'correct', '手伝いたい気持ちを示したうえで断る理由を述べ、代わりの手も提案している。同僚どうしの断り方として過不足がない。', '0720f12472338bac'),
       ('f82e71e147', 2, 'えー、来週ってほんと忙しいんだよねー。', 'content_mismatch', '忙しさを訴えるだけで、代わるかどうかの返事になっておらず、頼んだ側は結局どうすればいいか分からない。', '5bad3c42bf3b547d'),
       ('f82e71e147', 3, '無理無理、絶対ムリだから。', 'register_too_casual', '同僚どうしでも「無理無理」を繰り返すのは素っ気なく、頼んできた相手への配慮がない。', '6dafb1df69f37896'),
       ('6211b4d620', 0, 'あ、課長？さっきのメール、添付間違えちゃって。', 'phone_protocol_violation', '電話ではまず名乗るのが基本だが、名乗らずいきなり用件に入っており、電話の基本の型を欠いている。', 'b54d9ee9e42c854b'),
       ('6211b4d620', 1, '課長、大変申し訳ございません。先ほどのメールですが、添付ファイルをお間違えになったようで、至急ご確認いただけますでしょうか。', 'wrong_honorific_direction', '間違えたのは自分なのに「お間違えになった」と尊敬語を使い、まるで課長が間違えたかのように聞こえる。自分の非を認めていない。', 'd8dd1ae0cd6e564d'),
       ('6211b4d620', 2, '課長、営業部の田中です。今、少しよろしいでしょうか。取引先へのメールで添付ファイルを間違えてしまいました。至急ご相談したいのですが。', 'correct', '名乗り、都合を確認したうえで自分の間違いとして報告し、指示を仰いでいる。電話報告の型として過不足がない。', 'fe11e3d08f1e80ee'),
       ('6211b4d620', 3, 'この度は私の不徳の致すところで、誠に慙愧に堪えない失態を演じてしまいましたこと、幾重にもお詫び申し上げます。', 'over_polite_misfit', '始末書や取引先への文書で使うような重い言い回しで、上司への電話報告としては仰々しく、肝心の対応が伝わりにくい。', '2c4f38a35d92f32a'),
       ('23cc36ccc2', 0, '数量のところ、間違っていますよ。直してください。', 'register_too_casual', '間違いを直接指摘し「直してください」と命令する形で、取引先に向けるクッション言葉や配慮が欠けている。', 'd6c8b237a0ee6f7a'),
       ('23cc36ccc2', 1, '実は、弊社の田中さんもこの見積書の数量がおかしいとおっしゃっていました。念のためご確認いただけますか。', 'wrong_uchi_soto', '身内の田中に「さん」「おっしゃっていました」と敬語を使っており、社外の取引先に対してウチ・ソトの扱いが逆になっている。', '38531ca85fbabc09'),
       ('23cc36ccc2', 2, '誠に僭越ながら申し上げますが、御見積書の数量表記に些少の齟齬が生じておられるやに拝察いたしますゆえ、ご訂正賜れますと幸甚に存じます。', 'over_polite_misfit', '「生じておられる」など、物事に尊敬語を使う不自然な言い回しが重なり、指摘の趣旨がかえって伝わりにくいほど回りくどい。', '303845455141515e'),
       ('23cc36ccc2', 3, '念のための確認なのですが、数量が一桁多いように見えます。お手数ですが、修正版をいただけますか。', 'correct', '断定を避けて「念のための確認」「ように見える」と柔らかく指摘し、修正版の依頼へ丁寧につなげている。取引先への指摘として角が立たない。', 'cfbaf92240106b43'),
       ('83b4f2db61', 0, '楽しい時間に水を差すようで恐縮なのですが、次回の商談について少しだけお話ししてもよろしいでしょうか。', 'correct', '場の雰囲気を変えることへの断りを先に置いてから許可を求めており、会食の流れを乱さずに本題へ移れる。', '1166099fe887a18a'),
       ('83b4f2db61', 1, '今日は本当に楽しい時間でした。またこのお店、来たいですね。', 'content_mismatch', '会食の感想を述べているだけで、本題を切り出す許可を求めておらず、頼まれた機能を果たしていない。', '730c042c813813b3'),
       ('83b4f2db61', 2, 'せっかくですので、弊社の山田部長からも次回の商談についてお話しさせていただければと存じますが、よろしいでしょうか。', 'wrong_uchi_soto', '身内の山田に「部長」という敬称を付けており、社外の取引先に対してウチ・ソトの扱いが逆になっている。', 'adfd66197a21ad9c'),
       ('83b4f2db61', 3, '誠に恐縮至極ではございますが、僭越ながら次回の商談の件、少々お時間を頂戴いたしたく、伏してお願い申し上げる次第でございます。', 'over_polite_misfit', '「伏してお願い申し上げる」など、儀礼的な文書でも滅多に使わない大げさな言い回しで、和やかな会食の場にそぐわない。', 'e9bf80df3e37a2e9'),
       ('c65c0ca0ee', 0, 'はい、もしもし。破損ですか。今どちらの倉庫から届いた分か、ちょっと確認しますので、そのまま切らずに待っててもらえます?', 'phone_protocol_violation', '名乗りやお詫びより先に事務的な確認に入っており、苦情対応の電話としての基本の型を欠いている。', 'f2080054a13b4e4a'),
       ('c65c0ca0ee', 1, 'この度はご不便をおかけし、誠に申し訳ございません。すぐに状況を確認し、代わりの品をお送りする手配をいたします。', 'correct', '起きたことへの迷惑を先に詫び、すぐに調べて代替品を手配するという具体的な対応を示している。苦情対応の型として過不足がない。', '14f56d351c6161bc'),
       ('c65c0ca0ee', 2, 'それは大変でしたね。私も以前、似たようなことがあって困った経験があります。', 'wrong_speech_act', '共感は示しているが、詫びの言葉も今後の対応も述べておらず、苦情に応じるという役割を果たしていない。', 'bcc1e420e9f9a463'),
       ('c65c0ca0ee', 3, 'うわ、それはひどいですね。すぐ何とかしますんで、ちょっと待っててくださいね。', 'register_too_casual', '「うわ」「〜ですんで」など話し言葉が崩れており、怒っているお客様への対応として丁寧さが足りない。', '38852b120076059d'),
       ('d53d14e60e', 0, 'いつもお世話になっております。行ってらっしゃいませ。', 'set_phrase_wrong_situation', '「行ってらっしゃいませ」は出かける人を送り出す言葉で、到着した来客を迎える場面には合わない。', '5579cc61583e5187'),
       ('d53d14e60e', 1, 'お待ちしておりました。あ、そういえば先週お願いした資料、まだっすよね?', 'register_too_casual', '冒頭は丁寧だが「まだっすよね」と急に崩れており、取引先の担当者への言葉として一貫していない。', 'cc767cfa97c12642'),
       ('d53d14e60e', 2, 'お待ちしておりました。恐れ入りますが、先日お願いした資料の件、状況はいかがでしょうか。', 'correct', '出迎えの言葉のあとに「状況はいかがでしょうか」と柔らかく尋ねており、催促と分かりつつも角が立たない聞き方になっている。', '735d3d120c259455'),
       ('d53d14e60e', 3, 'お待ちしておりました。本日はお足元の悪い中、遠いところをわざわざお越しいただき、誠にありがとうございます。', 'content_mismatch', '出迎えの挨拶だけで終わっており、確認したかった資料の件にまったく触れていない。', 'c38f37e58b9b6eb4'),
       ('4aa2abf69f', 0, '早速なのですが、新製品の価格について今すぐご説明させてください。', 'wrong_speech_act', '世間話をする時間なのに、いきなり本題の値段交渉に入ろうとしており、求められている機能と合っていない。', 'ff4e850209efcc1a'),
       ('4aa2abf69f', 1, '急に涼しくなりましたね。今年は秋が短いと聞きますが、御社の方はいかがですか。', 'correct', '天候という当たり障りのない話題から相手にも話を振っており、会議前の世間話として自然に間をつなげている。', 'a2f29df05fdd6c9f'),
       ('4aa2abf69f', 2, '先ほど弊社の佐藤部長も、こちらの会議室は本当に素晴らしいですねと申しておりました。', 'wrong_uchi_soto', '身内の佐藤に「部長」という敬称を付けており、社外の相手に対してウチ・ソトの扱いが崩れている。', '6f1aae5ed05566b5'),
       ('4aa2abf69f', 3, 'いや〜今日めっちゃ暑くないですか、まいっちゃいますよね。', 'register_too_casual', '「めっちゃ」「まいっちゃいますよね」といった友人どうしの話し方で、取引先の会議室にはふさわしくない。', '71a51c94d01107e5'),
       ('bc9ff36bff', 0, 'さっきの提案書なんだけど、A社の「A」の字、一文字違ってたかも。念のため確認してみて。', 'correct', '断定を避けて「かも」「念のため」と柔らかく伝えており、同僚の間違いを角を立てずに知らせる言い方になっている。', 'bd89bb5c6403a543'),
       ('bc9ff36bff', 1, 'さっきの提案書、すごく良くできてたね。読みやすかったよ。', 'content_mismatch', '提案書を褒めるだけで、気づいた社名の誤りにまったく触れておらず、正すという役割を果たしていない。', '714a4da19863e801'),
       ('bc9ff36bff', 2, '大変僭越ながら申し上げますが、貴殿の提案書に誤植が見受けられますので、ご確認いただければ幸いに存じます。', 'over_polite_misfit', '「貴殿」「僭越ながら」といった格式ばった言い方で、廊下で交わす同僚への指摘としては他人行儀すぎる。', 'ae7b8b40f3b4251f'),
       ('bc9ff36bff', 3, 'その提案書、もう一回作り直したほうがいいと思うよ。', 'wrong_speech_act', '一文字の誤りを伝えるべき場面で「作り直したほうがいい」と大げさな提案に変えており、指摘という行為になっていない。', 'd69942d010196032'),
       ('bee26298b6', 0, '私のほうで、今回の値引き幅についてはお決めになってもよろしいでしょうか。', 'wrong_honorific_direction', '「お決めになる」は相手を敬う尊敬語で、自分の行為に使うのは方向が逆。正しくは「お決めしても」となる。', '8536b2f6816ecde0'),
       ('bee26298b6', 1, '確認なのですが、値引き交渉について、どのあたりまで私の判断で進めてよろしいでしょうか。', 'correct', '確認だと断ったうえで、判断していい範囲を具体的に尋ねており、あいまいな指示への確認として的確。', '92a8f7a695f94477'),
       ('bee26298b6', 2, '課長、値引きってどこまでOKすか?', 'register_too_casual', '「OKすか」という略式の言い方で、課長への確認としては崩れすぎている。', '9d7be8360282cbfb'),
       ('bee26298b6', 3, '承知しました。値引きの件、うまく進めておきます。', 'wrong_speech_act', '指示があいまいなまま「承知しました」と引き受けており、確認するべき場面で確認していない。', 'c4ec8a968c46ef30')
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
