-- One bank for everybody, and a queue that can say why it picked each item.
--
-- The library is a single shared pool: every learner draws from the same
-- published items, and nothing is written for one person. What is personal is
-- the *order*. Two things were missing from that order, and they are the two
-- that decide whether a few hundred items feel like a course or like a shuffle.
--
-- **Nothing brought a right answer back, and a wrong one came back for ever at
-- the same distance.** The old queue retried items you had never got right,
-- twenty hours later, again and again at twenty hours; an item you answered
-- correctly once was never scheduled again. Both halves are wrong. A trap you
-- keep falling into should come back on a widening interval rather than the
-- same one, and an answer you got right on Tuesday is exactly the one worth
-- checking on Friday. `review_schedule` below is a five-rung ladder — 20 hours,
-- 3 days, 1 week, 3 weeks, 2 months — climbed by a correct answer and dropped to
-- the bottom by a wrong one. It is a fixed table of intervals rather than a
-- fitted forgetting curve on purpose: a curve needs calibration these items do
-- not have, and "tomorrow, then in three days, then in a week" is a promise a
-- learner can hold the app to.
--
-- **Nothing knew how hard an item was.** Every unseen item at your level looked
-- alike to the queue, so a set was as likely to open with the hardest 総合聴読解
-- in the library as with something you could actually learn from. Difficulty is
-- not a thing to ask the learner about and not a thing to invent — it is a
-- measurement, and because the bank is shared it can be taken. `item_stats`
-- counts how often each item is answered correctly **across every learner**, and
-- the queue prefers items near a target success rate.
--
-- Read that last paragraph twice, because it is one letter away from the thing
-- this project refuses to do. `p_correct` is a property of an ITEM — how often
-- this question is answered correctly — and it is never shown to anybody. It is
-- not an ability estimate, there is no IRT model behind it, and no number out of
-- 800 can be derived from it. The rule stands: no estimated BJT score, anywhere.

-- --------------------------------------------- what the writer thought it was

-- The answerability gate already answers every generated item three times with
-- the full stimulus, and an item is discarded if a strong model cannot get it
-- right. The rate it passed at is a difficulty estimate we were throwing away.
--
-- Keeping it matters most for the case the shared counts cannot help with: an
-- item published this morning, which nobody has answered yet. Without a prior it
-- would sit at the target forever and be indistinguishable from a well-measured
-- item; with one, the queue starts out approximately right and the bank corrects
-- it as people answer.
--
-- Null for every hand-written reference item, because the gate is the one thing
-- `bjt importbatch` skips. Null is the honest value and the queue treats it as
-- "no opinion", not as "average".
alter table public.items
    add column model_p_correct numeric check (model_p_correct between 0 and 1);

comment on column public.items.model_p_correct is
    'How often the answerability gate answered this item correctly with the full '
    'stimulus, at generation time. A prior on item difficulty for items nobody '
    'has answered yet. Never shown to a learner, and never an ability estimate.';

-- ------------------------------------------------- what the bank has measured

-- Aggregate over every learner. Not a per-user table: the whole point is that
-- one person's answers make the bank better for the next person, which is the
-- only thing in this schema that gets better with scale.
--
-- Refreshed by a job, never on read. Counting a few hundred thousand attempts
-- inside the practice query would put the cost of the whole history on the
-- person waiting for five questions, and the number does not move fast enough
-- to be worth that.
create table public.item_stats (
    item_id    text primary key references public.items (id) on delete cascade,
    answered   integer not null default 0,
    correct    integer not null default 0,
    -- Null until there are enough answers to mean anything. See the view below.
    p_correct  numeric check (p_correct between 0 and 1),
    updated_at timestamptz not null default now()
);

comment on table public.item_stats is
    'How often each item is answered correctly, across all learners. Written by '
    'refresh_item_stats() as the service role; read by the queue through '
    'v_item_difficulty. Not readable by clients — see that view for why.';

alter table public.item_stats enable row level security;
-- No policy at all, and the grants taken away: the raw counts are the one thing
-- in the content schema that is derived from other people's answers. With three
-- users, "answered = 1, correct = 0" is a statement about a person. The public
-- surface is the view below, which only exists above a floor.
revoke all on public.item_stats from anon, authenticated;

