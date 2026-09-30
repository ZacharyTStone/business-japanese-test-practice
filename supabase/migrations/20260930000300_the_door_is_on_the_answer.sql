-- The door is on the answer, not only on the set.
--
-- Found in review (2026-09-30). "At fifteen answers in a Japanese calendar day
-- next_items() returns nothing" has been true since 20260918000200, and it was
-- the only place the fifteen lived. The answer itself was never counted: a
-- client posting straight to /rest/v1/attempts could answer twenty questions in
-- a day, and two devices that each fetched a set before either answered were
-- each served fifteen. The day's ceiling was a promise the queue made and the
-- table did not keep.
--
-- So grade_attempt(), which already decides everything else about an answer,
-- now decides whether today has room for it. Three details:
--
--   * **One learner at a time.** The count and the insert are two steps, and
--     two answers arriving together would both count fourteen. A transaction-
--     scoped advisory lock keyed on the learner puts the second behind the
--     first; it counts after the first has committed, and it is gone the moment
--     the answer is written. Nobody waits on anybody else.
--   * **The same door as everywhere else.** The ceiling is my_daily_max() — the
--     fifteen, or the number on the owner's own row — and a tester whose row is
--     `unlimited` is not counted at all, exactly as next_items() and v_my_day
--     already read it. Only an answer that lands today is judged: the app can
--     never date an answer (20260927000100), so that is every answer it sends,
--     and a dated insert made with privileges is not the app.
--   * **A refusal the app can tell apart.** check_violation, hint
--     `daily_limit_reached`, so the practice screen can show the done screen
--     rather than an error.
--
-- And the day is now counted the same way in all three places: as a range on
-- `answered_at` from midnight in Japan, rather than by converting every one of
-- the learner's answers to a date and comparing. Same rows — `answered_at` is
-- never later than now(), since the client cannot name it — but the range is
-- something `attempts_user_time_idx (user_id, answered_at desc)` can answer
-- directly, which matters now that the count runs on every answer.

-- ---------------------------------------------------------------- the answer

create or replace function public.grade_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role          text;
    v_correct_index smallint;
    v_type          text;
    v_function      text;
    v_day_start     timestamptz :=
        ((now() at time zone 'Asia/Tokyo')::date::timestamp at time zone 'Asia/Tokyo');
    v_today         integer;
begin
    new.user_id := (select auth.uid());
    if new.user_id is null then
        raise exception 'attempts require an authenticated session';
    end if;

    -- Only a privileged insert can name this column (see the grant in
    -- 20260927000100), so for the app it is always now().
    new.answered_at := coalesce(new.answered_at, now());

    -- The day's door, on the answer itself. Counted under a lock per learner,
    -- so two devices answering at once are counted one after the other.
    if new.answered_at >= v_day_start and not (select public.is_unlimited()) then
        perform pg_advisory_xact_lock(hashtextextended('attempts:' || new.user_id::text, 0));
        select count(*)::int
          into v_today
          from public.attempts a
         where a.user_id = new.user_id
           and a.answered_at >= v_day_start;
        if v_today >= (select public.my_daily_max()) then
            raise exception 'daily limit reached'
                using errcode = 'check_violation', hint = 'daily_limit_reached';
        end if;
    end if;

    -- The item still has to exist, and its answer key is still read here and
    -- not taken from the client — a timeout is graded, not merely accepted.
    select i.correct_index, i.item_type, i.function
      into v_correct_index, v_type, v_function
      from public.items i
     where i.id = new.item_id;

    if v_correct_index is null then
        raise exception 'no such item %', new.item_id;
    end if;

    if new.chosen_index = -1 then
        new.is_correct  := false;
        new.chosen_role := 'timed_out';
    else
        select o.role
          into v_role
          from public.item_options o
         where o.item_id = new.item_id
           and o.position = new.chosen_index;

        if v_role is null then
            raise exception 'no option % for item %', new.chosen_index, new.item_id;
        end if;

        new.is_correct  := (new.chosen_index = v_correct_index);
        new.chosen_role := v_role;
    end if;

    if new.stands_for is not null and (
           new.stands_for = new.item_id
           or exists (select 1 from public.attempts a
                       where a.user_id = new.user_id and a.item_id = new.item_id)
           or not exists (
                select 1
                  from public.review_schedule r
                  join public.items l on l.id = r.item_id
                 where r.user_id = new.user_id
                   and r.item_id = new.stands_for
                   and r.due_at <= now()
                   and l.item_type = v_type
                   and case when r.trap is not null then
                                exists (select 1 from public.item_options o
                                         where o.item_id = new.item_id
                                           and o.role = r.trap
                                           and o.position <> v_correct_index)
                            else l.function is null or l.function = v_function
                       end)
       ) then
        new.stands_for := null;
    end if;

    return new;
