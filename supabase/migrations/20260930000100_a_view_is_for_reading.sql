-- A view is for reading.
--
-- Found in review (2026-09-30): any tester could write the shared bank's
-- difficulty figures. `v_item_difficulty` (20260916000500) was given `grant
-- select` and nothing more, but in Supabase — and in supabase/test/00_stub.sql,
-- which copies it — the default privileges on `public` already hand the
-- authenticated role insert, update and delete on every table AND every view
-- created there. A grant of select on top of that grants nothing new and takes
-- nothing away.
--
-- For most views that is harmless: an aggregate or a join is not updatable,
-- and a write through it fails. `v_item_difficulty` is neither. It is a plain
-- filter over one table, so Postgres makes it automatically updatable; and it
-- is deliberately NOT security_invoker, so the write runs as the view's owner
-- and never meets the row-level security that keeps `item_stats` shut. As a
-- tester,
--
--     update public.v_item_difficulty set p_correct = 0.99;
--
-- answered UPDATE 1, and every learner's queue then pitched its sets at a
-- number one person typed in. The whole reason the table is shut and the view
-- is open is that the view only ever says what eight people did.
--
-- So every view in `public` loses every privilege but select, from both client
-- roles, whatever it happens to be today. Swept from the catalogue rather than
-- named, because the next view will be created with the same defaults, and a
-- test in supabase/test now fails on any view a client can write through.

do $$
declare
    v regclass;
begin
    for v in
        select c.oid::regclass
          from pg_class c
         where c.relnamespace = 'public'::regnamespace
           and c.relkind in ('v', 'm')
    loop
        execute format(
            'revoke insert, update, delete, truncate, references, trigger on %s from anon, authenticated',
            v);
    end loop;
end
$$;
