-- The published content, seen the way the app sees it.
--
-- The bundle checks prove the items are good. This proves the *publish* is good:
-- that `bjt publish` output applies, that re-applying it does not duplicate
-- anything, and that a brand-new tester can pull a real practice set out of the
-- database in one call and get everything the screen needs.

\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email, is_anonymous) values
    ('33333333-3333-3333-3333-333333333333', 'c@example.com', false);
insert into public.testers (email) values ('c@example.com');

do $$ begin perform test.become('33333333-3333-3333-3333-333333333333'); end $$;
set role authenticated;

do $$
declare
    v record;
    n int;
begin
    raise notice 'published content';
    select count(*) into n from public.items where bundle_id = 'hatsugen_choukai_J2_001';
    perform test.check(n = 10, 'all ten reference items published');

    select count(*) into n from public.item_options
     where item_id in (select id from public.items where bundle_id = 'hatsugen_choukai_J2_001');
    perform test.check(n = 40, 'four options each, and no leftovers from a re-publish');

    -- Scoped to this bundle: the schema test put its own fixtures in the same
    -- database, and a count over the whole table would be counting those too.
    create temporary view bundle_clips as
        select c.* from public.audio_clips c
         where c.id in (
            select i.narration_clip_id from public.items i where i.bundle_id = 'hatsugen_choukai_J2_001'
            union
            select o.clip_id from public.item_options o
              join public.items i on i.id = o.item_id
             where i.bundle_id = 'hatsugen_choukai_J2_001');

    select count(*) into n from bundle_clips;
    perform test.check(n = 50, 'the audio manifest landed as clip rows');

    perform test.check(
        (select count(*) from bundle_clips where audio_path is not null) = 0,
        'no clip claims a file yet — the app must cope with text-only items');

    select count(distinct scene_id) into n from public.items
     where bundle_id = 'hatsugen_choukai_J2_001' and scene_id is not null;
    perform test.check(n = 8, 'eight scenes carry ten items');

    perform test.check(
        (select count(*) from public.items i
          where not exists (select 1 from public.item_options o
                             where o.item_id = i.id and o.position = i.correct_index)) = 0,
        'every item''s correct_index points at a real option');

    perform test.check(
        (select count(*) from public.item_options o
           join public.items i on i.id = o.item_id
          where i.bundle_id = 'hatsugen_choukai_J2_001' and o.why = '') = 0,
        'every published option carries its why');
end
$$;

do $$
declare
    v record;
    q record;
begin
    raise notice 'a first practice set';
    select count(*) as n into v from public.next_items(5);
    perform test.check(v.n = 5, 'a new user gets a full set of five');

    -- What is true of every item, whatever type it is.
    select * into q from public.next_items(5) limit 1;
    perform test.check(q.times_seen = 0, 'all of them unseen');
    perform test.check(jsonb_array_length(q.options) = 4, 'with four options attached');
    perform test.check(q.options -> 0 ->> 'why' is not null, 'and the why for each');
    perform test.check(q.options -> 0 ? 'audio_path',
                       'the option audio paths ride along, so five items are one request');

    -- And what is true only of some. These used to be asserted on whatever
    -- item came back first, which worked while the library was one listening
    -- type and started failing the moment it was nine: a 語彙・文法 stem is one
    -- short sentence and has no narration at all, by design.
    select * into q from public.next_items(50) where item_type = 'hatsugen_choukai' limit 1;
    perform test.check(length(q.stem) > 20, 'a narrated stem is long enough to set up a situation');
    perform test.check(q.narration_clip_id is not null,
                       'and carries the clip id its audio will be filed under');
    perform test.check(q.narration_path is null,
                       'with no audio path yet — the screen falls back to the text');

    select * into q from public.next_items(50) where item_type = 'sougou_dokkai' limit 1;
    perform test.check(q.narration_clip_id is null,
                       'a reading item has no narration, and says so with a null rather than a gap');
    perform test.check(jsonb_array_length(q.documents) = 1,
                       'and arrives with the document it is about');

    select * into q from public.next_items(50) where item_type = 'sougou_choukai' limit 1;
    perform test.check(jsonb_array_length(q.dialogue) >= 3,
                       'a conversation item arrives with its turns');

    -- Five different questions, not the same one five times.
    perform test.check(
        (select count(distinct id) from public.next_items(5)) = 5,
        'a set of five is five distinct items');

    -- ...and not five of the same KIND either, which is the failure this
    -- library invites: 発言聴解 has four times as many items as anything else,
    -- so a queue that only ranks by weakness would serve it five times over. The
    -- per-type penalty in next_items is what stops that, and this is the
    -- assertion that notices if somebody takes it out.
    perform test.check(
        (select count(distinct item_type) from public.next_items(5)) >= 4,
        'a set of five spreads across problem types rather than drilling one');

    -- The smart set: four at your level and one from the level above, so the
    -- app is always quietly asking a harder question than it has to.
    perform test.check(
        (select count(*) from public.next_items(5) where level = 'J1') = 1
        and (select count(*) from public.next_items(5) where level = 'J2') = 4,
        'a daily set of five carries exactly one stretch item from the level above');
    perform test.check(
        (select count(*) from public.next_items(5) where level = 'J3') = 0,
        'and never reaches down a level while there is unseen content at this one');
