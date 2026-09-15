-- Somebody has to be able to write `entitlements`.
--
-- The table has had a read policy and no write policy since it was created,
-- which is right — a client that could write it could grant itself the paid
-- unlock. But "no write policy" was implemented as "nothing writes it at all":
-- there is no webhook, no function, and no way to give somebody the ad-free
-- unlock even by hand. `source` has allowed 'grant' since day one and nothing
-- could produce one.
--
-- This adds the writer, as a security-definer function the service role calls.
-- Three consequences worth stating:
--
-- **Replays are free.** A store webhook will deliver the same purchase more than
-- once; that is normal, not an error. The external transaction id is unique, so
-- the second delivery updates the row it already wrote instead of adding one.
--
-- **Revoking is a column, not a delete.** A refunded purchase that vanished
-- would leave no answer to "why did this person have the unlock in March", and
-- a chargeback dispute is exactly when that question gets asked.
--
-- **The client still cannot write any of it.** The function is owner-executed
-- and granted only to service_role, so it is reachable from the publishing
-- laptop or a deployed webhook and from nowhere a phone can call.

alter table public.entitlements
    add column if not exists external_id text,
    add column if not exists revoked_at  timestamptz,
    add column if not exists note        text;

comment on column public.entitlements.external_id is
    'The store or processor transaction id. Unique, so a replayed webhook delivery updates rather than duplicates.';
comment on column public.entitlements.revoked_at is
    'Set when a purchase is refunded or a grant withdrawn. The row stays: a chargeback dispute is exactly when "why did they have this in March" gets asked.';

create unique index if not exists entitlements_external_id_idx
    on public.entitlements (source, external_id)
    where external_id is not null;

-- ------------------------------------------------------------------ granting

create or replace function public.grant_entitlement(
    p_user_id     uuid,
    p_product     text default 'ads_free',
    p_source      text default 'grant',
    p_external_id text default null,
    p_note        text default null
)
returns public.entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
    row public.entitlements;
begin
    insert into public.entitlements (user_id, product, source, external_id, note)
    values (p_user_id, p_product, p_source, p_external_id, p_note)
    on conflict (user_id, product) do update set
        source      = excluded.source,
        external_id = coalesce(excluded.external_id, public.entitlements.external_id),
        note        = coalesce(excluded.note, public.entitlements.note),
        -- Re-granting after a revocation restores it, which is what a
        -- re-purchase after a refund means.
        revoked_at  = null
    returning * into row;

    return row;
end;
$$;

create or replace function public.revoke_entitlement(
    p_user_id uuid,
    p_product text default 'ads_free',
    p_note    text default null
)
returns public.entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
    row public.entitlements;
begin
    update public.entitlements
       set revoked_at = now(),
           note       = coalesce(p_note, note)
     where user_id = p_user_id
       and product = p_product
    returning * into row;

    return row;
end;
$$;

-- The door should not be in the wall: these are revoked from everyone first and
-- granted back only to the service role, matching 20260914000100.
revoke execute on function public.grant_entitlement(uuid, text, text, text, text)
    from public, anon, authenticated;
revoke execute on function public.revoke_entitlement(uuid, text, text)
    from public, anon, authenticated;

grant execute on function public.grant_entitlement(uuid, text, text, text, text) to service_role;
grant execute on function public.revoke_entitlement(uuid, text, text) to service_role;

comment on function public.grant_entitlement is
    'Grant an entitlement as the service role. Idempotent on (source, external_id) so a replayed purchase webhook is free.';
comment on function public.revoke_entitlement is
    'Withdraw an entitlement without deleting the record of it having existed.';
