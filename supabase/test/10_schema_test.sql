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
--
-- The claims carry what Supabase's JWT carries: the user's email and whether
-- the session is anonymous, read from auth.users so a test that links an
-- identity is seen as linked from then on. is_tester() reads both.
create or replace function test.become(p_user uuid)
returns void language plpgsql security definer as $$
declare
    claims json;
begin
    select json_build_object('sub', p_user, 'email', u.email, 'is_anonymous', u.is_anonymous)
      into claims
      from auth.users u
     where u.id = p_user;
    perform set_config('request.jwt.claims',
                       coalesce(claims, json_build_object('sub', p_user))::text, false);
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

-- Two users. A starts anonymous and links Google below, as the app once let
-- people do; B is already linked. Both are on the tester list, because while
-- the app is in testing nobody else can read anything at all — and the
-- isolation tests below are about what one *tester* can see of another.
insert into auth.users (id, email, is_anonymous) values
    ('11111111-1111-1111-1111-111111111111', null, true),
    ('22222222-2222-2222-2222-222222222222', 'b@example.com', false);
insert into public.testers (email, note) values
    ('zach@example.com', 'test fixture: user A, once linked'),
    ('b@example.com',    'test fixture: user B');

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
                       'but the item library is readable by every tester');
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
-- --- the definer functions are not an API -----------------------------------

-- They are `security definer` because they write rows the caller has no policy
-- for — or, in refresh_item_stats's case, because it reads every attempt in the
-- database, which is exactly what no client may do. Living in `public` also
-- publishes them at /rest/v1/rpc/<name>, so the grant is revoked where each is
-- defined. Assert both halves of that: the door is shut, and the triggers behind
-- it still fire — which the grading tests above have already demonstrated on
-- this very connection.
reset role;

do $$
declare
    f text;
begin
    raise notice 'definer functions are not reachable over the API';
    foreach f in array array['handle_new_user()', 'sync_profile_identity()', 'grade_attempt()',
                             'schedule_review()', 'refresh_item_stats()']
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

-- --- testers only -----------------------------------------------------------

-- While the app is in testing the database, not the client, is what keeps
-- everybody else out. Four things are asserted: the shape of the schema (every
-- policy requires is_tester(), anon has nothing), and then three people at the
-- door — an anonymous session, a Google account that is not on the list, and a
-- tester — each seen exactly as a request would see them.

reset role;

do $$
begin
    raise notice 'testers only: the shape';
    perform test.check(
        not exists (
            select 1 from pg_policies
             where schemaname = 'public'
               and coalesce(qual, '') not like '%is_tester()%'
               and coalesce(with_check, '') not like '%is_tester()%'),
        'every policy in public requires is_tester()');
    perform test.check(
        not exists (select 1 from pg_policies
                     where schemaname = 'public' and 'anon'::name = any(roles)),
        'no policy in public names the anon role');
    perform test.check(
        not exists (select 1 from information_schema.role_table_grants
                     where grantee = 'anon' and table_schema = 'public'),
        'anon holds no privilege on any table or view in public');
    perform test.check(
        not has_function_privilege('anon', 'public.next_items(integer)', 'execute')
        and not has_function_privilege('anon', 'public.my_streak()', 'execute')
        and not has_function_privilege('anon', 'public.is_tester()', 'execute'),
        'anon cannot call any RPC');
    perform test.check(
        has_function_privilege('authenticated', 'public.is_tester()', 'execute')
        and not has_table_privilege('authenticated', 'public.testers', 'select'),
        'a signed-in user may ask whether they are a tester, and nothing more');
end
$$;

insert into auth.users (id, email, is_anonymous) values
    ('77777777-7777-7777-7777-777777777777', null, true),
    ('88888888-8888-8888-8888-888888888888', 'stranger@example.com', false);

do $$
declare
    ok boolean;
