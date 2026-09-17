-- The queue keeps its promises.
--
-- Nothing here is a new idea. Every mechanism below already existed — the
-- spacing ladder, the per-section level, the difficulty pitch, the trap term,
-- the two-fifths cap on due items — and every one of them had a gap between
-- what its comment said and what its arithmetic did. Eight of those gaps, each
-- small enough to have survived review, and together enough that a learner who
-- did everything right would have been served the wrong set. This migration
-- closes them, and it changes no signature, no policy and no column anybody
-- already reads.
--
--   A. **The rest bucket re-served items answered minutes ago.** Once due, fresh
--      and stretch were exhausted, "the rest" ranked every at-level item above
--      every adjacent-level one, seen or not — so an item answered this morning
--      came back before an unseen item from the level below. Now: unseen first,
--      whatever its level; then seen items whose answer is at least a night
--      old; and only when nothing else exists, what was answered today.
--
--   B. **Promotions were judged on repeats.** adjust_level() counted every
--      attempt at the level, including a due item the learner had already met
--      with its explanation. Ten rights on a question you have read the answer
--      to is not evidence you have outgrown the level. The window now counts
--      only FIRST attempts at an item.
--
--   C. **The app could not tell a placed level from a default.** Every section
--      starts at J2, and the screen had no way to say whether that J2 was a
--      finding or a starting point. `section_levels.moves` counts moves, and
--      `v_my_levels.placed` says whether the database can vouch for the level.
--
--   D. **No difficulty ranked as perfect difficulty.** An item with no measured
--      rate and no gate prior took the target as its rate, paid nothing, and so
--      outranked every item the bank had actually measured. "No opinion" now
--      costs a neutral penalty, so a measured item at the target beats it.
--
--   E. **The due backlog only grew.** The cap held due items to two fifths of
--      every set, including the sets a learner asks for AFTER meeting the day's
--      goal. Those extra sets are exactly where a backlog should be cleared, so
--      once the goal is met the cap rises to four fifths.
--
--   F. **Elapsed time was recorded and never used.** A right answer that took
--      more than two minutes is not a known item, and climbing a rung on it
--      pushed the next meeting out to a week on the strength of a guess. It
--      holds its rung now.
--
--   G. **The trap term barely discriminated.** The common distractor roles are
--      in most items, so nearly every item got the same boost and the term was
--      mostly a constant. Each caught role is now weighted by how rare it is
--      across the bank: a role in every item says nothing about which item to
--      pick, and a role in one item in three says a lot.
--
--   H. **The record could not show what the queue was using.** The stats views
--      reported lifetime counts, while the queue reasons on a 30-day half-life.
--      They now carry the recent figures too, so a screen can show a person the
--      same weakness the queue is acting on.
--
-- Everything is still arithmetic over rows this database already has. No model
-- is consulted at practice time, nothing is added that answers a non-tester,
-- and every view stays security_invoker.

-- --------------------------------------------------------- C: moves, counted

-- One integer, bumped on every move. A promotion and a demotion count alike:
-- either is evidence the database has watched this section long enough to
-- have an opinion, which is what `placed` below is asking.
alter table public.section_levels
    add column moves integer not null default 0;

comment on column public.section_levels.moves is
    'How many times adjust_level() has moved this section, in either direction. '
    'Zero means the level is still the starting default.';

-- ------------------------------------------ D: the prior, described honestly

-- The gate is a strong model and finds most items easy; the difficulty model,
-- when one is configured (BJT_DIFFICULTY_MODEL), is a weaker one whose success
-- rate is a better proxy for a learner's. Either way the column means the same
-- thing, and the two things it is not still hold.
comment on column public.items.model_p_correct is
    'The share of full-stimulus trials answered correctly at generation time, '
    'measured by the difficulty model (BJT_DIFFICULTY_MODEL, a weaker model than '
    'the gate) when one ran, else by the answerability gate. A prior on item '
    'difficulty for items nobody has answered yet. Never shown to a learner, and '
    'never an ability estimate.';

-- ------------------------------------------- B, C: the level, on first sight

