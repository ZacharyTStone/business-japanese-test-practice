-- One level was one level too few.
--
-- The exam reports three scores — 聴解, 聴読解, 読解 — and the total is their sum.
-- A person is almost never the same at all three: reading is studied, listening
-- is not, and the gap between somebody's 読解 and their 聴解 is usually the
-- largest single fact about them. Until now the app held one `target_level` for
-- the whole learner, which meant it was wrong twice for nearly everybody: too
-- easy in the section they were good at, too hard in the one they were not.
-- Being bored and being drowned are the two ways a drill stops raising a score,
-- and the old design managed both at once.
--
-- So the level is per section now. Same rule, run three times: ten answers to
-- begin with and twenty once there is a record, 80% right moves that section up,
-- 40% or fewer moves it down. Nobody is asked anything; there is still nothing to
-- choose. A learner can sit at 読解 J1 and 聴解 J3 at the same time, which is a
-- fair description of a great many people studying for this exam.
--
-- **Why three and not nine.** One shelf per problem type would be finer, and
-- unusable: at five items a day a single type sees roughly one answer every two
-- days, so a nine-way level would need a month to move once. Three is what the
-- score report uses, it is the unit somebody actually plans study around, and it
-- moves on about a week of answers. The finer grain is handled below, by the
-- pitch, which needs no threshold at all and moves on every answer.
--
-- **The pitch: harder questions where you are already good.** Inside a level the
-- queue now aims at a success rate that depends on how you do at THAT problem
-- type. Strong at 発言聴解 and the queue reaches for items the bank finds hard;
-- weak at 総合聴読解 and it reaches for ones the bank finds easy. One line of
-- arithmetic, no thresholds, no waiting — and the two mechanisms compose: the
-- level says roughly how hard, the pitch says which item inside that.
--
-- All of it is arithmetic over rows this database already had. No model call, no
-- extra round trip, nothing per learner that a person cannot read and check.

-- -------------------------------------------------------------- three levels

create table public.section_levels (
    user_id    uuid not null references auth.users (id) on delete cascade,
    section    text not null check (section in ('choukai', 'choudokkai', 'dokkai')),
    level      text not null default 'J2' check (level in ('J3', 'J2', 'J1')),
    -- adjust_level() only counts answers after this, so a promotion starts from
    -- a clean slate rather than being judged on the level it just left.
    changed_at timestamptz not null default now(),
    primary key (user_id, section)
);

comment on table public.section_levels is
    'The level the app is serving in each of the exam''s three sections. Moved by '
    'adjust_level() on the evidence of the answers; the client never writes it, '
    'and nobody is ever asked.';

alter table public.section_levels enable row level security;

create policy "own levels are readable" on public.section_levels
    for select to authenticated using ((select auth.uid()) = user_id);
-- No write policy. A learner who could set their own level would set it to
-- whatever felt comfortable, which is the opposite of what raises a score — and
-- is the reason there is no level picker in the UI either.

-- Everybody who already has a profile starts their three sections wherever their
-- single level had got to. Nobody is demoted by this migration.
insert into public.section_levels (user_id, section, level, changed_at)
select p.id, s.section, p.target_level, p.level_changed_at
from public.profiles p
cross join (values ('choukai'), ('choudokkai'), ('dokkai')) as s(section)
on conflict (user_id, section) do nothing;

-- One row per section, always three, even for a learner who has answered
-- nothing — so the app can print the three without a null check and without
-- caring whether a row exists yet.
create view public.v_my_levels
with (security_invoker = on) as
select s.section,
       coalesce(sl.level, 'J2')      as level,
       coalesce(sl.changed_at, now()) as changed_at
from (values ('choukai'), ('choudokkai'), ('dokkai')) as s(section)
left join public.section_levels sl
       on sl.user_id = (select auth.uid()) and sl.section = s.section;

comment on view public.v_my_levels is
    'The three levels being served, one per exam section. A fact about the '
    'questions, not a prediction about the learner.';

