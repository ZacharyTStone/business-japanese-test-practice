-- The whole schema, on Cloudflare D1 (SQLite).
--
-- Applied by wrangler d1 migrations apply (the deploy workflow, and the
-- test harness in client/worker/test/). The rules that used to live in
-- Postgres functions and row-level security live in client/worker/core/ now,
-- because the Worker is the only thing that can reach this database: nothing
-- here is exposed to a browser, there is no anonymous role, and every query
-- the app can cause is in client/worker/queries.ts.
--
-- What the database still enforces itself, so that a bug in the Worker
-- cannot get past it:
--   * an answer is history: no UPDATE of attempts, ever,
--   * an answer is refused once the learner’s day is full
--     (daily_limit_reached), and to a question that is not published
--     (item_unavailable), inside the INSERT itself, so two devices
--     answering at once are counted one after the other,
--   * the grade is computed from the item by the INSERT (client/worker/
--     core/grade.ts), never taken from the app,
--   * every check constraint and foreign key the Postgres schema had, except
--     the circular items → item_options key (a correct_index with no option
--     is refused by bjt checkbatch and by the publish test instead).
--
-- Conventions. Timestamps are UTC ISO-8601 text, ’YYYY-MM-DDTHH:MM:SS.sssZ’,
-- which sorts as time does, now below is strftime’s form of it. Booleans
-- are 0/1. JSON is text, checked with json_valid. A Japanese day starts at
-- 15:00 UTC the day before: Japan has no daylight saving time.

-- ----------------------------------------------------------------- people