-- Below this many answers the rate is noise, and it is also close enough to an
-- individual to be worth not publishing. Eight is both thresholds at once.
create view public.v_item_difficulty as
    select item_id, p_correct
      from public.item_stats
     where answered >= 8
       and p_correct is not null;

-- Deliberately NOT security_invoker. The view runs as its owner so it can read
-- `item_stats`, which no client can; what it exposes is an average over at least
-- eight people and carries no user id. That is the whole reason the table is
-- shut and the view is open.
comment on view public.v_item_difficulty is
    'Per-item success rate, over at least eight answers from different sittings. '
    'A property of the question, never of a person, and never displayed.';

grant select on public.v_item_difficulty to anon, authenticated;

create or replace function public.refresh_item_stats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rows integer;
begin
    -- One pass over every attempt. Cheap at this scale, and simple enough that
    -- there is nothing to get subtly wrong on an incremental path.
    insert into public.item_stats as s (item_id, answered, correct, p_correct, updated_at)
    select a.item_id,
           count(*)::int,
           count(*) filter (where a.is_correct)::int,
           count(*) filter (where a.is_correct)::numeric / count(*),
           now()
      from public.attempts a
     group by a.item_id
    on conflict (item_id) do update
       set answered   = excluded.answered,
           correct    = excluded.correct,
           p_correct  = excluded.p_correct,
           updated_at = excluded.updated_at;
    get diagnostics v_rows = row_count;
    return v_rows;
end;
$$;

comment on function public.refresh_item_stats is
    'Recount the shared bank''s per-item success rates. Run by the nightly job '
    'as the service role; never on the practice path.';

-- Service role only. It reads every attempt in the database, which is precisely
-- what no client may do.
revoke execute on function public.refresh_item_stats() from public, anon, authenticated;

-- ------------------------------------------------------------ the spacing ladder

-- Rungs, in the order they are climbed. Fixed, short, and legible: this is the
-- promise the result screen makes on the app's behalf.
create or replace function public.review_interval(p_step smallint)
returns interval
language sql
immutable
set search_path = ''
as $$
    select (array[
        interval '20 hours',   -- 0: a miss. Tonight's sleep, then again.
        interval '3 days',     -- 1
        interval '7 days',     -- 2
        interval '21 days',    -- 3
        interval '60 days'     -- 4: known. Checked twice a term.
    ])[least(greatest(p_step, 0), 4) + 1];
$$;

-- A pure lookup, not part of the app's API. It leaks nothing, but the rule from
-- 20260914000100 holds: a function that no client needs should not have a door
-- in the wall. schedule_review() is `security definer` and calls it as its
-- owner, so the triggers are unaffected.
revoke execute on function public.review_interval(smallint) from public, anon, authenticated;

create table public.review_schedule (
    user_id uuid not null references auth.users (id) on delete cascade,
    item_id text not null references public.items (id) on delete cascade,
    due_at  timestamptz not null,
    -- Which rung. A wrong answer sends it back to 0 rather than down one: a trap
    -- you fall into after three weeks is a trap you have not learned, and
    -- pretending otherwise is how a leech stays in the deck for a year.
    step    smallint not null default 0 check (step between 0 and 4),
    last_at timestamptz not null default now(),
    primary key (user_id, item_id)
);

create index review_schedule_due_idx on public.review_schedule (user_id, due_at);

comment on table public.review_schedule is
    'When each item is next worth meeting again, per learner. Maintained by a '
    'trigger on attempts; the client never writes it.';

alter table public.review_schedule enable row level security;

create policy "own schedule is readable" on public.review_schedule
    for select to authenticated using ((select auth.uid()) = user_id);
-- No write policy, on the same principle as `attempts`: the schedule is a
-- consequence of answers, and a client that could move a due date could make
-- the app tell it what it wanted to hear.