-- Same rule, same thresholds, same section scoping. The one change is WHICH
-- attempts are in the window: the first attempt at each item by this learner,
-- and never a later one. A due item comes back with its explanation already
-- read; counting the second answer would let a learner promote themselves by
-- clearing a backlog, and demote themselves by fumbling one.
--
-- "First" is decided by (answered_at, id), so two answers in the same instant
-- still have an order and exactly one of them counts.
create or replace function public.adjust_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_section text;
    v_level   text;
    v_since   timestamptz;
    v_window  integer;
    v_total   integer;
    v_correct integer;
    v_next    text;
    v_overall text;
begin
    select it.section
      into v_section
      from public.items i
      join public.item_types it on it.id = i.item_type
     where i.id = new.item_id;
    if v_section is null then
        return new;
    end if;

    -- The very first answer seeds all three sections at once, not just the one
    -- it belongs to. Seeding lazily, section by section, would mean a learner who
    -- had climbed to J1 on reading alone met 聴解 for the first time already at
    -- J1 — handed hard listening on the strength of their reading, which is the
    -- exact mistake the per-section level exists to stop. It also keeps the
    -- table complete, so the summary below is a median of three and never of two.
    insert into public.section_levels (user_id, section, level)
    select new.user_id, s.section,
           coalesce((select p.target_level from public.profiles p where p.id = new.user_id), 'J2')
    from (values ('choukai'), ('choudokkai'), ('dokkai')) as s(section)
    on conflict (user_id, section) do nothing;

    select sl.level, sl.changed_at
      into v_level, v_since
      from public.section_levels sl
     where sl.user_id = new.user_id and sl.section = v_section;

    -- Ten to start with, twenty once there is a record IN THIS SECTION — a
    -- record of first attempts, because a repeat is not a new fact about the
    -- learner. Counting the whole history here would make a strong reader's
    -- 読解 answers decide how carefully their 聴解 is judged.
    select case when count(*) < 20 then 10 else 20 end
      into v_window
      from public.attempts a
      join public.items i on i.id = a.item_id
      join public.item_types it on it.id = i.item_type
     where a.user_id = new.user_id
       and it.section = v_section
       and not exists (
               select 1 from public.attempts b
                where b.user_id = a.user_id
                  and b.item_id = a.item_id
                  and (b.answered_at, b.id) < (a.answered_at, a.id));

    select count(*), count(*) filter (where recent.is_correct)
      into v_total, v_correct
      from (
        select a.is_correct
          from public.attempts a
          join public.items i on i.id = a.item_id
          join public.item_types it on it.id = i.item_type
         where a.user_id = new.user_id
           and it.section = v_section
           and a.answered_at >= v_since
           and i.level = v_level
           and not exists (
                   select 1 from public.attempts b
                    where b.user_id = a.user_id
                      and b.item_id = a.item_id
                      and (b.answered_at, b.id) < (a.answered_at, a.id))
         order by a.answered_at desc, a.id desc
         limit v_window
      ) recent;

    if v_total >= v_window then
        if v_correct * 10 >= v_window * 8 then
            v_next := case v_level when 'J3' then 'J2' when 'J2' then 'J1' end;
        elsif v_correct * 10 <= v_window * 4 then
            v_next := case v_level when 'J1' then 'J2' when 'J2' then 'J3' end;
        end if;
    end if;

    if v_next is not null then
        update public.section_levels
           set level = v_next, changed_at = now(), moves = moves + 1
         where user_id = new.user_id and section = v_section;
    end if;

    -- `profiles.target_level` stays, as the one-line summary: the middle of the
    -- three. It is what a screen with room for one number shows, and it is not
    -- what decides anything — section_levels above is.
    select sl.level into v_overall
      from public.section_levels sl
     where sl.user_id = new.user_id
     order by case sl.level when 'J3' then 0 when 'J2' then 1 else 2 end
     offset 1 limit 1;

    if v_overall is not null then
        update public.profiles
           set target_level     = v_overall,
               level_changed_at = case when target_level is distinct from v_overall
                                       then now() else level_changed_at end,
               updated_at       = now()
         where id = new.user_id
           and target_level is distinct from v_overall;
    end if;
    return new;
