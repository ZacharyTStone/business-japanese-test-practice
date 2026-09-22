-- One press that takes a question out of the bank.
--
-- `item_feedback` (20260919000400) is the other half of this and deliberately
-- does nothing: a report is an opinion, it is counted, and the item keeps being
-- served until somebody looks. That comment ends "an item that vanishes from
-- the bank on one press is a bank one press away from empty", and it is still
-- the right rule for a tester.
--
-- It is the wrong rule for the owner. Reviewing the bank means meeting a bad
-- question in the app, and the useful moment to remove it is that moment —
-- not a note to read later, by which time the item has been served again. So
-- a veto is an unpublish: the item leaves the bank for everybody, at once. The
-- owner asked for this (2026-09-22).
--
-- **The button is not for everyone.** What made one press dangerous has not
-- changed; what changed is who is pressing. `testers.may_veto` is off for every
-- row by default and the owner turns it on for their own
-- (`bjt tester <email> --veto`). A tester without it gets the report button and
-- nothing else, which is what the paragraph above is about.
--
-- **Why it is not a delete.** `is_published = false` leaves the row, so every
-- attempt, every review_schedule rung and every report that already points at
-- the item keeps pointing at something. A learner's history does not develop
-- holes because the owner disliked a question afterwards. `next_items()`
-- already filters on `is_published`, so no queue change is needed: the item is
-- gone from the next set anybody draws, including the one being drawn now.
--
-- **Why nothing is recorded against the learner.** Vetoing happens instead of
-- answering, so no `attempts` row is written — and since `v_my_day` counts
-- attempts, a vetoed question does not spend one of the day's ten either. The
-- set in progress simply gets shorter.

alter table public.testers
    add column may_veto boolean not null default false;

comment on column public.testers.may_veto is
    'Whether this account may unpublish a question from inside the app. Off by '
    'default; the owner''s row is the one that has it. Set by the owner '
    '(`bjt tester <email> --veto`), never from the client.';

-- ------------------------------------------------------------- may_i_veto()

-- The client asks this once to decide whether to draw the button. Shaped like
-- is_tester()/is_unlimited(): security definer because it reads `testers`,
-- which the caller cannot, and it answers a yes/no about the caller alone.
create or replace function public.may_i_veto()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select public.is_tester())
       and exists (
               select 1
                 from public.testers t
                where t.email = lower(auth.jwt() ->> 'email')
                  and t.may_veto
           );
$$;

comment on function public.may_i_veto() is
    'True when the caller is a tester whose row carries may_veto. The app draws '
    'the veto button on this; veto_item() re-checks it rather than trusting it.';

revoke execute on function public.may_i_veto() from public, anon;
grant execute on function public.may_i_veto() to authenticated;

-- -------------------------------------------------------------- the ledger

-- An unpublish is a decision, so it leaves a record saying who and when. One
-- row per item rather than per press: vetoing an item already vetoed is not a
-- second event, and `on conflict do nothing` keeps the first press's timestamp,
-- which is the one that mattered.
create table public.item_vetoes (
    item_id    text primary key references public.items (id) on delete cascade,
    user_id    uuid not null references auth.users (id) on delete cascade,
    note       text not null default '' check (length(note) <= 500),
    created_at timestamptz not null default now()
);

comment on table public.item_vetoes is
    'Questions an owner removed from the bank from inside the app, and when. '
    'The item row itself is left in place with is_published = false.';

create index item_vetoes_when_idx on public.item_vetoes (created_at desc);

alter table public.item_vetoes enable row level security;

-- Readable by a tester who may veto — that is, the owner reviewing what they
-- have taken out. Never writable from the client: the only way a row appears
-- here is veto_item(), which writes it as the definer alongside the unpublish,
-- so the ledger and the bank cannot disagree.
create policy "vetoes are readable by whoever may veto" on public.item_vetoes
    for select to authenticated
    using ((select public.is_tester()) and (select public.may_i_veto()));

revoke all on public.item_vetoes from anon;
grant select on public.item_vetoes to authenticated;

-- -------------------------------------------------------------- veto_item()

-- Takes the item id and an optional sentence. Re-checks may_i_veto() rather
-- than trusting the client that drew the button, for the same reason
-- `attempts` reads its user from the session: a client that can call an RPC
-- can call it having lied about what it is allowed to do.
create or replace function public.veto_item(p_item_id text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user uuid := (select auth.uid());
begin
    if v_user is null then
        raise exception 'a veto needs an authenticated session';
    end if;
    if not (select public.may_i_veto()) then
        raise exception 'this account may not veto a question';
    end if;
    if not exists (select 1 from public.items where id = p_item_id) then
        raise exception 'no such item: %', p_item_id;
    end if;

    update public.items
       set is_published = false
     where id = p_item_id;

    insert into public.item_vetoes (item_id, user_id, note)
    values (p_item_id, v_user, coalesce(left(p_note, 500), ''))
    on conflict (item_id) do nothing;
end;
$$;

comment on function public.veto_item(text, text) is
    'Unpublish one question and record who did it. Requires may_i_veto(). The '
    'item stays in the table so that attempts, schedules and reports pointing '
    'at it keep resolving; next_items() drops it because it filters on '
    'is_published.';

revoke execute on function public.veto_item(text, text) from public, anon;
grant execute on function public.veto_item(text, text) to authenticated;