-- --------------------------------------------------- the rule, run three times

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
    -- exact mistake this migration exists to stop. It also keeps the table
    -- complete, so the summary below is a median of three and never of two.
    insert into public.section_levels (user_id, section, level)
    select new.user_id, s.section,
           coalesce((select p.target_level from public.profiles p where p.id = new.user_id), 'J2')
    from (values ('choukai'), ('choudokkai'), ('dokkai')) as s(section)
    on conflict (user_id, section) do nothing;

    select sl.level, sl.changed_at
      into v_level, v_since
      from public.section_levels sl
     where sl.user_id = new.user_id and sl.section = v_section;

    -- Ten to start with, twenty once there is a record IN THIS SECTION. Counting
    -- the whole history here would make a strong reader's 読解 answers decide how
    -- carefully their 聴解 is judged.
    select case when count(*) < 20 then 10 else 20 end
      into v_window
      from public.attempts a
      join public.items i on i.id = a.item_id
      join public.item_types it on it.id = i.item_type
     where a.user_id = new.user_id and it.section = v_section;

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
           set level = v_next, changed_at = now()
         where user_id = new.user_id and section = v_section;
    end if;

    -- `profiles.target_level` stays, as the one-line summary: the middle of the
    -- three. It is what a screen with room for one number shows, and it is no
    -- longer what decides anything — section_levels above is.
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
    'answers in that section at that level to begin with and the last twenty '
    'once there is a record. Three sections, one rule.';

revoke execute on function public.adjust_level() from public, anon, authenticated;

-- ------------------------------------------------------------------ the queue

-- Same signature, same columns. Three things changed inside, and all three are
-- in service of one idea: **spend the learner's five minutes where they buy the
-- most score.**
--
--   * **The ladder is per section.** Every item is judged against the level of
--     its own section, so 読解 can be J1 while 聴解 is J3 and both are served at
--     the difficulty that section has earned.
--
--   * **The pitch follows how good you are at that problem type.** The queue
--     prefers items whose measured success rate across the whole bank is near a
--     target, and that target now slides with the learner:
--
--         target = 0.85 − (your accuracy at this type) × 0.33,  held in [0.50, 0.80]
--
--     Someone at 90% on 発言聴解 gets items the bank answers right 55% of the
--     time; someone at 30% gets items it answers right 75% of the time. This is
--     the fine grain the three-way level cannot give: it needs no threshold and
--     no waiting, it moves on every single answer, and it is one line.
--
--     Its weight went from 0.25 to 0.50 with this migration, and the tie-break
--     noise from a twelfth of a point to a fiftieth, because the old pair had the
--     ordering backwards: the noise range was two thirds of the entire difficulty
--     range, so on the first few sets — when every other term is still at its
--     prior and difficulty is the ONLY signal there is — the pitch was mostly
--     being drowned by a random number. The terms now sit in a readable order:
--     the 機能 tag dominates, traps and difficulty are comparable second, the
--     variety nudges are third, and the noise only ever breaks a real tie.
--
--   * **The set leans toward the weakest section.** The 機能 tag is still the
--     main axis, but a tag is orthogonal to the score report — 依頼 appears in
--     listening and in reading alike — so a weak section was invisible to it.
--     A section you are strong in is pushed back and a weak one pulled forward,
--     by up to a tenth. Enough to tilt a set; not enough to serve nothing else,
--     because an exam you have stopped practising two thirds of is not a plan.
--
-- And the stretch item now comes from the section you are **best** at. That is
-- the point of a stretch: it is a probe, and the probe is most informative — and
-- most likely to end in a promotion — where the learner is already close.
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
               la.level as at_level,
               la.up    as above,
               la.down  as below,
               coalesce(sa.accuracy, 0.5) as section_accuracy,
               s.item_id is not null              as is_seen,
               coalesce(s.ever_correct, false)    as ever_correct,
               s.last_at,
               -- Lower is more urgent.
               coalesce(ta.accuracy, 0.5)
                   + (coalesce(sa.accuracy, 0.5) - 0.5) * 0.20
                   - least(coalesce(tf.weight, 0), 5) * 0.06
                   + abs(coalesce(d.p_correct, i.model_p_correct, tp.target_p) - tp.target_p) * 0.50
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
    rest as (
        select p.id,
               case when p.level = p.at_level then 3 else 4 end as bucket,
               -- Caught-you-before first, then the level above before the one
               -- below, then longest ago; the noise only breaks ties.
               case when p.ever_correct then 1 else 0 end
                   + case when p.level = p.below then 0.5 else 0 end
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
    'The practice queue, and the only one. Each item is judged at the level of '
    'its own exam section, pitched at a difficulty that follows how good this '
    'learner is at that problem type, and ordered by what is due, what keeps '
    'catching them, and which section is weakest — with one stretch item from '
    'the section they are strongest in. Takes a size; decides the rest.';
