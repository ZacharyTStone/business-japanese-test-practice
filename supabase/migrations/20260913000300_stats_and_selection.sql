-- Reading your own history: the weakness profile, and what to serve next.
--
-- All the views here are security_invoker, so they inherit the owner-only
-- policies on `attempts` rather than needing their own — a view that ran as its
-- definer would quietly hand one person's history to another.
--
-- Everything is computed from `attempts` on read. There is no denormalised
-- "weakness" table to keep in sync, and at the scale of one person answering
-- five questions a day there never needs to be.

-- ------------------------------------------------- accuracy by problem type

-- The radar chart. Every one of the nine types appears, including the ones you
-- have never touched — "not attempted" is itself the most useful thing the
-- chart can tell you early on.
create view public.v_my_type_stats
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
    max(a.answered_at)                                  as last_answered_at
from public.item_types t
left join public.items i on i.item_type = t.id
left join public.attempts a on a.item_id = i.id
group by t.id, t.label_ja, t.section, t.sort_order;

-- -------------------------------------------------- accuracy by seed-cell tag

-- The finer grain. 場面, 関係, 機能 and channel are separate axes in the seed
-- table, so they are separate weaknesses: someone can be fine face to face and
-- fall apart on the telephone, and that is worth saying out loud.
create view public.v_my_tag_stats
with (security_invoker = on) as
with tagged as (
    select 'function' as axis, i.function as tag, a.is_correct from public.attempts a join public.items i on i.id = a.item_id where i.function is not null
    union all
    select 'relation', i.relation, a.is_correct from public.attempts a join public.items i on i.id = a.item_id where i.relation is not null
    union all
    select 'setting',  i.setting,  a.is_correct from public.attempts a join public.items i on i.id = a.item_id where i.setting is not null
    union all
    select 'channel',  i.channel,  a.is_correct from public.attempts a join public.items i on i.id = a.item_id where i.channel is not null
)
select
    axis,
    tag,
    count(*)                                   as answered,
    count(*) filter (where is_correct)         as correct,
    count(*) filter (where is_correct)::numeric / count(*) as accuracy
from tagged
group by axis, tag;

-- -------------------------------------------------------- which traps catch me

-- The single most actionable view in the app. "You get 発言聴解 wrong 40% of the
-- time" tells a learner nothing they can act on; "eleven times this month you
-- picked the option that points 尊敬語 at yourself" tells them exactly what to
-- study tonight.
create view public.v_my_role_traps
with (security_invoker = on) as
select
    a.chosen_role                as role,
    count(*)                     as times_chosen,
    max(a.answered_at)           as last_chosen_at
from public.attempts a
where not a.is_correct
group by a.chosen_role;

-- -------------------------------------------------------------- daily rhythm

create view public.v_my_daily
with (security_invoker = on) as
select
    (a.answered_at at time zone 'Asia/Tokyo')::date       as day,
    count(*)                                              as answered,
    count(*) filter (where a.is_correct)                  as correct
from public.attempts a
group by 1;

-- Current streak in days, counting back from today (JST — the user is in Japan
-- and a day should end at midnight where they are, not at UTC midnight).
create or replace function public.my_streak()
returns integer
language sql
stable
as $$
    with days as (
        select distinct (answered_at at time zone 'Asia/Tokyo')::date as day
        from public.attempts
        where user_id = (select auth.uid())
    ),
    today as (
        select (now() at time zone 'Asia/Tokyo')::date as d
    ),
    -- A run of consecutive days shares (day - row_number()); take the run that
    -- contains today, or yesterday if today is not answered yet.
    runs as (
        select day, day - (row_number() over (order by day))::int as grp from days
    )
    select coalesce(
        (select count(*)::int
           from runs
          where grp = (select grp from runs
                        where day in ((select d from today), (select d - 1 from today))
                        order by day desc limit 1)),
        0);
$$;

-- ---------------------------------------------------------------- what's next

-- Item selection, server-side and in one round trip.
--
-- Modes:
--   daily    — unseen items first, spread across whatever the level offers
--   weakness — unseen items, ordered so the tags you are worst at come first
--   free     — same as daily but unconstrained by the daily goal (the client's
--              concern, not this function's)
--
-- Once the unseen pool runs out, items you answered WRONG come back before items
-- you answered right, oldest first. That is deliberate spaced repetition rather
-- than a fallback: the second time you meet an item that caught you is when it
-- actually teaches you something.
--
-- Weakness-targeted GENERATION is a later step. This is weakness-targeted
-- SELECTION over a fixed published library, which is the part that works from
-- day one and needs no model call.
create or replace function public.next_items(
    p_limit     integer default 5,
    p_mode      text    default 'daily',
    p_item_type text    default null,
    p_level     text    default null
)
returns table (
    id                text,
    item_type         text,
    level             text,
    topic             text,
    stem              text,
    scene_id          text,
    speaker_role      text,
    listener_role     text,
    channel           text,
    seed_cell_id      text,
    correct_index     smallint,
    explanation_ja    text,
    explanation_en    text,
    vocab_notes       jsonb,
    narration_clip_id text,
    -- Null until the clip has been synthesised. The app is built to run without
    -- audio — it shows the text instead — so this is expected to be null for a
    -- while after an item is published, not an error.
    narration_path    text,
    options           jsonb,
    times_seen        integer
)
language sql
stable
as $$
    with uid as (
        select (select auth.uid()) as id
    ),
    target as (
        select coalesce(
            p_level,
            (select p.target_level from public.profiles p where p.id = (select id from uid)),
            'J2'
        ) as level
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
    tag_accuracy as (
        select i.function                                                  as function,
               count(*) filter (where a.is_correct)::numeric / count(*)    as accuracy
        from public.attempts a
        join public.items i on i.id = a.item_id
        where a.user_id = (select id from uid)
          and i.function is not null
        group by i.function
    )
    select
        i.id, i.item_type, i.level, i.topic, i.stem, i.scene_id,
        i.speaker_role, i.listener_role, i.channel, i.seed_cell_id,
        i.correct_index, i.explanation_ja, i.explanation_en, i.vocab_notes,
        i.narration_clip_id,
        (select c.audio_path from public.audio_clips c where c.id = i.narration_clip_id) as narration_path,
        -- The audio paths ride along with the options rather than being fetched
        -- per clip afterwards: a set of five would otherwise be twenty-six
        -- requests, and this screen has to work on a train.
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
    from public.items i
    left join seen s on s.item_id = i.id
    left join tag_accuracy ta on ta.function = i.function
    where i.is_published
      and i.level = (select level from target)
      and (p_item_type is null or i.item_type = p_item_type)
    order by
        -- 1. anything unseen, before anything seen
        (s.item_id is not null),
        -- 2. among seen items, the ones that caught you come back first
        coalesce(s.ever_correct, false),
        -- 3. in weakness mode, worst tag first; an untried tag sits mid-table so
        --    it still gets probed rather than starved
        case when p_mode = 'weakness' then coalesce(ta.accuracy, 0.5) else 0 end,
        -- 4. longest since you last saw it
        s.last_at nulls first,
        random()
    limit greatest(p_limit, 0);
$$;

comment on function public.next_items is
    'The practice queue. Unseen first, then items you got wrong, then weakness order.';