end;
$$;

comment on function public.grade_attempt is
    'Grades an answer from the item, never from the client. chosen_index -1 means '
    'the question clock ran out: wrong, with the role timed_out. A stands_for that '
    'the queue could not have served is cleared. An answer that would take today '
    'past my_daily_max() is refused (hint daily_limit_reached), unless the '
    'tester''s ceiling is lifted.';

-- ------------------------------------------------------------------- the day

-- Same six columns; only how today is counted has changed.
create or replace view public.v_my_day
with (security_invoker = on) as
with today as (
    select count(*)::int as answered
      from public.attempts a
     where a.user_id = (select auth.uid())
       and a.answered_at >= ((now() at time zone 'Asia/Tokyo')::date::timestamp
                             at time zone 'Asia/Tokyo')
)
select
    coalesce((select p.daily_goal from public.profiles p where p.id = (select auth.uid())), 10)
                                                        as goal,
    today.answered                                      as answered_today,
    (select public.is_unlimited())                      as unlimited,
    case when (select public.is_unlimited()) then null
         else (select public.my_daily_max()) end        as max_today,
    case when (select public.is_unlimited()) then null
         else greatest((select public.my_daily_max()) - today.answered, 0) end
                                                        as left_today,
    (select public.my_goal_max())                       as goal_max
from today;

comment on view public.v_my_day is
    'Today, for this learner: the goal, what is answered, whether the ceiling '
    'is lifted, the ceiling, how many more the queue will serve, and — for the '
    'one account that may size its own day — how large a set it may ask for. '
    'Days end at midnight in Japan, as the streak counts them.';

-- ----------------------------------------------------------------- the queue