create or replace function public.schedule_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_step smallint;
begin
    select r.step into v_step
      from public.review_schedule r
     where r.user_id = new.user_id and r.item_id = new.item_id;

    if new.is_correct then
        v_step := least(coalesce(v_step, -1) + 1, 4);
    else
        v_step := 0;
    end if;

    insert into public.review_schedule (user_id, item_id, due_at, step, last_at)
    values (new.user_id, new.item_id,
            new.answered_at + public.review_interval(v_step), v_step, new.answered_at)
    on conflict (user_id, item_id) do update
       set due_at  = excluded.due_at,
           step    = excluded.step,
           last_at = excluded.last_at;
    return new;
end;
$$;

create trigger schedule_review_after_insert
    after insert on public.attempts
    for each row execute function public.schedule_review();

revoke execute on function public.schedule_review() from public, anon, authenticated;

-- Everyone who has already answered something gets a schedule, walked forward
-- through their attempts in order so the rung they land on is the one they
-- earned. Without this the ladder would start empty and every item anybody has
-- ever answered would look unseen to the review bucket.
do $$
declare
    a record;
    v_step smallint;
begin
    for a in
        select user_id, item_id, is_correct, answered_at
          from public.attempts
         order by user_id, item_id, answered_at, id
    loop
        select r.step into v_step
          from public.review_schedule r
         where r.user_id = a.user_id and r.item_id = a.item_id;
        if a.is_correct then
            v_step := least(coalesce(v_step, -1) + 1, 4);
        else
            v_step := 0;
        end if;
        insert into public.review_schedule (user_id, item_id, due_at, step, last_at)
        values (a.user_id, a.item_id,
                a.answered_at + public.review_interval(v_step), v_step, a.answered_at)
        on conflict (user_id, item_id) do update
           set due_at = excluded.due_at, step = excluded.step, last_at = excluded.last_at;
    end loop;
end
$$;

-- ------------------------------------------------------------- what home says

-- One number, so the app's single sentence on the home screen can say "three
-- are due" rather than implying it. Everything else about the schedule stays
-- behind the queue.
create view public.v_my_review_load
with (security_invoker = on) as
select
    count(*) filter (where r.due_at <= now())::int as due_now,
    count(*)::int                                  as tracked,
    min(r.due_at) filter (where r.due_at > now())  as next_due_at
from public.review_schedule r;

-- ------------------------------------------------------------------ the queue

