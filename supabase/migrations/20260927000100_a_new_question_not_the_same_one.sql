-- A new question, not the same one.
--
-- The spacing ladder used to bring back the item itself: miss a question on
-- Monday and on Tuesday you met the very same four sentences again. That is a
-- test of whether you remember "it was 3", and the exam never asks it — the
-- exam asks the trap again, in a situation you have not seen. The owner put it
-- plainly: "I HATE taking the same question over and over." (2026-09-27)
--
-- So the ladder now schedules the LESSON an item taught, and a lesson that is
-- due is re-tested by a question the learner has never met that sets the same
-- trap. The same question comes back only when the bank has nothing new left
-- to ask. Everything else in this migration is a correction the same review
-- turned up, each one small, each one about a number the learner's score
-- depends on. The owner asked for all of them (2026-09-27).
--
--   A. **A due lesson is re-tested by a 類題.** For each due row of the ladder,
--      next_items() looks for an unseen, published question of the same problem
--      type that carries the trap which caught the learner as one of its wrong
--      answers — or, for a lesson learnt without being caught, one that shares
--      its 機能 tag. It is served in the due bucket with `stands_for` naming the
--      lesson it re-tests; the client posts that back with the answer, and the
--      answer moves the lesson's rung rather than starting a new one. A lesson
--      with no such question waits: it is never served as itself while any new
--      question remains.
--   B. **Any new question before any repeat.** The fallback used to stop at the
--      level window, so a J1 learner who had met every J1 and J2 question was
--      served J2 repeats while a whole shelf of J3 questions sat unseen. Every
--      unseen question now precedes every question already met, whatever its
--      level, and the unseen ones outside the window are ranked by weakness as
--      the fresh ones are rather than at random.
--   C. **Misses first.** A first right answer and a miss both landed on the
--      twenty-hour rung, and the due bucket took the oldest first, so
--      yesterday's misses queued behind questions the learner already knew. A
--      question known at first sight — right, in time, unaided — now starts on
--      the three-day rung, and due lessons are served misses first.
--   D. **"Slow" is measured from when the question could be answered.** The
--      two-minute rule timed the whole item, audio included, while the reading
--      clock itself allows a 総合読解 question up to 168 seconds. The client now
--      sends `think_ms` — time from the end of the audio (or, for a reading
--      question, from the moment it was on screen) — and a right answer holds
--      its rung only when that is longer than the reading clock's own maximum
--      for its type, or thirty seconds after the audio for a listening type.
--   E. **The exam plays once.** Replays and "show the options as text" were
--      unlimited and unrecorded. Both are recorded now (`replays`, `peeked`); a
--      right answer given with either holds its rung, and neither kind of
--      answer counts toward a level move, which is judged on one listen as the
--      exam judges it.
--   F. **A level can always be judged.** The window was ten or twenty first
--      attempts at the current level, and most shelves of the bank hold fewer —
--      so a learner who reached J1 聴読解 (five questions) could never leave it.
--      The window is now never larger than the questions the level has left for
--      this learner, never judged on fewer than five, and nobody is moved into
--      a level with fewer than five questions left to meet.
--   G. **The review lands before the exam.** With an exam date set, a lesson
--      whose next rung would fall on or after the last two days before the exam
--      is brought forward into them, so every lesson is re-tested once more
--      before the day it counts. In the last two weeks the set also follows the
--      exam's section mix strictly rather than leaning toward it.
--   H. **The pitch can reach its floor.** target = 0.85 − accuracy × 0.35 (it
--      was 0.33, which bottomed out at 0.52, so the stated floor of 0.50 was
--      never reached).
--   I. **Bug: the rested fallback was ordered at random.** Its tie-break noise
--      (random()/1e6) was worth about eleven days of `last_at`, so "longest ago
--      first" was a coin toss for any account younger than two weeks.
--   J. **The bank counts people, not attempts.** refresh_item_stats() counted
--      every attempt, repeats and timeouts included, so "eight answers" could be
--      one person answering a question they had just read the answer to. It
--      now counts each person's first answer, leaves out timeouts, and recounts
--      from nothing so a history that was reset leaves no stale row behind.
--   K. **A client cannot date its own answers.** `answered_at` was insertable,
--      and the day's ceiling and the ladder both read it. The client may now
--      insert only the columns it has any business sending.
--   L. **A trap is ranked by how often it catches you, not how often you meet
--      it.** v_my_role_traps gains how many times each trap was on offer, so a
--      screen can show "3 of 5" rather than a count that favours the traps in
--      every question.