-- Identical to 20260927000100 except for how `bounds` counts today (marked).
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
    times_seen        integer,
    stands_for        text,
    lesson_trap       text
)
language sql
stable
security invoker
set search_path = ''
as $$
    with recursive uid as (
        select (select auth.uid()) as id
    ),
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
    -- The door: the smaller of what was asked for and what the day has left,
    -- unless this tester's ceiling is lifted. Today is counted as a range on
    -- answered_at from midnight in Japan, the form attempts_user_time_idx can
    -- answer, and the same form grade_attempt() counts with.
    bounds as (
        select case
            when (select public.is_unlimited()) then greatest(p_limit, 0)
            else least(
                greatest(p_limit, 0),
                greatest(
                    (select public.my_daily_max())
                    - (select count(*)::int
                         from public.attempts a
                        where a.user_id = (select id from uid)
                          and a.answered_at >= ((now() at time zone 'Asia/Tokyo')::date::timestamp
                                                at time zone 'Asia/Tokyo')),
                    0))
        end as n
    ),
    -- The last two weeks before the exam date, counted in Japan (G).
    exam as (
        select coalesce((
            select p.exam_date between (now() at time zone 'Asia/Tokyo')::date
                                   and (now() at time zone 'Asia/Tokyo')::date + 14
              from public.profiles p
             where p.id = (select id from uid)), false) as near
    ),
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
    -- H: 0.35, so the most accurate learner is pitched at the stated floor.
    type_pitch as (
        select t.id as item_type,
               coalesce(ty.accuracy, 0.5) as accuracy,
               least(greatest(0.85 - coalesce(ty.accuracy, 0.5) * 0.35, 0.50), 0.80) as target_p
        from public.item_types t
        left join (
            select i.item_type,
                   (coalesce(sum(w.w) filter (where w.is_correct), 0) + 1) / (sum(w.w) + 2) as accuracy
            from weighted w
            join public.items i on i.id = w.item_id
            group by i.item_type
        ) ty on ty.item_type = t.id
    ),
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
    lessons as (
        select r.item_id, r.trap, r.missed, r.due_at, r.due_at <= now() as is_due
        from public.review_schedule r
        where r.user_id = (select id from uid)
    ),
    -- Every servable published question, at every level (B). `in_window` is
    -- the old pool: this section's level and the two beside it.
    pool as (
        select i.id, i.level, i.item_type, i.setting, i.function, it.section,
               la.level as at_level,
               la.up    as above,
               la.down  as below,
               coalesce(i.level = la.level or i.level = la.up or i.level = la.down, false)
                                                  as in_window,
               coalesce(sa.accuracy, 0.5)         as section_accuracy,
               s.item_id is not null              as is_seen,
               coalesce(s.ever_correct, false)    as ever_correct,
               s.last_at,
               coalesce(l.is_due, false)          as lesson_due,
               coalesce(l.missed, false)          as lesson_missed,
               -- Lower is more urgent. Same four terms, same weights.
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
        left join lessons l on l.item_id = i.id
        where i.is_published
          and (not it.needs_picture
               or exists (select 1 from public.scenes sc
                           where sc.id = i.scene_id and sc.image_path is not null))
    ),
    -- A: the lessons that are due, misses first, then the most overdue.
    due_lessons as (
        select l.item_id, l.trap, i.item_type, i.function,
               row_number() over (order by l.missed desc, l.due_at, l.item_id) as priority
        from lessons l
        join public.items i on i.id = l.item_id
        where l.is_due
          and i.is_published
    ),
    -- ...and for each, every unseen question that re-tests it, best first. The
    -- same rule grade_attempt() checks a `stands_for` against. Materialised,
    -- because the assignment below reads it once per lesson.
    sibling_options as materialized (
        select dl.item_id as lesson_id, p.id as sibling_id,
               row_number() over (partition by dl.item_id
                                  order by (p.level = p.at_level) desc, p.in_window desc,
                                           p.weakness, p.id) as pick
        from due_lessons dl
        join pool p on p.item_type = dl.item_type and not p.is_seen
        where case when dl.trap is not null then
                       exists (select 1
                                 from public.item_options o
                                 join public.items c on c.id = o.item_id
                                where o.item_id = p.id
                                  and o.role = dl.trap
                                  and o.position <> c.correct_index)
                   else dl.function is null or p.function = dl.function
              end
    ),
    -- One question per lesson, handed out in lesson order: each lesson takes
    -- its best question that no earlier lesson has taken. Two misses on the
    -- same trap — the commonest case there is — are two different questions,
    -- not one question and a lesson left waiting. A lesson whose questions are
    -- all taken, or which has none, is skipped and waits for a later set.
    siblings (priority, lesson_id, trap, sibling_id, taken) as (
        select 0::bigint, null::text, null::text, null::text, array[]::text[]
        union all
        select dl.priority, dl.item_id, dl.trap, nxt.sibling_id,
               case when nxt.sibling_id is null then sb.taken
                    else sb.taken || nxt.sibling_id end
        from siblings sb
        join due_lessons dl on dl.priority = sb.priority + 1
        left join lateral (
            select so.sibling_id
              from sibling_options so
             where so.lesson_id = dl.item_id
               and not (so.sibling_id = any (sb.taken))
             order by so.pick
             limit 1
        ) nxt on true
        -- A backlog is served two fifths of a set at a time; there is no need
        -- to walk more of it than a large set could ever take.
        where dl.priority <= 200
    ),
    due as (
        select sb.sibling_id as id, 0 as bucket, sb.priority::double precision as rank,
               sb.lesson_id as stands_for, sb.trap as lesson_trap
        from siblings sb
        where sb.sibling_id is not null
        order by sb.priority
        limit greatest(1, ((select b.n from bounds b) * 2) / 5)
    ),
    stretch as (
        select p.id, 2 as bucket, random() as rank,
               null::text as stands_for, null::text as lesson_trap
        from pool p
        where (select b.n from bounds b) >= 5
          and p.level = p.above
          and not p.is_seen
        order by p.section_accuracy desc, random()
        limit 1
    ),
    fresh_size as (
        select greatest(
            (select b.n from bounds b)
            - (select count(*) from due)
            - (select count(*) from stretch), 1) as n
    ),
    sec_quota as (
        select it.section,
               round(
                   sum(it.exam_questions)::numeric
                   / (select sum(t.exam_questions) from public.item_types t)
                   * (select f.n from fresh_size f)
               ) as quota
        from public.item_types it
        group by it.section
    ),
    fresh_ranked as (
        select p.id,
               p.weakness
                   + greatest(0, row_number() over (partition by p.section
                                             order by p.weakness, p.id)
                                 - coalesce(q.quota, 99))
                     * case when (select e.near from exam e) then 1.0 else 0.25 end
                   + (row_number() over (partition by p.item_type
                                             order by p.weakness, p.id) - 1) * 0.15
                   + (row_number() over (partition by coalesce(p.setting, p.id)
                                             order by p.weakness, p.id) - 1) * 0.05
                   + random() / 50 as rank
        from pool p
        left join sec_quota q on q.section = p.section
        where p.level = p.at_level
          and not p.is_seen
    ),
    fresh as (
        select f.id, 1 as bucket, f.rank,
               null::text as stands_for, null::text as lesson_trap
        from fresh_ranked f
        order by f.rank
        limit (select f.n from fresh_size f)
    ),
    rest as (
        select p.id,
               case when not p.is_seen and p.in_window                then 3
                    when not p.is_seen                                then 4
                    when p.last_at <= now() - interval '20 hours'     then 5
                    else                                                   6
               end as bucket,
               (case when not p.is_seen then
                        -- Own level, then above, then below, then further;
                        -- inside a band, weakest ground first. The weakness is
                        -- squeezed under one so a band never mixes with the next.
                        case when p.level = p.at_level then 0
                             when p.level = p.above    then 1
                             when p.level = p.below    then 2
                             else                           3
                        end
                        + least(greatest(p.weakness, 0), 1.8) / 2
                        + random() / 1e6
                    else
                        -- A lesson due with no new question left to re-test it,
                        -- misses first; then questions never answered right; the
                        -- level above before the one below; then longest ago. The
                        -- noise is a fraction of a second of `last_at` (I).
                        case when p.lesson_due and p.lesson_missed then 0
                             when p.lesson_due                     then 1
                             when not p.ever_correct               then 2
                             else                                       3
                        end
                        + case when p.level = p.below then 0.5 else 0 end
                        + coalesce(extract(epoch from p.last_at), 0) / 1e12
                        + random() / 1e15
               end)::double precision as rank,
               null::text as stands_for, null::text as lesson_trap
        from pool p
        -- A question already met comes back only from inside the window.
        where not p.is_seen or p.in_window
    ),
    chosen as (
        select distinct on (u.id) u.id, u.bucket, u.rank, u.stands_for, u.lesson_trap
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
        coalesce(s.times_seen, 0) as times_seen,
        ch.stands_for,
        ch.lesson_trap
    from chosen ch
    join public.items i on i.id = ch.id
    left join seen s on s.item_id = i.id
    order by ch.bucket, ch.rank
    limit (select b.n from bounds b);
$$;

comment on function public.next_items is
    'The practice queue. Due lessons first, each re-tested by an unseen question '
    'that sets the same trap (stands_for names the lesson); then fresh questions '
    'ranked by weakness, the difficulty pitch and the traps that caught this '
    'learner, leaned toward the exam''s own section mix (strictly, in the last two '
    'weeks before the exam date); one stretch item; then every other unseen '
    'question, at any level, before any question already met. Takes a size and '
    'reads everything else from the record. The size it serves is capped by what '
    'the day has left.';
