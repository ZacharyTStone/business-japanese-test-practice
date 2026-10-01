-- The role the Cloudflare Worker connects as (client/worker/db.ts).
--
-- NOT a migration, and not applied by any workflow. Run it once, by hand, as
-- the database owner (the Supabase SQL editor, or psql with the owner's URL),
-- then give the role a password in the same session — never in a file:
--
--     \i supabase/worker_role.sql
--     alter role bjt_worker password '<a long random string>';
--
-- and put `postgres://bjt_worker:<that>@<host>:5432/postgres` into the
-- Hyperdrive configuration. It is kept out of the migrations because it is a
-- credential's home rather than part of the schema — like Supabase's own
-- `authenticator`, which PostgREST logs in as for the same reason — and
-- because a role grant the hosted owner turns out not to be allowed to make
-- should fail in front of the person running it, not in an unattended deploy.
--
-- What it can do: log in, and become `authenticated` for one transaction
-- (`set local role authenticated`), which is all the Worker ever does. What it
-- cannot do: anything else. `noinherit` means membership in `authenticated`
-- gives it none of that role's privileges until it says `set role`, so a
-- request that skipped that step is refused outright rather than served with
-- whatever the connection happened to be. It is not a superuser, cannot bypass
-- row-level security, create roles or databases, and owns nothing.
--
-- supabase/test/run.sh applies this file to its throwaway database and
-- asserts all of the above, then runs every Worker query through
-- client/worker/queries.db.test.ts.

-- Only `login` and `noinherit` are said. Everything else a new role is
-- denied by default (superuser, createdb, createrole, bypassrls), and naming
-- those attributes at all, even to say "no", is refused to an owner that is
-- not a superuser — which Supabase's `postgres` is not. run.sh's test asserts
-- every one of them is off.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'bjt_worker') then
        create role bjt_worker login noinherit;
    end if;
end
$$;

-- Re-assert on a role that already existed, so running this again repairs one
-- somebody loosened by hand.
alter role bjt_worker login noinherit;

grant authenticated to bjt_worker;
