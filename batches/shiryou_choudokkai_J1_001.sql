-- shiryou_choudokkai_J1_001: 2 × shiryou_choudokkai (J1)
-- generated 2026-09-18T08:50:50+00:00 by manual-load
-- Produced by `bjt publish`. Idempotent: re-running replaces these rows.

begin;

-- Scenes are a shared bank; image_path stays null until the art exists,
-- and is deliberately not overwritten by a re-publish.
insert into public.scenes (id, label_ja)
values ('scene_meeting_room_table', '社内の会議室のテーブル'),
       ('scene_phone_desk', 'デスクで固定電話')
on conflict (id) do update set
       label_ja = excluded.label_ja;

-- One row per distinct utterance. audio_path is filled in by the TTS step.
insert into public.audio_clips (id, text, voice, channel)
values ('94647a13ebeedf10', '課長が配布資料を見ながらこう言いました。「条件を整理します。単価は千五百円まで、納期は今月中。それから、資料は二百個で作ってもらいましたが、数量は三百個に増えました。三百個で頼める先のうち、一番安いところにしましょう。」どこに頼むことになりますか。', 'narrator_f', 'in_person'),
       ('8d559a1f441ce8be', 'お客様から電話がありました。「メールを拝見しました。十二日の分は倉庫で受け取りたいのですが、当日入るのは全部で何点になりますか。椅子のカバーは数に入れなくて結構です。」十二日に届くのは何点ですか。', 'narrator_f', 'in_person')
on conflict (id) do update set
       text = excluded.text,
       voice = excluded.voice,
       channel = excluded.channel;