begin
    raise notice 'testers only: an anonymous session';
    perform test.become('77777777-7777-7777-7777-777777777777');
    set local role authenticated;
    perform test.check(not public.is_tester(), 'is not a tester');
    perform test.check((select count(*) from public.items) = 0, 'sees no items');
    perform test.check((select count(*) from public.item_types) = 0, 'sees no problem types');
    perform test.check((select count(*) from public.profiles) = 0,
                       'sees no profile, not even the one the trigger made');
    perform test.check((select count(*) from public.next_items(5)) = 0, 'gets no practice set');
    perform test.check((select count(*) from public.v_item_difficulty) = 0,
                       'sees no difficulty figures');
    ok := false;
    begin
        insert into public.attempts (item_id, chosen_index) values ('itm_phone', 0);
    exception when others then
        ok := true;
    end;
    perform test.check(ok, 'cannot write an attempt');
end
$$;

do $$
declare
    ok boolean;
begin
    raise notice 'testers only: a Google account that is not on the list';
    perform test.become('88888888-8888-8888-8888-888888888888');
    set local role authenticated;
    perform test.check(not public.is_tester(), 'is not a tester');
    perform test.check((select count(*) from public.items) = 0, 'sees no items');
    perform test.check((select count(*) from public.profiles) = 0, 'sees no profile');
    perform test.check((select count(*) from public.next_items(5)) = 0, 'gets no practice set');
    ok := false;
    begin
        insert into public.attempts (item_id, chosen_index) values ('itm_phone', 0);
    exception when others then
        ok := true;
    end;
    perform test.check(ok, 'cannot write an attempt');
    ok := false;
    begin
        insert into public.testers (email) values ('stranger@example.com');
    exception when others then
        ok := true;
    end;
    perform test.check(ok, 'cannot add themselves to the list');
end
$$;

do $$
begin
    raise notice 'testers only: somebody on the list';
    perform test.become('11111111-1111-1111-1111-111111111111');
    set local role authenticated;
    perform test.check(public.is_tester(), 'is a tester');
    -- The fixture items were cleaned up by the tests above; the nine problem
    -- types and the scene are content that is always there.
    perform test.check((select count(*) from public.item_types) = 9, 'sees the content');
    perform test.check((select count(*) from public.scenes) > 0, 'sees the scenes');
    perform test.check((select count(*) from public.profiles) = 1, 'sees their own profile');
end
$$;

-- The list is matched case-insensitively, because Google reports the address
-- the person typed and people type their own address in every case there is.
do $$
begin
    update auth.users set email = 'Zach@Example.com' where id = '11111111-1111-1111-1111-111111111111';
    perform test.become('11111111-1111-1111-1111-111111111111');
    set local role authenticated;
    perform test.check(public.is_tester(), 'the email is matched whatever its case');
end
$$;
update auth.users set email = 'zach@example.com' where id = '11111111-1111-1111-1111-111111111111';

reset role;

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

-- --- level, per section ----------------------------------------------------

-- Last, because it writes well over a hundred answers and every count above
-- would move. The fixtures from the top were deleted along the way, so it brings
-- its own: one 聴解 item and one 読解 item, which is the whole point — the two
-- sections have to move independently or a strong reader is still being drowned
-- in listening.
begin;
set local role service_role;
insert into public.bundles (id, item_type, level, generator_model, generated_at) values
    ('bnd_lvl', 'hatsugen_choukai', 'J2', 'author-composed', now()),
    ('bnd_dok', 'sougou_dokkai',    'J2', 'author-composed', now());
insert into public.items (id, bundle_id, item_type, level, seed_cell_id, setting, relation,
                          function, channel, topic, stem, correct_index)
values ('itm_lvl', 'bnd_lvl', 'hatsugen_choukai', 'J2', 'office_desk+peer_to_peer+request@J2',
        'office_desk', 'peer_to_peer', 'request', 'in_person', '依頼', '同僚に頼む場面です。', 0),
       ('itm_dok', 'bnd_dok', 'sougou_dokkai', 'J2', 'report_document+other_department+summarise@J2',
        'report_document', 'other_department', 'summarise', 'written', '読解', '文書から読み取れることは。', 0);
