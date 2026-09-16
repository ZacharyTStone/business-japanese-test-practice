-- The first decision comes sooner.
--
-- Twenty answers before the level can move is right once a person is settled,
-- and too slow at the start: a J1-ready learner should not sit through four
-- sets of J2 before the app notices. So the window is ten answers until they
-- have twenty on record, and twenty after that. The thresholds scale with it
-- (80% up, 40% down), so the rule is still one sentence.

create or replace function public.adjust_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_level   text;
    v_since   timestamptz;
    v_window  integer;
    v_total   integer;
    v_correct integer;
    v_next    text;
begin
    select p.target_level, p.level_changed_at
      into v_level, v_since
      from public.profiles p
     where p.id = new.user_id;
    if v_level is null then
        return new;
    end if;

    -- Ten to start with, twenty once there is a record to judge by.
    select case when count(*) < 20 then 10 else 20 end
      into v_window
      from public.attempts a
     where a.user_id = new.user_id;

    select count(*), count(*) filter (where recent.is_correct)
      into v_total, v_correct
      from (
        select a.is_correct
          from public.attempts a
          join public.items i on i.id = a.item_id
         where a.user_id = new.user_id
           and a.answered_at >= v_since
           and i.level = v_level
         order by a.answered_at desc, a.id desc
         limit v_window
      ) recent;

    if v_total < v_window then
        return new;
    end if;

    if v_correct * 10 >= v_window * 8 then
        v_next := case v_level when 'J3' then 'J2' when 'J2' then 'J1' end;
    elsif v_correct * 10 <= v_window * 4 then
        v_next := case v_level when 'J1' then 'J2' when 'J2' then 'J3' end;
    end if;

    if v_next is not null then
        update public.profiles
           set target_level = v_next,
               level_changed_at = now(),
               updated_at = now()
         where id = new.user_id;
    end if;
    return new;
end;
$$;

revoke execute on function public.adjust_level() from public, anon, authenticated;
