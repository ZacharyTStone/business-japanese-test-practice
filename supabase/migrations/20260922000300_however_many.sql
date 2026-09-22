-- However many. The hundred comes off.
--
-- 20260922000200 gave one account a number of its own and bounded it at a
-- hundred, on the reasoning that the app fetches a set in one request and no
-- sitting is longer than that. The first half is true and the second is not
-- mine to decide: the owner asked for "however many", and a hundred is a
-- number I invented standing in front of it.
--
-- It also was not protecting anything. `next_items()` can only return what is
-- in the level window of the published bank — 146 items today, and a learner's
-- window is a fraction of that — so the size asked for stops mattering long
-- before the number does. A goal of five hundred does not fetch five hundred
-- rows; it fetches everything there is and does not shut the door afterwards.
-- The real bound is the bank, and the bank enforces it by existing.
--
-- So the ceiling is the column's own: both are `smallint`, which ends at
-- 32767. That is a fact about the type rather than a product decision, which
-- is the point — there is now no number here that somebody chose. Everything
-- else from 20260922000200 stands unchanged: null on a tester row still means
-- the standard ten-a-day, fifteen-at-most, the trigger still asks who is
-- writing, and `my_daily_max()` is still what the view and the queue read.
--
-- The owner asked for this (2026-09-22).

alter table public.testers drop constraint testers_max_daily_goal_check;
alter table public.testers
    add constraint testers_max_daily_goal_check
        check (max_daily_goal is null or max_daily_goal >= 1);

comment on column public.testers.max_daily_goal is
    'The largest daily set this account may choose, and the ceiling its day '
    'shuts at. Null — every row but the owner''s — means the standard fifteen '
    '(daily_max()). Set by the owner (`bjt tester <email> --max-goal 200`), '
    'never from the client. No upper bound but the column''s own (smallint, '
    'so 32767): what actually limits a set is how many items the published '
    'bank has in this learner''s level window, and next_items() serves what it '
    'has however large a number it is handed.';

alter table public.profiles drop constraint profiles_daily_goal_check;
alter table public.profiles
    add constraint profiles_daily_goal_check check (daily_goal >= 1);

comment on column public.profiles.daily_goal is
    'Items in the daily set. Ten is the product promise: one sitting, '
    'finishable. Fifteen is as high as it goes for everybody but the one '
    'account whose testers.max_daily_goal says otherwise — see my_daily_max(), '
    'which is both the bound on this and the day''s door, and the trigger on '
    'this table, which is what enforces it. The constraint here is only that a '
    'day is at least one question.';