insert into public.item_options (item_id, position, text, role, why) values
    ('itm_lvl', 0, '正しい。',   'correct',             '正解。'),
    ('itm_lvl', 1, '砕けすぎ。', 'register_too_casual', '砕けすぎ。'),
    ('itm_lvl', 2, '逆。',       'wrong_honorific_direction', '逆。'),
    ('itm_lvl', 3, '答えない。', 'content_mismatch',    '答えていない。'),
    ('itm_dok', 0, '書いてある。',   'correct',          '正解。'),
    ('itm_dok', 1, '書いていない。', 'not_in_document',  '本文にない。'),
    ('itm_dok', 2, '言いすぎ。',     'overgeneralised',  '広げすぎ。'),
    ('itm_dok', 3, '別の話。',       'wrong_paragraph',  '別の段落。');
commit;

do $$ begin perform test.become('11111111-1111-1111-1111-111111111111'); end $$;
set role authenticated;

do $$
declare
    i integer;
begin
    raise notice 'level, per section';
    perform test.check(
        (select count(*) from public.v_my_levels where level = 'J2') = 3,
        'all three sections start at J2; nobody is asked about any of them');

    -- The record so far is a handful of answers, so the first window is ten.
    for i in 1..9 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 0);
    end loop;
    perform test.check(
        (select level from public.v_my_levels where section = 'choukai') = 'J2',
        'nine right answers are not yet a decision');
    insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 0);
    perform test.check(
        (select level from public.v_my_levels where section = 'choukai') = 'J1',
        'the tenth moves 聴解 up: the first window is ten, not twenty');

    -- The headline. One section moving must not drag the other two with it.
    perform test.check(
        (select level from public.v_my_levels where section = 'dokkai') = 'J2'
        and (select level from public.v_my_levels where section = 'choudokkai') = 'J2',
        'and leaves the other two where they were: being good at listening says '
        'nothing about your reading');
    perform test.check((select target_level from public.profiles) = 'J2',
        'the one-line summary is the middle of the three, so one strong section '
        'does not claim the whole learner');

    for i in 1..10 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 0);
    end loop;
    for i in 1..20 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_lvl', 1);
    end loop;
    perform test.check(
        (select level from public.v_my_levels where section = 'choukai') = 'J1',
        'answers at another level do not count: J2 misses leave a J1 section alone');

    -- The other direction, in the other section, on the same rule — and on the
    -- fast window, because the window is counted PER SECTION. Forty answers of
    -- listening are not a record of this person's reading, so 読解 is still being
    -- placed and gets the ten-answer window a beginner gets.
    for i in 1..9 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_dok', 1);
    end loop;
    perform test.check(
        (select level from public.v_my_levels where section = 'dokkai') = 'J2',
        'nine misses are not yet a decision either');
    insert into public.attempts (item_id, chosen_index) values ('itm_dok', 1);
    perform test.check(
        (select level from public.v_my_levels where section = 'dokkai') = 'J3',
        'the tenth moves 読解 down: a section still being placed gets the fast '
        'window, however long the record in another section is');
    perform test.check(
        (select level from public.v_my_levels where section = 'choukai') = 'J1',
        'while the section they are good at stays where it climbed to');
    perform test.check((select target_level from public.profiles) = 'J2',
        'and the summary is still the middle: J1 listening, J2 in between, J3 reading');
end
$$;

reset role;

-- A client that could set its own level would set it to whatever felt
-- comfortable, which is the opposite of what raises a score — and is why there
-- is no level picker in the app either.
do $$
declare
    denied boolean := false;
begin
    raise notice 'nobody sets their own level';
    set local role authenticated;
    begin
        update public.section_levels set level = 'J3' where section = 'choukai';
        denied := (select level from public.v_my_levels where section = 'choukai') = 'J1';
    exception when others then
        denied := true;
    end;
    perform test.check(denied, 'a client cannot move its own section level');

    denied := false;
    begin
        insert into public.section_levels (user_id, section, level)
        values ((select auth.uid()), 'dokkai', 'J1');
        denied := false;
    exception when others then
        denied := true;
    end;
    perform test.check(denied, 'nor write a new one');
    reset role;
