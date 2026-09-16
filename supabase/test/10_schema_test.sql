-- What the schema promises, checked against a real Postgres.
--
-- The two things worth proving here are the ones that are expensive to get wrong
-- and invisible until they are: that a person can never read anyone else's
-- history, and that grading is decided by the database rather than by whatever
-- the client claims. Everything else is a bonus.

\set ON_ERROR_STOP on
\set QUIET on

create or replace function test.check(ok boolean, what text)
returns void language plpgsql as $$
begin
    if ok then
        raise notice '  ok   %', what;
    else
        raise exception 'FAILED: %', what;
    end if;
end;
$$;

-- Act as a signed-in user with this id. Session-scoped rather than
-- transaction-scoped, because psql commits after every statement and a
-- transaction-local claim would be gone by the next one.
create or replace function test.become(p_user uuid)
returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, false);
end;
$$;

-- ----------------------------------------------------------------- fixtures

-- Publishing runs as the service role, which bypasses RLS — same as the real
-- thing, where `bjt publish` output is applied with the service key.
--
-- One transaction, because items.correct_index is a deferred foreign key into
-- the option set: an item and its options only make sense together, and the
-- database enforces that by refusing to let them be committed apart. The
-- publisher emits a single transaction for the same reason.
begin;
set local role service_role;

insert into public.scenes (id, label_ja) values ('scene_phone_desk', '電話');
insert into public.audio_clips (id, text, voice, channel) values
    ('clip_n1', 'ナレーション', 'narrator_f', 'in_person'),
    ('clip_o1', '選択肢1', 'staff_mid_m', 'phone');
insert into public.bundles (id, item_type, level, generator_model, generated_at) values
    ('test_bundle', 'hatsugen_choukai', 'J2', 'author-composed', now());

insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation,
                          function, channel, scene_id, topic, stem, correct_index)
values
    ('itm_phone', 'test_bundle', 'hatsugen_choukai', 'J2',
     'phone_external+staff_to_client+phone_absence@J2', 'phone_external', 'staff_to_client',
     'phone_absence', 'phone', 'scene_phone_desk', '不在の伝達', '電話の場面です。', 0),
    ('itm_desk', 'test_bundle', 'hatsugen_choukai', 'J2',
     'office_desk+subordinate_to_superior+request@J2', 'office_desk', 'subordinate_to_superior',
     'request', 'in_person', null, '依頼', '上司に頼む場面です。', 1);

insert into public.item_options (item_id, position, text, role, why) values
    ('itm_phone', 0, '正しい言い方。',   'correct',             'これが正解である理由。'),
    ('itm_phone', 1, '身内を高める。',   'wrong_uchi_soto',     'ウチ・ソトを誤っている。'),
    ('itm_phone', 2, '砕けすぎ。',       'register_too_casual', '取引先には丁寧さが足りない。'),
    ('itm_phone', 3, '答えていない。',   'content_mismatch',    '場面の要求に答えていない。'),
    ('itm_desk',  0, '敬意の方向が逆。', 'wrong_honorific_direction', '謙譲語を相手の行為に使っている。'),
    ('itm_desk',  1, '正しい依頼。',     'correct',             'これが正解である理由。'),
    ('itm_desk',  2, '申し出になる。',   'wrong_speech_act',    '依頼ではなく申し出になっている。'),
    ('itm_desk',  3, '二重敬語。',       'over_polite_misfit',  '敬語を重ねすぎている。');

commit;

-- Two users, as the app creates them: anonymous first, identity later.
insert into auth.users (id, is_anonymous) values
    ('11111111-1111-1111-1111-111111111111', true),
    ('22222222-2222-2222-2222-222222222222', true);

-- ------------------------------------------------------------------- tests

do $$
declare
    a uuid := '11111111-1111-1111-1111-111111111111';
    b uuid := '22222222-2222-2222-2222-222222222222';
    n int;
    v_correct boolean;
    v_role text;
