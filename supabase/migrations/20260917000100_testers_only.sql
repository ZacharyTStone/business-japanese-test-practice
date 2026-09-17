-- Testers only, for now.
--
-- The owner asked (2026-09-17) that nobody but the people testing the app can
-- use it. Until now the app signed everybody in anonymously before it showed
-- anything, and every content table was readable by the anon role; that was
-- the right shape for a public app and the wrong shape for one that is not
-- open yet. This migration turns it round:
--
--   * `public.testers` lists who may use the app, by the email on their Google
--     account. Only the service role can read or write it. Adding somebody is
--     one row, applied with psql (`bjt tester <email>` prints the statement).
--   * `public.is_tester()` reads the request's JWT: a signed-in, non-anonymous
--     user whose email is in the list. Every row-level policy in the schema
--     now requires it, so a person who is not on the list sees no content, no
--     profile, and cannot write an attempt — the database refuses, whatever
--     the client does. The app calls it once after sign-in to say so politely.
--   * The anon role loses every privilege on every table, view and function in
--     `public`. There is nothing an unsigned visitor may read.
--
-- Gating in the policies rather than only in the app is the same principle as
-- grading in the database: the client is not trusted to enforce anything, and
-- a future client with a bug cannot open the door. A test in supabase/test
-- asserts every policy in `public` names is_tester(), so a policy added later
-- without it fails the schema check rather than quietly opening a table.
--
-- Opening the app later is one migration that drops the conjunct from each
-- policy, and the `testers` table can stay as an allow-list for early access.

-- ------------------------------------------------------------------ testers

create table public.testers (
    email    text primary key check (email = lower(email)),
    note     text not null default '',
    added_at timestamptz not null default now()
);

comment on table public.testers is
    'Who may use the app while it is in testing, by Google account email. '
    'Service role only; a row here is a decision the owner makes.';

alter table public.testers enable row level security;
revoke all on public.testers from public, anon, authenticated;
-- No policies at all: even the authenticated role cannot see who else is
-- testing. Reads and writes happen as the service role, which bypasses RLS.

-- ---------------------------------------------------------------- is_tester

-- `security definer` because it reads `testers`, which the caller cannot; it
-- answers a yes/no about the caller alone, and nothing else leaks. `stable`
-- and wrapped in a subselect at every use, so a policy evaluates it once per
-- statement, not once per row.
create or replace function public.is_tester()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
       and exists (
               select 1
                 from public.testers t
                where t.email = lower(auth.jwt() ->> 'email')
           );
$$;

comment on function public.is_tester() is
    'True when the request is from a signed-in, non-anonymous user whose email is '
    'in public.testers. Every policy in the schema requires it.';

revoke execute on function public.is_tester() from public, anon;
grant execute on function public.is_tester() to authenticated;

-- ---------------------------------------------- nothing for the anon role

revoke all privileges on all tables    in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
-- Postgres grants EXECUTE on every new function to PUBLIC, and anon inherits
-- that, so revoking from anon alone leaves the door open. Take it from PUBLIC
-- and hand the two RPCs the app calls back to authenticated by name.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.next_items(integer) to authenticated;
grant execute on function public.my_streak()         to authenticated;

-- ------------------------------------------- every policy requires a tester

-- Content. Was readable by anon and authenticated alike; now by testers.
alter policy "content is readable" on public.item_types  to authenticated using ((select public.is_tester()));
alter policy "content is readable" on public.scenes      to authenticated using ((select public.is_tester()));
alter policy "content is readable" on public.audio_clips to authenticated using ((select public.is_tester()));
alter policy "content is readable" on public.bundles     to authenticated using ((select public.is_tester()));

alter policy "published items are readable" on public.items
    to authenticated using ((select public.is_tester()) and is_published);

alter policy "options of published items are readable" on public.item_options
    to authenticated using (
        (select public.is_tester())
        and exists (select 1 from public.items i where i.id = item_id and i.is_published)
    );

-- Per-user tables. Owner-only as before, and the owner must be a tester.
alter policy "own profile is readable" on public.profiles
    using ((select public.is_tester()) and (select auth.uid()) = id);
alter policy "own profile is writable" on public.profiles
    using ((select public.is_tester()) and (select auth.uid()) = id)
    with check ((select public.is_tester()) and (select auth.uid()) = id);

alter policy "own sessions are readable" on public.practice_sessions
    using ((select public.is_tester()) and (select auth.uid()) = user_id);
alter policy "own sessions are insertable" on public.practice_sessions
    with check ((select public.is_tester()) and (select auth.uid()) = user_id);
alter policy "own sessions are updatable" on public.practice_sessions
    using ((select public.is_tester()) and (select auth.uid()) = user_id)
    with check ((select public.is_tester()) and (select auth.uid()) = user_id);

alter policy "own attempts are readable" on public.attempts
    using ((select public.is_tester()) and (select auth.uid()) = user_id);
alter policy "own attempts are insertable" on public.attempts
    with check ((select public.is_tester()) and (select auth.uid()) = user_id);

alter policy "own notes are readable" on public.review_notes
    using ((select public.is_tester()) and (select auth.uid()) = user_id);
alter policy "own notes are insertable" on public.review_notes
    with check ((select public.is_tester()) and (select auth.uid()) = user_id);
alter policy "own notes are updatable" on public.review_notes
    using ((select public.is_tester()) and (select auth.uid()) = user_id)
    with check ((select public.is_tester()) and (select auth.uid()) = user_id);
alter policy "own notes are deletable" on public.review_notes
    using ((select public.is_tester()) and (select auth.uid()) = user_id);

alter policy "own entitlements are readable" on public.entitlements
    using ((select public.is_tester()) and (select auth.uid()) = user_id);

alter policy "own schedule is readable" on public.review_schedule
    using ((select public.is_tester()) and (select auth.uid()) = user_id);

alter policy "own levels are readable" on public.section_levels
    using ((select public.is_tester()) and (select auth.uid()) = user_id);

-- The one view that runs as its owner rather than the caller. It carries no
-- user id and nothing below the k-anonymity floor, but "block the app" means
-- block, so it answers only testers too. Same columns, so next_items() is
-- unchanged.
create or replace view public.v_item_difficulty as
    select item_id, p_correct
      from public.item_stats
     where answered >= 8
       and p_correct is not null
       and (select public.is_tester());
