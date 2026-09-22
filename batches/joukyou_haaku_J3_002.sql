-- joukyou_haaku_J3_002: 1 × joukyou_haaku (J3)
-- generated 2026-09-19T05:33:30+00:00 by claude-sonnet-5
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank (or, for 画像把握, one picture per item);
-- image_path stays null until the art exists, and is deliberately not
-- overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_phone_desk', 'デスクで固定電話')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('87aa241f1529313d', '部下が経理部からの通知を見ているところへ、上司から電話がかかってきた。上司は「さっきのタクシー代なんだけど、五千円ぐらいだった。会社のSuicaで払ったんだが、領収書は出なかったんだ。今日中に精算したいんだけど、どうすればいい？」と言っている。このあと、どうすればいいですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('joukyou_haaku_J3_002', 'joukyou_haaku', 'J3', 'claude-sonnet-5', '2026-09-19T05:33:30+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('fd6bb953af', 'joukyou_haaku_J3_002', 'joukyou_haaku', 'J3', 'phone_with_notice+superior_to_subordinate+check_condition@J3', 'phone_with_notice', 'superior_to_subordinate', 'check_condition', 'phone', 'scene_phone_desk', null, null, '経費精算の証憑ルール', '部下が経理部からの通知を見ているところへ、上司から電話がかかってきた。上司は「さっきのタクシー代なんだけど、五千円ぐらいだった。会社のSuicaで払ったんだが、領収書は出なかったんだ。今日中に精算したいんだけど、どうすればいい？」と言っている。このあと、どうすればいいですか。', 1, '通知は経費精算の証憑について、金額と支払い方法によって扱いを分けている。1万円以上は領収書原本、1万円未満で領収書を紛失した場合は支出報告書、交通系ICカードでの支払いは利用明細と、三つの規定がある。上司の電話から、金額は5000円で1万円未満だが、支払い方法が会社のSuicaだと分かるため、現金紛失時の規定ではなく、ICカードの規定が適用される。1万円以上の規定は金額条件を満たさず誤り。支出報告書の案は支払い方法を見落としている。経理部や部下が代わりに動く必要はなく、当人である上司が利用明細を用意すべきである。', 'The notice splits receipt rules by amount and payment method; the phone call reveals the fare was paid via company IC card, which triggers the usage-statement rule rather than the lost-receipt or high-amount rules.', '[{"term": "精算", "reading": "せいさん", "meaning": "settlement of accounts / reimbursement"}, {"term": "領収書", "reading": "りょうしゅうしょ", "meaning": "receipt"}, {"term": "利用明細", "reading": "りようめいさい", "meaning": "usage statement / detailed record of use"}]'::jsonb, '[{"template": "memo_notice", "title": "経費精算における証憑の取り扱いについて", "meta": [{"label": "発信者", "value": "経理部"}, {"label": "発信日", "value": "4月1日"}, {"label": "対象", "value": "全社員"}], "blocks": [{"type": "paragraph", "text": "経費精算における証憑の取り扱いを、本日より次のとおり変更します。"}, {"type": "numbered", "items": ["1万円以上の支出は、領収書の原本を添付してください。", "1万円未満の支出で領収書を紛失した場合は、支出報告書に理由を記入し、上長の承認を得てください。", "交通系ICカードでの支払い分は、領収書の代わりに利用明細を印刷して添付してください。"]}]}]'::jsonb, '[]'::jsonb, '87aa241f1529313d', 1.0)
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
delete from public.item_options where item_id in ('fd6bb953af');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('fd6bb953af', 0, '1万円以上の支出の規定に従い、領収書の原本を添付するよう伝える。', 'right_action_wrong_condition', '領収書原本の添付は1万円以上の支出に適用される規定で、今回のタクシー代は5000円のためこの条件を満たさない。', null),
       ('fd6bb953af', 1, '交通系ICカードでの支払い分なので、利用明細を印刷して添付するよう伝える。', 'correct', '通知は交通系ICカードでの支払い分について、領収書の代わりに利用明細を印刷して添付すると定めており、上司の支払い方法はこれに当てはまる。', null),
       ('fd6bb953af', 2, '部下が経理部に連絡し、利用明細を代わりに印刷して提出してもらう。', 'wrong_action_owner', '利用明細の準備と提出は精算する本人である上司が行うべきことで、部下や経理部が代行するものではない。', null),
       ('fd6bb953af', 3, '領収書をなくしているので、支出報告書に理由を記入し、上長の承認を得るよう伝える。', 'ignores_the_document', 'この対応は現金払いで領収書を紛失した場合の規定であり、今回は会社のSuicaで支払っているため、通知は利用明細の添付という別の対応を求めている。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