-- ------------------------------------------------------------ the new columns

alter table public.attempts
    add column think_ms   integer  check (think_ms >= 0),
    add column replays    smallint not null default 0 check (replays >= 0),
    add column peeked     boolean  not null default false,
    add column stands_for text     references public.items (id) on delete set null;

comment on column public.attempts.think_ms is
    'Milliseconds from the moment the question could be answered with its stimulus '
    'over — the end of the audio, or the question on screen for a reading type — '
    'to the answer. Null when the client could not tell (a listening item played as '
    'text, an older client). elapsed_ms still covers the whole item.';
comment on column public.attempts.replays is
    'How many times the audio was played again before answering. The exam plays it '
    'once: a right answer given after a replay holds its rung, and the answer does '
    'not count toward a level move.';
comment on column public.attempts.peeked is
    'Whether spoken options were shown as text before answering. Treated as a '
    'replay is: allowed in practice, and not the exam''s conditions.';
comment on column public.attempts.stands_for is
    'The item whose lesson this answer re-tests, when the question was served as a '
    '類題 by next_items(). Checked by grade_attempt() and cleared when it does not '
    'hold, so a client can only claim what the queue would have served.';

alter table public.review_schedule
    add column trap   text,
    add column missed boolean not null default false;

comment on column public.review_schedule.trap is
    'The distractor role that last caught the learner on this lesson, or null for a '
    'lesson that has never caught them (or only on the clock). next_items() re-tests '
    'the lesson with an unseen question carrying this role as a wrong answer.';
comment on column public.review_schedule.missed is
    'Whether the latest answer on this lesson was wrong. Due lessons are served '
    'misses first.';

-- The ladder as it stands, described in the new terms: each row's trap is the
-- role of its latest wrong answer (a timeout is not a trap), and `missed` is
-- whether its latest answer was wrong.
update public.review_schedule r
   set trap = (select a.chosen_role
                 from public.attempts a
                where a.user_id = r.user_id and a.item_id = r.item_id
                  and not a.is_correct and a.chosen_role <> 'timed_out'
                order by a.answered_at desc, a.id desc
                limit 1),
       missed = coalesce((select not a.is_correct
                            from public.attempts a
                           where a.user_id = r.user_id and a.item_id = r.item_id
                           order by a.answered_at desc, a.id desc
                           limit 1), false);

-- ------------------------------------------------ K: what a client may insert

-- The table-level grant covered every column, `answered_at` included, and both
-- the day's ceiling and the spacing ladder read that column. A column grant is
-- the door: an insert that names anything else is refused before any trigger
-- runs. A migration, a fixture or the service role is unaffected.
revoke insert on public.attempts from authenticated;
grant insert (item_id, chosen_index, session_id, elapsed_ms, think_ms, replays, peeked, stands_for)
    on public.attempts to authenticated;

-- ------------------------------------------------------ A, K: grading, checked

-- The same grading as 20260919000300, and one more thing checked: a question
-- claiming to re-test a lesson has to be one the queue could have served for
-- it. The lesson must be on this learner's ladder and due; the question must be
-- a first meeting, of the same problem type; and it must set the lesson's trap
-- among its wrong answers — or, for a lesson with no trap, share its 機能 tag.
-- A claim that fails any of that is cleared rather than refused: a set loaded
-- yesterday can carry a lesson that another sitting has since re-tested, and
-- the answer is still an answer.
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
begin
    new.user_id := (select auth.uid());
    if new.user_id is null then
        raise exception 'attempts require an authenticated session';
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

    -- Only a privileged insert can name this column (see the grant above), so
    -- for the app it is always now().
    new.answered_at := coalesce(new.answered_at, now());
    return new;
