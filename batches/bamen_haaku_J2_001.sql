-- bamen_haaku_J2_001: 6 × bamen_haaku (J2)
-- generated 2026-09-15T17:50:12+00:00 by author-composed
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_corridor', 'オフィスの廊下'),
       ('scene_expo_booth', '展示会のブース'),
       ('scene_office_open_floor', '執務フロア全体'),
       ('scene_phone_desk', 'デスクで固定電話'),
       ('scene_restaurant_private', '料理店の個室'),
       ('scene_video_call_laptop', 'ノートPCでオンライン会議')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('b0ee6487f832174e', '会社の廊下で、部下が上司に呼び止められました。「例の報告書ですが、数字を直したものを先方に送る前に一度見せてください。」部下はこのあと何をしますか。', 'narrator_f', 'in_person'),
       ('a79b34a57d0e972e', '会社で、ある人が電話でこう話しています。「いつもお世話になっております。山川商事の佐藤でございます。先日ご注文いただいた品物の納期の件で、ご連絡いたしました。」この人はどの立場の人ですか。', 'narrator_f', 'in_person'),
       ('5df209a88719e6c3', '料理店の個室で、ある人が話しています。「本日は、三年間の取引にお礼を申し上げたく、ささやかですが席を設けました。来月から担当が代わりますので、その引き継ぎもかねております。」この場面は何のためのものですか。', 'narrator_f', 'in_person'),
       ('d9c7b6f8d85f4061', '展示会のブースで、社員がこう話しています。「恐れ入ります、お名刺を一枚頂戴できますでしょうか。あとで資料をお送りいたしますので、ご住所もこちらにご記入ください。」この人は誰に向かって話していますか。', 'narrator_f', 'in_person'),
       ('76a5ac56baf558db', '執務フロアで、課長が部下に話しています。「先月の集計、数字そのものは合っているんです。ただ、出てくるのが締切の当日でしてね。会議で使うには遅すぎるんですよ。」何が問題になっていますか。', 'narrator_f', 'in_person'),
       ('df22875660f76c21', 'オンライン会議で、ある人がこう話しています。「では、本日決まったことを確認いたします。まず日程は十日に変更、担当は私が引き続き。次回までに先方の返事をいただいておきます。」これはやりとりのどの段階ですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('bamen_haaku_J2_001', 'bamen_haaku', 'J2', 'author-composed', '2026-09-15T17:50:12+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id)