end
$$;

delete from public.items where id in ('itm_lvl', 'itm_dok');
delete from public.bundles where id in ('bnd_lvl', 'bnd_dok');

-- ---------------------------------------------------------------------------
-- The spacing ladder, and the shared bank.
--
-- Two mechanisms in one section because they meet in next_items: the ladder
-- decides WHEN an item comes back, and the bank's counts decide which of the
-- unseen ones is worth meeting at all. Both are new surfaces that the wrong
-- party could read or write, so most of what follows is about who cannot.
--
-- Its own user and its own items, deleted at the end. 20_published_test.sql
-- draws from the same J2 pool, and a fixture left behind would turn up in its
-- "first practice set" and fail on a stem that is four characters long.

begin;
-- auth.users belongs to Supabase, not to us: `service_role` has no grant on it
-- here any more than it does in the real project, so the fixture user is
-- created before the role is dropped, exactly as the entitlement test does.
insert into auth.users (id, email, is_anonymous) values
    ('44444444-4444-4444-4444-444444444444', 'd@example.com', false);
insert into public.testers (email) values ('d@example.com');
set local role service_role;
insert into public.bundles (id, item_type, level, generator_model, generated_at) values
    ('bnd_bank', 'goi_bunpou', 'J2', 'author-composed', now());
-- One item the gate found trivial and one it found about right. Nobody has
-- answered either, so model_p_correct is all the queue has to go on — which is
-- exactly the cold-start case it exists for.
insert into public.items (id, bundle_id, item_type, level, topic, stem, correct_index,
                          model_p_correct)
values ('itm_easy', 'bnd_bank', 'goi_bunpou', 'J2', '易しすぎ', '空欄に入るものは。', 0, 1.0),
       ('itm_fit',  'bnd_bank', 'goi_bunpou', 'J2', 'ちょうど', '空欄に入るものは。', 0, 0.7);
insert into public.item_options (item_id, position, text, role, why) values
    ('itm_easy', 0, 'あ', 'correct',              '正解。'),
    ('itm_easy', 1, 'い', 'register_too_casual',  '砕けすぎ。'),
    ('itm_easy', 2, 'う', 'grammar_form_error',   '形が誤り。'),
    ('itm_easy', 3, 'え', 'collocation_error',    '結びつかない。'),
    ('itm_fit',  0, 'か', 'correct',              '正解。'),
    ('itm_fit',  1, 'き', 'register_too_casual',  '砕けすぎ。'),
    ('itm_fit',  2, 'く', 'grammar_form_error',   '形が誤り。'),
    ('itm_fit',  3, 'け', 'collocation_error',    '結びつかない。');
commit;

do $$ begin perform test.become('44444444-4444-4444-4444-444444444444'); end $$;
set role authenticated;

do $$
declare
    r record;
    n integer;
    denied boolean := false;