end;
$$;

comment on function public.grade_attempt is
    'Grades an answer from the item, never from the client. chosen_index -1 means '
    'the question clock ran out: wrong, with the role timed_out. A stands_for that '
    'the queue could not have served is cleared.';

-- ---------------------------------------------------- D: how long the clock is

-- The most the reading clock ever gives a question, as a multiple of its type's
-- seconds_per_item: client/src/lib/pace.ts clamps its scale to this, and a test
-- holds the two equal. A right answer given inside the clock may climb.
create or replace function public.pace_max_scale()
returns numeric
language sql
immutable
set search_path = ''
as $$ select 1.6::numeric; $$;

comment on function public.pace_max_scale is
    'The reading clock''s largest scale on seconds_per_item (pace.ts MAX_SCALE). '
    'schedule_review() holds a right answer slower than this.';

revoke execute on function public.pace_max_scale() from public, anon, authenticated;

-- ------------------------------------------------- A, C, D, E, G: the ladder

-- One row per lesson, as before; what changed is which row an answer moves and
-- how far.
--
--   * An answer to a 類題 moves the lesson it stands for, not a row of its own:
--     the question was the lesson's re-test, and a second row for the same trap
--     would bring it back twice.
--   * Wrong drops to the bottom, as it always has, and remembers the trap.
--   * Right but slow, or right with a replay or the options read, holds.
--   * Right, in time and unaided at first sight starts on the three-day rung:
--     known the first time is not the same as caught the first time.
--   * Otherwise right climbs one.
--   * With an exam date ahead, a due date on or after the last two days before
--     it is brought into them.
create or replace function public.schedule_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_lesson  text := coalesce(new.stands_for, new.item_id);
    v_step    smallint;
    v_trap    text;
    v_known   boolean;
    v_secs    smallint;
    v_slow    boolean;
    v_helped  boolean;
    v_due     timestamptz;
    v_exam    timestamptz;
begin
    select r.step, r.trap
      into v_step, v_trap
      from public.review_schedule r
     where r.user_id = new.user_id and r.item_id = v_lesson;
    v_known := found;

    select it.seconds_per_item
      into v_secs
      from public.items i
      join public.item_types it on it.id = i.item_type
     where i.id = new.item_id;

    -- A self-paced type is slow past the most its clock ever gives; a type the
    -- audio paces is slow thirty seconds after the audio ended (the exam moves
    -- on a few seconds after each question). With no think time, the old rule:
    -- two minutes for the whole item.
    v_slow := case
        when v_secs is not null then
            coalesce(new.think_ms, new.elapsed_ms, 0) > v_secs * 1000 * public.pace_max_scale()
        when new.think_ms is not null then
            new.think_ms > 30000
        else
            coalesce(new.elapsed_ms, 0) > 120000
    end;
    v_helped := new.replays > 0 or new.peeked;

    if not new.is_correct then
        v_step := 0;
        if new.chosen_role <> 'timed_out' then
            v_trap := new.chosen_role;
        end if;
    elsif v_slow or v_helped then
        v_step := coalesce(v_step, 0);
    elsif not v_known then
        v_step := 1;
    else
        v_step := least(v_step + 1, 4);
    end if;

    v_due := new.answered_at + public.review_interval(v_step);

    select (p.exam_date::timestamp at time zone 'Asia/Tokyo')
      into v_exam
      from public.profiles p
     where p.id = new.user_id;
    if v_exam is not null and v_exam > new.answered_at
       and v_due > v_exam - interval '2 days' then
        v_due := greatest(new.answered_at + interval '20 hours', v_exam - interval '2 days');
    end if;

    insert into public.review_schedule (user_id, item_id, due_at, step, last_at, trap, missed)
    values (new.user_id, v_lesson, v_due, v_step, new.answered_at, v_trap, not new.is_correct)
    on conflict (user_id, item_id) do update
       set due_at  = excluded.due_at,
           step    = excluded.step,
           last_at = excluded.last_at,
           trap    = excluded.trap,
           missed  = excluded.missed;
    return new;