end
$$;

-- Answer the whole set the way the app does, then check the weakness profile is
-- actually usable rather than merely present.
do $$
declare
    r record;
    sess uuid;
    n integer;
begin
    raise notice 'a full session';
    insert into public.practice_sessions (user_id)
    values ((select auth.uid())) returning id into sess;

    -- A real set: whatever the queue serves at this user's level, across
    -- however many types have content there.
    --
    -- Three right and two wrong, and this time actually deterministically. It
    -- used to flip a coin per item, which meant roughly one run in thirty-two
    -- answered all five correctly, left no trap on the record, and failed the
    -- last assertion in this file for no reason anybody could reproduce.
    n := 0;
    for r in select id, correct_index from public.next_items(5) loop
        n := n + 1;
        insert into public.attempts (session_id, item_id, chosen_index)
        values (sess, r.id,
                case when n <= 3 then r.correct_index
                     else (r.correct_index + 1) % 4 end);
    end loop;

    update public.practice_sessions set finished_at = now() where id = sess;

    perform test.check((select count(*) from public.attempts) = 5, 'five answers recorded');
    perform test.check(
        (select count(*) from public.attempts where session_id = sess) = 5,
        'all five belong to the session');
    -- Across types, not within one. The published pool used to be a single
    -- item type, so a set of five was five 発言聴解 items and the radar had one
    -- row to check. It is nine types now, a set is drawn from all of them, and
    -- an assertion pinned to one type was asserting the library had not grown.
    perform test.check(
        (select coalesce(sum(answered), 0) from public.v_my_type_stats) = 5,
        'the radar picks them up immediately, whichever types they came from');
    perform test.check(
        (select count(*) from public.v_my_type_stats) = 10,
        'and still reports all ten types, including the ones not answered yet');
    perform test.check(public.my_streak() = 1, 'and the streak starts');
    perform test.check(
        (select count(*) from public.v_my_tag_stats where axis = 'function') > 0,
        'the finer tags are populated too, from the seed cell the item came from');

    -- The point of all of it: after one session the queue has an opinion, and it
    -- is aimed at the traps that just caught this person rather than at random
    -- unseen content.
    perform test.check(
        (select count(*) from public.next_items(5)) > 0,
        'the queue still has something to serve after a full set');

    -- The five just answered are the last thing the queue should reach for:
    -- nothing is due for twenty hours, and every unseen item in the window —
    -- at this level, above it, or below it — comes first. A thousand is asked
    -- for and ten come back: the day allows fifteen and five are spent, and
    -- with a bank this size none of the ten is one of the five.
    perform test.check(
        (select count(*) from public.next_items(1000)) = 10
        and (select count(*) from public.next_items(1000) where times_seen > 0) = 0,
        'the door sizes the set to what the day has left, and none of it is a repeat');

    -- The record the screen shows is the record the queue uses. Everything was
    -- answered a moment ago, so the recent figures equal the lifetime ones.
    perform test.check(
        (select count(*) from public.v_my_type_stats where recent_answered > answered) = 0
        and (select coalesce(sum(recent_answered), 0) from public.v_my_type_stats) = 5,
        'the radar counts the recent answers, and never more than the lifetime ones');
    perform test.check(
        (select count(*) from public.v_my_type_stats
          where answered > 0
            and (recent_accuracy is null or recent_accuracy not between 0 and 1
                 or abs(recent_accuracy - accuracy) > 0.001)) = 0
        and (select count(*) from public.v_my_type_stats
              where answered = 0 and recent_accuracy is not null) = 0,
        'recent accuracy is a share, matches the lifetime one when everything is recent, '
        'and is null for a type never answered');
    perform test.check(
        (select count(*) from public.v_my_tag_stats
          where recent_answered > answered
             or recent_accuracy not between 0 and 1
             or abs(recent_accuracy - accuracy) > 0.001) = 0,
        'the tag view carries the same two figures, per tag');
    perform test.check(
        (select count(*) from public.v_my_role_traps) > 0
        and (select count(*) from public.v_my_role_traps where recent_times <> times_chosen) = 0,
        'the trap view counts recent catches, and today they are all of them');
    perform test.check(
        (select count(*) from public.next_items(50) n
          join public.item_options o on o.item_id = n.id and o.position <> n.correct_index
         where o.role in (select chosen_role from public.attempts
                           where not is_correct and chosen_role <> '')) > 0,
        'and it serves items carrying the traps that have caught them');
