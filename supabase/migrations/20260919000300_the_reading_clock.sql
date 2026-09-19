-- A clock on the reading questions.
--
-- The exam's three parts are paced in two completely different ways, and until
-- now the app practised only one of them. 第1部 聴解 and 第2部 聴読解 advance with
-- the audio: the candidate makes no pacing decision at all and cannot go back.
-- 第3部 読解 is the opposite — **30 questions in a 30-minute block, freely
-- navigable** — so pacing is a skill, and it is the skill this app was silently
-- not teaching. Somebody who reads well and slowly meets the last six questions
-- with two minutes left, and loses marks they had the Japanese for.
--
-- So: every 読解 item carries the number of seconds the exam affords it, the
-- practice screen counts them down, and a question nobody answers in time is
-- recorded as one nobody answered. The owner asked for this (2026-09-19).
--
--   * `item_types.seconds_per_item` — the budget, per type, null where the
--     audio already sets the pace.
--   * `profiles.timed_reading` — the one switch, on by default.
--   * `attempts.chosen_index` may now be -1, meaning the clock ran out with
--     nothing chosen, and `grade_attempt()` grades that as wrong with the role
--     `timed_out`.
--
-- Nothing here touches `next_items()`. Which questions a learner is served is
-- still decided by the record alone, and the invariant that the learner chooses
-- nothing *about the questions* stands: `timed_reading` is about how they
-- practise, and the queue has never heard of it.

-- ------------------------------------------------------- the budget, per type

alter table public.item_types
    add column seconds_per_item smallint check (seconds_per_item > 0),
    add column typical_chars    smallint check (typical_chars > 0);

comment on column public.item_types.seconds_per_item is
    'How many seconds a TYPICAL item of this type gets in practice, or null when '
    'the audio sets the pace and a countdown would only be a second clock '
    'disagreeing with the first. A number therefore means two things at once: this '
    'type is self-paced, and this is the pace.';

comment on column public.item_types.typical_chars is
    'How many characters a typical item of this type puts on screen — the passage, '
    'the question and the four options. The app scales seconds_per_item by how a '
    'particular item compares with this, so a 900-character thread is not given the '
    'same time as a 400-character notice. Null wherever seconds_per_item is.';

-- Where the numbers come from, so the next person can check them rather than
-- trust them.
--
-- 第3部 読解 is 30 questions in 30 minutes: **60 seconds per question, exactly**,
-- and it is the one clean pacing figure the exam publishes. But the three types
-- inside that block do very unequal work, and a flat 60 would be wrong for all
-- three of them: a 語彙・文法 cloze is a fifteen-second item, and a 総合読解
-- passage is not. So the block is divided rather than averaged —
--
--     語彙・文法   30s × 10 =  300s
--     表現読解     45s × 10 =  450s
--     総合読解    105s × 10 = 1050s
--                            ------
--                             1800s  = the 30-minute block, exactly
--
-- — which makes the promise on the screen literally true: meet every budget and
-- you finish the section with the time the exam gives you. The split is ours;
-- the 1800 it sums to is the exam's, and that is the part worth not breaking.
-- The counts it is weighted by (10 + 10 + 10) are the published shape of the
-- section.
--
-- `typical_chars` is how much a typical item of the type puts on screen —
-- passage plus question plus the four options — and the app scales the budget
-- by how a particular item compares with it (client/src/lib/pace.ts). The
-- figures are a calibration of the published item shapes: a 語彙・文法 carrier
-- sentence of 25–50 characters with four fillers of 2–6; a 表現読解 situation of
-- 40–80 with four expressions of 10–25; a 総合読解 passage the level guide
-- describes as two to three minutes of reading, which is 400–900 characters,
-- plus its question and options.
--
-- They are a calibration and not a measurement, which is the honest description:
-- re-measure them against the bank when it is bigger and move them here.
--
-- The 聴解 and 聴読解 types stay null on purpose. Their real pacing is the
-- length of the clip, which this app already enforces by playing it once.
update public.item_types set seconds_per_item =  30, typical_chars =  80 where id = 'goi_bunpou';
update public.item_types set seconds_per_item =  45, typical_chars = 160 where id = 'hyougen';
update public.item_types set seconds_per_item = 105, typical_chars = 650 where id = 'sougou_dokkai';

-- ---------------------------------------------------------------- the setting

-- On by default, because the app's whole job is to raise a score and the
-- reading block is timed whether or not anybody practised it that way. One tap
-- turns it off on the account screen, and turning it off changes nothing about
-- which questions are served — only whether they are counted down.
alter table public.profiles
    add column timed_reading boolean not null default true;

comment on column public.profiles.timed_reading is
    'Whether 読解 items are counted down at exam pace in practice. The only thing '
    'in the app a learner chooses, and it is about how they practise rather than '
    'about what they are served: next_items() does not read it.';

-- ------------------------------------------------- an answer nobody gave

-- -1 is "the clock ran out and nothing was chosen". It is a sentinel rather
-- than a nullable column because `chosen_index` is not null everywhere it is
-- read, and because every screen that indexes the options by it already gets
-- nothing for -1, which is the truth. The 0..3 range is otherwise unchanged.
alter table public.attempts drop constraint attempts_chosen_index_check;
alter table public.attempts
    add constraint attempts_chosen_index_check check (chosen_index between -1 and 3);

comment on column public.attempts.chosen_index is
    'Which option was touched, or -1 when the question clock ran out with nothing '
    'chosen. -1 grades as wrong with the role timed_out.';

-- The role a timeout is recorded under. Not a distractor role — no option
-- carries it — so it never joins `item_options` and cannot skew the queue's
-- trap term, which ranks items by the roles they contain. It shows up where a
-- person reads their own mistakes, which is where it belongs: on a timed set,
-- "you ran out of time four times" is the most actionable thing the record has
-- to say.
create or replace function public.grade_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role          text;
    v_correct_index smallint;
begin
    new.user_id := (select auth.uid());
    if new.user_id is null then
        raise exception 'attempts require an authenticated session';
    end if;

    -- The item still has to exist, and its answer key is still read here and
    -- not taken from the client — a timeout is graded, not merely accepted.
    select i.correct_index
      into v_correct_index
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

    new.answered_at := coalesce(new.answered_at, now());
    return new;
end;
$$;

comment on function public.grade_attempt is
    'Grades an answer from the item, never from the client. chosen_index -1 means '
    'the question clock ran out: wrong, with the role timed_out.';
