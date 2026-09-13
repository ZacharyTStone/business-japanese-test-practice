-- Per-user data: who you are, what you answered, what you got wrong.
--
-- Everyone gets a row from the very first launch, including people who never
-- sign in: the app calls signInAnonymously() before showing anything, so there
-- is always an auth.users row and always a profile. Linking a Google identity
-- later keeps the same user id, so history, streak and weakness profile carry
-- over with no merge step — that is the whole reason anonymous-first is worth
-- the small extra complexity here.
--
-- Every table in this file is owner-only. auth.uid() is wrapped in a subselect
-- throughout so Postgres evaluates it once per statement instead of once per
-- row.

-- ------------------------------------------------------------------ profiles

create table public.profiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    display_name  text,
    target_level  text not null default 'J2' check (target_level in ('J3', 'J2', 'J1')),
    daily_goal    smallint not null default 5 check (daily_goal between 1 and 50),
    -- Mirrors auth.users.is_anonymous, kept in sync by a trigger, so the app can
    -- ask "should I nudge this person to link an account?" in one query.
    is_anonymous  boolean not null default true,
    linked_at     timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

comment on column public.profiles.daily_goal is
    'Items per day. The default of 5 is the product promise: one small set, finishable.';

-- Give every new auth user a profile, anonymous or not.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, is_anonymous, linked_at)
    values (
        new.id,
        coalesce(new.is_anonymous, false),
        case when coalesce(new.is_anonymous, false) then null else now() end
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- When an anonymous user links Google, auth.users.is_anonymous flips. Mirror it
-- rather than trusting the client to tell us.
create or replace function public.sync_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if coalesce(old.is_anonymous, false) is distinct from coalesce(new.is_anonymous, false) then
        update public.profiles
           set is_anonymous = coalesce(new.is_anonymous, false),
               linked_at    = case
                                  when coalesce(new.is_anonymous, false) then linked_at
                                  else coalesce(linked_at, now())
                              end,
               updated_at   = now()
         where id = new.id;
    end if;
    return new;
end;
$$;

create trigger on_auth_user_identity_changed
    after update on auth.users
    for each row execute function public.sync_profile_identity();

-- ---------------------------------------------------------- practice sessions

create table public.practice_sessions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    mode        text not null check (mode in ('daily', 'weakness', 'mock', 'free')),
    started_at  timestamptz not null default now(),
    finished_at timestamptz
);

create index practice_sessions_user_idx on public.practice_sessions (user_id, started_at desc);

-- ------------------------------------------------------------------ attempts

create table public.attempts (
    id           bigint generated always as identity primary key,
    user_id      uuid not null references auth.users (id) on delete cascade,
    session_id   uuid references public.practice_sessions (id) on delete set null,
    item_id      text not null references public.items (id) on delete cascade,
    chosen_index smallint not null check (chosen_index between 0 and 3),

    -- Both of these are filled in by the trigger below, never by the client.
    is_correct   boolean not null,
    -- WHICH trap caught them. "You get 発言聴解 wrong 40% of the time" is not
    -- actionable; "you reach for 尊敬語 when you need 謙譲語" is, and it is what
    -- weakness-targeted generation will eventually select on.
    chosen_role  text not null,

    elapsed_ms   integer check (elapsed_ms >= 0),
    answered_at  timestamptz not null default now()
);

create index attempts_user_time_idx on public.attempts (user_id, answered_at desc);
create index attempts_user_item_idx on public.attempts (user_id, item_id);

-- Grading happens here, not in the app. The client sends only which option it
-- touched; correctness and the distractor role are read from the item. This
-- keeps the record honest even if a future client has a bug, and it means the
-- answer key and the stats can never disagree.
create or replace function public.grade_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_role          text;
    v_correct_index smallint;
begin
    new.user_id := (select auth.uid());
    if new.user_id is null then
        raise exception 'attempts require an authenticated session';
    end if;

    select o.role, i.correct_index
      into v_role, v_correct_index
      from public.item_options o
      join public.items i on i.id = o.item_id
     where o.item_id = new.item_id
       and o.position = new.chosen_index;

    if v_role is null then
        raise exception 'no option % for item %', new.chosen_index, new.item_id;
    end if;

    new.is_correct  := (new.chosen_index = v_correct_index);
    new.chosen_role := v_role;
    new.answered_at := coalesce(new.answered_at, now());
    return new;
end;
$$;

create trigger grade_attempt_before_insert
    before insert on public.attempts
    for each row execute function public.grade_attempt();

-- -------------------------------------------------------------- review notes

-- 復習ノート. The schema is here from the start because an attempt is worth
-- almost nothing if you cannot come back to the ones that caught you.
create table public.review_notes (
    user_id  uuid not null references auth.users (id) on delete cascade,
    item_id  text not null references public.items (id) on delete cascade,
    note     text not null default '',
    added_at timestamptz not null default now(),
    primary key (user_id, item_id)
);

-- -------------------------------------------------------------- entitlements

-- One row when somebody buys the ad-free unlock. Written by the purchase
-- webhook (service role), read by the app to decide whether to show ads at all.
-- Listening practice never shows an ad regardless of what is in here — that is
-- a client rule, and the only ad surfaces are the result and list screens.
create table public.entitlements (
    user_id    uuid not null references auth.users (id) on delete cascade,
    product    text not null check (product in ('ads_free')),
    source     text not null check (source in ('app_store', 'play_store', 'stripe', 'grant')),
    granted_at timestamptz not null default now(),
    primary key (user_id, product)
);

-- ----------------------------------------------------------------------- RLS

alter table public.profiles          enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.attempts          enable row level security;
alter table public.review_notes      enable row level security;
alter table public.entitlements      enable row level security;

create policy "own profile is readable"  on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile is writable"  on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "own sessions are readable" on public.practice_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "own sessions are insertable" on public.practice_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own sessions are updatable" on public.practice_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own attempts are readable" on public.attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy "own attempts are insertable" on public.attempts for insert to authenticated with check ((select auth.uid()) = user_id);
-- Deliberately no update or delete policy: an answer already given is history.
-- Letting it be rewritten would quietly corrupt the weakness profile.

create policy "own notes are readable" on public.review_notes for select to authenticated using ((select auth.uid()) = user_id);
create policy "own notes are insertable" on public.review_notes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own notes are updatable" on public.review_notes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own notes are deletable" on public.review_notes for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own entitlements are readable" on public.entitlements for select to authenticated using ((select auth.uid()) = user_id);
-- No write policy: entitlements are granted by the purchase webhook, as the
-- service role. A client that could write this table could grant itself the
-- paid unlock.
