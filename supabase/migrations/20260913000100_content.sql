-- Content: the item library. Written by the pipeline, read by everyone.
--
-- Content is published, never generated on demand. `bjt publish` turns a checked
-- bundle into idempotent SQL that lands here; the app only ever reads. That is
-- why every table in this file is world-readable and nothing here has a write
-- policy: writes go through the service role, which bypasses RLS, and happen on
-- a laptop rather than in a request.

-- ---------------------------------------------------------------- item types

-- The nine BJT problem types are the app's weakness taxonomy, so they are a
-- table rather than an enum: the app needs their Japanese labels and their
-- section for the radar chart, and an enum would need a migration to extend.
create table public.item_types (
    id          text primary key,
    section     text not null check (section in ('choukai', 'choudokkai', 'dokkai')),
    label_ja    text not null,
    label_en    text not null,
    sort_order  smallint not null
);

comment on table public.item_types is
    'The nine BJT problem types. Doubles as the weakness taxonomy shown on the radar.';

insert into public.item_types (id, section, label_ja, label_en, sort_order) values
    ('bamen_haaku',        'choukai',    '場面把握問題',   'situation grasp (listening)',        1),
    ('hatsugen_choukai',   'choukai',    '発言聴解問題',   'utterance choice (listening)',       2),
    ('sougou_choukai',     'choukai',    '総合聴解問題',   'integrated listening',               3),
    ('joukyou_haaku',      'choudokkai', '状況把握問題',   'situation grasp (listening+reading)', 4),
    ('shiryou_choudokkai', 'choudokkai', '資料聴読解問題', 'document listening+reading',         5),
    ('sougou_choudokkai',  'choudokkai', '総合聴読解問題', 'integrated listening+reading',       6),
    ('goi_bunpou',         'dokkai',     '語彙・文法問題', 'vocabulary and grammar',             7),
    ('hyougen',            'dokkai',     '表現読解問題',   'expression reading',                 8),
    ('sougou_dokkai',      'dokkai',     '総合読解問題',   'integrated reading',                 9);

-- -------------------------------------------------------------------- scenes

-- A small shared bank of pictures, reused across many items. `image_path` stays
-- null until the artwork exists, so items can ship and be practised before any
-- image does.
create table public.scenes (
    id          text primary key,
    label_ja    text not null default '',
    image_path  text,
    updated_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- audio clips

-- One row per distinct utterance. The id is the content hash the TTS plan
-- computes from (voice, channel, text), so an utterance shared by twenty items
-- is one row and one file. `audio_path` is null until it has been synthesised;
-- the app falls back to showing the text.
create table public.audio_clips (
    id          text primary key,
    text        text not null,
    voice       text not null,
    channel     text not null check (channel in ('in_person', 'phone', 'video')),
    audio_path  text,
    duration_ms integer,
    created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- bundles

create table public.bundles (
    id              text primary key,
    item_type       text not null references public.item_types (id),
    level           text not null check (level in ('J3', 'J2', 'J1')),
    generator_model text not null,
    generated_at    timestamptz not null,
    published_at    timestamptz not null default now()
);

-- --------------------------------------------------------------------- items

create table public.items (
    id            text primary key,
    bundle_id     text not null references public.bundles (id) on delete cascade,
    item_type     text not null references public.item_types (id),
    level         text not null check (level in ('J3', 'J2', 'J1')),

    -- The seed cell, flattened. These are weakness tags in their own right: the
    -- useful question is not only "how are you on 発言聴解" but "how are you on
    -- the telephone", "how are you at declining", "how are you talking upward".
    seed_cell_id  text,
    setting       text,
    relation      text,
    function      text,
    channel       text check (channel in ('in_person', 'phone', 'video')),

    scene_id      text references public.scenes (id),
    speaker_role  text,
    listener_role text,

    topic          text not null default '',
    stem           text not null,
    correct_index  smallint not null check (correct_index between 0 and 3),
    explanation_ja text not null default '',
    explanation_en text not null default '',
    vocab_notes    jsonb not null default '[]'::jsonb,

    narration_clip_id text references public.audio_clips (id),

    -- An item can be pulled without deleting the attempts that reference it.
    is_published  boolean not null default true,
    created_at    timestamptz not null default now()
);

create index items_pick_idx on public.items (item_type, level) where is_published;
create index items_function_idx on public.items (function) where is_published;
create index items_seed_cell_idx on public.items (seed_cell_id);

create table public.item_options (
    item_id  text not null references public.items (id) on delete cascade,
    position smallint not null check (position between 0 and 3),
    text     text not null,
    role     text not null,
    -- One Japanese sentence on what is wrong with THIS wording here. Shown to
    -- the learner after they answer; the role above is for our own reporting.
    why      text not null default '',
    clip_id  text references public.audio_clips (id),
    primary key (item_id, position)
);

-- The answer is a foreign key into the option set, so an item whose correct
-- index points at nothing cannot exist. Deferred because the item row is
-- inserted before its options.
alter table public.items
    add constraint items_correct_option_fk
    foreign key (id, correct_index)
    references public.item_options (item_id, position)
    deferrable initially deferred;

-- ----------------------------------------------------------------------- RLS

alter table public.item_types   enable row level security;
alter table public.scenes       enable row level security;
alter table public.audio_clips  enable row level security;
alter table public.bundles      enable row level security;
alter table public.items        enable row level security;
alter table public.item_options enable row level security;

-- Read-only to everyone, including anonymous sessions. No write policies at all:
-- publishing runs as the service role, which bypasses RLS.
create policy "content is readable" on public.item_types   for select to anon, authenticated using (true);
create policy "content is readable" on public.scenes        for select to anon, authenticated using (true);
create policy "content is readable" on public.audio_clips   for select to anon, authenticated using (true);
create policy "content is readable" on public.bundles       for select to anon, authenticated using (true);

create policy "published items are readable" on public.items
    for select to anon, authenticated using (is_published);

create policy "options of published items are readable" on public.item_options
    for select to anon, authenticated using (
        exists (select 1 from public.items i where i.id = item_id and i.is_published)
    );
