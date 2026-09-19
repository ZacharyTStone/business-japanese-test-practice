-- A set shaped like the exam.
--
-- The exam asks 80 questions in a fixed proportion: 第1部 聴解 25, 第2部 聴読解
-- 25, 第3部 読解 30 — and inside those, 場面把握 5 / 発言聴解 10 / 総合聴解 10,
-- 状況把握 5 / 資料聴読解 10 / 総合聴読解 10, 語彙・文法 10 / 表現読解 10 /
-- 総合読解 10. The app has never known any of that. It spread a set across
-- problem *types* so nobody got five 語彙・文法 in a row, and left the section
-- mix to fall out of the weakness arithmetic — which, on a bank whose shelves
-- are uneven, produces sets that are five listening items and nothing else.
--
-- The owner asked for the app to mirror the exam more closely (2026-09-19).
-- This is the half of that which belongs in the database: one column saying
-- how many questions of each type the real exam asks, and one term in the
-- queue that leans a set the way the score report does.
--
--   * `item_types.exam_questions` — the count, per type. The nightly planner
--     reads the same fact from `bjt/schemas.EXAM_QUESTIONS` (it runs with no
--     database) and tests/test_plan.py asserts the two agree, exactly as they
--     already do for `section`.
--   * `next_items()` gains a **section term** in the fresh bucket. Everything
--     else about the queue is untouched: same signature, same buckets, same
--     order of authority among the terms it already had.
--
-- What this does NOT do is let anybody choose a section. There is still no
-- picker: the set leans the way the exam leans, and which items fill each
-- section is still decided by the record alone.

alter table public.item_types
    add column exam_questions smallint not null default 10 check (exam_questions > 0);

comment on column public.item_types.exam_questions is
    'How many questions of this type the real exam asks, out of its 80. Used to '
    'shape a practice set (next_items) and to decide which shelf the nightly run '
    'fills next (bjt/plan.py). Mirrored in bjt/schemas.EXAM_QUESTIONS.';

-- 場面把握 and 状況把握 are the five-question types; the rest are ten. 画像把握 is
-- ours rather than the exam's — the closest thing to it is the picture half of
-- 第1部 — so it carries the smallest share there is, and what actually keeps it
-- rare is plan.NIGHT_TYPE_CAPS.
update public.item_types set exam_questions = 5 where id in ('bamen_haaku', 'joukyou_haaku');
update public.item_types set exam_questions = 2 where id = 'gazou_haaku';

-- ------------------------------------------------------------------- the queue

-- Identical to 20260919000100 except for the section term and the two CTEs it
-- needs (all marked), plus `it.section` carried through `pool`.

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
        select i.id, i.level, i.item_type, i.setting, it.section,
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
          -- A type whose picture is the question is not served without it.
          -- The picture is drawn after the item is written (bjt scenes) and
          -- may take a night or two; until then the item waits here, unseen.
          and (not it.needs_picture
               or exists (select 1 from public.scenes sc
                           where sc.id = i.scene_id and sc.image_path is not null))
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
    -- How many of the new items this call is choosing, which is what the
    -- section quota below is a share OF. Naming it once means the quota and the
    -- `limit` cannot drift apart.
    fresh_size as (
        select greatest(
            (select b.n from bounds b)
            - (select count(*) from due)
            - (select count(*) from stretch), 1) as n
    ),
    -- The exam's own shape, read off the same column the nightly planner reads:
    -- 聴解 25 questions, 聴読解 25, 読解 30, out of 80. A set of ten should lean
    -- the way the score report does — 3 / 3 / 4 — rather than however the
    -- weakness arithmetic happens to fall, which on a bank with one deep shelf
    -- is five listening items in a row.
    --
    -- 画像把握 is ours rather than the exam's and carries the smallest share
    -- there is, so 聴解 reads a little over its true 25/80 here. At every set
    -- size the app serves, the quota rounds to the same integer either way.
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
    -- The variety nudges. Ranking first by weakness inside each partition means
    -- the FIRST item of a type is the best one of that type, and it is the
    -- second and third copies that get pushed back.
    --
    -- The section term is the same idea one level up, and it is deliberately
    -- the strongest of the three: a set that is all 読解 is not a BJT set, in a
    -- way that a set with two 総合読解 items in it still is. It costs nothing
    -- for the first `quota` items of a section — those are still ordered by
    -- weakness alone — and 0.25 for each one after, which is enough to put a
    -- fresh item from an under-served section ahead of a fourth from a
    -- well-served one without ever overriding a large difference in weakness.
    fresh_ranked as (
        select p.id,
               p.weakness
                   + greatest(0, row_number() over (partition by p.section
                                             order by p.weakness, p.id)
                                 - coalesce(q.quota, 99)) * 0.25
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
        select f.id, 1 as bucket, f.rank
        from fresh_ranked f
        order by f.rank
        limit (select f.n from fresh_size f)
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
    'The practice queue. Six buckets — due, fresh, one stretch item, then the '
    'rest in three bands — ranked by weakness, the difficulty pitch and the traps '
    'that caught this learner, and leaned toward the exam''s own section mix '
    '(item_types.exam_questions). Takes a size and reads everything else from the '
    'record: there is no level, type, section or mode to pass, because there is no '
    'screen where anybody chooses one.';
