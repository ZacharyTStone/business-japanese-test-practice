-- joukyou_haaku_J1_002: 1 × joukyou_haaku (J1)
-- generated 2026-09-19T05:32:24+00:00 by claude-sonnet-5
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
values ('bc79d4b41309107d', '後輩が電話を受けながら、この通知を見ています。先輩（営業部）からこう言われました。「来週の八日から名古屋に出張することになった。急いでいたから、もうトリップナビに出張申請を入力しておいたよ。念のため、これで大丈夫か確認してもらえる？」後輩は、先輩に何を確認する必要がありますか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('joukyou_haaku_J1_002', 'joukyou_haaku', 'J1', 'claude-sonnet-5', '2026-09-19T05:32:24+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('5f2adf082b', 'joukyou_haaku_J1_002', 'joukyou_haaku', 'J1', 'phone_with_notice+junior_to_senior+what_to_confirm@J1', 'phone_with_notice', 'junior_to_senior', 'what_to_confirm', 'phone', 'scene_phone_desk', null, null, '出張申請手続きの経過措置', '後輩が電話を受けながら、この通知を見ています。先輩（営業部）からこう言われました。「来週の八日から名古屋に出張することになった。急いでいたから、もうトリップナビに出張申請を入力しておいたよ。念のため、これで大丈夫か確認してもらえる？」後輩は、先輩に何を確認する必要がありますか。', 0, '通知は、10月15日から出張申請の方法を国内・海外で分けたうえで、出発日が14日以前の出張は種類を問わず紙の申請書とする経過措置を定めている。先輩の電話から、出張先は国内（名古屋）だが、出発日は来週の8日で14日以前にあたることが分かる。したがって、すでにシステムに入力していても、経過措置により紙の申請書で出し直す必要がある。「入力済みだから大丈夫」は但し書きを見ていない誤り、「15日以降だから大丈夫」は日付の当てはめを誤っている、「総務部に代行させる」は訂正の主体を誤っている。通知だけでは先輩の出発日が分からず、電話だけでは経過措置の存在が分からない。', 'The notice''s transitional rule requires paper applications for any trip departing before Oct 14, regardless of destination; the call reveals the departure date falls into that window, overriding the fact that the trip is domestic and already entered into the new system.', '[{"term": "出張申請", "reading": "しゅっちょうしんせい", "meaning": "business trip application"}, {"term": "経過措置", "reading": "けいかそち", "meaning": "transitional measure"}, {"term": "出し直す", "reading": "だしなおす", "meaning": "to resubmit"}]'::jsonb, '[{"template": "memo_notice", "title": "出張申請手続きの変更について", "meta": [{"label": "発信者", "value": "総務部"}, {"label": "発信日", "value": "10月1日"}, {"label": "対象", "value": "全社員"}], "blocks": [{"type": "paragraph", "text": "10月15日より、出張申請の手続きを次のとおり変更します。"}, {"type": "bullets", "items": ["国内出張は、新システム「トリップナビ」から申請してください。", "海外出張は、従来どおり紙の申請書を総務部に提出してください。"]}, {"type": "callout", "tone": "warning", "text": "ただし、出発日が10月14日以前の出張は、国内・海外を問わず紙の申請書を総務部に提出してください。"}]}]'::jsonb, '[]'::jsonb, 'bc79d4b41309107d', 1.0)
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
delete from public.item_options where item_id in ('5f2adf082b');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('5f2adf082b', 0, '出発日が10月14日以前にあたるため、システムではなく紙の申請書で出し直す必要があると伝える。', 'correct', '名古屋出張は国内だが、出発日が来週の8日で14日以前にあたり、通知の但し書きによりシステムではなく紙の申請書が必要だから。', null),
       ('5f2adf082b', 1, '出発日が10月15日以降の出張なので、システムのままで良いと伝える。', 'right_action_wrong_condition', 'システムでの申請が認められるのは出発日が15日以降の場合であり、先輩の出張は来週の8日でこの条件を満たしていない。', null),
       ('5f2adf082b', 2, 'すでにトリップナビへの入力が済んでいるので、そのままで問題ないと伝える。', 'ignores_the_document', '新方式での入力が済んでいることだけを見ており、出発日が14日以前は紙の申請書が必要という但し書きを見落としている。', null),
       ('5f2adf082b', 3, '総務部に連絡し、先輩の代わりにシステムの入力を紙の申請書に直してもらうよう依頼する。', 'wrong_action_owner', '申請内容の訂正・出し直しは申請者本人が行うべきことで、後輩や総務部が代わりに手続きするものではない。', null)
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
 where id in ('5f2adf082b');

commit;