begin
    raise notice 'profiles';
    perform test.check(
        (select count(*) from public.profiles where id in (a, b)) = 2,
        'an anonymous sign-in gets a profile without being asked');
    perform test.check(
        (select is_anonymous from public.profiles where id = a),
        'the profile starts out marked anonymous');

    raise notice 'linking a Google identity';
    update auth.users set is_anonymous = false, email = 'zach@example.com' where id = a;
    perform test.check(
        (select not is_anonymous and linked_at is not null from public.profiles where id = a),
        'linking flips is_anonymous and stamps linked_at');
    perform test.check(
        (select count(*) from public.profiles where id = a) = 1,
        'linking keeps ONE row — history is not split across two users');
end
$$;

-- --- grading is the database's job, not the client's -----------------------

set role authenticated;
do $$ begin perform test.become('11111111-1111-1111-1111-111111111111'); end $$;

do $$
declare
    v record;
begin
    raise notice 'grading';
    -- The client sends only which option it touched. Note it does NOT send
    -- user_id, is_correct, or chosen_role; all three are filled in server-side.
    insert into public.attempts (item_id, chosen_index) values ('itm_phone', 1);
    select * into v from public.attempts order by id desc limit 1;

    perform test.check(not v.is_correct, 'a wrong option is graded wrong');
    perform test.check(v.chosen_role = 'wrong_uchi_soto',
                       'the attempt records WHICH trap caught them');
    perform test.check(v.user_id = '11111111-1111-1111-1111-111111111111'::uuid,
                       'user_id comes from the session, not from the insert');

    insert into public.attempts (item_id, chosen_index) values ('itm_desk', 1);
    select * into v from public.attempts order by id desc limit 1;
    perform test.check(v.is_correct, 'the right option is graded right');
    perform test.check(v.chosen_role = 'correct', 'a correct answer records the correct role');
end
$$;

do $$
declare
    ok boolean := false;
begin
    raise notice 'a client cannot lie about its own result';
    begin
        -- Claiming a wrong answer was right: the trigger overwrites it.
        insert into public.attempts (item_id, chosen_index, is_correct, chosen_role)
        values ('itm_phone', 2, true, 'correct');
        ok := not (select is_correct from public.attempts order by id desc limit 1);
    exception when others then
        ok := true;   -- refusing outright is just as good
    end;
    perform test.check(ok, 'a claimed is_correct is ignored in favour of the answer key');
end
$$;

do $$
declare
    ok boolean := false;
begin
    raise notice 'an answer already given is history';
    begin
        update public.attempts set chosen_index = 0 where item_id = 'itm_phone';
        ok := (select count(*) from public.attempts where item_id = 'itm_phone' and chosen_index = 0) = 0;
    exception when insufficient_privilege then
        ok := true;
    end;
    perform test.check(ok, 'attempts cannot be rewritten after the fact');

    begin
        insert into public.entitlements (user_id, product, source)
        values ((select auth.uid()), 'ads_free', 'grant');
        ok := false;
    exception when others then
        ok := true;
    end;
    perform test.check(ok, 'a client cannot grant itself the paid unlock');
end
$$;

-- --- isolation --------------------------------------------------------------

do $$ begin perform test.become('22222222-2222-2222-2222-222222222222'); end $$;

do $$
begin
    raise notice 'isolation';
    perform test.check((select count(*) from public.attempts) = 0,
                       'user B sees none of user A''s attempts');
    perform test.check((select count(*) from public.profiles) = 1,
                       'user B sees only their own profile');
    perform test.check((select count(*) from public.v_my_type_stats where answered > 0) = 0,
                       'the stats views inherit that isolation (security_invoker)');
    perform test.check((select count(*) from public.items) = 2,
                       'but the item library is readable by everyone');
end
$$;

do $$
declare
    ok boolean := false;