-- Who an account is. Cloudflare Access signs a person in by email, this is
-- the id their history hangs on (it was Supabase’s auth.users, ids kept).
create table if not exists users (
    id         text primary key,
    email      text not null unique check (email = lower(email)),
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Who may use the app while it is in testing, by sign-in email. The Worker
-- refuses every query from an address not listed here (client/worker/core/
-- caller.ts), and creates an account only for an address that is.
create table if not exists testers (
    email          text primary key check (email = lower(email)),
    note           text not null default '',
    added_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- Lifts the fifteen-a-day ceiling, for exercising the app, not studying.
    unlimited      integer not null default 0 check (unlimited in (0, 1)),
    -- May unpublish a question for everybody from the practice screen.
    may_veto       integer not null default 0 check (may_veto in (0, 1)),
    -- This account’s own day: the largest set it may choose, and where its
    -- day stops. Null on every row but the owner’s.
    max_daily_goal integer check (max_daily_goal is null or max_daily_goal >= 1)
);

create table if not exists profiles (
    id               text primary key references users (id) on delete cascade,
    display_name     text,
    -- The one-line summary of the three section levels (the middle one). It
    -- decides nothing.
    target_level     text not null default 'J2' check (target_level in ('J3', 'J2', 'J1')),
    daily_goal       integer not null default 10 check (daily_goal >= 1),
    exam_date        text check (exam_date is null or exam_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    timed_reading    integer not null default 1 check (timed_reading in (0, 1)),
    level_changed_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------- content

create table if not exists item_types (
    id               text primary key,
    section          text not null check (section in ('choukai', 'choudokkai', 'dokkai')),
    label_ja         text not null,
    label_en         text not null,
    sort_order       integer not null,
    -- 画像把握: the picture is the question, so the item is not served until
    -- its picture exists (scenes.image_path).
    needs_picture    integer not null default 0 check (needs_picture in (0, 1)),
    -- The reading clock: the exam’s 30-minute 読解 block divided by type.
    seconds_per_item integer check (seconds_per_item > 0),
    typical_chars    integer check (typical_chars > 0),
    -- How many of the exam’s 80 questions are of this type.
    exam_questions   integer not null default 10 check (exam_questions > 0)
);

insert or ignore into item_types (id, section, label_ja, label_en, sort_order, needs_picture, seconds_per_item, typical_chars, exam_questions) values
    ('bamen_haaku',        'choukai',    '場面把握問題',   'situation grasp (listening)',          1,  0, null, null, 5),
    ('gazou_haaku',        'choukai',    '画像把握問題',   'picture situation grasp (listening)',  2,  1, null, null, 2),
    ('hatsugen_choukai',   'choukai',    '発言聴解問題',   'utterance choice (listening)',         3,  0, null, null, 10),
    ('sougou_choukai',     'choukai',    '総合聴解問題',   'integrated listening',                 4,  0, null, null, 10),
    ('joukyou_haaku',      'choudokkai', '状況把握問題',   'situation grasp (listening+reading)',  5,  0, null, null, 5),
    ('shiryou_choudokkai', 'choudokkai', '資料聴読解問題', 'document listening+reading',           6,  0, null, null, 10),
    ('sougou_choudokkai',  'choudokkai', '総合聴読解問題', 'integrated listening+reading',         7,  0, null, null, 10),
    ('goi_bunpou',         'dokkai',     '語彙・文法問題', 'vocabulary and grammar',               8,  0, 30,   80,   10),
    ('hyougen',            'dokkai',     '表現読解問題',   'expression reading',                   9,  0, 45,   160,  10),
    ('sougou_dokkai',      'dokkai',     '総合読解問題',   'integrated reading',                   10, 0, 105,  650,  10);

create table if not exists scenes (
    id         text primary key,
    label_ja   text not null default '',
    -- The picture’s path in R2, under scenes/. Null until it is drawn.
    image_path text,
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists audio_clips (
    -- A hash of (voice, channel, text): a line said twice is one file.
    id          text primary key,
    text        text not null,
    voice       text not null,
    channel     text not null check (channel in ('in_person', 'phone', 'video')),
    -- The clip’s path in R2, under audio/. Null until it is synthesised, a
    -- live clip is never re-made.
    audio_path  text,
    duration_ms integer,
    created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists bundles (
    id              text primary key,
    item_type       text not null references item_types (id),
    level           text not null check (level in ('J3', 'J2', 'J1')),
    generator_model text not null,
    generated_at    text not null,
    published_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists items (
    id                text primary key,
    bundle_id         text not null references bundles (id) on delete restrict,
    item_type         text not null references item_types (id),
    level             text not null check (level in ('J3', 'J2', 'J1')),
    seed_cell_id      text,
    setting           text,
    relation          text,
    function          text,
    channel           text check (channel in ('in_person', 'phone', 'video', 'written')),
    scene_id          text references scenes (id),
    speaker_role      text,
    listener_role     text,
    topic             text not null default '',
    stem              text not null,
    correct_index     integer not null check (correct_index between 0 and 3),
    explanation_ja    text not null default '',
    explanation_en    text not null default '',
    vocab_notes       text not null default '[]' check (json_valid(vocab_notes)),
    documents         text not null default '[]' check (json_valid(documents)),
    dialogue          text not null default '[]' check (json_valid(dialogue)),
    narration_clip_id text references audio_clips (id),
    -- How often a model answered it right at generation time: a property of
    -- the question, never of a person, and never displayed.
    model_p_correct   real check (model_p_correct between 0 and 1),
    -- Withdrawn or vetoed questions stay, so every answer pointing at them
    -- keeps resolving, nothing ever sets this back to 1 but a hand-written
    -- update.
    is_published      integer not null default 1 check (is_published in (0, 1)),
    created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists items_pick_idx on items (item_type, level) where is_published = 1;
create index if not exists items_function_idx on items (function) where is_published = 1;
create index if not exists items_seed_cell_idx on items (seed_cell_id);

create table if not exists item_options (
    item_id  text not null references items (id) on delete cascade,
    position integer not null check (position between 0 and 3),
    text     text not null,
    role     text not null,
    why      text not null default '',
    clip_id  text references audio_clips (id),
    primary key (item_id, position)
);

-- Per-item success over each person’s first answer, timeouts left out,
-- recounted from nothing by d1/refresh_item_stats.sql. Read by the queue only
-- at eight people or more.
create table if not exists item_stats (
    item_id    text primary key references items (id) on delete cascade,
    answered   integer not null default 0,
    correct    integer not null default 0,
    p_correct  real check (p_correct between 0 and 1),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------- the record

create table if not exists practice_sessions (
    id          text primary key,
    user_id     text not null references users (id) on delete cascade,
    started_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at text
);

create index if not exists practice_sessions_user_idx on practice_sessions (user_id, started_at desc);

create table if not exists attempts (
    -- AUTOINCREMENT: an id is never reused, and the queue breaks ties on it.
    id           integer primary key autoincrement,
    user_id      text not null references users (id) on delete cascade,
    session_id   text references practice_sessions (id) on delete set null,
    item_id      text not null references items (id) on delete restrict,
    -- -1: the reading clock ran out. Graded wrong, role timed_out.
    chosen_index integer not null check (chosen_index between -1 and 3),
    is_correct   integer not null check (is_correct in (0, 1)),
    chosen_role  text not null,
    elapsed_ms   integer check (elapsed_ms >= 0),
    answered_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- Timed from when the question could be answered: the end of its audio,
    -- or its appearing, for a reading one.
    think_ms     integer check (think_ms >= 0),
    replays      integer not null default 0 check (replays >= 0),
    peeked       integer not null default 0 check (peeked in (0, 1)),
    -- The lesson a 類題 re-tests, when the queue served it as one.
    stands_for   text references items (id) on delete restrict
);

create index if not exists attempts_user_time_idx on attempts (user_id, answered_at desc);
create index if not exists attempts_user_item_idx on attempts (user_id, item_id);
create index if not exists attempts_session_idx on attempts (session_id) where session_id is not null;

-- An answer given is history. Starting again deletes a whole history
-- (client/worker/core/profile.ts, resetProgress), nothing edits one.
create trigger if not exists attempts_are_history
before update on attempts
begin
    select raise(abort, 'an answer already given cannot be changed');
end;

-- The question has to be in the bank, the option has to exist, and the grade
-- is the item’s, never the writer’s: the Worker computes it inside the INSERT
-- (core/grade.ts), and a write that went around it with any other grade is
-- refused. The app sends only which option was touched. In this order, so a
-- withdrawn question is said to be withdrawn.
create trigger if not exists attempts_need_a_live_question
before insert on attempts
begin
    select raise(abort, 'item_unavailable')
     where not exists (select 1 from items i where i.id = new.item_id and i.is_published = 1);
    select raise(abort, 'no_such_option')
     where new.chosen_index <> -1
       and not exists (select 1 from item_options o
                        where o.item_id = new.item_id and o.position = new.chosen_index);
    select raise(abort, 'graded_wrongly')
     where (new.chosen_index = -1
            and (new.is_correct is not 0 or new.chosen_role is not 'timed_out'))
        or (new.chosen_index <> -1
            and (new.is_correct is not (select new.chosen_index = i.correct_index
                                          from items i where i.id = new.item_id)
                 or new.chosen_role is not (select o.role from item_options o
                                             where o.item_id = new.item_id
                                               and o.position = new.chosen_index)));
end;

-- The day’s door, on the answer itself: fifteen answers in the Japanese
-- calendar day the answer is given in (or the account’s own max_daily_goal),
-- unless the tester row lifts it. The day is the answer’s own, from the same
-- clock the queue counted the day’s set by, so a few milliseconds between the
-- Worker’s clock and the database’s at midnight cannot shut a new day early.
-- D1 runs one write at a time, so a second device cannot slip past the count.
create trigger if not exists attempts_daily_ceiling
before insert on attempts
begin
    select raise(abort, 'daily_limit_reached')
     where not coalesce((select t.unlimited from testers t join users u on u.email = t.email
                          where u.id = new.user_id), 0)
       and (select count(*) from attempts a
             where a.user_id = new.user_id
               and a.answered_at >= strftime('%Y-%m-%dT%H:%M:%fZ', date(new.answered_at, '+9 hours'), '-9 hours'))
           >= coalesce((select t.max_daily_goal from testers t join users u on u.email = t.email
                         where u.id = new.user_id), 15);
end;

-- The lessons, and when each is due: the spacing ladder. One row per lesson
-- (an item), moved by every answer to it or to a 類題 standing for it.
create table if not exists review_schedule (
    user_id text not null references users (id) on delete cascade,
    item_id text not null references items (id) on delete restrict,
    due_at  text not null,
    step    integer not null default 0 check (step between 0 and 4),
    last_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- The distractor role that caught the learner, re-tested by a 類題 that
    -- offers it as a wrong answer.
    trap    text,
    missed  integer not null default 0 check (missed in (0, 1)),
    primary key (user_id, item_id)
);

create index if not exists review_schedule_due_idx on review_schedule (user_id, due_at);

create table if not exists review_notes (
    user_id  text not null references users (id) on delete cascade,
    item_id  text not null references items (id) on delete restrict,
    note     text not null default '',
    added_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    primary key (user_id, item_id)
);

-- The level being served, one per exam section.
create table if not exists section_levels (
    user_id    text not null references users (id) on delete cascade,
    section    text not null check (section in ('choukai', 'choudokkai', 'dokkai')),
    level      text not null default 'J2' check (level in ('J3', 'J2', 'J1')),
    changed_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    moves      integer not null default 0,
    primary key (user_id, section)
);

create table if not exists entitlements (
    user_id     text not null references users (id) on delete cascade,
    product     text not null check (product = 'ads_free'),
    source      text not null check (source in ('app_store', 'play_store', 'stripe', 'grant')),
    granted_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    external_id text,
    -- A refund keeps the row: revoked, not deleted.
    revoked_at  text,
    note        text,
    primary key (user_id, product)
);

create unique index if not exists entitlements_external_id_idx on entitlements (source, external_id) where external_id is not null;

-- ------------------------------------------------------ removing questions

-- A report is a report: one per person per item, read by a person, never by
-- the queue.
create table if not exists item_feedback (
    id         integer primary key autoincrement,
    user_id    text not null references users (id) on delete cascade,
    item_id    text not null references items (id) on delete restrict,
    reason     text not null check (reason in ('unnatural', 'wrong_answer', 'ambiguous', 'unclear', 'audio', 'other')),
    note       text not null default '' check (length(note) <= 500),
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    unique (user_id, item_id)
);

create index if not exists item_feedback_item_idx on item_feedback (item_id, created_at desc);

-- A veto is the decision: who unpublished which question, and when.
create table if not exists item_vetoes (
    item_id    text primary key references items (id) on delete restrict,
    user_id    text not null references users (id) on delete cascade,
    note       text not null default '' check (length(note) <= 500),
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists item_vetoes_when_idx on item_vetoes (created_at desc);