end;
$$;

comment on function public.schedule_review is
    'Keep review_schedule in step with attempts. A 類題 moves the lesson it stands '
    'for. Wrong drops to the bottom and remembers the trap; right but slow, or '
    'with a replay, holds; right at first sight starts on the three-day rung; '
    'otherwise right climbs one. A due date is brought forward to land before the '
    'exam.';

-- ------------------------------------------------------ E, F: the level, judged

-- What adjust_level() judges a section on, and what v_my_levels shows, in one
-- place so the two cannot disagree. It reads the caller's own record only
-- (auth.uid()), so it is safe to leave callable: in the trigger that is the
-- person answering, and in the view it is the person looking.
--
--   * First attempts only, as before, and only unaided ones (E).
--   * The window is ten while the section has fewer than twenty first attempts
--     and twenty after, as before — but never more than the questions this
--     level has left for this learner (F): items at the level they had not met
--     before the level was set. Below five the section cannot be judged.
--   * Only published items: an answer on a question since vetoed is history,
--     but it is not evidence about the level, and the view (which row-level
--     security limits to published items) and the trigger (which it does not)
--     must count the same rows.
create or replace function public.level_evidence(p_section text)
returns table (
    level        text,
    since        timestamptz,
    level_window integer,
    answered     integer,
    correct      integer
)
language sql
stable
set search_path = ''
as $$
    with me as (
        select (select auth.uid()) as id
    ),
    cur as (
        select coalesce(sl.level, 'J2')              as level,
               coalesce(sl.changed_at, '-infinity')  as since
          from (select 1) one
          left join public.section_levels sl
                 on sl.user_id = (select id from me) and sl.section = p_section
    ),
    firsts as (
        select a.id, a.item_id, a.is_correct, a.answered_at, i.level,
               (a.replays > 0 or a.peeked) as helped
          from public.attempts a
          join public.items i on i.id = a.item_id
          join public.item_types it on it.id = i.item_type
         where a.user_id = (select id from me)
           and it.section = p_section
           and i.is_published
           and not exists (
                   select 1 from public.attempts b
                    where b.user_id = a.user_id
                      and b.item_id = a.item_id
                      and (b.answered_at, b.id) < (a.answered_at, a.id))
    ),
    shelf as (
        select count(*)::int as n
          from public.items i
          join public.item_types it on it.id = i.item_type
         cross join cur
         where it.section = p_section
           and i.level = cur.level
           and i.is_published
           and (not it.needs_picture
                or exists (select 1 from public.scenes sc
                            where sc.id = i.scene_id and sc.image_path is not null))
           and not exists (select 1 from firsts f
                            where f.item_id = i.id and f.answered_at < cur.since)
    ),
    win as (
        select least(case when (select count(*) from firsts) < 20 then 10 else 20 end,
                     (select n from shelf)) as w
    ),
    recent as (
        select f.is_correct
          from firsts f
         cross join cur
         where f.level = cur.level
           and f.answered_at >= cur.since
           and not f.helped
         order by f.answered_at desc, f.id desc
         limit (select w from win)
    )
    select cur.level,
           cur.since,
           (select w from win),
           (select count(*)::int from recent),
           (select count(*) filter (where recent.is_correct)::int from recent)
      from cur
     -- The same door as everything else: a non-tester is answered with nothing.
     where (select public.is_tester());
$$;

comment on function public.level_evidence is
    'The evidence a section''s level is judged on, for the caller: the level, since '
    'when, the window (ten, or twenty with a record, never more than the questions '
    'the level has left, and unjudgeable below five), and how many of the latest '
    'unaided first attempts at that level are in it and right.';

revoke execute on function public.level_evidence(text) from public, anon;
grant execute on function public.level_evidence(text) to authenticated;