end;
$$;

comment on function public.adjust_level is
    'Move the level of the section this answer belongs to, on the last ten '
    'first attempts in that section at that level to begin with and the last '
    'twenty once there is a record. A repeat of an item never counts. Three '
    'sections, one rule.';

-- Same three rows, one more column. `placed` is true when the database itself
-- has the evidence to name the level: the section has moved at least once, or
-- it has the ten first attempts at the current level that adjust_level() would
-- judge a move on. Until then the J2 on screen is a starting point, and the
-- screen may say so. A section with no row yet is a starting point by
-- definition.
--
-- The count is adjust_level()'s own window sense, restated: first attempts, in
-- this section, at this level, since the level last changed.
create or replace view public.v_my_levels
with (security_invoker = on) as
select s.section,
       coalesce(sl.level, 'J2')       as level,
       coalesce(sl.changed_at, now()) as changed_at,
       coalesce(sl.moves, 0) > 0
       or (
           select count(*)
             from public.attempts a
             join public.items i on i.id = a.item_id
             join public.item_types it on it.id = i.item_type
            where a.user_id = (select auth.uid())
              and it.section = s.section
              and i.level = sl.level
              and a.answered_at >= sl.changed_at
              and not exists (
                      select 1 from public.attempts b
                       where b.user_id = a.user_id
                         and b.item_id = a.item_id
                         and (b.answered_at, b.id) < (a.answered_at, a.id))
       ) >= 10                         as placed
from (values ('choukai'), ('choudokkai'), ('dokkai')) as s(section)
left join public.section_levels sl
       on sl.user_id = (select auth.uid()) and sl.section = s.section;

comment on view public.v_my_levels is
    'The three levels being served, one per exam section, and whether each is '
    'placed — moved at least once, or judged on ten first attempts — or still '
    'the starting default. A fact about the questions, not a prediction about '
    'the learner.';

-- ------------------------------------------------- F: a slow right answer holds

-- Two minutes is generous on purpose. The clock the client sends covers the
-- whole item — the scene, the listening stage, the reading of four options —
-- and a 総合聴読解 item honestly takes a minute. A right answer that still took
-- longer than two was not known; it was worked out, or guessed, and either way
-- the next meeting should be at the same distance as the last, not a rung
-- further out. A null elapsed_ms — an older client, or a clock that failed —
-- climbs as before: absence of evidence is not slowness.
--
-- Wrong still drops to the bottom, whatever the clock says.
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

    if not new.is_correct then
        v_step := 0;
    elsif coalesce(new.elapsed_ms, 0) > 120000 then
        -- Held: the rung it was on, or the bottom rung for a first meeting.
        v_step := coalesce(v_step, 0);
    else
        v_step := least(coalesce(v_step, -1) + 1, 4);
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

comment on function public.schedule_review is
    'Keep review_schedule in step with attempts: right climbs a rung, right but '
    'slower than two minutes holds it, wrong drops to the bottom.';

-- --------------------------------------------------------- H: the record shown

-- Each view keeps every column it had and gains the figures the queue actually
-- reasons on. `recent_answered` is a plain count over the last 30 days;
-- `recent_accuracy` is the same 30-day half-life the queue uses, over ALL
-- answers, unsmoothed — it is a display of the record, not a prior, and a
-- person reading it should see their own answers and nothing added.
create or replace view public.v_my_type_stats
with (security_invoker = on) as
select
    t.id                                                as item_type,
    t.label_ja,
    t.section,
    t.sort_order,
    count(a.id)                                         as answered,
    count(a.id) filter (where a.is_correct)             as correct,
    case when count(a.id) > 0
         then count(a.id) filter (where a.is_correct)::numeric / count(a.id)
    end                                                 as accuracy,
    max(a.answered_at)                                  as last_answered_at,
    count(a.id) filter (where a.answered_at >= now() - interval '30 days')::int
                                                        as recent_answered,
    -- Null when nothing was answered (the denominator is null), 0 when it was
    -- all wrong (a filtered sum over no rows is null, hence the coalesce).
    (coalesce(sum(power(0.5, extract(epoch from now() - a.answered_at) / (30 * 86400)))
                  filter (where a.is_correct), 0)
     / nullif(sum(power(0.5, extract(epoch from now() - a.answered_at) / (30 * 86400))), 0)
    )::numeric                                          as recent_accuracy
