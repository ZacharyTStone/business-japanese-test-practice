-- Ten a day, fifteen at most, and then the door shuts.
--
-- The daily set was five, chosen when the bank was a few dozen items and the
-- promise was "one small set, finishable". The bank is past that, and the owner
-- asked (2026-09-18) for ten: still one sitting, still finishable, and twice the
-- evidence per day for the level and the pitch to move on.
--
-- With it, a ceiling. A learner who has done the day's ten may ask for one
-- more set, and that is where the spacing ladder's backlog gets cleared — but
-- at fifteen the day is over, and the app says so with a screen rather than
-- with a dimmer button. The database enforces it: past fifteen answers in a
-- Japanese calendar day, next_items() returns nothing, whatever it is asked
-- for. Nobody chooses the goal in the app; it is a profile column that the
-- owner may raise or lower by SQL, between one and fifteen.
--
-- The one thing this replaces from 20260918000100: the due cap that rose to
-- four fifths once the goal was met. The bonus set is still where the backlog
-- goes — it is short and it is optional — but it is now capped by the day's
-- allowance, and the cap on due items stays at two fifths of whatever is
-- served, so a bonus set is never five retries in a row.

-- ------------------------------------------------------------ the goal itself

alter table public.profiles alter column daily_goal set default 10;

-- Nobody has ever set this in the app; every row at the old default is a row
-- that took the default, and the default has moved.
update public.profiles set daily_goal = 10 where daily_goal = 5;
update public.profiles set daily_goal = 15 where daily_goal > 15;

alter table public.profiles drop constraint profiles_daily_goal_check;
alter table public.profiles
    add constraint profiles_daily_goal_check check (daily_goal between 1 and 15);

comment on column public.profiles.daily_goal is
    'Items in the daily set. Ten is the product promise: one sitting, finishable. '
    'At most fifteen, which is also the most anybody may answer in a day — see '
    'v_my_day. Never chosen in the app.';

-- -------------------------------------------------------------- the day's door

-- The ceiling, once, so the view the app reads and the queue that enforces it
-- cannot drift apart. A function rather than a table because it is a product
-- decision with one value, and a migration is the right place to change it.
create or replace function public.daily_max()
returns integer
language sql
immutable
set search_path = ''
as $$ select 15; $$;

comment on function public.daily_max is
    'The most items anybody may answer in one Japanese calendar day. A constant, '
    'so the app and the queue read the same number.';

revoke execute on function public.daily_max() from public, anon;
grant execute on function public.daily_max() to authenticated;

-- Testers who are working on the app need to be able to run through it more
-- than fifteen times in a day. A flag on the tester row, off by default and
-- set by the owner (`bjt tester <email> --unlimited`, or one update), lifts
-- the ceiling for that account alone. Read the way is_tester() is read: as
-- the definer, about the caller only, one bit out.
alter table public.testers
    add column unlimited boolean not null default false;

comment on column public.testers.unlimited is
    'True lifts the daily ceiling for this tester. Off by default; the owner '
    'sets it for accounts that are exercising the app rather than studying.';

create or replace function public.is_unlimited()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.testers t
         where t.email = lower(auth.jwt() ->> 'email')
           and t.unlimited
    );
$$;

comment on function public.is_unlimited() is
    'True when the caller is a tester whose row lifts the daily ceiling. '
    'Answers about the caller alone.';

revoke execute on function public.is_unlimited() from public, anon;
grant execute on function public.is_unlimited() to authenticated;