-- How many questions a level still has for this learner: published, servable,
-- and never attempted. Nobody is moved into a level with fewer than five, because
-- a window there could never fill and the learner would be stuck until the bank
-- grew. Not for clients; the trigger calls it as its owner.
create or replace function public.questions_left(p_user uuid, p_section text, p_level text)
returns integer
language sql
stable
set search_path = ''
as $$
    select count(*)::int
      from public.items i
      join public.item_types it on it.id = i.item_type
     where it.section = p_section
       and i.level = p_level
       and i.is_published
       and (not it.needs_picture
            or exists (select 1 from public.scenes sc
                        where sc.id = i.scene_id and sc.image_path is not null))
       and not exists (select 1 from public.attempts a
                        where a.user_id = p_user and a.item_id = i.id);
$$;

revoke execute on function public.questions_left(uuid, text, text) from public, anon, authenticated;

create or replace function public.adjust_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_section text;
    ev        record;
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

    -- The very first answer seeds all three sections at once, as before, so a
    -- strong reader does not meet 聴解 already at J1.
    insert into public.section_levels (user_id, section, level)
    select new.user_id, s.section,
           coalesce((select p.target_level from public.profiles p where p.id = new.user_id), 'J2')
    from (values ('choukai'), ('choudokkai'), ('dokkai')) as s(section)
    on conflict (user_id, section) do nothing;

    select * into ev from public.level_evidence(v_section);

    if ev.level_window >= 5 and ev.answered >= ev.level_window then
        if ev.correct * 10 >= ev.level_window * 8 then
            v_next := case ev.level when 'J3' then 'J2' when 'J2' then 'J1' end;
        elsif ev.correct * 10 <= ev.level_window * 4 then
            v_next := case ev.level when 'J1' then 'J2' when 'J2' then 'J3' end;
        end if;
    end if;

    if v_next is not null
       and public.questions_left(new.user_id, v_section, v_next) < 5 then
        v_next := null;
    end if;

    if v_next is not null then
        update public.section_levels
           set level = v_next, changed_at = now(), moves = moves + 1
         where user_id = new.user_id and section = v_section;
    end if;

    -- `profiles.target_level` stays the one-line summary: the middle of the
    -- three. It decides nothing.
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
    'Move the level of the section this answer belongs to, on level_evidence(): the '
    'latest unaided first attempts at that level, ten or twenty of them but never '
    'more than the level has questions for, and never fewer than five. Nobody is '
    'moved into a level with fewer than five questions left to meet.';

-- Same four columns. Placed: the section has moved, or the evidence at the
-- current level reaches ten first attempts — or the whole window, where the
-- level has fewer than ten questions to give.
create or replace view public.v_my_levels
with (security_invoker = on) as
select s.section,
       coalesce(sl.level, 'J2')       as level,
       coalesce(sl.changed_at, now()) as changed_at,
       coalesce(sl.moves, 0) > 0
       or (sl.level is not null
           and ev.level_window >= 5
           and ev.answered >= least(10, ev.level_window)) as placed
from (values ('choukai'), ('choudokkai'), ('dokkai')) as s(section)
left join public.section_levels sl
       on sl.user_id = (select auth.uid()) and sl.section = s.section
left join lateral public.level_evidence(s.section) ev on true;

-- ------------------------------------------------------------- J: the bank

create or replace function public.refresh_item_stats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rows integer;
begin
    -- From nothing, every time: a history that was reset must not leave its
    -- counts behind, and a full recount is still one pass at this scale. The
    -- `where true` is for pg-safeupdate, which refuses a bare delete.
    delete from public.item_stats where true;

    -- Each person's first answer to each question, and never a timeout. A
    -- second answer comes after the explanation was read, and a timeout is a
    -- fact about the clock (or a phone put down), not about the Japanese.
    insert into public.item_stats (item_id, answered, correct, p_correct, updated_at)
    select f.item_id,
           count(*)::int,
           count(*) filter (where f.is_correct)::int,
           count(*) filter (where f.is_correct)::numeric / count(*),
           now()
      from (
        select distinct on (a.user_id, a.item_id)
               a.item_id, a.is_correct, a.chosen_role
          from public.attempts a
         order by a.user_id, a.item_id, a.answered_at, a.id
      ) f
     where f.chosen_role <> 'timed_out'
     group by f.item_id;
    get diagnostics v_rows = row_count;
    return v_rows;