from public.item_types t
left join public.items i on i.item_type = t.id
left join public.attempts a on a.item_id = i.id
group by t.id, t.label_ja, t.section, t.sort_order;

create or replace view public.v_my_tag_stats
with (security_invoker = on) as
with tagged as (
    select 'function' as axis, i.function as tag, a.is_correct, a.answered_at from public.attempts a join public.items i on i.id = a.item_id where i.function is not null
    union all
    select 'relation', i.relation, a.is_correct, a.answered_at from public.attempts a join public.items i on i.id = a.item_id where i.relation is not null
    union all
    select 'setting',  i.setting,  a.is_correct, a.answered_at from public.attempts a join public.items i on i.id = a.item_id where i.setting is not null
    union all
    select 'channel',  i.channel,  a.is_correct, a.answered_at from public.attempts a join public.items i on i.id = a.item_id where i.channel is not null
)
select
    axis,
    tag,
    count(*)                                   as answered,
    count(*) filter (where is_correct)         as correct,
    count(*) filter (where is_correct)::numeric / count(*) as accuracy,
    count(*) filter (where answered_at >= now() - interval '30 days')::int
                                               as recent_answered,
    (coalesce(sum(power(0.5, extract(epoch from now() - answered_at) / (30 * 86400)))
                  filter (where is_correct), 0)
     / nullif(sum(power(0.5, extract(epoch from now() - answered_at) / (30 * 86400))), 0)
    )::numeric                                 as recent_accuracy
from tagged
group by axis, tag;

create or replace view public.v_my_role_traps
with (security_invoker = on) as
select
    a.chosen_role                as role,
    count(*)                     as times_chosen,
    max(a.answered_at)           as last_chosen_at,
    count(*) filter (where a.answered_at >= now() - interval '30 days')::int
                                 as recent_times
from public.attempts a
where not a.is_correct
group by a.chosen_role;

-- ------------------------------------------------------- A, D, E, G: the queue

