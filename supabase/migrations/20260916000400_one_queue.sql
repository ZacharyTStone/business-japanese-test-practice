-- One queue, and nothing to ask it for but a number.
--
-- next_items() used to take a mode, an item type and a level, because the app
-- had a screen where a person chose those. That screen is gone. The whole claim
-- of the app is that it decides what you practise next from what you have
-- answered, and every argument here was a way to overrule it — usually toward
-- whatever felt comfortable, which is the opposite of what raises a score.
--
-- So the manual path goes, and with it the branch that made every bucket below
-- conditional. What is left is the set the record asks for:
--
--   1. retry    — up to two items that caught you before, at your level, not
--                 seen in the last twenty hours. Spaced, so the same trap is
--                 met again after a night's sleep rather than immediately.
--   2. fresh    — unseen items at your level, weakest ground first (below).
--   3. stretch  — exactly one unseen item from the level above, when the set
--                 is five or more. This is how the app pushes: the harder
--                 question is always there, and adjust_level() ignores it, so
--                 it can never cost a promotion.
--   4. the rest — seen-and-right items at your level, longest ago first; then
--                 the adjacent levels, so a level with thin content still
--                 fills a set instead of ending it early.
--
-- **"Weakest ground" now means two things, not one.** It used to be the 機能
-- tag you score worst on. That is a good axis and it stays the main one, but it
-- is blunt: it says you are weak at 依頼 without saying how you go wrong. The
-- record knows how — `attempts.chosen_role` stores which distractor caught you
-- every single time — so an unseen item that *contains* a trap that has caught
-- this person before is now pulled forward. Six points of accuracy per prior
-- catch, capped at five catches, so a well-matched item can jump about one
-- accuracy band but a single trap cannot drag the whole set onto one mistake.
--
-- The correct option is excluded from that match for a reason worth stating:
-- its role is the role of the right answer, so counting it would rank items by
-- how often the learner has answered *correctly* — precisely backwards.

drop function if exists public.next_items(integer, text, text, text);

create function public.next_items(p_limit integer default 5)
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
    tag_accuracy as (
        select i.function                                                  as function,
               count(*) filter (where a.is_correct)::numeric / count(*)    as accuracy
        from public.attempts a
        join public.items i on i.id = a.item_id
        where a.user_id = (select id from uid)
          and i.function is not null
        group by i.function
    ),
    -- Which traps keep catching this person, and how often.
    traps as (
        select a.chosen_role as role, count(*)::int as times
        from public.attempts a
        where a.user_id = (select id from uid)
          and not a.is_correct
          and a.chosen_role <> ''
        group by a.chosen_role
    ),
    -- How well each item is aimed at those traps. Distractors only: the correct
    -- option's role is the role of a right answer.
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
        select i.id, i.level,
               s.item_id is not null              as is_seen,
               coalesce(s.ever_correct, false)    as ever_correct,
               s.last_at,
               -- Lower is more urgent: the tag you are worst at, pulled further
               -- forward by every trap in the item that has caught you before.
               coalesce(ta.accuracy, 0.5)
                   - least(coalesce(tf.weight, 0), 5) * 0.06 as weakness
        from public.items i
        left join seen s on s.item_id = i.id
        left join tag_accuracy ta on ta.function = i.function
        left join trap_fit tf on tf.item_id = i.id
        where i.is_published
          and i.level in ((select l.level from ladder l), (select l.up from ladder l), (select l.down from ladder l))
    ),
    retry as (
        select p.id, 0 as bucket, extract(epoch from p.last_at) as rank
        from pool p
        where p.level = (select l.level from ladder l)
          and p.is_seen and not p.ever_correct
          and p.last_at < now() - interval '20 hours'
        order by p.last_at
        limit 2
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
    fresh as (
        select p.id, 1 as bucket, p.weakness + random() / 12 as rank
        from pool p
        where p.level = (select l.level from ladder l)
          and not p.is_seen
        order by p.weakness, random()
        limit greatest(p_limit - (select count(*) from retry) - (select count(*) from stretch), 1)
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
            select * from retry
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
    'The practice queue, and the only one: items that caught you before, unseen '
    'items aimed at your weakest tag and the traps you keep falling for, one '
    'stretch item from the level above, then the rest. Takes a size; decides '
    'everything else from the record.';

grant execute on function public.next_items(integer) to anon, authenticated;

-- ------------------------------------------------------------ one kind of set

-- `mode` distinguished a daily set from a mock and from the picker's runs.
-- There is one kind of practice run now, so the column would record the same
-- word for ever. A session is a grouping label and nothing else.
alter table public.practice_sessions drop column mode;
