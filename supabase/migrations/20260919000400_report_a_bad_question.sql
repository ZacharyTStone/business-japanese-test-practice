-- Somewhere to say "this question is wrong".
--
-- Every item in the bank was written by a model and passed by other models: a
-- cheap proofreader, an answerability gate that sees the whole stimulus and a
-- cold view that does not, a dedupe check, and — for 画像把握 — a reviewer shown
-- the picture. That catches a great deal and it does not catch everything. What
-- gets through is the item that is *defensible but odd*: Japanese nobody would
-- actually say, a situation that does not quite hang together, a second option
-- that is arguably as good. The owner has been meeting those and had nowhere to
-- put them (2026-09-19).
--
-- So: one report per person per item, a fixed reason and an optional sentence.
--
-- **Why a fixed reason rather than a free-text box.** A box produces prose
-- nobody counts. A reason produces a number — "eleven 総合読解 items reported
-- unnatural this month" — which is the shape the generator loop can act on:
-- `bjt/fidelity/discriminator.py` already feeds the judge's tells back into the
-- prompts, and a human's tells are better tells. The sentence is there for the
-- half of a report the categories cannot hold, not instead of them.
--
-- **Why it is not an attempt.** `attempts` is what happened; this is an opinion
-- about the question, and unlike an answer an opinion may be corrected. Hence
-- one row per person per item, updatable, rather than the append-only ledger
-- `attempts` deliberately is.
--
-- Nothing here reaches the queue. A reported item keeps being served until a
-- person looks at the report and unpublishes it, because "some tester pressed a
-- button" is not a review, and an item that vanishes from the bank on one press
-- is a bank one press away from empty.

create table public.item_feedback (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    item_id    text not null references public.items (id) on delete cascade,

    -- A closed set on purpose: see above. `other` exists so that a report that
    -- fits nothing is still a report rather than a shrug, and its `note` is the
    -- part worth reading.
    reason     text not null check (reason in (
                   'unnatural',     -- 日本語が不自然 / nobody would say this
                   'wrong_answer',  -- the option marked correct is not correct
                   'ambiguous',     -- another option is just as good
                   'unclear',       -- the question cannot be understood
                   'audio',         -- the clip is wrong, cut off, or misread
                   'other'
               )),
    note       text not null default '' check (length(note) <= 500),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- One report per person per item. A second press corrects the first rather
    -- than counting twice, which keeps "how many people reported this" a true
    -- number instead of a measure of how annoyed one person was.
    unique (user_id, item_id)
);

comment on table public.item_feedback is
    'A tester''s report that a question is wrong or odd. One row per person per '
    'item, correctable. Read by a human; nothing in the queue looks at it.';

comment on column public.item_feedback.note is
    'The half of a report the categories cannot hold. Optional, and capped so the '
    'column cannot become a place to paste a document.';

create index item_feedback_item_idx on public.item_feedback (item_id, created_at desc);

-- `user_id` is filled in from the session, never sent by the client — the same
-- rule attempts follow, and for the same reason: a client that can name the
-- author of a row can name somebody else.
create or replace function public.stamp_item_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.user_id := (select auth.uid());
    if new.user_id is null then
        raise exception 'feedback requires an authenticated session';
    end if;
    new.updated_at := now();
    if tg_op = 'UPDATE' then
        new.created_at := old.created_at;
    end if;
    return new;
end;
$$;

create trigger stamp_item_feedback_before_write
    before insert or update on public.item_feedback
    for each row execute function public.stamp_item_feedback();

-- ------------------------------------------------------------------- policies

alter table public.item_feedback enable row level security;

-- Testers only, and only their own rows — the same shape as every other policy
-- in `public`. A schema test asserts that every policy here names is_tester(),
-- so this table is inside the door by construction rather than by memory.
create policy "own feedback is readable" on public.item_feedback
    for select to authenticated
    using ((select public.is_tester()) and (select auth.uid()) = user_id);

create policy "own feedback is writable" on public.item_feedback
    for insert to authenticated
    with check ((select public.is_tester()) and (select auth.uid()) = user_id);

-- Correctable, unlike an attempt. Somebody who pressed 「音声がおかしい」 and then
-- realised the Japanese was the problem should be able to say so.
create policy "own feedback is correctable" on public.item_feedback
    for update to authenticated
    using ((select public.is_tester()) and (select auth.uid()) = user_id)
    with check ((select public.is_tester()) and (select auth.uid()) = user_id);

-- No delete policy, for the same reason `attempts` has none: a report that was
-- made was made. Correcting it is `update`.

-- The anon role holds nothing in `public`, and a new table must not be the
-- exception. No delete grant either: the policy list above has no delete policy
-- to go with one.
revoke all on public.item_feedback from anon;
grant select, insert, update on public.item_feedback to authenticated;

-- A trigger's function is reachable by name unless it is taken away, exactly as
-- grade_attempt() is (see 20260914000100).
revoke execute on function public.stamp_item_feedback() from public, anon, authenticated;
