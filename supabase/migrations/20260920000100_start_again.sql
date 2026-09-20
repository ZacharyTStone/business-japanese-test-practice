-- Starting again.
--
-- Everything the app knows about a learner is derived from their answers: the
-- three levels, the spacing ladder, the weakness arithmetic that orders the
-- queue, today's count. There has been no way to put any of it back to zero,
-- and the owner asked for one (2026-09-20) — mostly because exercising the app
-- means answering questions badly on purpose, and a bank of a hundred and forty
-- items is small enough that a testing afternoon is visible in the record for
-- weeks afterwards.
--
-- **Why this is a function and not a delete policy.** `attempts` has no update
-- or delete policy, and `review_schedule` has no write policy at all, for a
-- reason that has not changed: an answer already given is history, and a client
-- that could edit either could make the app tell it what it wanted to hear. A
-- policy would open the door for every statement a client can write —
-- "delete the ones I got wrong" included. This is the opposite shape: one
-- function, no arguments, all of it or none of it, and the rows it touches are
-- chosen by `auth.uid()` rather than by anything the caller sends. There is no
-- way to spell a selective erasure with it, which is the property worth having.
--
-- **What it does not touch.** The profile itself (the display name, the exam
-- date, the daily goal, the reading clock) is settings rather than progress.
-- `entitlements` is a purchase. `item_feedback` is an opinion about a question
-- rather than a fact about the person, and those reports are the signal the
-- generator loop acts on — a reset of one tester's history should not quietly
-- delete the bug reports that history produced.
--
-- `item_stats` is an aggregate over everybody and is recomputed from `attempts`
-- by `refresh_item_stats()`, so it corrects itself on the next run rather than
-- needing anything here.

create or replace function public.reset_my_progress()
returns jsonb
language plpgsql
security definer
-- Pinned, like the other two functions the app can call: the body reads
-- `is_tester()` and five tables, and an unpinned path lets a caller who can
-- create a temporary schema decide what those names mean.
set search_path = ''
as $$
declare
    v_user     uuid := (select auth.uid());
    v_attempts integer;
    v_sessions integer;
    v_reviews  integer;
    v_notes    integer;
    v_levels   integer;
begin
    -- The same door as every policy in the schema. A definer function is not
    -- covered by row-level security, so it has to ask on its own account.
    if v_user is null or not (select public.is_tester()) then
        raise exception 'reset_my_progress is for a signed-in tester';
    end if;

    delete from public.attempts where user_id = v_user;
    get diagnostics v_attempts = row_count;

    delete from public.review_schedule where user_id = v_user;
    get diagnostics v_reviews = row_count;

    delete from public.review_notes where user_id = v_user;
    get diagnostics v_notes = row_count;

    delete from public.practice_sessions where user_id = v_user;
    get diagnostics v_sessions = row_count;

    -- Deleted rather than set back to 'J2': a section with no row is exactly
    -- what a learner who has never answered anything has, and every reader of
    -- this table (v_my_levels, next_items) already coalesces a missing row to
    -- the starting level. Writing the default back would leave `changed_at`
    -- and `moves` saying the level had been considered and kept.
    delete from public.section_levels where user_id = v_user;
    get diagnostics v_levels = row_count;

    -- The one-line summary of the three, and nothing else on the profile.
    -- `default` rather than a literal, so the starting level lives in the
    -- column definition and not in a second place that can drift from it.
    update public.profiles
       set target_level     = default,
           level_changed_at = now(),
           updated_at       = now()
     where id = v_user;

    return jsonb_build_object(
        'attempts', v_attempts,
        'sessions', v_sessions,
        'reviews',  v_reviews,
        'notes',    v_notes,
        'levels',   v_levels
    );
end;
$$;

comment on function public.reset_my_progress is
    'Erases the caller''s own practice history — answers, sessions, the spacing '
    'schedule, review notes and the three section levels — and puts the level '
    'summary back to the starting default. Takes no arguments and reads the '
    'user from the session, so it cannot be aimed at anybody else or at part of '
    'one history. Settings, entitlements and item reports are left alone.';

-- Postgres grants EXECUTE on a new function to PUBLIC, which anon inherits.
revoke execute on function public.reset_my_progress() from public, anon;
grant  execute on function public.reset_my_progress() to authenticated;
