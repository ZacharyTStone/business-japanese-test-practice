-- A question is never deleted, and now the database says so.
--
-- "A question leaves the bank through batches/withdrawn.txt, never by
-- deletion" (CLAUDE.md), and a veto is "an unpublish, never a delete, so every
-- attempt, review rung and report pointing at the item keeps resolving". Both
-- are true of everything this repository writes — `bjt publish` upserts items
-- and deletes only an item's own options before re-inserting them, and
-- veto_item() sets is_published — and neither was true of the schema. Found in
-- review (2026-09-30): every table that points at a question was declared
-- `on delete cascade`, so one `delete from items` — typed at the SQL editor to
-- tidy up a bad batch, or a `delete from bundles`, which cascaded to its items
-- in turn — would have taken every learner's answers to those questions with
-- it, their spacing ladder, their notes and the reports about them, silently
-- and for good.
--
-- So the history is RESTRICT now. A question somebody has answered, scheduled,
-- noted, reported, vetoed or been re-tested on cannot be deleted, and a bundle
-- cannot be deleted while it holds a question; the error names the table in
-- the way. A question nobody has met can still be deleted, which is the one
-- case where nothing resolves through it. Two references keep their cascade on
-- purpose: `item_options`, which are the question itself rather than something
-- pointing at it, and `item_stats`, which refresh_item_stats() recounts from
-- nothing every night and holds no history of its own.
--
-- `attempts.stands_for` was `on delete set null` (20260927000100). It is
-- history too — which lesson an answer re-tested — and a null there reads as
-- "this was a fresh question", which would be a quiet lie; it goes RESTRICT
-- with the rest.

alter table public.items
    drop constraint items_bundle_id_fkey,
    add  constraint items_bundle_id_fkey
         foreign key (bundle_id) references public.bundles (id) on delete restrict;

alter table public.attempts
    drop constraint attempts_item_id_fkey,
    add  constraint attempts_item_id_fkey
         foreign key (item_id) references public.items (id) on delete restrict,
    drop constraint attempts_stands_for_fkey,
    add  constraint attempts_stands_for_fkey
         foreign key (stands_for) references public.items (id) on delete restrict;

alter table public.review_schedule
    drop constraint review_schedule_item_id_fkey,
    add  constraint review_schedule_item_id_fkey
         foreign key (item_id) references public.items (id) on delete restrict;

alter table public.review_notes
    drop constraint review_notes_item_id_fkey,
    add  constraint review_notes_item_id_fkey
         foreign key (item_id) references public.items (id) on delete restrict;

alter table public.item_feedback
    drop constraint item_feedback_item_id_fkey,
    add  constraint item_feedback_item_id_fkey
         foreign key (item_id) references public.items (id) on delete restrict;

alter table public.item_vetoes
    drop constraint item_vetoes_item_id_fkey,
    add  constraint item_vetoes_item_id_fkey
         foreign key (item_id) references public.items (id) on delete restrict;