begin
    begin
        insert into public.attempts (user_id, item_id, chosen_index)
        values ('11111111-1111-1111-1111-111111111111', 'itm_phone', 0);
        ok := (select user_id from public.attempts order by id desc limit 1)
              = '22222222-2222-2222-2222-222222222222'::uuid;
    exception when others then
        ok := true;
    end;
    perform test.check(ok, 'user B cannot write an attempt into user A''s history');
end
$$;

-- --- selection --------------------------------------------------------------

do $$ begin perform test.become('11111111-1111-1111-1111-111111111111'); end $$;

do $$
declare
    first_id text;
    n int;
begin
    raise notice 'next_items';
    select count(*) into n from public.next_items(10);
    perform test.check(n = 2, 'the queue returns the whole published level');

    perform test.check(
        (select jsonb_array_length(options) from public.next_items(10) limit 1) = 4,
        'each queued item arrives with its four options in one round trip');

    -- A has answered itm_desk correctly and itm_phone wrongly, so the one that
    -- caught them should come back first.
    select id into first_id from public.next_items(1);
    perform test.check(first_id = 'itm_phone',
                       'an item you got wrong comes back before one you got right');

    perform test.check(
        (select times_seen from public.next_items(1))
            = (select count(*) from public.attempts where item_id = 'itm_phone'),
        'the queue says how often you have met this item');

    -- Size is the only thing the queue can be asked for. If a mode, a type or a
    -- level ever comes back as an argument, this stops compiling.
    perform test.check((select count(*) from pg_proc where oid = 'public.next_items'::regproc
                          and pronargs = 1) = 1,
                       'the queue takes a size and nothing else');

    perform test.check(public.my_streak() = 1, 'answering today makes the streak 1');
end
$$;

do $$
declare
    v record;
begin
    raise notice 'weakness views';
    select * into v from public.v_my_role_traps where role = 'wrong_uchi_soto';
    perform test.check(v.times_chosen = 1, 'the trap view counts the trap, not just the miss');

    select * into v from public.v_my_type_stats where item_type = 'hatsugen_choukai';
    perform test.check(
        v.answered = (select count(*) from public.attempts)
            and v.correct = (select count(*) from public.attempts where is_correct),
        'type stats add up to the attempts behind them');

    perform test.check(
        (select count(*) from public.v_my_type_stats) = 9,
        'all nine types appear on the radar, including untouched ones');

    select * into v from public.v_my_tag_stats where axis = 'channel' and tag = 'phone';
    perform test.check(v.accuracy = 0, 'the telephone shows up as its own weakness');
end
$$;

reset role;

-- These fixtures exist only to prove grading and RLS. Left in place, they sit
-- in the same J2 pool as the published reference batch, and next_items() picks
-- among all of it at random — so 20_published_test.sql would intermittently
-- draw a fixture item instead of real content and fail on its short stem or
-- missing narration clip. Clean up before that file runs.
delete from public.items where id in ('itm_phone', 'itm_desk');

-- --- the answer key cannot dangle -------------------------------------------

begin;
set local role service_role;
-- The constraint is deferred so a publisher can insert the item before its
-- options; made immediate here so the failure lands on the statement.
set constraints items_correct_option_fk immediate;

do $$
declare
    ok boolean := false;
begin
    raise notice 'integrity';
    begin
        insert into public.items (id, bundle_id, item_type, level, stem, correct_index)
        values ('itm_broken', 'test_bundle', 'hatsugen_choukai', 'J2', 'x', 3);
        ok := false;
    exception when foreign_key_violation then
        ok := true;
    end;
    perform test.check(ok, 'an item whose correct_index points at no option is rejected');
end
$$;
-- --- the trigger functions are not an API -----------------------------------

-- They are `security definer` because they write rows the caller has no policy
-- for. Living in `public` also publishes them at /rest/v1/rpc/<name>, so the
-- grant is revoked in 20260914000100. Assert both halves of that: the door is
-- shut, and the triggers behind it still fire — which the grading tests above
-- have already demonstrated on this very connection.
reset role;

do $$
declare
    f text;
