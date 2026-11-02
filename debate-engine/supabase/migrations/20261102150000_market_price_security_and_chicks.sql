-- AFE-CI hardening + chick quotation metadata.
-- Apply manually only after review and explicit approval.
-- This migration is additive and does not alter existing observations.

-- Fingerprints must be unique per owner, not globally: identical public quotations
-- imported by two farms must remain independently visible to both users.
alter table public.market_price_observations
  drop constraint if exists market_price_observations_fingerprint_key;
create unique index if not exists market_price_observations_owner_fingerprint_uidx
  on public.market_price_observations (created_by, fingerprint);

-- One observation can have only one direct correction. This closes the race in
-- which two concurrent correction requests both pass the trigger's EXISTS check.
create unique index if not exists market_price_observations_one_correction_uidx
  on public.market_price_observations (supersedes_id)
  where supersedes_id is not null;

-- Enforce that an observation can only reference an import batch owned by the
-- same user, even if a future server-side code path is implemented incorrectly.
alter table public.market_price_import_batches
  add constraint market_price_import_batches_id_owner_uidx unique (id, created_by);

alter table public.market_price_observations
  drop constraint if exists market_price_observations_batch_id_fkey;
alter table public.market_price_observations
  add constraint market_price_observations_batch_owner_fkey
  foreign key (batch_id, created_by)
  references public.market_price_import_batches (id, created_by)
  on delete restrict;

-- Explicit server-role grants: the API uses the server secret only after
-- authenticateRequest has verified the caller's bearer token and obtained auth.uid().
grant select, insert, update on public.market_price_import_batches to service_role;
grant select, insert on public.market_price_observations to service_role;
grant select on public.market_price_observations_current to service_role;

-- Optional product-specific fields. They are populated for chick quotations
-- and remain NULL for feed, grain and other market observations.
alter table public.market_price_observations
  add column if not exists product_category text,
  add column if not exists strain text,
  add column if not exists vaccination_status text,
  add column if not exists minimum_quantity integer,
  add column if not exists pack_size integer,
  add column if not exists delivery_fee numeric(18,4),
  add column if not exists availability_date date;

alter table public.market_price_observations
  drop constraint if exists market_price_observations_product_category_check;
alter table public.market_price_observations
  add constraint market_price_observations_product_category_check
  check (product_category is null or product_category in ('chick','feed','raw_material','equipment','health','other'));

alter table public.market_price_observations
  drop constraint if exists market_price_observations_quantity_check;
alter table public.market_price_observations
  add constraint market_price_observations_quantity_check
  check ((minimum_quantity is null or minimum_quantity > 0)
     and (pack_size is null or pack_size > 0)
     and (delivery_fee is null or delivery_fee >= 0));

-- Preserve product-specific attributes through every correction.
create or replace function public.validate_market_price_correction()
returns trigger language plpgsql as $$
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
    or coalesce(original.region,'') <> coalesce(new.region,'')
    or coalesce(original.city,'') <> coalesce(new.city,'')
    or coalesce(original.product_category,'') <> coalesce(new.product_category,'')
    or coalesce(original.strain,'') <> coalesce(new.strain,'')
  then raise exception 'Correction must preserve owner, product, kind, currency, unit, geography, category and strain'; end if;
  if exists(select 1 from public.market_price_observations child where child.supersedes_id = original.id) then
    raise exception 'This observation already has a correction; correct the latest version instead';
  end if;
  return new;
end;
$$;

create index if not exists market_price_observations_chick_lookup_idx
  on public.market_price_observations (created_by, product_category, strain, city, observed_at desc)
  where product_category = 'chick';
