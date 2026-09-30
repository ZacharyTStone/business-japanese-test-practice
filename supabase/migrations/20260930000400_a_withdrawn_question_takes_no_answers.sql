-- A withdrawn question takes no new answers.
--
-- Found in review (2026-09-30). A question leaves the bank by being
-- unpublished — withdrawn in batches/withdrawn.txt, or vetoed in the app — and
-- from then on nobody can read it: the select policy on `items` is
-- `is_tester() and is_published`, and next_items() serves only published
-- questions. But grade_attempt() read the answer key as the definer, past that
-- policy, and never asked whether the question was still in the bank. So an
-- answer to a withdrawn question was graded and kept: from a set fetched a
-- moment before a veto, or from a client that simply remembered an id. It then
-- moved the ladder, the section level and the weakness figures on a question
-- the owner had decided nobody should be taught by.
--
-- Now the lookup asks `is_published` as well. The refusal keeps its readable
-- message and carries the hint `item_unavailable`, so the practice screen can
-- drop the question and move on rather than show an error. Nothing already
-- answered changes: the answers given before the question was withdrawn are
-- history, and the item row stays so that they keep resolving.

create or replace function public.grade_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role          text;
    v_correct_index smallint;
    v_type          text;
    v_function      text;
    v_day_start     timestamptz :=
        ((now() at time zone 'Asia/Tokyo')::date::timestamp at time zone 'Asia/Tokyo');
    v_today         integer;
begin
    new.user_id := (select auth.uid());
    if new.user_id is null then
        raise exception 'attempts require an authenticated session';
    end if;

    -- Only a privileged insert can name this column (see the grant in
    -- 20260927000100), so for the app it is always now().
    new.answered_at := coalesce(new.answered_at, now());

    -- The day's door, on the answer itself. Counted under a lock per learner,
    -- so two devices answering at once are counted one after the other.
    if new.answered_at >= v_day_start and not (select public.is_unlimited()) then
        perform pg_advisory_xact_lock(hashtextextended('attempts:' || new.user_id::text, 0));
        select count(*)::int
          into v_today
          from public.attempts a
         where a.user_id = new.user_id
           and a.answered_at >= v_day_start;
        if v_today >= (select public.my_daily_max()) then
            raise exception 'daily limit reached'
                using errcode = 'check_violation', hint = 'daily_limit_reached';
        end if;
    end if;

    -- The item still has to exist, and still be in the bank: a question that
    -- was withdrawn or vetoed takes no new answers. Its answer key is read here
    -- and not taken from the client — a timeout is graded, not merely accepted.
    select i.correct_index, i.item_type, i.function
      into v_correct_index, v_type, v_function
      from public.items i
     where i.id = new.item_id
       and i.is_published;

    if v_correct_index is null then
        raise exception 'no such item %', new.item_id
            using hint = 'item_unavailable';
    end if;

    if new.chosen_index = -1 then
        new.is_correct  := false;
        new.chosen_role := 'timed_out';
    else
        select o.role
          into v_role
          from public.item_options o
         where o.item_id = new.item_id
           and o.position = new.chosen_index;

        if v_role is null then
            raise exception 'no option % for item %', new.chosen_index, new.item_id;
        end if;

        new.is_correct  := (new.chosen_index = v_correct_index);
        new.chosen_role := v_role;
    end if;

    if new.stands_for is not null and (
           new.stands_for = new.item_id
           or exists (select 1 from public.attempts a
                       where a.user_id = new.user_id and a.item_id = new.item_id)
           or not exists (
                select 1
                  from public.review_schedule r
                  join public.items l on l.id = r.item_id
                 where r.user_id = new.user_id
                   and r.item_id = new.stands_for
                   and r.due_at <= now()
                   and l.item_type = v_type
                   and case when r.trap is not null then
                                exists (select 1 from public.item_options o
                                         where o.item_id = new.item_id
                                           and o.role = r.trap
                                           and o.position <> v_correct_index)
                            else l.function is null or l.function = v_function
                       end)
       ) then
        new.stands_for := null;
    end if;

    return new;
end;
$$;

comment on function public.grade_attempt is
    'Grades an answer from the item, never from the client. chosen_index -1 means '
    'the question clock ran out: wrong, with the role timed_out. A stands_for that '
    'the queue could not have served is cleared. An answer that would take today '
    'past my_daily_max() is refused (hint daily_limit_reached), unless the '
    'tester''s ceiling is lifted, and so is an answer to a question that is not '
    'published (hint item_unavailable).';