begin
    raise notice 'difficulty, before anybody has answered';
    -- Both unseen and equally weak, so the only thing separating them is how
    -- hard the gate found them. A giveaway teaches nothing and goes second.
    perform test.check((select id from public.next_items(1)) = 'itm_fit',
        'an unseen set is pitched at the difficulty that teaches, not at the easiest item');

    raise notice 'the spacing ladder';
    insert into public.attempts (item_id, chosen_index) values ('itm_fit', 1);   -- wrong
    select * into r from public.review_schedule where item_id = 'itm_fit';
    perform test.check(r.step = 0, 'a wrong answer puts the item on the bottom rung');
    perform test.check(r.due_at between now() + interval '19 hours'
                                    and now() + interval '21 hours',
        'and brings it back after a night, not immediately and not never');

    insert into public.attempts (item_id, chosen_index) values ('itm_fit', 0);   -- right
    select * into r from public.review_schedule where item_id = 'itm_fit';
    perform test.check(r.step = 1, 'a right answer climbs a rung');
    perform test.check(r.due_at > now() + interval '2 days',
        'so an answer you got right on Tuesday is checked on Friday');

    insert into public.attempts (item_id, chosen_index) values ('itm_fit', 0);   -- right
    select * into r from public.review_schedule where item_id = 'itm_fit';
    perform test.check(r.step = 2, 'and again, further out each time');

    insert into public.attempts (item_id, chosen_index) values ('itm_fit', 2);   -- wrong
    select * into r from public.review_schedule where item_id = 'itm_fit';
    perform test.check(r.step = 0,
        'one wrong answer drops it all the way back rather than one rung — a trap '
        'you still fall for after three weeks is a trap you have not learned');

    begin
        insert into public.review_schedule (user_id, item_id, due_at)
        values ((select auth.uid()), 'itm_easy', now() + interval '10 years');
        denied := false;
    exception when others then
        denied := true;
    end;
    perform test.check(denied, 'a client cannot write its own review schedule');

    denied := false;
    begin
        update public.review_schedule set due_at = now() + interval '10 years';
        denied := (select count(*) from public.review_schedule
                    where due_at > now() + interval '1 year') = 0;
    exception when others then
        denied := true;
    end;
    perform test.check(denied, 'nor push away a due date it does not fancy');

    select count(*) into n from public.v_my_review_load;
    perform test.check(n = 1, 'home gets exactly one row to print, always');
    perform test.check((select tracked from public.v_my_review_load) = 1,
        'and it says how much the ladder is tracking');
end
$$;

do $$
declare
    due_id text;
begin
    raise notice 'a due item comes first';
    set local role service_role;
    update public.review_schedule set due_at = now() - interval '1 hour'
     where user_id = '44444444-4444-4444-4444-444444444444' and item_id = 'itm_fit';
    reset role;
    set local role authenticated;
    perform test.check((select due_now from public.v_my_review_load) = 1,
        'the count home prints follows the ladder');
    select id into due_id from public.next_items(1);
    perform test.check(due_id = 'itm_fit',
        'and the item the ladder says is due beats an unseen one');
    reset role;
end
$$;

do $$
declare
    r record;
    denied boolean := false;
begin
    raise notice 'the shared bank';

    set local role service_role;
    perform public.refresh_item_stats();
    select * into r from public.item_stats where item_id = 'itm_fit';
    perform test.check(r.answered = 4, 'the bank counts every answer, from everybody');
    perform test.check(r.correct = 2 and r.p_correct = 0.5,
        'and the rate is what those answers say, not what anybody hoped');
    reset role;

    set local role authenticated;
    perform test.check(
        (select count(*) from public.v_item_difficulty where item_id = 'itm_fit') = 0,
        'four answers is one person, and an item that thin has no published difficulty');
    reset role;

    set local role service_role;
    update public.item_stats set answered = 12, correct = 9, p_correct = 0.75
     where item_id = 'itm_fit';
    reset role;

    set local role authenticated;
    select * into r from public.v_item_difficulty where item_id = 'itm_fit';
    perform test.check(r.p_correct = 0.75,
        'above the floor it is published — an average over at least eight sittings');

    begin
        perform count(*) from public.item_stats;
        denied := false;
    exception when insufficient_privilege then
        denied := true;
    end;
    perform test.check(denied,
        'but the raw counts behind it stay shut: at this scale they are a person');
    reset role;
end
$$;

reset role;

delete from public.items where id in ('itm_easy', 'itm_fit');
delete from public.bundles where id = 'bnd_bank';
delete from auth.users where id = '44444444-4444-4444-4444-444444444444';

\echo 'ALL LADDER AND BANK TESTS PASSED'

-- ---------------------------------------------------------------------------
-- The pitch: harder questions where you are already good.
--
-- The level moves in three big steps on a week of answers. This is the other
-- half, and the half that moves every time: inside a level, WHICH item of a
-- given problem type the queue reaches for depends on how this learner does at
-- that type. Two learners, the same two unseen items, opposite records — and the
-- queue should hand them opposite items. If it does not, "push harder where they
-- are strong" is a comment rather than a behaviour.

begin;
insert into auth.users (id, email, is_anonymous) values
    ('55555555-5555-5555-5555-555555555555', 'e@example.com', false),
    ('66666666-6666-6666-6666-666666666666', 'f@example.com', false);
