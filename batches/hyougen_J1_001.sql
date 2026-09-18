-- hyougen_J1_001: 2 × hyougen (J1)
-- generated 2026-09-18T08:50:49+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('hyougen_J1_001', 'hyougen', 'J1', 'manual-load', '2026-09-18T08:50:49+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('19427808fb', 'hyougen_J1_001', 'hyougen', 'J1', 'email_internal+superior_to_subordinate+schedule_change@J1', 'email_internal', 'superior_to_subordinate', 'schedule_change', 'written', null, null, null, '部長が定例会議の変更を知らせる', '部長が、部内のメンバーあてのメールで、来週の定例会議を水曜から木曜に動かすことを知らせます。理由は取引先の来訪と重なったためで、変更はすでに決めています。最も適切な表現はどれですか。', 0, '上司から部下への変更の知らせは、決定を理由とともに述べ、対応が必要な人に何をしてほしいかを添える。「よろしいでしょうか」は決まっていることを許可の形にしており、部下は答えようがない。「ずらすね」は全員あての文として崩れすぎ。「参られる」は謙譲語を相手に向けた誤りで、そのうえ部下への文として敬語が過剰になっている。', 'A manager announces a decided change as a statement with a reason, not as a request for permission, and without pointing humble forms at the client.', '[{"term": "定例会議", "reading": "ていれいかいぎ", "meaning": "regular meeting"}, {"term": "来訪", "reading": "らいほう", "meaning": "a visit (by someone)"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null),
       ('4dae5d71aa', 'hyougen_J1_001', 'hyougen', 'J1', 'chat_internal+superior_to_subordinate+offer_help@J1', 'chat_internal', 'superior_to_subordinate', 'offer_help', 'written', null, null, null, '課長が残業中の部下に手を貸す', '社内チャットで、部下が「報告書、まだ数字が合わなくて残業になりそうです」と書き込みました。課長として、押しつけがましくならないように手伝いを申し出ます。最も適切な表現はどれですか。', 2, '上司の申し出は、手伝える範囲を示しつつ、受けるかどうかを部下に委ねる形にする。「そんなことで」は相手を見下す言い方。「送ってください。直しておきます」は指示で、申し出ではない。「させていただきたく存じます」は部下に向けた社内チャットとして敬語が過剰で、向きも合わない。', 'An offer from a manager names what they can do and leaves the decision to the subordinate, without belittling them or over-humbling.', '[{"term": "突き合わせ", "reading": "つきあわせ", "meaning": "cross-checking (figures)"}, {"term": "押しつけがましい", "reading": "おしつけがましい", "meaning": "pushy / imposing"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
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
delete from public.item_options where item_id in ('19427808fb', '4dae5d71aa');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('19427808fb', 0, '来週の定例会議ですが、取引先のご来訪と重なったため、水曜から木曜の同じ時刻に変更します。都合の悪い方は本日中に知らせてください。', 'correct', '決定事項を理由とともに簡潔に伝え、部下への文として丁寧さも過不足がない。', null),
       ('19427808fb', 1, '来週の定例会議を水曜から木曜に変更してもよろしいでしょうか。取引先のご来訪と重なっております。', 'correct_keigo_wrong_speech_act', '敬語は整っているが、すでに決めた変更を部下に許可を求める形で書いており、通知になっていない。', null),
       ('19427808fb', 2, '来週の定例、水曜は先方が来るから木曜にずらすね。よろしく。', 'register_too_casual', '内容は合っているが、部内全員あてのメールとしては話し言葉が過ぎ、記録に残る文としての体裁がない。', null),
       ('19427808fb', 3, '来週の定例会議ですが、取引先が参られるため、水曜から木曜に変更させていただきたく存じます。', 'wrong_honorific_direction', '「参る」は自分側の移動をへりくだる語で、取引先の来訪に使うと敬意の向きが逆になる。部下に対する「させていただきたく存じます」も過剰。', null),
       ('4dae5d71aa', 0, '元データをこちらに送ってください。私のほうで直しておきます。', 'correct_keigo_wrong_speech_act', '丁寧ではあるが申し出ではなく指示で、相手の仕事を取り上げる形になっている。', null),
       ('4dae5d71aa', 1, 'お手伝いさせていただきたく存じますので、元データをお送りいただけますでしょうか。', 'wrong_honorific_direction', '上司から部下への社内チャットで謙譲語を重ねており、敬意の向きが立場に合わず、かえって距離を作る。', null),
       ('4dae5d71aa', 2, '数字の突き合わせなら、元データを送ってもらえれば私も見てみます。今日中でなくても大丈夫ですよ。', 'correct', '手伝う範囲を示したうえで判断を相手に残し、期限の圧力も外しており、上司からの申し出として自然。', null),
       ('4dae5d71aa', 3, 'そんなことで残業ですか。私なら十分で終わりますから、送ってください。', 'register_insulting', '手伝いを申し出る形にはなっているが、相手の力量をおとしめる言い方になっている。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
