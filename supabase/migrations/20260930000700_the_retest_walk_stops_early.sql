-- The re-test walk stops when the set's share of the backlog is handed out.
--
-- Found in review (2026-09-30): next_items() got slower with every lesson that
-- fell due. The 類題 assignment from 20260927000100 built, for EVERY due lesson,
-- every unseen question that could re-test it, checking each (lesson,
-- question) pair with its own search of item_options; then it walked two
-- hundred lessons one step at a time, rescanning that whole list at each step,
-- and kept walking long after the set's two-fifths share of re-tests was full.
-- A learner with a long backlog on a bank of a couple of thousand questions
-- waited seconds for ten.
--
-- Four changes to how the due bucket is found, and none to what it holds:
--
--   a. **Only the lessons the walk can reach.** It never went past the two
--      hundredth; now nothing is built for the rest.
--   b. **Only each lesson's best `due_cap` questions**, where due_cap is the
--      set's share, greatest(1, n × 2 / 5). The walk hands out at most due_cap
--      questions, so when a lesson's turn comes fewer than due_cap are taken,
--      and its best question still free is always among its first due_cap.
--   c. **One join instead of a search per pair.** A lesson's trap is looked up
--      in the distinct (question, wrong-answer role) pairs of the published
--      bank.
--   d. **The walk stops once due_cap questions are handed out.** The due
--      bucket took the first due_cap of them in lesson order anyway.
--
-- The ranking is untouched: same lessons in the same order, same candidates
-- ranked on the same keys, and every other bucket and term exactly as it was,
-- so CLAUDE.md's order of authority among the ranking terms holds as before.
-- Checked on a scratch bank of 2,250 questions and eight learners — up to
-- 1,276 lessons due, lessons competing for the same eight questions, a learner
-- at the door — at set sizes from nothing to two hundred, three random seeds
-- each: the old and the new function returned the same rows in the same order
-- in all 246 comparisons, and the heaviest learner's set of ten went from
-- about 700 ms to about 120 ms.
--
-- And the function no longer asks for JIT compilation: its plan is large and
-- its estimates are pessimistic, so Postgres would compile it on every call,
-- which costs more than it saves on a query that reads a few thousand rows.

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
set jit = off
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
    -- A: the lessons that are due, misses first, then the most overdue. Only
    -- the first two hundred: the walk below never goes further, so nothing
    -- here is built for a lesson it could not reach.
    due_lessons as (
        select d.*
        from (
            select l.item_id, l.trap, i.item_type, i.function,
                   row_number() over (order by l.missed desc, l.due_at, l.item_id) as priority
            from lessons l
            join public.items i on i.id = l.item_id
            where l.is_due
              and i.is_published
        ) d
        where d.priority <= 200
    ),
    -- A backlog is served two fifths of a set at a time.
    due_cap as (
        select greatest(1, ((select b.n from bounds b) * 2) / 5) as n
    ),
    -- Every role a published question offers as a wrong answer, once per
    -- question: what a lesson's trap is looked up in, as one join rather than
    -- a search per (lesson, question) pair.
    wrong_roles as (
        select distinct o.item_id, o.role
        from public.item_options o
        join public.items c on c.id = o.item_id
        where c.is_published
          and o.position <> c.correct_index
    ),
    -- ...and for each lesson, the unseen questions that re-test it, best
    -- first. The same rule grade_attempt() checks a `stands_for` against: the
    -- trap as a wrong answer, or for a lesson that never caught anybody, its
    -- 機能. Only a lesson's best `due_cap` are kept. The walk below stops once
    -- it has handed out `due_cap` questions, so when any lesson's turn comes,
    -- fewer than `due_cap` are taken, and its best free question is always
    -- among its first `due_cap`. Materialised, because the walk reads it once
    -- per lesson.
    sibling_options as materialized (
        select r.lesson_id, r.sibling_id, r.pick
        from (
            select c.lesson_id, c.sibling_id,
                   row_number() over (partition by c.lesson_id
                                      order by (c.level = c.at_level) desc, c.in_window desc,
                                               c.weakness, c.sibling_id) as pick
            from (
                select dl.item_id as lesson_id, p.id as sibling_id,
                       p.level, p.at_level, p.in_window, p.weakness
                from due_lessons dl
                join pool p on p.item_type = dl.item_type and not p.is_seen
                join wrong_roles wr on wr.item_id = p.id and wr.role = dl.trap
                where dl.trap is not null
                union all
                select dl.item_id, p.id, p.level, p.at_level, p.in_window, p.weakness
                from due_lessons dl
                join pool p on p.item_type = dl.item_type and not p.is_seen
                where dl.trap is null
                  and (dl.function is null or p.function = dl.function)
            ) c
        ) r
        where r.pick <= (select dc.n from due_cap dc)
    ),
    -- One question per lesson, handed out in lesson order: each lesson takes
    -- its best question that no earlier lesson has taken. Two misses on the
    -- same trap — the commonest case there is — are two different questions,
    -- not one question and a lesson left waiting. A lesson whose questions are
    -- all taken, or which has none, is skipped and waits for a later set. The
    -- walk stops as soon as the set's share of the backlog is handed out.
    siblings (priority, lesson_id, trap, sibling_id, taken, served) as (
        select 0::bigint, null::text, null::text, null::text, array[]::text[], 0
        union all
        select dl.priority, dl.item_id, dl.trap, nxt.sibling_id,
               case when nxt.sibling_id is null then sb.taken
                    else sb.taken || nxt.sibling_id end,
               sb.served + case when nxt.sibling_id is null then 0 else 1 end
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
        where sb.served < (select dc.n from due_cap dc)
    ),
    due as (
        select sb.sibling_id as id, 0 as bucket, sb.priority::double precision as rank,
               sb.lesson_id as stands_for, sb.trap as lesson_trap
        from siblings sb
        where sb.sibling_id is not null
        order by sb.priority
        limit (select dc.n from due_cap dc)
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