-- Same signature, same columns. The set is now six buckets you can read out
-- loud, and the first three are exactly what they were:
--
--   0. due     — items the ladder says are due today, most overdue first, at any
--                level. Capped at two fifths of the set, so a backlog after a
--                week away cannot crowd out everything new — and at four fifths
--                once today's goal is met, because the sets after the goal are
--                the ones a backlog should be cleared in (E).
--   1. fresh   — unseen items at your level, weakest ground first, spread across
--                problem types and settings.
--   2. stretch — exactly one unseen item from the level above, when the set is
--                five or more, from the section you are best at.
--   3. unseen  — every other unseen item in the window: at your level first,
--                then the level above, then the level below (A).
--   4. rested  — items you have answered, whose last answer is at least twenty
--                hours old: the ones that caught you first, the level above
--                before the one below, longest ago first (A).
--   5. today   — items you answered in the last twenty hours. Served only when
--                nothing else in the window exists, which is what "the rest"
--                was always meant to be (A).
--
-- Within fresh, "weakest ground" is the same three terms, with two corrections:
--
--   * **The 機能 tag you score worst on**, smoothed and aged, unchanged.
--   * **The traps that keep catching you**, aged the same way — and now weighted
--     by how much each trap says. A role's rarity is ln(items in the bank /
--     items carrying that role as a distractor): a role in every item scores 0,
--     one in a third of items scores about 1.1, one in a tenth about 2.3. Each
--     prior catch counts its role's rarity rather than a flat one, and the sum
--     is still capped at five and worth six points of accuracy a point. The
--     common roles — the ones in nearly every item — used to hand nearly every
--     item the same boost, which is a constant, not a signal (G).
--   * **How hard the item is for everybody else**: the measured rate, else the
--     gate's prior, against the target the pitch sets for this type. An item
--     with neither used to be scored AT the target and paid nothing, so it
--     beat every measured item. It now pays 0.05 — a tenth of a point of
--     difference, half-weighted — which sits between "at the target" and
--     "clearly off it", so a measured item near the target wins and a badly
--     pitched one loses (D).
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
    -- One ladder per section, instead of one for the whole learner.
    ladder as (
        select s.section,
               coalesce(sl.level, 'J2') as level,
               case coalesce(sl.level, 'J2') when 'J3' then 'J2' when 'J2' then 'J1' end as up,
               case coalesce(sl.level, 'J2') when 'J1' then 'J2' when 'J2' then 'J3' end as down
        from (values ('choukai'), ('choudokkai'), ('dokkai')) as s(section)
        left join public.section_levels sl
               on sl.user_id = (select id from uid) and sl.section = s.section
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
    -- Has today's goal been met? Days end at midnight in Japan, as v_my_daily
    -- and my_streak() already count them. Only the due cap reads this (E).
    goal as (
        select (
            select count(*)
              from public.attempts a
             where a.user_id = (select id from uid)
               and (a.answered_at at time zone 'Asia/Tokyo')::date
                   = (now() at time zone 'Asia/Tokyo')::date
        ) >= coalesce(
            (select p.daily_goal from public.profiles p where p.id = (select id from uid)),
            5
        ) as met
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
    -- How good this learner is at each of the nine problem types, and therefore
    -- how hard an item of that type should be. Always nine rows: a type nobody
    -- has tried sits at the middle and is pitched at the middle.
    type_pitch as (
        select t.id as item_type,
               coalesce(ty.accuracy, 0.5) as accuracy,
               least(greatest(0.85 - coalesce(ty.accuracy, 0.5) * 0.33, 0.50), 0.80) as target_p
        from public.item_types t
        left join (
            select i.item_type,
                   (coalesce(sum(w.w) filter (where w.is_correct), 0) + 1) / (sum(w.w) + 2) as accuracy
            from weighted w
            join public.items i on i.id = w.item_id
            group by i.item_type
        ) ty on ty.item_type = t.id
    ),
    -- ...and at each of the three sections, which is what the score report adds
    -- up and therefore what the set should lean toward.
    sec_accuracy as (
        select it.section,
               (coalesce(sum(w.w) filter (where w.is_correct), 0) + 1) / (sum(w.w) + 2) as accuracy
        from weighted w
        join public.items i on i.id = w.item_id
        join public.item_types it on it.id = i.item_type
        group by it.section
    ),
    traps as (
        select w.chosen_role as role, sum(w.w) as times
        from weighted w
        where not w.is_correct
          and w.chosen_role <> ''
        group by w.chosen_role
    ),
    -- How much a caught role says about WHICH item to serve: the log of how
    -- many items in the published bank there are per item carrying that role
    -- as a distractor. A role in every item is 0 and drops out; a role in a
    -- third of items is about 1.1. Over the whole bank, not the level window,
    -- because rarity is a property of the library and should not shift with a
    -- promotion (G).
    role_rarity as (
        select o.role,
               ln((select count(*) from public.items b where b.is_published)::numeric
                  / count(distinct o.item_id)) as rarity
        from public.item_options o
        join public.items i on i.id = o.item_id
        where i.is_published
          and o.position <> i.correct_index
        group by o.role
    ),
    trap_fit as (
        select o.item_id, sum(t.times * rr.rarity)::numeric as weight
        from public.item_options o
        join public.items i on i.id = o.item_id
        join traps t on t.role = o.role
        join role_rarity rr on rr.role = o.role
        where i.is_published
          and o.position <> i.correct_index
        group by o.item_id
    ),
    pool as (
        select i.id, i.level, i.item_type, i.setting,
               la.level as at_level,
               la.up    as above,
               la.down  as below,
               coalesce(sa.accuracy, 0.5) as section_accuracy,
               s.item_id is not null              as is_seen,
               coalesce(s.ever_correct, false)    as ever_correct,
               s.last_at,
               -- Lower is more urgent. The last term is the distance from the
               -- pitch when the bank or the gate has a rate, and a flat 0.10
               -- when neither does: no opinion is not the same as on target (D).
               coalesce(ta.accuracy, 0.5)
                   + (coalesce(sa.accuracy, 0.5) - 0.5) * 0.20
                   - least(coalesce(tf.weight, 0), 5) * 0.06
                   + coalesce(abs(coalesce(d.p_correct, i.model_p_correct) - tp.target_p), 0.10) * 0.50
                   as weakness
        from public.items i
        join public.item_types it on it.id = i.item_type
        join ladder la on la.section = it.section
        join type_pitch tp on tp.item_type = i.item_type
        left join sec_accuracy sa on sa.section = it.section
        left join seen s on s.item_id = i.id
        left join tag_accuracy ta on ta.function = i.function
        left join trap_fit tf on tf.item_id = i.id
        left join public.v_item_difficulty d on d.item_id = i.id
        where i.is_published
          and (i.level = la.level or i.level = la.up or i.level = la.down)
    ),
    -- Read straight from `items` rather than from `pool`: a J3 item that caught
    -- you before a promotion is still an item that caught you, and the level
    -- window has no business hiding it on the day it comes due.
    --
    -- Two fifths of the set while today's goal is still open, so a backlog can
    -- never crowd out the new. Four fifths once it is met: the learner has done
    -- the day's work and asked for more, and more is where the backlog goes (E).
    due as (
        select i.id, 0 as bucket, extract(epoch from r.due_at) as rank
        from public.review_schedule r
        join public.items i on i.id = r.item_id
        where r.user_id = (select id from uid)
          and r.due_at <= now()
          and i.is_published
        order by r.due_at
        limit case when (select g.met from goal g)
                   then greatest(1, (p_limit * 4) / 5)
                   else greatest(1, (p_limit * 2) / 5)
              end
    ),
    -- From the section the learner is best at: a probe is worth most where a
    -- promotion is closest.
    stretch as (
        select p.id, 2 as bucket, random() as rank
        from pool p
        where p_limit >= 5
          and p.level = p.above
          and not p.is_seen
        order by p.section_accuracy desc, random()
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
                   + random() / 50 as rank
        from pool p
        where p.level = p.at_level
          and not p.is_seen
    ),
    fresh as (
        select f.id, 1 as bucket, f.rank
        from fresh_ranked f
        order by f.rank
        limit greatest(p_limit - (select count(*) from due) - (select count(*) from stretch), 1)
    ),
    -- Everything else in the window, in three bands: unseen (3), then seen and
    -- rested for a night (4), then seen today (5). The old single band put an
    -- item answered this morning ahead of an unseen item from the level below,
    -- which is the one thing a fallback must never do (A).
    rest as (
        select p.id,
               case when not p.is_seen                                then 3
                    when p.last_at <= now() - interval '20 hours'     then 4
                    else                                                   5
               end as bucket,
               case when not p.is_seen then
                        -- At your level, then above, then below; the noise
                        -- only breaks ties.
                        case when p.level = p.at_level then 0
                             when p.level = p.above    then 1
                             else                           2
                        end + random() / 1e6
                    else
                        -- Caught-you-before first, then the level above before
                        -- the one below, then longest ago; the noise only
                        -- breaks ties.
                        case when p.ever_correct then 1 else 0 end
                            + case when p.level = p.below then 0.5 else 0 end
                            + coalesce(extract(epoch from p.last_at), 0) / 1e12
                            + random() / 1e6
               end as rank
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
    'The practice queue, and the only one. Each item is judged at the level of '
    'its own exam section, pitched at a difficulty that follows how good this '
    'learner is at that problem type, and ordered by what is due, what keeps '
    'catching them (weighted by how rare the trap is), and which section is '
    'weakest — with one stretch item from the section they are strongest in, '
    'and nothing answered today served before anything unseen. Takes a size; '
    'decides the rest.';
