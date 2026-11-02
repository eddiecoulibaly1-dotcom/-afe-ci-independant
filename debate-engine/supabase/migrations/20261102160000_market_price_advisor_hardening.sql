-- AFE-CI test hardening: pin trigger function search paths and cover FK/RLS access paths.
-- This incremental migration is safe to apply after the two ledger migrations.

create or replace function public.reject_market_price_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Market price observations are append-only; insert a correction instead.';
end;
$$;

create or replace function public.validate_market_price_correction()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare original public.market_price_observations%rowtype;
begin
  if new.supersedes_id is null then return new; end if;
  select * into original from public.market_price_observations where id = new.supersedes_id;
  if not found then raise exception 'Observation to correct was not found'; end if;
  if original.created_by <> new.created_by
    or original.normalized_product <> new.normalized_product
    or original.kind <> new.kind
    or original.currency <> new.currency
    or original.unit <> new.unit
    or original.country <> new.country
    or original.region is distinct from new.region
    or original.city is distinct from new.city
    or original.product_category is distinct from new.product_category
    or original.strain is distinct from new.strain
    or original.vaccination_status is distinct from new.vaccination_status
    or original.minimum_quantity is distinct from new.minimum_quantity
    or original.pack_size is distinct from new.pack_size
    or original.delivery_fee is distinct from new.delivery_fee
    or original.availability_date is distinct from new.availability_date
  then raise exception 'Correction must preserve owner, product, kind, currency, unit, geography and chick quotation attributes'; end if;
  if exists(select 1 from public.market_price_observations child where child.supersedes_id = original.id) then
    raise exception 'This observation already has a correction; correct the latest version instead';
  end if;
  return new;
end;
$$;

drop policy if exists market_price_batches_select_own on public.market_price_import_batches;
create policy market_price_batches_select_own on public.market_price_import_batches
  for select to authenticated using (created_by = (select auth.uid()));

drop policy if exists market_price_observations_select_own on public.market_price_observations;
create policy market_price_observations_select_own on public.market_price_observations
  for select to authenticated using (created_by = (select auth.uid()));

create index if not exists market_price_import_batches_created_by_idx
  on public.market_price_import_batches (created_by);
create index if not exists market_price_observations_batch_owner_idx
  on public.market_price_observations (batch_id, created_by);
