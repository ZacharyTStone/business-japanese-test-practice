-- An index for starting again.
--
-- Found in review (2026-09-30). `attempts.session_id` points at
-- practice_sessions `on delete set null`, and nothing indexed it. Deleting a
-- session therefore means Postgres looking through the whole of `attempts` for
-- answers that name it, once per session — which is exactly what
-- reset_my_progress() does, a whole history's sessions at a time, and it
-- deletes them after the learner's own answers are gone, so every one of those
-- scans finds nothing. With 205,000 answers in the table, resetting a history
-- of forty sessions took 425 milliseconds on a scratch database, and 2 with
-- this index; the review measured 2.66 seconds against 2.3 milliseconds on
-- its own. It grows with everybody's answers, not with the learner's.
--
-- Partial, because an answer given outside a session (an older client, a
-- fixture) has nothing to find, and the index need not carry it.

create index attempts_session_idx on public.attempts (session_id)
    where session_id is not null;
