-- Nothing new for anon, either.
--
-- 20260917000100 took every privilege in `public` away from the anon role —
-- "there is nothing an unsigned visitor may read" — but a REVOKE ... ON ALL
-- reaches only the objects that exist when it runs. Supabase's default
-- privileges on `public` grant everything on every table, view, sequence and
-- function created afterwards to anon as well as to authenticated, and
-- Postgres itself grants EXECUTE on every new function to PUBLIC, which anon
-- inherits. So each migration since has had to remember to take anon's share
-- back by hand (item_feedback, item_vetoes, v_my_day, every function), and a
-- migration that forgets opens a door. Found in review (2026-09-30).
--
-- So the defaults change, for the role migrations run as (postgres, in
-- Supabase as in supabase/test/run.sh), which is the role whose defaults
-- these are:
--
--   * In `public`, anon is no longer given anything on a new table, view,
--     sequence or function. authenticated and service_role keep Supabase's
--     defaults: a new table still needs its grants to work for the app, and
--     row-level security, which every table here has, is what decides who
--     sees a row.
--   * Nowhere is PUBLIC given EXECUTE on a new function. This one cannot be
--     said per schema — Postgres adds per-schema defaults to the global one
--     and a per-schema REVOKE cannot take a global grant away — so it holds
--     for every function this role creates from now on, in any schema. In
--     `public` and `extensions` Supabase's own per-schema grants still give
--     the client roles what they had; a function anywhere else is callable by
--     whoever it is granted to, and nobody else.
--
-- A new function in `public` is still callable by authenticated the moment it
-- exists, so supabase/test still sweeps the catalogue: it fails on any
-- function a signed-in client can call that is not in the app's API, and on
-- anything in `public` that anon can reach at all.

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges revoke execute on functions from public;
