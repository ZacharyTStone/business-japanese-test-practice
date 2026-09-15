-- hyougen_J2_001: 6 × hyougen (J2)
-- generated 2026-09-15T17:48:41+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hyougen_J2_001', 'hyougen', 'J2', 'author-composed', '2026-09-15T17:48:41+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id)
values ('f2c98e574b', 'hyougen_J2_001', 'hyougen', 'J2', 'email_external+subordinate_to_superior+follow_up@J2', 'email_external', 'subordinate_to_superior', 'follow_up', 'written', null, null, null, '返信のない取引先に催促する', '先週送った見積書について、取引先からまだ返事がありません。急かしている印象を与えずに、返事を促すメールを書きます。最も適切な表現はどれですか。', 2, '催促は、相手の落ち度を指摘せずに現状を尋ねる形にする。「その後いかがでしょうか」は相手に返事の余地を残す。「まだご返信をいただいておりません」は事実だが苦情に読まれ、「早くご返信ください」は指示、「忘れておられませんか」は相手を責める形で、いずれも取引先には使えない。', 'A follow-up asks after the other side''s situation rather than naming what they failed to do.', '[{"term": "その後", "reading": "そのご", "meaning": "since then"}, {"term": "催促", "reading": "さいそく", "meaning": "a reminder / chasing"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null),
       ('fa5e00499a', 'hyougen_J2_001', 'hyougen', 'J2', 'phone_call+other_department+decline@J2', 'phone_call', 'other_department', 'decline', 'phone', null, null, null, '他部署からの応援依頼を断る', '他部署の担当者から、明日の作業の応援を電話で頼まれました。自分の部署も締切が重なっていて引き受けられません。最も適切な表現はどれですか。', 0, '断るときは、まず「あいにく」で切り出し、理由を具体的に述べ、詫びる。「無理です」は言い切りで丁寧さを欠く。「ご遠慮させていただく」は誘いを辞退する表現で、依頼を断る場面とはずれる。「そちらで何とかして」は相手に押しつける形になる。', 'A refusal states a concrete reason and apologises; it does not hand the problem back.', '[{"term": "あいにく", "reading": "あいにく", "meaning": "unfortunately"}, {"term": "力になる", "reading": "ちからになる", "meaning": "to be of help"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null),
       ('df47204e8f', 'hyougen_J2_001', 'hyougen', 'J2', 'client_office+staff_to_visitor+confirm@J2', 'client_office', 'staff_to_visitor', 'confirm', 'in_person', null, null, null, '来客に人数を確認する', '来客を会議室へ案内する前に、同行者がいるかどうかを確かめたい場面です。最も適切な表現はどれですか。', 3, '来客の状態を尋ねるので尊敬語「いらっしゃる」。「まいる」は自分側の移動に使う謙譲語で方向が逆。「二人ですか」は丁寧さを欠く。「お連れになりましたか」は尊敬語だが、人数の確認ではなく同行の有無を問う別の行為になっている。', 'いらっしゃる is the honorific for the visitor''s own being there; まいる would point the humility at them.', '[{"term": "いらっしゃる", "reading": "いらっしゃる", "meaning": "to be / to come (honorific)"}, {"term": "同行者", "reading": "どうこうしゃ", "meaning": "accompanying person"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null),
       ('00a6086083', 'hyougen_J2_001', 'hyougen', 'J2', 'chat_internal+peer_to_peer+offer_help@J2', 'chat_internal', 'peer_to_peer', 'offer_help', 'written', null, null, null, '社内チャットで同僚に手を貸す', '社内チャットで、同僚が資料の作成に手間取っていると書き込みました。手伝いを申し出ます。最も適切な表現はどれですか。', 1, '申し出は、自分の状況を示したうえで相手に判断を委ねる形にする。社内チャットで同僚相手なら「言ってください」程度が適切で、「幸いに存じます」は過剰。「全部やっておきます」は申し出ではなく通告、「そんなに時間がかかるものですか」は相手を責める形になる。', 'An offer leaves the decision with the other person; it does not announce a takeover.', '[{"term": "手が空く", "reading": "てがあく", "meaning": "to be free / have time"}, {"term": "分担", "reading": "ぶんたん", "meaning": "sharing the work"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null),
       ('590df1a9f0', 'hyougen_J2_001', 'hyougen', 'J2', 'video_call+other_department+propose@J2', 'video_call', 'other_department', 'propose', 'video', null, null, null, 'オンライン会議で代案を出す', 'オンライン会議で、他部署の担当者が示した進め方では期限に間に合わないと分かりました。別のやり方を提案します。最も適切な表現はどれですか。', 3, '提案は、相手の案を正面から否定せずに切り出し、自分の案を問いの形で置く。「間に合いません。〜してください」は命令、「よろしいでしょうか」は確認で段階が違う。「無理があるのではないでしょうか」は指摘だけで代案がなく、提案として成立していない。', 'A proposal offers an alternative as a question, rather than only naming what is wrong with theirs.', '[{"term": "検証", "reading": "けんしょう", "meaning": "verification / testing"}, {"term": "代案", "reading": "だいあん", "meaning": "alternative proposal"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null),
       ('fb167cd9a3', 'hyougen_J2_001', 'hyougen', 'J2', 'notice_document+other_department+ask_permission@J2', 'notice_document', 'other_department', 'ask_permission', 'written', null, null, null, '掲示で持ち出しの許可を求める', '共用の備品を自部署の催しで一日だけ借りたいので、管理している他部署あてに社内掲示の書式で願い出ます。最も適切な表現はどれですか。', 0, '許可を願い出る文書では「お認めいただけますでしょうか」の形を使う。「お認めになりますでしょうか」は相手の意向を問うだけ、「させていただきます」は言い切りで通告、「いいですか」は文書に話し言葉が混ざっている。掲示の書式では、話し言葉かどうかも判断の材料になる。', 'A written request for permission uses お認めいただけますでしょうか, not a statement of intent.', '[{"term": "つきましては", "reading": "つきましては", "meaning": "accordingly (formal connective)"}, {"term": "持ち出し", "reading": "もちだし", "meaning": "taking something off the premises"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null)
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
       narration_clip_id = excluded.narration_clip_id;

-- Options are replaced wholesale rather than upserted: a corrected item can
-- have fewer options or a different order, and a stale row left behind would
-- be a fifth answer nobody meant to publish.
delete from public.item_options where item_id in ('f2c98e574b', 'fa5e00499a', 'df47204e8f', '00a6086083', '590df1a9f0', 'fb167cd9a3');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('f2c98e574b', 0, '先日お送りいたしました見積書の件、まだご返信をいただいておりません。', 'correct_keigo_wrong_speech_act', '敬語は正しいが、していないことを指摘する発話になっており、催促ではなく苦情として読まれる。', null),
       ('f2c98e574b', 1, '先日お送りいたしました見積書の件、早くご返信ください。', 'register_too_casual', '「早く〜ください」は指示の形で、社外の相手に対しては直接的すぎる。', null),
       ('f2c98e574b', 2, '先日お送りいたしました見積書の件、その後いかがでございましょうか。', 'correct', '「その後いかがでしょうか」は相手の状況を尋ねる形で、返事がないこと自体を責めずに返信を促せる、催促の定型表現。', null),
       ('f2c98e574b', 3, '先日お送りいたしました見積書の件、ご返信を忘れておられませんか。', 'register_insulting', '尊敬語ではあるが、相手が忘れていると決めつけており、失礼になる。', null),
       ('fa5e00499a', 0, 'あいにく明日は当部も締切が重なっておりまして、お力になれず申し訳ございません。', 'correct', '「あいにく」で切り出し、断る理由を具体的に示したうえで詫びており、断り方の型が揃っている。', null),
       ('fa5e00499a', 1, '明日は無理です。当部も締切が重なっていますので。', 'register_too_casual', '内容は同じだが「無理です」と言い切っており、他部署への電話としては丁寧さが足りない。', null),
       ('fa5e00499a', 2, 'あいにく明日は当部も締切が重なっておりまして、ご遠慮させていただきます。', 'correct_keigo_wrong_speech_act', '「ご遠慮させていただく」は誘いや申し出を辞退する言い方で、応援を頼まれて断る場面には合わない。', null),
       ('fa5e00499a', 3, 'あいにく明日は当部も締切が重なっておりまして、そちらで何とかしていただけますか。', 'register_insulting', '断ったうえで相手に丸投げしており、こちらの都合だけを押しつける形になっている。', null),
       ('df47204e8f', 0, '本日はお二人でまいられますでしょうか。', 'wrong_honorific_direction', '「まいる」は自分側の移動に使う謙譲語で、来客の行為に使うと敬意の方向が逆になる。', null),
       ('df47204e8f', 1, '本日は二人ですか。', 'register_too_casual', '意味は通るが、来客に向ける表現としては丁寧さがまったく足りない。', null),
       ('df47204e8f', 2, '本日はお二人様をお連れになりましたでしょうか。', 'correct_keigo_wrong_speech_act', '尊敬語としては成立するが、同行者を「連れてきた」かを問う形になり、人数の確認という行為からずれる。', null),
       ('df47204e8f', 3, '本日はお二人でいらっしゃいますでしょうか。', 'correct', '来客の状態を尋ねるので尊敬語「いらっしゃる」を使い、確認の形になっている。', null),
       ('00a6086083', 0, 'こちら手が空いておりますので、お手伝いさせていただければ幸いに存じます。', 'correct_keigo_wrong_speech_act', '敬語としては正しいが、社内チャットで同僚に向ける文としては過剰で、かえって距離を作る。', null),
       ('00a6086083', 1, 'こちら手が空いているので、分担できるところがあれば言ってください。', 'correct', '自分の状況を先に伝え、相手が断りやすい形で申し出ており、社内チャットの距離感にも合っている。', null),
       ('00a6086083', 2, 'こちら手が空いているので、代わりに全部やっておきます。', 'wrong_honorific_direction', '申し出ではなく決定の通告になっており、相手の担当を勝手に引き取ってしまう。', null),
       ('00a6086083', 3, 'こちら手が空いているので、そんなに時間がかかるものですか。', 'register_insulting', '申し出の形になっておらず、相手の進み具合を暗に責める言い方になっている。', null),
       ('590df1a9f0', 0, 'その進め方では間に合いません。先に検証だけ進めてください。', 'register_too_casual', '否定と指示を並べており、提案ではなく他部署への命令になっている。', null),
       ('590df1a9f0', 1, '一つ伺いたいのですが、先に検証だけ進めるという進め方でよろしいでしょうか。', 'correct_keigo_wrong_speech_act', '「よろしいでしょうか」は既に決まったことの確認で、まだ相手の案が生きている段階の提案には合わない。', null),
       ('590df1a9f0', 2, '一つ伺いたいのですが、そちらの進め方には無理があるのではないでしょうか。', 'register_insulting', '丁寧な形はしているが、代案を出さずに相手の案の欠点だけを指摘しており、提案になっていない。', null),
       ('590df1a9f0', 3, '一つ伺いたいのですが、先に検証だけ進めるという進め方はいかがでしょうか。', 'correct', '相手の案を否定せずに切り出し、代案を「いかがでしょうか」と問いの形で置いており、提案の型に合っている。', null),
       ('fb167cd9a3', 0, 'つきましては、九月三日に限り持ち出しをお認めいただけますでしょうか。', 'correct', '「つきましては」で本題に入り、期間を限ったうえで「お認めいただけますでしょうか」と許可を求める、文書の型どおりの言い方。', null),
       ('fb167cd9a3', 1, 'つきましては、九月三日に限り持ち出しをお認めになりますでしょうか。', 'wrong_honorific_direction', '「お認めになる」は尊敬語だが「〜ますでしょうか」と続けると相手の意向を問うだけになり、許可を願い出る形にならない。', null),
       ('fb167cd9a3', 2, 'つきましては、九月三日に限り持ち出しをさせていただきます。', 'correct_keigo_wrong_speech_act', '謙譲語は正しいが言い切りで、許可を求めずに持ち出すことを通告している。', null),
       ('fb167cd9a3', 3, 'つきましては、九月三日に限り持ち出してもいいですか。', 'register_too_casual', '社内掲示の書式に話し言葉が混ざっており、文書としての体裁が崩れている。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