values ('771f316560', 'bamen_haaku_J2_001', 'bamen_haaku', 'J2', 'corridor+subordinate_to_superior+identify_next_action@J2', 'corridor', 'subordinate_to_superior', 'identify_next_action', 'in_person', 'scene_corridor', null, null, '廊下で上司に呼び止められる', '会社の廊下で、部下が上司に呼び止められました。「例の報告書ですが、数字を直したものを先方に送る前に一度見せてください。」部下はこのあと何をしますか。', 2, '上司の指示は「先方に送る前に一度見せてください」で、順序まで含んでいる。修正はすでに済んでおり、先方への確認は指示されていない。この種の問題は、行為そのものだけでなく順序を聞き取れているかを見ている。', 'The instruction includes the order: show it before sending, not after.', '[{"term": "呼び止める", "reading": "よびとめる", "meaning": "to call someone to a stop"}, {"term": "先方", "reading": "せんぽう", "meaning": "the other party"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'b0ee6487f832174e'),
       ('3051f79b53', 'bamen_haaku_J2_001', 'bamen_haaku', 'J2', 'phone_desk+peer_to_peer+identify_speaker_role@J2', 'phone_desk', 'peer_to_peer', 'identify_speaker_role', 'phone', 'scene_phone_desk', null, null, '電話の相手の立場を聞き分ける', '会社で、ある人が電話でこう話しています。「いつもお世話になっております。山川商事の佐藤でございます。先日ご注文いただいた品物の納期の件で、ご連絡いたしました。」この人はどの立場の人ですか。', 0, '「ご注文いただいた」は相手が注文し、自分が受けた側であることを示す。したがって話し手は納める側の担当者。授受表現の方向が、そのまま立場を決めている。運送の話は出ておらず、受付が取引先に納期を連絡することもない。', 'ご注文いただいた marks the speaker as the one who received the order, i.e. the supplier.', '[{"term": "納期", "reading": "のうき", "meaning": "delivery date"}, {"term": "品物", "reading": "しなもの", "meaning": "goods"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'a79b34a57d0e972e'),
       ('5bcdfbb584', 'bamen_haaku_J2_001', 'bamen_haaku', 'J2', 'dining+staff_to_client+identify_purpose@J2', 'dining', 'staff_to_client', 'identify_purpose', 'in_person', 'scene_restaurant_private', null, null, '会食の目的を聞き取る', '料理店の個室で、ある人が話しています。「本日は、三年間の取引にお礼を申し上げたく、ささやかですが席を設けました。来月から担当が代わりますので、その引き継ぎもかねております。」この場面は何のためのものですか。', 3, '「お礼を申し上げたく」「引き継ぎもかねております」と、目的が二つ並べて述べられている。「かねる」は二つの目的を一つの場でまとめる語で、どちらか一方だけを選ぶと不十分になる。取引が終わるとはどこにも述べられていない。', 'かねる signals two purposes at once, so an answer naming only one is incomplete.', '[{"term": "席を設ける", "reading": "せきをもうける", "meaning": "to arrange a gathering"}, {"term": "兼ねる", "reading": "かねる", "meaning": "to serve two purposes"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '5df209a88719e6c3'),
       ('96e5f5b389', 'bamen_haaku_J2_001', 'bamen_haaku', 'J2', 'event_venue+staff_to_visitor+identify_listener_role@J2', 'event_venue', 'staff_to_visitor', 'identify_listener_role', 'in_person', 'scene_expo_booth', null, null, '展示会のブースで誰に話しているか', '展示会のブースで、社員がこう話しています。「恐れ入ります、お名刺を一枚頂戴できますでしょうか。あとで資料をお送りいたしますので、ご住所もこちらにご記入ください。」この人は誰に向かって話していますか。', 1, '名刺を求め、住所を書いてもらい、あとで資料を送る──これは展示会で来場者と接するときの一続きの流れ。同僚や設営業者に対して行うことではなく、配送業者は話題にも出ていない。', 'Asking for a card and an address to post materials is what one does with a visitor to the stand.', '[{"term": "頂戴する", "reading": "ちょうだいする", "meaning": "to receive (humble)"}, {"term": "来場者", "reading": "らいじょうしゃ", "meaning": "visitor to an event"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'd9c7b6f8d85f4061'),
       ('071dec33a5', 'bamen_haaku_J2_001', 'bamen_haaku', 'J2', 'office_floor+superior_to_subordinate+identify_problem@J2', 'office_floor', 'superior_to_subordinate', 'identify_problem', 'in_person', 'scene_office_open_floor', null, null, '何が問題になっているか', '執務フロアで、課長が部下に話しています。「先月の集計、数字そのものは合っているんです。ただ、出てくるのが締切の当日でしてね。会議で使うには遅すぎるんですよ。」何が問題になっていますか。', 3, '「数字そのものは合っているんです。ただ〜」という言い方は、何を問題にしていないかを先に示す型。問題は正確さではなく、出てくる時期。取り上げられているのは先月の集計で、今月の話にも、会議の日程が早すぎるという話にもなっていない。', '「Xは合っている。ただ〜」 marks what is NOT the problem before naming what is.', '[{"term": "集計", "reading": "しゅうけい", "meaning": "tally / aggregation"}, {"term": "締切", "reading": "しめきり", "meaning": "deadline"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '76a5ac56baf558db'),
       ('5c05ab4b5f', 'bamen_haaku_J2_001', 'bamen_haaku', 'J2', 'video_call+subordinate_to_superior+identify_stage@J2', 'video_call', 'subordinate_to_superior', 'identify_stage', 'video', 'scene_video_call_laptop', null, null, 'オンライン会議のどの段階か', 'オンライン会議で、ある人がこう話しています。「では、本日決まったことを確認いたします。まず日程は十日に変更、担当は私が引き続き。次回までに先方の返事をいただいておきます。」これはやりとりのどの段階ですか。', 0, '「本日決まったことを確認いたします」は会議を締めくくる型。決定事項を並べているので、話し合いはすでに終わっている。日程は決着済みで、次回の日程を決める話にもなっていない。', '「本日決まったことを確認いたします」 is a closing move, not an opening one.', '[{"term": "引き続き", "reading": "ひきつづき", "meaning": "continuing as before"}, {"term": "変更", "reading": "へんこう", "meaning": "change"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'df22875660f76c21')
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
delete from public.item_options where item_id in ('771f316560', '3051f79b53', '5bcdfbb584', '96e5f5b389', '071dec33a5', '5c05ab4b5f');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('771f316560', 0, '数字を直した報告書を、先方に送ってから上司に見せる。', 'right_scene_wrong_moment', '見せること自体は合っているが、順序が逆で、指示の「送る前に」に反する。', null),
       ('771f316560', 1, '報告書の数字をこれから直す。', 'plausible_but_unmentioned', '自然な流れではあるが、上司は「数字を直したもの」と言っており、修正はすでに終わっている。', null),
       ('771f316560', 2, '数字を直した報告書を、先に上司に見せる。', 'correct', '「先方に送る前に一度見せてください」と、送る前に見せる順序まで指示されている。', null),
       ('771f316560', 3, '先方に報告書の送り先を確認する。', 'wrong_participant', '先方は話に出てくるが、確認するよう言われているのは上司への提示であって、送り先ではない。', null),
       ('3051f79b53', 0, '品物を納める側の会社の担当者', 'correct', '「ご注文いただいた」と相手の注文を受けた側の言い方をしており、納期を知らせる側でもある。', null),
       ('3051f79b53', 1, '品物を注文した側の会社の担当者', 'wrong_participant', '注文したのは「ご注文いただいた」の相手のほうで、この話し手ではない。', null),
       ('3051f79b53', 2, '山川商事に品物を運ぶ運送会社の担当者', 'plausible_but_unmentioned', '納期の話から運送を連想しやすいが、運送については何も述べられていない。', null),
       ('3051f79b53', 3, '山川商事の受付担当者', 'adjacent_setting', '同じ会社の人ではあるが、自分から取引先に納期の連絡をしており、受付の役割ではない。', null),
       ('5bcdfbb584', 0, '新しい取引を始めるための顔合わせ', 'plausible_but_unmentioned', '会食の目的としてはありそうだが、三年間の取引がすでにあると述べられており、始まりの場面ではない。', null),
       ('5bcdfbb584', 1, '取引を終わらせることを伝えるための会食', 'right_scene_wrong_moment', '担当が代わるとは言っているが、取引そのものが終わるとは述べていない。', null),
       ('5bcdfbb584', 2, '新しい担当者を紹介するためだけの会食', 'wrong_participant', '引き継ぎには触れているが、目的はそれだけではなく、礼を述べることが先に挙げられている。', null),
       ('5bcdfbb584', 3, 'これまでの取引への礼と、担当交代の知らせを兼ねた会食', 'correct', '「お礼を申し上げたく」と「引き継ぎもかねております」の両方が述べられており、目的は二つある。', null),
       ('96e5f5b389', 0, '同じブースで働いている同僚', 'wrong_participant', '同僚に名刺を求め、住所を書かせることはない。', null),
       ('96e5f5b389', 1, 'ブースに立ち寄った来場者', 'correct', '名刺をもらい、あとで資料を送るという流れは、初めて会った来場者に対するもの。', null),
       ('96e5f5b389', 2, '会場の設営を担当している業者', 'adjacent_setting', '同じ会場にはいるが、資料を送る相手として話しかけられてはいない。', null),
       ('96e5f5b389', 3, 'あとで資料を送る先の配送業者', 'plausible_but_unmentioned', '資料の発送は話に出るが、配送業者に住所を記入させる場面ではない。', null),
       ('071dec33a5', 0, '集計の数字が間違っていること', 'plausible_but_unmentioned', '集計の問題として最も想像しやすいが、「数字そのものは合っている」と明確に否定されている。', null),
       ('071dec33a5', 1, '今月の集計にまだ取りかかっていないこと', 'right_scene_wrong_moment', '同じ集計の話ではあるが、課長が取り上げているのは先月の集計であって、今月のことは話に出ていない。', null),
       ('071dec33a5', 2, '会議の日程が早すぎること', 'wrong_participant', '遅すぎると言われているのは集計のほうで、会議の日程が問題にされてはいない。', null),
       ('071dec33a5', 3, '集計が出来上がる時期が遅いこと', 'correct', '「数字そのものは合っている」と正確さを認めたうえで、「出てくるのが締切の当日」「遅すぎる」と時期を問題にしている。', null),
       ('5c05ab4b5f', 0, '話し合いが終わり、決まったことをまとめている段階', 'correct', '「本日決まったことを確認いたします」と述べ、決定事項を並べているので、締めくくりの段階。', null),
       ('5c05ab4b5f', 1, '議題を示して話し合いを始める段階', 'right_scene_wrong_moment', '同じ会議の中の場面だが、これから話すのではなく、決まったことを振り返っている。', null),
       ('5c05ab4b5f', 2, '日程について意見が分かれている段階', 'plausible_but_unmentioned', '日程は話に出るが、すでに十日に決まっており、意見が分かれている様子はない。', null),
       ('5c05ab4b5f', 3, '次回の会議の日程を決めている段階', 'wrong_participant', '「次回までに」とは言っているが、次回の日程を決めているわけではない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
