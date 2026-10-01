-- The Worker's login role (supabase/worker_role.sql) can become a signed-in
-- client and nothing else. Run by run.sh after that file is applied.

do $$
declare
    r pg_roles%rowtype;
begin
    select * into r from pg_roles where rolname = 'bjt_worker';
    if not found then
        raise exception 'bjt_worker does not exist';
    end if;
    if not r.rolcanlogin then
        raise exception 'bjt_worker cannot log in';
    end if;
    if r.rolinherit then
        raise exception 'bjt_worker must be noinherit: membership alone must grant nothing';
    end if;
    if r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb then
        raise exception 'bjt_worker holds an attribute it must not';
    end if;
    if not pg_has_role('bjt_worker', 'authenticated', 'MEMBER') then
        raise exception 'bjt_worker cannot become authenticated';
    end if;
    if exists (
        select 1
        from pg_auth_members m
        join pg_roles g on g.oid = m.roleid
        where m.member = r.oid and g.rolname <> 'authenticated'
    ) then
        raise exception 'bjt_worker is a member of a role other than authenticated';
    end if;
    -- Without `set role`, nothing: the step the Worker cannot skip.
    if has_table_privilege('bjt_worker', 'public.attempts', 'SELECT')
       or has_table_privilege('bjt_worker', 'public.items', 'SELECT') then
        raise exception 'bjt_worker reads tables without becoming authenticated';
    end if;
    if exists (select 1 from pg_class where relowner = r.oid)
       or exists (select 1 from pg_proc where proowner = r.oid) then
        raise exception 'bjt_worker owns something';
    end if;
end
$$;