begin
    raise notice 'definer functions are not reachable over the API';
    foreach f in array array['handle_new_user()', 'sync_profile_identity()', 'grade_attempt()']
    loop
        perform test.check(
            not has_function_privilege('anon', 'public.' || f, 'execute'),
            'anon cannot call public.' || f || ' as an RPC');
        perform test.check(
            not has_function_privilege('authenticated', 'public.' || f, 'execute'),
            'authenticated cannot call public.' || f || ' as an RPC');
    end loop;

    -- The two read functions ARE the app's API and must stay callable.
    perform test.check(
        has_function_privilege('authenticated', 'public.my_streak()', 'execute'),
        'my_streak stays callable — it is the app''s own RPC');
    perform test.check(
        has_function_privilege('authenticated', 'public.next_items(integer)', 'execute'),
        'next_items stays callable — it is the app''s own RPC');

    -- ...with a pinned search_path, so a caller cannot shadow what they read.
    foreach f in array array['my_streak', 'next_items']
    loop
        perform test.check(
            (select proconfig is not null
                and exists (select 1 from unnest(proconfig) c where split_part(c, '=', 1) = 'search_path')
             from pg_proc
             where oid = ('public.' || f)::regproc),
            'public.' || f || ' pins its search_path');
    end loop;
end
$$;

rollback;

\echo 'ALL SCHEMA TESTS PASSED'

-- ---------------------------------------------------------------------------
-- Documents, dialogue, and the scene image path.
--
-- Six of the nine item types carry a stimulus that is not a string. All three
-- of the things that carry it were added at once and all three are read by the
-- app through next_items, so all three are asserted here rather than trusted.

do $$
declare
    v record;
begin
    raise notice 'documents, dialogue, and scene art';

    -- A scene with artwork, and an item set in it.
    insert into public.scenes (id, label_ja, image_path)
    values ('scene_test_room', 'テスト用の場面', 'scenes/test_room.webp')
    on conflict (id) do update set image_path = excluded.image_path;

    insert into public.bundles (id, item_type, level, generator_model, generated_at)
    values ('bnd_doc', 'sougou_choudokkai', 'J2', 'test', now())
    on conflict (id) do nothing;

    set constraints all deferred;
    insert into public.items (
        id, bundle_id, item_type, level, stem, correct_index, scene_id,
        documents, dialogue
    ) values (
        'itm_doc', 'bnd_doc', 'sougou_choudokkai', 'J2', '資料と会話の問題', 0, 'scene_test_room',
        '[{"template": "quote_order", "title": "お見積書", "meta": [], "blocks": []}]'::jsonb,
        '[{"speaker_role": "課長", "text": "数量を増やしてください", "clip_id": "clip_doc"},
          {"speaker_role": "担当", "text": "承知しました", "clip_id": null}]'::jsonb
    );
    insert into public.item_options (item_id, position, text, role, why) values
        ('itm_doc', 0, '二十脚にする', 'correct', 'これが正解。'),
        ('itm_doc', 1, '十二脚のまま', 'combines_wrong_pair', 'これは誤り。'),
        ('itm_doc', 2, '課長が直す', 'stated_by_wrong_speaker', 'これは誤り。'),
        ('itm_doc', 3, '担当が直す', 'wrong_action_owner', 'これは誤り。');
    insert into public.audio_clips (id, text, voice, channel, audio_path)
    values ('clip_doc', '数量を増やしてください', 'manager_m', 'in_person', 'audio/clip_doc.m4a')
    on conflict (id) do update set audio_path = excluded.audio_path;
    set constraints all immediate;

    select * into v from public.next_items(20) where id = 'itm_doc';

    perform test.check(jsonb_array_length(v.documents) = 1,
                       'a document item arrives with its document');
    perform test.check(v.documents -> 0 ->> 'template' = 'quote_order',
                       'the document keeps the template it was published with');

    perform test.check(jsonb_array_length(v.dialogue) = 2,
                       'a conversation item arrives with every turn');
    perform test.check(v.dialogue -> 0 ->> 'speaker_role' = '課長',
                       'dialogue turns keep their order and their speaker');
    perform test.check(v.dialogue -> 0 ->> 'audio_path' = 'audio/clip_doc.m4a',
                       'a synthesised turn arrives with its audio path resolved');
    perform test.check(v.dialogue -> 1 ->> 'audio_path' is null,
                       'an unsynthesised turn says so rather than failing the whole item');

    perform test.check(v.scene_image_path = 'scenes/test_room.webp',
                       'an item arrives with the path to its scene artwork');

    -- Items whose scene has no artwork yet are the normal case, not an error.
    -- Asserted against a scene created here with no image_path, rather than
    -- against a fixture from an earlier block: those are deleted above, and a
    -- subquery over no rows returns null whatever the function does.
    insert into public.scenes (id, label_ja) values ('scene_test_unart', 'まだ絵のない場面')
    on conflict (id) do nothing;

    set constraints all deferred;
    insert into public.items (id, bundle_id, item_type, level, stem, correct_index, scene_id)
    values ('itm_unart', 'bnd_doc', 'sougou_choudokkai', 'J2', '絵のない問題', 0, 'scene_test_unart');
    insert into public.item_options (item_id, position, text, role, why) values
        ('itm_unart', 0, 'あ', 'correct', 'これが正解。'),
        ('itm_unart', 1, 'い', 'combines_wrong_pair', 'これは誤り。'),
        ('itm_unart', 2, 'う', 'stated_by_wrong_speaker', 'これは誤り。'),
        ('itm_unart', 3, 'え', 'wrong_action_owner', 'これは誤り。');
    set constraints all immediate;

    select * into v from public.next_items(20) where id = 'itm_unart';
    perform test.check(v.id = 'itm_unart' and v.scene_image_path is null,
                       'an item whose scene has no art yet still comes back, with a null path');
