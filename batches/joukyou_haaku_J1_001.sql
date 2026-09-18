-- joukyou_haaku_J1_001: 2 × joukyou_haaku (J1)
-- generated 2026-09-18T08:50:49+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_office_open_floor', '執務フロア全体'),
       ('scene_phone_desk', 'デスクで固定電話')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('ea03c75fb2d914f1', '課長が部下に、通知を見ながらこう言いました。「山田さんから、来週の木曜と金曜を在宅にしたいと相談があったんだ。山田さんは先月入社したばかりで、金曜はお客様の来訪もある。認めていいか、条件を確認してくれ。」どう答えればいいですか。', 'narrator_f', 'in_person'),
       ('f3001ac88b61ccc9', '十月三日の金曜日、お客様から電話がありました。「先日そちらで購入した測定器を返品したいのですが、どこへ持って行けばいいでしょうか。明日、土曜にそちらの近くまで行く用事があるので、そのときに伺えればと思いまして。」どう案内すればいいですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('joukyou_haaku_J1_001', 'joukyou_haaku', 'J1', 'manual-load', '2026-09-18T08:50:49+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('5fea125b8c', 'joukyou_haaku_J1_001', 'joukyou_haaku', 'J1', 'office_notice+superior_to_subordinate+check_condition@J1', 'office_notice', 'superior_to_subordinate', 'check_condition', 'in_person', 'scene_office_open_floor', null, null, '在宅勤務の申請が条件を満たすか', '課長が部下に、通知を見ながらこう言いました。「山田さんから、来週の木曜と金曜を在宅にしたいと相談があったんだ。山田さんは先月入社したばかりで、金曜はお客様の来訪もある。認めていいか、条件を確認してくれ。」どう答えればいいですか。', 2, '通知には三つの条件と、対象外を定める但し書きがある。課長の話から、山田さんは先月入社で三か月未満、金曜は来客日と分かる。曜日や日数の条件を当てはめる前に、但し書きで対象外になるので、木曜だけ認める答えも誤り。通知だけでは山田さんの入社時期が分からず、話だけでは但し書きが分からない。', 'The notice''s fine print excludes anyone under three months in; the manager''s remark that Yamada joined last month is what triggers it, before the weekday rules even apply.', '[{"term": "試用期間", "reading": "しようきかん", "meaning": "probation period"}, {"term": "所属長", "reading": "しょぞくちょう", "meaning": "head of one''s department"}]'::jsonb, '[{"template": "memo_notice", "title": "在宅勤務制度の運用について", "meta": [{"label": "発信者", "value": "人事部"}, {"label": "発信日", "value": "九月一日"}, {"label": "対象", "value": "全社員"}], "blocks": [{"type": "paragraph", "text": "十月より、在宅勤務を次の条件で認めます。"}, {"type": "numbered", "items": ["週二日までとする。", "前週の金曜日までに、所属長の承認を得て申請すること。", "来客対応や外出の予定がある日は対象としない。"]}, {"type": "callout", "tone": "warning", "text": "なお、試用期間中の方および入社後三か月未満の方は、当面の間、対象外とします。"}]}]'::jsonb, '[]'::jsonb, 'ea03c75fb2d914f1', null),
       ('b7865a8ee7', 'joukyou_haaku_J1_001', 'joukyou_haaku', 'J1', 'phone_with_notice+staff_to_customer+choose_destination@J1', 'phone_with_notice', 'staff_to_customer', 'choose_destination', 'phone', 'scene_phone_desk', null, null, '返品の持ち込み先を案内する', '十月三日の金曜日、お客様から電話がありました。「先日そちらで購入した測定器を返品したいのですが、どこへ持って行けばいいでしょうか。明日、土曜にそちらの近くまで行く用事があるので、そのときに伺えればと思いまして。」どう案内すればいいですか。', 0, '通知は持ち込み先を物品の種類で分け、日にちを平日に限っている。お客様の電話から、品物が測定器で、希望が土曜だと分かる。品物の種類で本社の窓口が決まり、曜日の条件で土曜が外れる。通知だけでは品物が分からず、電話だけでは窓口も曜日の決まりも分からない。', 'The notice splits the drop-off point by type of goods and limits it to weekdays; the call supplies the type and the customer''s Saturday wish, and both rules bite.', '[{"term": "返品", "reading": "へんぴん", "meaning": "returning goods"}, {"term": "精密機器", "reading": "せいみつきき", "meaning": "precision instruments"}]'::jsonb, '[{"template": "memo_notice", "title": "返品受付窓口の変更について", "meta": [{"label": "発信者", "value": "営業管理部"}, {"label": "発信日", "value": "九月二十五日"}, {"label": "対象", "value": "全社員"}], "blocks": [{"type": "paragraph", "text": "十月一日より、お客様からの返品を次のとおり受け付けます。"}, {"type": "bullets", "items": ["返品の持ち込み先は、本社受付から港北物流センターに変更します。", "測定器などの精密機器は、従来どおり本社三階のサービス窓口で受け付けます。", "持ち込みはいずれも平日の九時から十七時までとし、土日祝は受け付けません。"]}]}]'::jsonb, '[]'::jsonb, 'f3001ac88b61ccc9', null)
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
delete from public.item_options where item_id in ('5fea125b8c', 'b7865a8ee7');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('5fea125b8c', 0, '週二日以内なので、木曜と金曜の両方を認める。', 'ignores_the_document', '相談の内容だけに答えており、通知にある来客日の除外も、入社後三か月未満の但し書きも見ていない。', null),
       ('5fea125b8c', 1, '人事部から山田さんに直接、対象外だと伝えてもらう。', 'wrong_action_owner', '判断の中身は合っているが、部下の相談に答えるのは所属長で、通知にも人事部が個別に伝えるとは書かれていない。', null),
       ('5fea125b8c', 2, '先月入社で入社後三か月未満なので、どちらの日も対象外だと伝える。', 'correct', '通知の但し書きが入社後三か月未満の人を対象外としており、課長の話から山田さんが先月入社だと分かる。日数や曜日を見る前に、そもそも対象にならない。', null),
       ('5fea125b8c', 3, '金曜は来客対応の日にあたるので、木曜だけを認める。', 'right_action_wrong_condition', '来客のある日を除く条件は本当だが、山田さんは入社後三か月未満で制度の対象外なので、木曜も認められない。', null),
       ('b7865a8ee7', 0, '本社三階のサービス窓口へ、平日の九時から十七時の間に持ち込むよう案内する。', 'correct', '測定器は精密機器として本社の窓口が受け付けると通知にあり、土日は受け付けないので、明日の土曜ではなく平日を案内する。', null),
       ('b7865a8ee7', 1, '本社三階のサービス窓口へ、明日の土曜に持ち込むよう案内する。', 'right_action_wrong_condition', '持ち込み先は合っているが、通知は土日祝の受け付けをしないと定めており、お客様の希望する日は使えない。', null),
       ('b7865a8ee7', 2, '港北物流センターへ、平日に持ち込むよう案内する。', 'ignores_the_request', '返品の一般の持ち込み先としては正しいが、お客様が言っている測定器は精密機器で、通知は本社の窓口に分けている。', null),
       ('b7865a8ee7', 3, '物流センターの担当者から、お客様に折り返し連絡してもらう。', 'wrong_action_owner', '案内は電話を受けた自分がその場でするもので、しかも測定器は物流センターの扱いではない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
