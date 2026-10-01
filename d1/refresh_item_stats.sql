-- How often the people who meet each question get it right: the shared
-- bank’s own measure of difficulty, which the practice queue reads once a
-- question has been answered by eight people or more (core/snapshot.ts).
-- Run by the nightly workflow (wrangler d1 execute --remote --file), as one
-- all-or-nothing unit.
--
-- From nothing, every time: a history that was reset must not leave its
-- counts behind, and a full recount is still one pass at this scale.
--
-- Each person’s first answer to each question, and never a timeout. A second
-- answer comes after the explanation was read, and a timeout is a fact about
-- the clock (or a phone put down), not about the Japanese.
delete from item_stats;

insert into item_stats (item_id, answered, correct, p_correct, updated_at)
select f.item_id,
       count(*),
       sum(f.is_correct),
       sum(f.is_correct) * 1.0 / count(*),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from (select a.item_id, a.is_correct, a.chosen_role,
               row_number() over (partition by a.user_id, a.item_id
                                  order by a.answered_at, a.id) as nth
          from attempts a) f
 where f.nth = 1 and f.chosen_role <> 'timed_out'
 group by f.item_id;