end
$$;

-- Same reason as the cleanup further up: these fixtures share the J2 pool with
-- the published reference batch, and next_items() draws among all of it at
-- random. Left in place they would make 20_published_test.sql intermittently
-- count a fixture as real content.
delete from public.items where id in ('itm_doc', 'itm_unart');
delete from public.bundles where id = 'bnd_doc';

do $$
declare
    n integer;
begin
    raise notice 'media buckets';

    select count(*) into n from storage.buckets where id in ('audio', 'scenes');
    perform test.check(n = 2, 'both media buckets exist');

    perform test.check(
        (select bool_and(public) from storage.buckets where id in ('audio', 'scenes')),
        'media is public-read: these are questions, identical for every learner');

    -- The same rule the item library follows. A client that could write here
    -- could replace the audio of a question with anything at all.
    select count(*) into n
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and cmd <> 'SELECT';
    perform test.check(n = 0, 'no client-side write policy on storage objects');
end
$$;

-- ---------------------------------------------------------------------------
-- Entitlements: the table finally has a writer, and it had better be the only
-- one. Every assertion below is about who CANNOT call it.

do $$
declare
    uid uuid;
    ent public.entitlements;
    denied boolean := false;
begin
    raise notice 'entitlement grants';

    insert into auth.users (email, is_anonymous) values ('buyer@example.com', false)
    returning id into uid;

    set local role service_role;
    ent := public.grant_entitlement(uid, 'ads_free', 'stripe', 'txn_0001');
    perform test.check(ent.user_id = uid and ent.revoked_at is null,
                       'the service role can grant the unlock');

    -- A store delivers the same purchase more than once. That is normal.
    ent := public.grant_entitlement(uid, 'ads_free', 'stripe', 'txn_0001');
    perform test.check(
        (select count(*) from public.entitlements where user_id = uid) = 1,
        'a replayed purchase webhook updates rather than duplicating');

    ent := public.revoke_entitlement(uid, 'ads_free', 'refunded');
    perform test.check(ent.revoked_at is not null,
                       'revoking marks the row');
    perform test.check(
        (select count(*) from public.entitlements where user_id = uid) = 1,
        'and keeps it — a chargeback dispute is when that record is wanted');

    ent := public.grant_entitlement(uid, 'ads_free', 'stripe', 'txn_0002');
    perform test.check(ent.revoked_at is null,
                       'buying again after a refund restores the unlock');
    reset role;

    -- The whole point. A client that could call this could grant itself the
    -- paid unlock, so it must not be able to reach the function at all.
    set local role authenticated;
    begin
        perform public.grant_entitlement(uid, 'ads_free', 'grant', null, 'nice try');
    exception when insufficient_privilege then
        denied := true;
    end;
    perform test.check(denied, 'a signed-in client cannot call grant_entitlement');

    denied := false;
    begin
        perform public.revoke_entitlement(uid, 'ads_free');
    exception when insufficient_privilege then
        denied := true;
    end;
    perform test.check(denied, 'nor revoke_entitlement');
    reset role;

    delete from public.entitlements where user_id = uid;
    delete from auth.users where id = uid;
