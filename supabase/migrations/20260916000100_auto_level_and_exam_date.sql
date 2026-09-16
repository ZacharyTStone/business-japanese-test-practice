-- The level is decided by the database, never chosen by the learner.
--
-- Nobody knows whether they are "J2". Asking made the first screen a form, and
-- the honest answer for most people is "no idea" — so the app now decides.
-- Everyone starts at J2; after every answer the trigger below looks at the last
-- twenty answers at the current level and moves the level up when at least
-- sixteen were right, or down when eight or fewer were. That is the whole rule.
--
-- It is deliberately blunt. A finer model (IRT, a rolling estimate) would need
-- calibration the generated items do not have, and would tempt somebody to show
-- it as a score. What this produces is a fact about the app — "the questions you
-- are getting are J1 questions" — which is true, and is allowed on screen.
--
-- `exam_date` is the other thing the app asks on first launch, and the only one:
-- a countdown is the cheapest motivation there is, and it costs one column.

alter table public.profiles
    add column exam_date        date,
    add column level_changed_at timestamptz not null default now();

comment on column public.profiles.target_level is
    'The level the app is serving right now. Moved by adjust_level(); the client never writes it.';
comment on column public.profiles.exam_date is
    'When they sit the exam, if they have said. Drives the countdown on home; null means not yet decided.';
comment on column public.profiles.level_changed_at is
    'When target_level last moved. adjust_level() only counts answers after this, so a promotion starts from a clean slate.';

/** Twenty answers at the current level, counted from the last level change. */
create or replace function public.adjust_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_level   text;
    v_since   timestamptz;
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
         limit 20
      ) recent;

    if v_total < 20 then
        return new;
    end if;

    if v_correct >= 16 then
        v_next := case v_level when 'J3' then 'J2' when 'J2' then 'J1' end;
    elsif v_correct <= 8 then
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

create trigger adjust_level_after_insert
    after insert on public.attempts
    for each row execute function public.adjust_level();

-- Trigger functions are not an API, same as the ones in 20260914000100.
revoke execute on function public.adjust_level() from public, anon, authenticated;