insert into public.testers (email) values ('e@example.com'), ('f@example.com');
set local role service_role;
insert into public.bundles (id, item_type, level, generator_model, generated_at) values
    ('bnd_pitch', 'goi_bunpou', 'J2', 'author-composed', now());
-- Three items of one type at one level, sharing a 機能 tag so the weakness term
-- is identical for the two candidates and the only thing left to separate them
-- is difficulty. Different settings, so neither picks up the variety nudge.
insert into public.items (id, bundle_id, item_type, level, setting, function, topic, stem,
                          correct_index, model_p_correct)
values ('itm_drv',  'bnd_pitch', 'goi_bunpou', 'J2', 'set_a', 'request', '練習台', '空欄は。', 0, 0.70),
       ('itm_hard', 'bnd_pitch', 'goi_bunpou', 'J2', 'set_b', 'request', '難しい', '空欄は。', 0, 0.45),
       ('itm_soft', 'bnd_pitch', 'goi_bunpou', 'J2', 'set_c', 'request', 'やさしい', '空欄は。', 0, 0.95);
insert into public.item_options (item_id, position, text, role, why)
select v.id, p.pos, v.id || p.pos, p.role, 'せ'
from (values ('itm_drv'), ('itm_hard'), ('itm_soft')) as v(id)
cross join (values (0, 'correct'), (1, 'register_too_casual'),
                   (2, 'grammar_form_error'), (3, 'collocation_error')) as p(pos, role);
commit;

do $$
declare
    i integer;
begin
    raise notice 'the pitch follows how good you are at the type';

    -- A learner who is good at 語彙・文法. Six answers, all right: enough to move
    -- the accuracy well above the prior, and safely short of the ten that would
    -- promote the section and take the J2 candidates out of the pool.
    perform test.become('55555555-5555-5555-5555-555555555555');
    set local role authenticated;
    for i in 1..6 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_drv', 0);
    end loop;
    perform test.check(
        (select level from public.v_my_levels where section = 'dokkai') = 'J2',
        'six right answers have not moved the section yet, so both candidates '
        'are still in the pool');
    perform test.check((select id from public.next_items(1)) = 'itm_hard',
        'strong at this type: the queue reaches for the item the bank finds hard');
    reset role;

    -- And the same two items, to somebody who keeps getting this type wrong.
    perform test.become('66666666-6666-6666-6666-666666666666');
    set local role authenticated;
    for i in 1..6 loop
        insert into public.attempts (item_id, chosen_index) values ('itm_drv', 1);
    end loop;
    perform test.check((select id from public.next_items(1)) = 'itm_soft',
        'weak at this type: the same two items, and the gentler one comes first');
    reset role;
end
$$;

-- Run it again from scratch a few times. The ranking carries a tie-break random
-- and the whole point of rebalancing its weight was that it must not be able to
-- outvote the pitch; an assertion that passes four times in a row is how that
-- claim stays true rather than merely intended.
do $$
declare
    i integer;
    j integer;
begin
    raise notice 'and it is not the random number talking';
    perform test.become('55555555-5555-5555-5555-555555555555');
    set local role authenticated;
    for j in 1..8 loop
        perform test.check((select id from public.next_items(1)) = 'itm_hard',
            'strong learner still gets the harder item on repeat draw ' || j);
    end loop;
    reset role;

    perform test.become('66666666-6666-6666-6666-666666666666');
    set local role authenticated;
    for j in 1..8 loop
        perform test.check((select id from public.next_items(1)) = 'itm_soft',
            'weak learner still gets the gentler item on repeat draw ' || j);
    end loop;
    reset role;
end
$$;

reset role;

delete from public.items where bundle_id = 'bnd_pitch';
delete from public.bundles where id = 'bnd_pitch';
delete from auth.users where id in ('55555555-5555-5555-5555-555555555555',
                                    '66666666-6666-6666-6666-666666666666');

\echo 'ALL PITCH TESTS PASSED'