end
$$;

-- --- level ------------------------------------------------------------------

-- Last, because it writes sixty answers and the counts above would move. The
-- fixtures from the top were deleted along the way, so it brings its own.
begin;
set local role service_role;
insert into public.bundles (id, item_type, level, generator_model, generated_at) values
    ('bnd_lvl', 'hatsugen_choukai', 'J2', 'author-composed', now());
insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation,
                          function, channel, topic, stem, correct_index)
values ('itm_lvl', 'bnd_lvl', 'hatsugen_choukai', 'J2', 'office_desk+peer_to_peer+request@J2',
        'office_desk', 'peer_to_peer', 'request', 'in_person', '依頼', '同僚に頼む場面です。', 0);
insert into public.item_options (item_id, position, text, role, why) values
    ('itm_lvl', 0, '正しい。',   'correct',             '正解。'),
    ('itm_lvl', 1, '砕けすぎ。', 'register_too_casual', '砕けすぎ。'),
    ('itm_lvl', 2, '逆。',       'wrong_honorific_direction', '逆。'),
    ('itm_lvl', 3, '答えない。', 'content_mismatch',    '答えていない。');
commit;

do $$ begin perform test.become('11111111-1111-1111-1111-111111111111'); end $$;
set role authenticated;

do $$
declare
    i integer;
begin
    raise notice 'level';
    perform test.check((select target_level from public.profiles) = 'J2',
                       'everyone starts at J2; nobody is asked');

    -- The record so far is a handful of answers, so the first window is ten.
    for i in 1..9 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 0);
    end loop;
    perform test.check((select target_level from public.profiles) = 'J2',
                       'nine right answers are not yet a decision');
    insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 0);
    perform test.check((select target_level from public.profiles) = 'J1',
                       'the tenth moves the level up: the first window is ten, not twenty');
    for i in 1..10 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 0);
    end loop;

    for i in 1..20 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 1);
    end loop;
    perform test.check((select target_level from public.profiles) = 'J1',
                       'answers at another level do not count: J2 misses leave a J1 learner alone');
end
$$;

reset role;

do $$
declare
    i integer;
begin
    -- Put them back at J2 the way a service-role tool would, then miss twenty.
    set local role service_role;
    update public.profiles
       set target_level = 'J2', level_changed_at = now()
     where id = '11111111-1111-1111-1111-111111111111';
    reset role;
    set local role authenticated;

    for i in 1..19 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 1);
    end loop;
    perform test.check((select target_level from public.profiles) = 'J2',
                       'with a record behind them the window is twenty, so nineteen misses wait');
    insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 1);
    perform test.check((select target_level from public.profiles) = 'J3',
                       'twenty answers with eight or fewer right move the level down');
    reset role;
end
$$;

delete from public.items where id = 'itm_lvl';
delete from public.bundles where id = 'bnd_lvl';
