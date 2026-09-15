-- Take away the two footholds the database linter finds in the schema above.
--
-- Neither is exploitable today; both are the kind of thing that stops being
-- true the moment somebody adds a function and copies the shape of the one
-- next to it. Fixing them here means the shape being copied is the safe one.

-- ------------------------------------------ trigger functions are not an API

-- The three trigger functions are `security definer` because they write rows
-- the caller has no policy for: a profile keyed to auth.users, and the graded
-- columns of an attempt. Living in `public` also publishes them at
-- /rest/v1/rpc/<name>, where anon and authenticated inherited EXECUTE from
-- PUBLIC.
--
-- Calling one directly fails — a trigger function raises when there is no
-- trigger context — so this is a closed door rather than an open one. Take the
-- grant away anyway: the door should not be in the wall.
--
-- Firing a trigger does not re-check EXECUTE (the check happens once, when the
-- trigger is created), so the triggers in 20260913000200_users.sql keep
-- working. That is asserted in supabase/test/.
revoke execute on function public.handle_new_user()       from public, anon, authenticated;
revoke execute on function public.sync_profile_identity() from public, anon, authenticated;
revoke execute on function public.grade_attempt()         from public, anon, authenticated;

-- ------------------------------------------------- pin the two read functions

-- `my_streak` and `next_items` are the app's two RPCs and are meant to be
-- callable. They are `security invoker`, so they cannot escalate anything —
-- but an unpinned search_path still lets a caller who can create a temporary
-- schema shadow an unqualified name inside the body and change what the
-- function reads.
--
-- Both bodies already schema-qualify every table, so pinning it to nothing
-- changes no behaviour; it just removes the question. pg_catalog stays
-- implicitly searched, which is what keeps now(), jsonb_agg() and the built-in
-- types resolving.
alter function public.my_streak()                             set search_path = '';
alter function public.next_items(integer, text, text, text)   set search_path = '';