-- Same signature, same columns. What changed is the ordering, and it is still
-- four buckets you can read out loud:
--
--   0. due     — items the ladder says are due today, most overdue first, at any
--                level: a J3 item you met before a promotion is still an item
--                you got wrong. Capped at two fifths of the set, so a backlog
--                after a week away cannot crowd out everything new.
--   1. fresh   — unseen items at your level, weakest ground first, spread across
--                problem types and settings (below).
--   2. stretch — exactly one unseen item from the level above, when the set is
--                five or more. adjust_level() ignores it, so it can never cost a
--                promotion.
--   3. rest    — everything else at your level, then the adjacent levels, so a
--                thin level still fills a set instead of ending it early.
--
-- "Weakest ground" is now three things rather than two, and all three are
-- arithmetic anybody can check:
--
--   * **The 機能 tag you score worst on**, smoothed and aged. Smoothed because a
--     single miss on a tag used to read as 0% and drag the whole set onto it:
--     the rate is (right + 1) / (answered + 2), which starts a new tag at 50%
--     and needs real evidence to move. Aged because a habit you broke in March
--     is not today's weakness: every answer is weighted by a 30-day half-life,
--     so last week counts roughly five times what last quarter does.
--   * **The traps that keep catching you**, aged the same way. An unseen item
--     containing a distractor whose role has caught this person before is pulled
--     forward — six points of accuracy per prior catch, capped at five catches,
--     so one bad habit can move an item up a band but cannot take over a set.
--     The correct option is excluded from that match: its role is the role of a
--     right answer, and counting it would rank items by how often the learner
--     answered correctly.
--   * **How hard the item is for everybody else.** Items whose measured success
--     rate sits near TARGET_P are preferred; the further off, the further back.
--     Too easy teaches nothing and too hard teaches nothing, and now that the
--     bank has counted, the queue does not have to guess.
--
-- And two nudges for variety, which are the reason a set of five from a library
-- that is 40% one problem type is not five of that type:
--
--   * the second item of a problem type in one set is pushed back by 0.15, the
--     third by 0.30, and so on — enough to lose to any other type that is close,
--     not enough to serve nothing when the bank has only one type published;
--   * the same for 場面, at a third of the weight, because two questions in a
--     row set at the same reception desk are monotonous rather than wrong.
create or replace function public.next_items(p_limit integer default 5)
returns table (
    id                text,
    item_type         text,
    level             text,
    topic             text,
    stem              text,
    scene_id          text,
    scene_image_path  text,
    speaker_role      text,
    listener_role     text,
    channel           text,
    seed_cell_id      text,
    correct_index     smallint,
    explanation_ja    text,
    explanation_en    text,
    vocab_notes       jsonb,
    documents         jsonb,
    dialogue          jsonb,
    narration_clip_id text,
    narration_path    text,
    options           jsonb,
    times_seen        integer
)
language sql
stable
security invoker
set search_path = ''
as $$
    with uid as (
        select (select auth.uid()) as id
    ),
    ladder as (
        select t.level,
               case t.level when 'J3' then 'J2' when 'J2' then 'J1' end as up,
               case t.level when 'J1' then 'J2' when 'J2' then 'J3' end as down
        from (
            select coalesce(
                (select p.target_level from public.profiles p where p.id = (select id from uid)),
                'J2'
            ) as level
        ) t
    ),
    seen as (
        select a.item_id,
               count(*)::int              as times_seen,
               bool_or(a.is_correct)      as ever_correct,
               max(a.answered_at)         as last_at
        from public.attempts a
        where a.user_id = (select id from uid)
        group by a.item_id
    ),
    -- Every answer, with its age already turned into a weight. 30-day half-life:
    -- today counts 1, a month ago counts 0.5, a quarter ago counts 0.125.
    weighted as (
        select a.item_id,
               a.is_correct,
               a.chosen_role,
               power(0.5, extract(epoch from now() - a.answered_at) / (30 * 86400)) as w
        from public.attempts a
        where a.user_id = (select id from uid)
    ),
    tag_accuracy as (
        select i.function as function,
               (coalesce(sum(w.w) filter (where w.is_correct), 0) + 1) / (sum(w.w) + 2) as accuracy
        from weighted w
        join public.items i on i.id = w.item_id
        where i.function is not null
        group by i.function
    ),
    traps as (
        select w.chosen_role as role, sum(w.w) as times
        from weighted w
        where not w.is_correct
          and w.chosen_role <> ''
        group by w.chosen_role
    ),
    trap_fit as (
        select o.item_id, sum(t.times)::numeric as weight
        from public.item_options o
        join public.items i on i.id = o.item_id
        join traps t on t.role = o.role
        where i.is_published
          and o.position <> i.correct_index
        group by o.item_id
    ),
    pool as (
        select i.id, i.level, i.item_type, i.setting,
               s.item_id is not null              as is_seen,
               coalesce(s.ever_correct, false)    as ever_correct,
               s.last_at,
               -- Lower is more urgent. The tag you are worst at, pulled forward
               -- by every trap in this item that has caught you before, pushed
               -- back by how far the item is from the difficulty that teaches.
               coalesce(ta.accuracy, 0.5)
                   - least(coalesce(tf.weight, 0), 5) * 0.06
                   + abs(coalesce(d.p_correct, i.model_p_correct, 0.7) - 0.7) * 0.25
                   as weakness
        from public.items i
        left join seen s on s.item_id = i.id
        left join tag_accuracy ta on ta.function = i.function
        left join trap_fit tf on tf.item_id = i.id
        left join public.v_item_difficulty d on d.item_id = i.id
        where i.is_published
          and i.level in ((select l.level from ladder l), (select l.up from ladder l), (select l.down from ladder l))
    ),
    -- Read straight from `items` rather than from `pool`: a J3 item that caught
    -- you before a promotion is still an item that caught you, and the level
    -- window has no business hiding it on the day it comes due.
    due as (
        select i.id, 0 as bucket, extract(epoch from r.due_at) as rank
        from public.review_schedule r
        join public.items i on i.id = r.item_id
        where r.user_id = (select id from uid)
          and r.due_at <= now()
          and i.is_published
        order by r.due_at
        limit greatest(1, (p_limit * 2) / 5)
    ),
    stretch as (
        select p.id, 2 as bucket, random() as rank
        from pool p
        where p_limit >= 5
          and p.level = (select l.up from ladder l)
          and not p.is_seen
        order by random()
        limit 1
    ),
    -- The variety nudges. Ranking first by weakness inside each partition means
    -- the FIRST item of a type is the best one of that type, and it is the
    -- second and third copies that get pushed back.
    fresh_ranked as (
        select p.id,
               p.weakness
                   + (row_number() over (partition by p.item_type
                                             order by p.weakness, p.id) - 1) * 0.15
                   + (row_number() over (partition by coalesce(p.setting, p.id)
                                             order by p.weakness, p.id) - 1) * 0.05
                   + random() / 12 as rank
        from pool p
        where p.level = (select l.level from ladder l)
          and not p.is_seen
    ),
    fresh as (
        select f.id, 1 as bucket, f.rank
        from fresh_ranked f
        order by f.rank
        limit greatest(p_limit - (select count(*) from due) - (select count(*) from stretch), 1)
    ),
    rest as (
        select p.id,
               case when p.level = (select l.level from ladder l) then 3 else 4 end as bucket,
               -- Caught-you-before first, then the level above before the one
               -- below, then longest ago; the noise only breaks ties.
               case when p.ever_correct then 1 else 0 end
                   + case when p.level = (select l.down from ladder l) then 0.5 else 0 end
                   + coalesce(extract(epoch from p.last_at), 0) / 1e12 + random() / 1e6 as rank
        from pool p
    ),
    chosen as (
        select distinct on (u.id) u.id, u.bucket, u.rank
        from (
            select * from due
            union all select * from fresh
            union all select * from stretch
            union all select * from rest
        ) u
        order by u.id, u.bucket, u.rank
    )
    select
        i.id, i.item_type, i.level, i.topic, i.stem, i.scene_id,
        (select s.image_path from public.scenes s where s.id = i.scene_id) as scene_image_path,
        i.speaker_role, i.listener_role, i.channel, i.seed_cell_id,
        i.correct_index, i.explanation_ja, i.explanation_en, i.vocab_notes,
        i.documents,
        (
            select coalesce(
                jsonb_agg(
                    turn || jsonb_build_object(
                        'audio_path',
                        (select c.audio_path from public.audio_clips c
                          where c.id = turn ->> 'clip_id')
                    )
                    order by idx
                ),
                '[]'::jsonb
            )
            from jsonb_array_elements(i.dialogue) with ordinality as t(turn, idx)
        ) as dialogue,
        i.narration_clip_id,
        (select c.audio_path from public.audio_clips c where c.id = i.narration_clip_id) as narration_path,
        (
            select jsonb_agg(
                       jsonb_build_object(
                           'position',   o.position,
                           'text',       o.text,
                           'role',       o.role,
                           'why',        o.why,
                           'clip_id',    o.clip_id,
                           'audio_path', c.audio_path
                       )
                       order by o.position
                   )
            from public.item_options o
            left join public.audio_clips c on c.id = o.clip_id
            where o.item_id = i.id
        ) as options,
        coalesce(s.times_seen, 0) as times_seen
    from chosen ch
    join public.items i on i.id = ch.id
    left join seen s on s.item_id = i.id
    order by ch.bucket, ch.rank
    limit greatest(p_limit, 0);
$$;

comment on function public.next_items is
    'The practice queue, and the only one: items the spacing ladder says are due, '
    'unseen items aimed at your weakest tag and the traps you keep falling for and '
    'pitched near the difficulty that teaches, one stretch item from the level '
    'above, then the rest — spread across problem types so a set is not five of '
    'the same thing. Takes a size; decides everything else from the record.';