insert into public.bundles (id, item_type, level, generator_model, generated_at)
values ('shiryou_choudokkai_J1_001', 'shiryou_choudokkai', 'J1', 'manual-load', '2026-09-18T08:50:50+00:00')
on conflict (id) do update set
       item_type = excluded.item_type,
       level = excluded.level,
       generator_model = excluded.generator_model,
       generated_at = excluded.generated_at;

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation, function, channel, scene_id, speaker_role, listener_role, topic, stem, correct_index, explanation_ja, explanation_en, vocab_notes, documents, dialogue, narration_clip_id, model_p_correct)
values ('07d09e3290', 'shiryou_choudokkai_J1_001', 'shiryou_choudokkai', 'J1', 'meeting_handout+superior_to_subordinate+choose_the_option@J1', 'meeting_handout', 'superior_to_subordinate', 'choose_the_option', 'in_person', 'scene_meeting_room_table', null, null, '条件に合う仕入先を選ぶ', '課長が配布資料を見ながらこう言いました。「条件を整理します。単価は千五百円まで、納期は今月中。それから、資料は二百個で作ってもらいましたが、数量は三百個に増えました。三百個で頼める先のうち、一番安いところにしましょう。」どこに頼むことになりますか。', 0, '資料は二百個を前提に作られており、その前提ではB社しか残らない。課長の話で数量が三百個になると、最低注文数二百五十個のC社が候補に入り、B社より安いので採用される。A社は最低注文数、D社は納期で外れる。資料だけでは数量の変更が分からず、話だけでは各社の条件が分からない。', 'The sheet assumes 200 units, under which only B qualifies; the spoken change to 300 brings C into range, and it is cheaper.', '[{"term": "仕入先", "reading": "しいれさき", "meaning": "supplier"}, {"term": "最低注文数", "reading": "さいていちゅうもんすう", "meaning": "minimum order quantity"}]'::jsonb, '[{"template": "quote_order", "title": "部品X 仕入先比較（数量二百個の場合）", "meta": [{"label": "宛先", "value": "購買会議 出席者各位"}, {"label": "発行者", "value": "購買部 川口"}, {"label": "発行日", "value": "九月十六日"}], "blocks": [{"type": "table", "columns": ["仕入先", "単価", "納期", "最低注文数"], "rows": [["A社", "1,400円", "九月二十五日", "500個"], ["B社", "1,480円", "九月三十日", "100個"], ["C社", "1,450円", "九月二十九日", "250個"], ["D社", "1,430円", "十月三日", "200個"]]}, {"type": "callout", "tone": "info", "text": "最低注文数に満たない数量では、いずれの仕入先も受注しません。"}]}]'::jsonb, '[]'::jsonb, '94647a13ebeedf10', null),
       ('afae5f31b2', 'shiryou_choudokkai_J1_001', 'shiryou_choudokkai', 'J1', 'delivery_email+staff_to_customer+find_the_quantity@J1', 'delivery_email', 'staff_to_customer', 'find_the_quantity', 'phone', 'scene_phone_desk', null, null, '分納の初回に届く点数', 'お客様から電話がありました。「メールを拝見しました。十二日の分は倉庫で受け取りたいのですが、当日入るのは全部で何点になりますか。椅子のカバーは数に入れなくて結構です。」十二日に届くのは何点ですか。', 2, 'メールには椅子の分納、机の一括納品、カバーの同梱が書かれている。電話で問われたのは十二日に届く点数で、カバーは除く。十二日は椅子四十脚と机十台で五十点。十九日の二十脚は入れず、カバーも数えない。メールだけでは何を数えるか決まらず、電話だけでは数が分からない。', 'The email gives the split by date and the covers; the call fixes the date and excludes the covers, leaving forty chairs plus ten desks.', '[{"term": "分納", "reading": "ぶんのう", "meaning": "delivery in instalments"}, {"term": "全数", "reading": "ぜんすう", "meaning": "the full quantity"}]'::jsonb, '[{"template": "email_external", "title": "納品予定のご連絡", "meta": [{"label": "差出人", "value": "山川商事 営業部 佐藤"}, {"label": "宛先", "value": "みどり物産 総務部 田中様"}, {"label": "件名", "value": "納品予定のご連絡"}, {"label": "日時", "value": "九月五日 十四時"}], "blocks": [{"type": "paragraph", "text": "ご注文いただきました品の納品予定をご連絡いたします。"}, {"type": "bullets", "items": ["椅子六十脚は、九月十二日に四十脚、九月十九日に残りの二十脚を納品いたします。", "机十台は、九月十二日に全数納品いたします。", "椅子には、予備の座面カバーを一脚につき一枚ずつお付けします。"]}, {"type": "paragraph", "text": "ご不明な点がございましたら、佐藤までお問い合わせください。"}]}]'::jsonb, '[]'::jsonb, '8d559a1f441ce8be', null)
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
delete from public.item_options where item_id in ('07d09e3290', 'afae5f31b2');
insert into public.item_options (item_id, position, text, role, why, clip_id)
values ('07d09e3290', 0, 'C社', 'correct', '三百個なら最低注文数二百五十個を満たし、単価千四百五十円は千五百円以内、納期九月二十九日は今月中。条件に合う中で最も安い。', null),
       ('07d09e3290', 1, 'B社', 'ignores_the_spoken_change', '資料どおり二百個で考えると条件に合う唯一の先だが、数量が三百個に増えたことでC社も候補に入り、そちらのほうが安い。', null),
       ('07d09e3290', 2, 'A社', 'reads_wrong_row', '表で最も安い行だが、最低注文数五百個を三百個では満たさず、注記のとおり受注されない。', null),
       ('07d09e3290', 3, 'D社', 'wrong_timeframe', '単価も最低注文数も条件に合うが、納期が十月三日で今月中に間に合わない。', null),
       ('afae5f31b2', 0, '七十点', 'wrong_timeframe', '椅子六十脚と机十台の注文全体の数で、十九日に届く二十脚まで十二日の分に入れている。', null),
       ('afae5f31b2', 1, '九十点', 'surface_keyword_match', '「一脚につき一枚」に引かれて椅子四十脚分のカバーを足した数だが、電話でカバーは数に入れないと言われている。', null),
       ('afae5f31b2', 2, '五十点', 'correct', '十二日に届くのは椅子四十脚と机十台で、合わせて五十点。カバーは数えないと言われている。', null),
       ('afae5f31b2', 3, '四十点', 'reads_wrong_row', '椅子の十二日分だけを数えており、同じ日に全数届く机十台の行が抜けている。', null)
on conflict (item_id, position) do update set
       text = excluded.text,
       role = excluded.role,
       why = excluded.why,
       clip_id = excluded.clip_id;

commit;