end;
$$;

comment on function public.refresh_item_stats is
    'Recount the shared bank''s per-item success rates from each person''s first '
    'answer, timeouts left out, from nothing. Run by the nightly job as the service '
    'role; never on the practice path.';

revoke execute on function public.refresh_item_stats() from public, anon, authenticated;

comment on view public.v_item_difficulty is
    'Per-item success rate, over the first answers of at least eight different '
    'people. A property of the question, never of a person, and never displayed.';

-- ------------------------------------------------------------ L: the traps

-- Same four columns first, then how often each trap was on offer: every answer
-- to a question carrying the role as a wrong option. Both halves count the same
-- answers — published questions only (row-level security sees to that for
-- `met`, and the join does for `caught`), repeats included — so the share is a
-- share and never more than one. A timeout is no option's role and has no
-- exposure; the screen shows it as a count.
create or replace view public.v_my_role_traps
with (security_invoker = on) as
with caught as (
    select a.chosen_role                as role,
           count(*)                     as times_chosen,
           max(a.answered_at)           as last_chosen_at,
           count(*) filter (where a.answered_at >= now() - interval '30 days')::int
                                        as recent_times
      from public.attempts a
      join public.items i on i.id = a.item_id and i.is_published
     where not a.is_correct
     group by a.chosen_role
),
met as (
    select o.role,
           count(*)::int as times_met,
           count(*) filter (where a.answered_at >= now() - interval '30 days')::int
                         as recent_met
      from public.attempts a
      join public.items i on i.id = a.item_id and i.is_published
      join public.item_options o on o.item_id = a.item_id and o.position <> i.correct_index
     group by o.role
)
select c.role, c.times_chosen, c.last_chosen_at, c.recent_times,
       m.times_met, m.recent_met
  from caught c
  left join met m on m.role = c.role;

-- ------------------------------------------------ A, B, G, H, I: the queue

-- The return type gains two columns, which `create or replace` cannot do.
drop function public.next_items(integer);

-- Same arguments, same buckets in spirit, same order of authority among the
-- ranking terms. What changed:
--
--   0. due      — due LESSONS, misses first, each served as the best unseen
--                 question that re-tests it (A, C): same problem type, carrying
--                 the lesson's trap as a wrong answer, or sharing its 機能 when
--                 there is no trap; the learner's own level first, then the
--                 window, then anything further. Lessons are served in that
--                 order and each takes the best question no earlier lesson has
--                 taken, so two misses on one trap are two new questions.
--                 Capped at two fifths, as before.
--   1. fresh    — unchanged, except that in the last two weeks before the exam
--                 each item beyond its section's share costs a full point rather
--                 than a quarter (G).
--   2. stretch  — unchanged.
--   3. unseen   — every other unseen question in the level window, now ranked
--                 by weakness inside each level band rather than at random.
--   4. unseen, further — unseen questions outside the window (B).
--   5. rested   — questions already met, answered at least twenty hours ago: a
--                 due lesson with no new question left comes back as itself,
--                 misses first; then questions never answered right; the level
--                 above before the one below; longest ago first (I).
--   6. today    — questions answered in the last twenty hours.
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
    -- The door, unchanged: the smaller of what was asked for and what the day
    -- has left, unless this tester's ceiling is lifted.
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
                          and (a.answered_at at time zone 'Asia/Tokyo')::date
                              = (now() at time zone 'Asia/Tokyo')::date),
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

revoke execute on function public.next_items(integer) from public, anon;
grant execute on function public.next_items(integer) to authenticated;
