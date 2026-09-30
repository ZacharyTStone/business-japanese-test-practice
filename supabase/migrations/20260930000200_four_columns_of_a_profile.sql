-- Four columns of a profile, and one of them only for one account.
--
-- Found in review (2026-09-30). "The learner chooses nothing about the
-- questions" was true of the app and not of the API behind it.
--
-- `profiles` has had one update policy since 20260913000200 — your own row,
-- once you are a tester — and never a column list, so the default privileges
-- let a client PATCH any column of it. Most of them are harmless to write. One
-- is not: `target_level`. adjust_level() seeds all three section levels from
-- it on a learner's very first answer, and reset_my_progress() puts a learner
-- back to exactly that state. So
--
--     PATCH /rest/v1/profiles  {"target_level": "J1"}
--     POST  /rest/v1/rpc/reset_my_progress
--     ...answer one question
--
-- was a level picker: all three sections at J1, chosen rather than earned, and
-- as often as anybody liked. That breaks two rules at once — the learner
-- chooses nothing about the questions, and `target_level` is a summary that
-- must never decide what is served.
--
-- The client writes four columns, all from the account screen through
-- updateProfile() in client/src/lib/db.ts: a display name, the exam date, the
-- reading clock, and — for one account — the size of the day. Those four are
-- now the only ones it may update, and it may not insert a profile at all (a
-- profile is made by handle_new_user(), as the definer, when the account is).
-- Everything else on the row is written by the database: the level summary by
-- adjust_level() and reset_my_progress(), the identity columns by the triggers
-- on auth.users, both as the definer and so unaffected by any of this.
--
-- The fourth column needed the same treatment from the other side. The trigger
-- from 20260922000200 kept a goal under the account's ceiling — fifteen for
-- everybody — which left every tester free to pick any size of day from one to
-- fifteen through the API, when CLAUDE.md is plain that the daily set is never
-- chosen in the app and is the owner's number to give to one account. So a
-- change of `daily_goal` from a client is now refused outright unless the
-- account's tester row carries `max_daily_goal`; with one, it is refused above
-- it, as before. Two things stay exactly as they were:
--
--   * **A goal being written is judged, never an existing row.** Saving the
--     exam date on a row whose goal is untouched is not a change of the goal,
--     and a client that sends the number back unchanged changes nothing.
--   * **A migration, a fixture, a definer function and the service role are
--     unaffected.** The trigger now also asks that the statement run as the
--     `authenticated` role, which is what PostgREST sets for a signed-in
--     request, as well as asking whose row it is.

revoke insert, update on public.profiles from anon, authenticated;
grant update (display_name, daily_goal, exam_date, timed_reading)
    on public.profiles to authenticated;

create or replace function public.keep_the_daily_goal_under_its_ceiling()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_max integer;
begin
    -- Only the app: a signed-in request, as PostgREST makes one, writing its
    -- own profile. A migration, a fixture, a definer function or the owner with
    -- the service role is none of those and is not what this is guarding.
    if current_user <> 'authenticated'
       or (select auth.uid()) is distinct from new.id then
        return new;
    end if;
    -- And only when the goal is what is being written. A row is not re-judged
    -- every time something else on it moves: a goal of forty set while the
    -- account had a ceiling of sixty would otherwise make every later write to
    -- that profile fail the day the ceiling came off, which is a strange way
    -- for an exam date to stop saving.
    if tg_op = 'UPDATE' and new.daily_goal is not distinct from old.daily_goal then
        return new;
    end if;
    -- The size of a day is the owner's to give, one account at a time. Without
    -- a number on this account's tester row it is not the learner's to change
    -- at all, not even below the fifteen: ten is the product, not a setting.
    v_max := (select public.my_goal_max());
    if v_max is null then
        raise exception 'the size of the day is not this account''s to choose'
            using errcode = 'insufficient_privilege';
    end if;
    if new.daily_goal > v_max then
        raise exception 'a daily goal of % is above this account''s ceiling of %',
            new.daily_goal, v_max;
    end if;
    return new;
end;
$$;

comment on function public.keep_the_daily_goal_under_its_ceiling is
    'The size of the day, enforced where the client cannot get past it. A client '
    'may change profiles.daily_goal only on the account whose tester row carries '
    'max_daily_goal, and only up to it; everybody else''s goal is not theirs to '
    'change. Judges a goal being written, never an existing row.';
