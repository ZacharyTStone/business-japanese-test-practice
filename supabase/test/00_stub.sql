-- A minimal stand-in for the parts of Supabase the migrations lean on, so the
-- schema can be applied and exercised against a plain Postgres with no network,
-- no project, and no keys.
--
-- This file is NOT a migration and must never run against the real database —
-- Supabase provides all of it already. It exists so that "does the schema work,
-- and does RLS actually keep one user out of another's history" is a question
-- answered by `supabase/test/run.sh` in a few seconds rather than by poking at a
-- live project.

create schema if not exists auth;

-- The columns the migrations touch. The real table has many more.
create table auth.users (
    id           uuid primary key default gen_random_uuid(),
    email        text,
    is_anonymous boolean not null default false,
    created_at   timestamptz not null default now()
);

-- Supabase resolves the current user from the request's JWT claims. Same shape
-- here, so a test can switch users with set_config('request.jwt.claims', ...).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(
        coalesce(
            nullif(current_setting('request.jwt.claim.sub', true), ''),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        ),
        ''
    )::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
    end if;
end
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public
    grant select on tables to anon, authenticated;
alter default privileges in schema public
    grant insert, update, delete on tables to authenticated;
alter default privileges in schema public
    grant all on tables to service_role;
alter default privileges in schema public
    grant all on sequences to authenticated, service_role;
alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;
