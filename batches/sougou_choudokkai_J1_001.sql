-- sougou_choudokkai_J1_001: 2 × sougou_choudokkai (J1)
-- generated 2026-09-18T08:50:50+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_client_meeting_room', '取引先の会議室'),
       ('scene_office_desk_pair', '自分の席で向かい合う二人')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('ea48beeb13697a5d', '社内の完成は、いつまでに必要になりましたか。', 'narrator_f', 'in_person'),
       ('f634a159fb45d245', '山本さんから引き継いだ案件ですが、進捗報告書では、先方への納品が十月十五日になっています。', 'manager_m', 'in_person'),
       ('ee7d23749c3b7722', 'それは先方の希望日でしょう。確か、検収に二週間みてほしいと言われていたはずだが。', 'staff_junior_m', 'in_person'),
       ('42b0498777d66d52', 'はい。ですので、社内の完成は九月末が目安と書いてあります。', 'manager_m', 'in_person'),
       ('e39ae53ca4c67039', 'ただ、先週の連絡で、先方の検収担当が十月の頭は出張だと聞いています。検収の開始が一週間遅れる前提で考えてください。', 'staff_junior_m', 'in_person'),
       ('829e56922bee762c', 'では、納品日を動かさないなら、完成をその分早める必要がありますね。', 'manager_m', 'in_person'),
       ('7823a3471d64019e', 'そういうことです。納品日は動かさない、と先方に約束しています。', 'staff_junior_m', 'in_person'),
       ('b2f949f39d8e3870', 'どの案で進めることになりましたか。', 'narrator_f', 'in_person'),
       ('94561c3a595df897', '先方から、見積を予算内に収めてほしいと言われています。修正案は三つ用意しました。', 'manager_m', 'in_person'),
       ('acd39c0cbf164f3a', '一つ目は保守を外す案ですね。先方は保守を重視していたと思いますが。', 'staff_junior_m', 'in_person'),
       ('096dad51111dbee0', 'はい。ですので実質、二つ目か三つ目かと。', 'manager_m', 'in_person'),
       ('9549cfceb1f9d0b8', '三つ目は台数を減らす案ですか。それだと来年また追加の話になって、かえって高くつきます。', 'staff_junior_m', 'in_person'),
       ('a80739165aba624f', 'では、二つ目でいきますか。金額は予算をわずかに超えますが。', 'manager_m', 'in_person'),
       ('fe0cbc037f4cf5c4', '超える分は初年度の保守を値引きで吸収しましょう。台数はそのままで。', 'staff_junior_m', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('sougou_choudokkai_J1_001', 'sougou_choudokkai', 'J1', 'manual-load', '2026-09-18T08:50:50+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('91d768f9f8', 'sougou_choudokkai_J1_001', 'sougou_choudokkai', 'J1', 'handover+subordinate_to_superior+find_the_deadline@J1', 'handover', 'subordinate_to_superior', 'find_the_deadline', 'in_person', 'scene_office_desk_pair', null, null, '引き継いだ案件の期限', '社内の完成は、いつまでに必要になりましたか。', 2, '報告書の日付は、納品十月十五日、その前に検収二週間、だから完成は九月三十日という組み立て。会話で、検収の開始が一週間遅れること、それでも納品日は動かさないことが分かる。動かせるのは完成日だけなので、一週間前倒しの九月二十三日ごろになる。報告書だけでは遅れが分からず、会話だけでは元の日付が分からない。', 'The report chains delivery, two weeks of acceptance and completion; the conversation delays acceptance a week and fixes delivery, so completion moves a week earlier.', '[{"term": "検収", "reading": "けんしゅう", "meaning": "acceptance inspection"}, {"term": "前倒し", "reading": "まえだおし", "meaning": "bringing forward"}]'::jsonb, '[{"template": "progress_report", "title": "案件K 進捗報告（引き継ぎ用）", "meta": [{"label": "報告者", "value": "技術部 山本"}, {"label": "報告日", "value": "九月十二日"}, {"label": "案件", "value": "案件K（みどり物産）"}], "blocks": [{"type": "key_values", "pairs": [{"label": "納品希望日", "value": "十月十五日"}, {"label": "検収期間", "value": "納品前に二週間（先方の要望）"}, {"label": "社内完成目安", "value": "九月三十日"}]}, {"type": "bullets", "items": ["仕様は確定済み。残る作業は最終検査のみ。", "検収の日程は先方の担当者と改めて調整すること。"]}]}]'::jsonb, '[{"speaker_role": "部下", "text": "山本さんから引き継いだ案件ですが、進捗報告書では、先方への納品が十月十五日になっています。", "clip_id": "f634a159fb45d245"}, {"speaker_role": "課長", "text": "それは先方の希望日でしょう。確か、検収に二週間みてほしいと言われていたはずだが。", "clip_id": "ee7d23749c3b7722"}, {"speaker_role": "部下", "text": "はい。ですので、社内の完成は九月末が目安と書いてあります。", "clip_id": "42b0498777d66d52"}, {"speaker_role": "課長", "text": "ただ、先週の連絡で、先方の検収担当が十月の頭は出張だと聞いています。検収の開始が一週間遅れる前提で考えてください。", "clip_id": "e39ae53ca4c67039"}, {"speaker_role": "部下", "text": "では、納品日を動かさないなら、完成をその分早める必要がありますね。", "clip_id": "829e56922bee762c"}, {"speaker_role": "課長", "text": "そういうことです。納品日は動かさない、と先方に約束しています。", "clip_id": "7823a3471d64019e"}]'::jsonb, 'ea48beeb13697a5d', null),
       ('749cfab0e3', 'sougou_choudokkai_J1_001', 'sougou_choudokkai', 'J1', 'client_review+subordinate_to_superior+choose_revision@J1', 'client_review', 'subordinate_to_superior', 'choose_revision', 'in_person', 'scene_client_meeting_room', null, null, '見積の修正案をどれにするか', 'どの案で進めることになりましたか。', 0, '表には三案と予算があり、予算内に収まるのは案一と案三。会話で案一は保守の重視、案三は将来の追加コストを理由に外れ、予算をわずかに超える案二が残る。超過分は初年度の保守の値引きで吸収し、台数は変えない。表だけを見ると予算内の案を選び、会話だけでは案二の中身が分からない。', 'The table shows which options fit the budget; the conversation rules those out and adopts the one that slightly exceeds it, absorbing the gap with a maintenance discount.', '[{"term": "保守", "reading": "ほしゅ", "meaning": "maintenance (contract)"}, {"term": "吸収する", "reading": "きゅうしゅうする", "meaning": "to absorb (a cost)"}]'::jsonb, '[{"template": "quote_order", "title": "お見積書 修正案の比較", "meta": [{"label": "宛先", "value": "あさひ工業株式会社 御中"}, {"label": "発行者", "value": "山川商事株式会社 営業部"}, {"label": "発行日", "value": "九月十七日"}], "blocks": [{"type": "table", "columns": ["案", "内容", "合計金額"], "rows": [["案一", "保守契約を外す", "2,850,000円"], ["案二", "納期を一か月延ばし、設置費を減らす", "3,050,000円"], ["案三", "台数を二十台から十六台に減らす", "2,900,000円"]]}, {"type": "key_values", "pairs": [{"label": "先方のご予算", "value": "3,000,000円"}]}]}]'::jsonb, '[{"speaker_role": "部下", "text": "先方から、見積を予算内に収めてほしいと言われています。修正案は三つ用意しました。", "clip_id": "94561c3a595df897"}, {"speaker_role": "課長", "text": "一つ目は保守を外す案ですね。先方は保守を重視していたと思いますが。", "clip_id": "acd39c0cbf164f3a"}, {"speaker_role": "部下", "text": "はい。ですので実質、二つ目か三つ目かと。", "clip_id": "096dad51111dbee0"}, {"speaker_role": "課長", "text": "三つ目は台数を減らす案ですか。それだと来年また追加の話になって、かえって高くつきます。", "clip_id": "9549cfceb1f9d0b8"}, {"speaker_role": "部下", "text": "では、二つ目でいきますか。金額は予算をわずかに超えますが。", "clip_id": "a80739165aba624f"}, {"speaker_role": "課長", "text": "超える分は初年度の保守を値引きで吸収しましょう。台数はそのままで。", "clip_id": "fe0cbc037f4cf5c4"}]'::jsonb, 'b2f949f39d8e3870', null)
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
delete from public.item_options where item_id in ('91d768f9f8', '749cfab0e3');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('91d768f9f8', 0, '十月七日ごろまで', 'unsupported_but_plausible', '検収の遅れに合わせて完成も一週間遅らせた形だが、納品日を動かさないと約束している以上、遅らせる余地はない。', null),
       ('91d768f9f8', 1, '十月十五日まで', 'stated_by_wrong_speaker', '部下が最初に挙げた日付だが、課長がそれは先方の希望する納品日であって完成の期限ではないと述べている。', null),
       ('91d768f9f8', 2, '九月二十三日ごろまで', 'correct', '報告書の完成目安は九月三十日だが、検収の開始が一週間遅れるのに納品日を動かさないので、完成もその分、一週間早める必要がある。', null),
       ('91d768f9f8', 3, '九月三十日まで', 'combines_wrong_pair', '報告書に書かれた目安のままで、検収が一週間遅れて始まるという課長の話を反映していない。', null),
       ('749cfab0e3', 0, '納期を一か月延ばして設置費を減らし、予算を超える分は初年度の保守の値引きで補う。', 'correct', '課長が案二を前提に「超える分は初年度の保守を値引きで吸収」「台数はそのまま」と決めており、案二に値引きを足した形になる。', null),
       ('749cfab0e3', 1, '台数を十六台に減らして、予算内に収める。', 'combines_wrong_pair', '表の中で予算内に収まる案だが、課長が来年の追加でかえって高くつくと退けている。', null),
       ('749cfab0e3', 2, '保守契約を外して、最も安い案にする。', 'stated_by_wrong_speaker', '部下が用意した案の一つではあるが、先方が保守を重視していると課長が指摘し、部下も実質外れると認めている。', null),
       ('749cfab0e3', 3, '納期を一か月延ばして設置費を減らし、超える分は先方に予算を増やしてもらう。', 'wrong_action_owner', '案二を通す方法としてはあり得るが、超過分を吸収するのは自社の保守の値引きで、先方に予算を動かしてもらう話は出ていない。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