end
$$;

-- ---------------------------------------------------------- 画像把握 waits

-- A picture item is published like any other, but the queue withholds it
-- until its picture exists: the picture is the question, and an item with no
-- picture would be four descriptions of nothing.
do $$
declare
    n int;
begin
    raise notice 'a picture item waits for its picture';
    select count(*) into n from public.items where item_type = 'gazou_haaku' and is_published;
    perform test.check(n = 4, 'the reference batch of 画像把握 is published');
    perform test.check(
        (select count(*) from public.scenes s
           join public.items i on i.scene_id = s.id
          where i.item_type = 'gazou_haaku' and s.image_path is null) = 4,
        'each with a scene of its own, and no picture yet');
    perform test.check(
        (select count(*) from public.next_items(1000) where item_type = 'gazou_haaku') = 0,
        'and none of them is served without it');
    perform test.check(
        (select bool_and(needs_picture) from public.item_types where id = 'gazou_haaku')
        and (select count(*) from public.item_types where needs_picture) = 1,
        'because the type, and only this type, says the picture is the stimulus');
end
$$;

reset role;

-- The scene job points the database at one picture (the service role does
-- this from the workflow); that item, and only that item, becomes servable.
-- The tester's ceiling is lifted for the check, so the whole eligible pool
-- comes back rather than the five the day has left.
update public.scenes set image_path = id || '.webp'
 where id = (select scene_id from public.items where item_type = 'gazou_haaku'
              order by id limit 1);
update public.testers set unlimited = true where email = 'c@example.com';

do $$ begin perform test.become('33333333-3333-3333-3333-333333333333'); end $$;
set role authenticated;

do $$
begin
    perform test.check(
        (select count(*) from public.next_items(1000) where item_type = 'gazou_haaku') = 1
        and (select count(*) from public.next_items(1000)
              where item_type = 'gazou_haaku' and scene_image_path is null) = 0,
        'once its picture exists the item is served, with the picture');
end
$$;

reset role;

\echo 'ALL PUBLISHED-CONTENT TESTS PASSED'
