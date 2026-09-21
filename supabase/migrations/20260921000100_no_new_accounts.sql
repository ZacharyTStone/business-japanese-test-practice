-- No new accounts while the app is closed.
--
-- `public.testers` has decided since 2026-09-17 what a signed-in person may
-- READ: every row-level policy requires is_tester(), and somebody who is not on
-- the list finds an empty database. What it has never decided is who may have
-- an account in the first place. Supabase's sign-up endpoint answers the
-- internet, so anybody who found the project URL could post an address and a
-- password and end up with an `auth.users` row, a `public.profiles` row from
-- the trigger beneath it, and a permanent place in a table the owner never
-- chose to put them in. They could read nothing -- but "reads nothing" is not
-- the same as "is not here". The owner asked (2026-09-21) that the app take no
-- new users at all while it is still a work in progress built for one person's
-- own BJT practice.
--
-- So the door moves one step earlier: from what an account may read to whether
-- the account may exist. An address that is not already on the tester list
-- cannot sign up, and because only the service role may write `public.testers`,
-- the list is the owner's decision and nobody else's. With the list empty --
-- which is where a fresh project starts -- nobody can sign up at all. An
-- anonymous sign-in carries no address, so it is refused by the same sentence.
--
-- The check applies to the auth service. GoTrue connects as
-- `supabase_auth_admin`, and that connection IS the public sign-up path: it is
-- the one a stranger can reach. A row written by a migration, by a test
-- fixture, or by the owner holding the service role is the owner doing
-- something deliberately, and refusing those would only mean turning the
-- trigger off to do ordinary work -- which is how a safety check stops being
-- on.
--
-- Two ways of being that role, because they are two different questions.
-- `session_user` is who CONNECTED and is what production answers: it survives
-- `security definer`, which changes only who the function RUNS as, so
-- `current_user` here is always the definer and would tell us nothing. The
-- `role` setting is who the session has since become with `set role`, which is
-- how the schema test reaches this path without a second connection. Either
-- one is enough to be refused; the pair only ever widens who is turned away,
-- and neither is a way round the check.
--
-- This is a second lock on the same door, not a replacement for the first. The
-- policies still require is_tester(), so an account that exists and is later
-- taken off the list goes back to reading nothing. Opening the app is the one
-- migration it always was -- drop the conjunct from each policy -- plus
-- dropping this trigger.

create or replace function public.refuse_unlisted_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Anything but the auth service is the owner, deliberately.
    if session_user is distinct from 'supabase_auth_admin'
       and coalesce(current_setting('role', true), 'none') is distinct from 'supabase_auth_admin'
    then
        return new;
    end if;

    if new.email is null
       or not exists (select 1
                        from public.testers t
                       where t.email = lower(new.email))
    then
        raise exception 'this app is not open for sign-up'
            using errcode = 'check_violation',
                  hint = 'The app is in private testing and is not accepting new accounts.';
    end if;

    return new;
end;
$$;

comment on function public.refuse_unlisted_signup() is
    'Refuses a sign-up for an address the owner has not already listed in '
    'public.testers. Applies to the auth service''s connection, which is the '
    'path open to the internet.';

revoke execute on function public.refuse_unlisted_signup() from public, anon, authenticated;

-- Before, so that a refusal happens before handle_new_user() writes a profile.
create trigger on_auth_user_signup
    before insert on auth.users
    for each row execute function public.refuse_unlisted_signup();
