-- 画像把握問題: a picture is shown, a question about it is heard, and four
-- spoken descriptions follow; exactly one is true of the picture. The closest
-- thing on the exam to the first part of the listening section. The picture
-- is drawn for the item, one per item, by the scene job after the item is
-- written, and reviewed against the four descriptions before it ships
-- (bjt/scene_art.py). The owner asked for this type (2026-09-19): rare, and
-- with pictures that are clear and not generic.
--
-- Two consequences for the database:
--
--   * `item_types` gains the row, in the listening section, right after
--     場面把握 on the radar. Every view that counts "all types" now counts ten.
--   * `item_types.needs_picture` says the picture IS the stimulus, and
--     `next_items()` will not serve such an item until `scenes.image_path` is
--     set for it. Every other type keeps shipping without a picture, as before.
--     The queue is otherwise unchanged: same terms, same order of authority.

-- ------------------------------------------------------------ the tenth type

update public.item_types set sort_order = sort_order + 1 where sort_order >= 2;

insert into public.item_types (id, section, label_ja, label_en, sort_order) values
    ('gazou_haaku', 'choukai', '画像把握問題', 'picture situation grasp (listening)', 2);

alter table public.item_types
    add column needs_picture boolean not null default false;

comment on column public.item_types.needs_picture is
    'True when the picture is the stimulus: next_items() withholds an item of this type until its scene has an image_path.';

update public.item_types set needs_picture = true where id = 'gazou_haaku';

-- ------------------------------------------------- the queue, minus the unseen

-- Identical to 20260918000200 except for one conjunct in `pool` (marked).
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
