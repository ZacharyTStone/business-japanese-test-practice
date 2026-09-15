-- The six remaining item types need somewhere to put their stimulus.
--
-- Until now every published item's stimulus was its `stem`: one string, spoken
-- or read. That is true of three of the nine types. The other six carry either a
-- document the learner reads, a multi-speaker exchange they hear, or both — and
-- neither fits in a text column.
--
-- Two jsonb columns rather than two tables. Documents and dialogue are read
-- whole, written once by the publisher, and never queried across items: there is
-- no "find every item whose table has four rows" question, and normalising them
-- would turn one round trip for a set of five into a join per item on the exact
-- screen that has to work on a train. The shapes are enforced upstream, by
-- bjt/render/document.py and bjt/schemas.py, before an item is ever published.

alter table public.items
    add column if not exists documents jsonb not null default '[]'::jsonb,
    add column if not exists dialogue  jsonb not null default '[]'::jsonb;

comment on column public.items.documents is
    'The document(s) the learner reads, as render-ready data — never an image. Always an array, even for the types that have exactly one; see bjt/render.';
comment on column public.items.dialogue is
    'The multi-speaker exchange the learner hears: [{speaker_role, text, clip_id}]. Empty for types with no conversation.';

-- Scene images. The column has existed since the first migration and nothing
-- has ever been able to read it: next_items returned `scene_id` but not the
-- path, so the app could know which picture an item wanted and not where it
-- was. Adding it here is what makes the scene bank reachable at all.

-- ---------------------------------------------------------------- next_items

drop function if exists public.next_items(integer, text, text, text);

create function public.next_items(
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
    -- Null until the artwork exists. The app draws the item without it, the
    -- same way it plays an item with no audio: content ships before media.
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
-- Empty, matching the hardening in 20260914000100: every non-catalog name in
-- the body is schema-qualified, so nothing here can be shadowed by a search
-- path the caller controls.
set search_path = ''
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
        (select s.image_path from public.scenes s where s.id = i.scene_id) as scene_image_path,
        i.speaker_role, i.listener_role, i.channel, i.seed_cell_id,
        i.correct_index, i.explanation_ja, i.explanation_en, i.vocab_notes,
        i.documents,
        -- The dialogue's clip paths are resolved here for the same reason the
        -- options' are: a set of five with eight turns each would otherwise be
        -- forty extra requests on the screen that most needs to be quick.
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

grant execute on function public.next_items(integer, text, text, text) to anon, authenticated;