-- One row, always: what the day asks for, what has been answered, the
-- ceiling, and how many more the database will serve before midnight in
-- Japan. Null for the last two when the ceiling is lifted. The client reads
-- this to size a set and to know when to show the "done" screen; next_items()
-- runs the same arithmetic, so the two can never disagree.
create or replace view public.v_my_day
with (security_invoker = on) as
with today as (
    select count(*)::int as answered
      from public.attempts a
     where a.user_id = (select auth.uid())
       and (a.answered_at at time zone 'Asia/Tokyo')::date
           = (now() at time zone 'Asia/Tokyo')::date
)
select
    coalesce((select p.daily_goal from public.profiles p where p.id = (select auth.uid())), 10)
                                                        as goal,
    today.answered                                      as answered_today,
    (select public.is_unlimited())                      as unlimited,
    case when (select public.is_unlimited()) then null
         else public.daily_max() end                    as max_today,
    case when (select public.is_unlimited()) then null
         else greatest(public.daily_max() - today.answered, 0) end
                                                        as left_today
from today;

comment on view public.v_my_day is
    'Today, for this learner: the goal, what is answered, whether the ceiling '
    'is lifted, the ceiling, and how many more the queue will serve. Days end '
    'at midnight in Japan, as the streak counts them.';

-- A new relation picks up the project's default grants, which include anon;
-- the anon role holds nothing in public (20260917000100), and this view is no
-- exception. It reads the caller's own rows, so authenticated is enough.
revoke all on public.v_my_day from public, anon;
grant select on public.v_my_day to authenticated;

-- ------------------------------------------------------------------ the queue

-- Same signature, same columns. One thing is new in front of everything else:
-- **the size served is the size asked for or the day's allowance, whichever is
-- smaller**, and once fifteen answers stand against today's date in Japan the
-- allowance is zero and the function returns no rows. That is the door. The
-- client asks for what the home screen said was left; the database would cap
-- it anyway.
--
-- Six buckets you can read out loud:
--
--   0. due     — items the ladder says are due today, most overdue first, at any
--                level. Capped at two fifths of the set, so a backlog after a
--                week away cannot crowd out everything new. The bonus set after
--                the goal is where a backlog gets cleared, and it is capped the
--                same way, so it is never five retries in a row.
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
    -- The door. How many more the day allows, and therefore how many this
    -- call may serve: the smaller of what was asked for and what is left,
    -- unless this tester's ceiling is lifted. Days end at midnight in Japan,
    -- as v_my_day, v_my_daily and my_streak() count them. Zero is a
    -- legitimate answer and yields no rows.
    bounds as (
        select case
            when (select public.is_unlimited()) then greatest(p_limit, 0)
            else least(
                greatest(p_limit, 0),
                greatest(
                    public.daily_max()
                    - (select count(*)::int
                         from public.attempts a
                        where a.user_id = (select id from uid)
                          and (a.answered_at at time zone 'Asia/Tokyo')::date
                              = (now() at time zone 'Asia/Tokyo')::date),
                    0))
        end as n
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
    -- Two fifths of what is served, so a backlog can never crowd out the new.
    due as (
        select i.id, 0 as bucket, extract(epoch from r.due_at) as rank
        from public.review_schedule r
        join public.items i on i.id = r.item_id
        where r.user_id = (select id from uid)
          and r.due_at <= now()
          and i.is_published
        order by r.due_at
        limit greatest(1, ((select b.n from bounds b) * 2) / 5)
    ),
    -- From the section the learner is best at: a probe is worth most where a
    -- promotion is closest.
    stretch as (
        select p.id, 2 as bucket, random() as rank
        from pool p
        where (select b.n from bounds b) >= 5
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
        limit greatest((select b.n from bounds b) - (select count(*) from due) - (select count(*) from stretch), 1)
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
    limit (select b.n from bounds b);
$$;

comment on function public.next_items is
    'The practice queue, and the only one. Each item is judged at the level of '
    'its own exam section, pitched at a difficulty that follows how good this '
    'learner is at that problem type, and ordered by what is due, what keeps '
    'catching them (weighted by how rare the trap is), and which section is '
    'weakest — with one stretch item from the section they are strongest in, '
    'and nothing answered today served before anything unseen. Takes a size, '
    'serves at most what the day has left (daily_max), and decides the rest.';
