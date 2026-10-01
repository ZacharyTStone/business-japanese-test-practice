-- The rules an answer must keep, enforced by the database itself whatever
-- code writes the row. Applied by the deploy after the migrations, with
-- wrangler d1 execute --remote --file: a migration goes to D1 as one request
-- that D1 splits into statements on its own side, and that splitter cuts a
-- trigger body at its first semicolon (incomplete input). The file path is the
-- one built to load whole SQLite dumps, triggers included.
--
-- Each trigger is dropped and created again, so applying this file is how a
-- change to one ships, and applying it twice changes nothing.

-- An answer given is history. Starting again deletes a whole history
-- (client/worker/core/profile.ts, resetProgress), nothing edits one.
drop trigger if exists attempts_are_history;
create trigger attempts_are_history
before update on attempts
begin
    select raise(abort, 'an answer already given cannot be changed');
end;

-- The question has to be in the bank, the option has to exist, and the grade
-- is the item’s, never the writer’s: the Worker computes it inside the INSERT
-- (core/grade.ts), and a write that went around it with any other grade is
-- refused. The app sends only which option was touched. In this order, so a
-- withdrawn question is said to be withdrawn.
drop trigger if exists attempts_need_a_live_question;
create trigger attempts_need_a_live_question
before insert on attempts
begin
    select raise(abort, 'item_unavailable')
     where not exists (select 1 from items i where i.id = new.item_id and i.is_published = 1);
    select raise(abort, 'no_such_option')
     where new.chosen_index <> -1
       and not exists (select 1 from item_options o
                        where o.item_id = new.item_id and o.position = new.chosen_index);
    select raise(abort, 'graded_wrongly')
     where (new.chosen_index = -1
            and (new.is_correct is not 0 or new.chosen_role is not 'timed_out'))
        or (new.chosen_index <> -1
            and (new.is_correct is not (select new.chosen_index = i.correct_index
                                          from items i where i.id = new.item_id)
                 or new.chosen_role is not (select o.role from item_options o
                                             where o.item_id = new.item_id
                                               and o.position = new.chosen_index)));
end;

-- The day’s door, on the answer itself: fifteen answers in the Japanese
-- calendar day the answer is given in (or the account’s own max_daily_goal),
-- unless the tester row lifts it. The day is the answer’s own, from the same
-- clock the queue counted the day’s set by, so a few milliseconds between the
-- Worker’s clock and the database’s at midnight cannot shut a new day early.
-- D1 runs one write at a time, so a second device cannot slip past the count.
drop trigger if exists attempts_daily_ceiling;
create trigger attempts_daily_ceiling
before insert on attempts
begin
    select raise(abort, 'daily_limit_reached')
     where not coalesce((select t.unlimited from testers t join users u on u.email = t.email
                          where u.id = new.user_id), 0)
       and (select count(*) from attempts a
             where a.user_id = new.user_id
               and a.answered_at >= strftime('%Y-%m-%dT%H:%M:%fZ', date(new.answered_at, '+9 hours'), '-9 hours'))
           >= coalesce((select t.max_daily_goal from testers t join users u on u.email = t.email
                         where u.id = new.user_id), 15);
end;
