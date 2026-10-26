-- AFE-CI security/performance hardening applied to production on 2026-10-26.
-- Keep this migration idempotent so the repository remains the source of truth.

-- Admin RPCs must not be callable anonymously. Signed-in callers are still
-- allowed because the functions independently enforce the admin role.
revoke execute on function public.admin_record_farm_health(uuid,date,text,text,integer,date,text) from anon;
revoke execute on function public.admin_record_feed_consumption(uuid,text,numeric,date,text) from anon;
revoke execute on function public.admin_update_farm_lot(uuid,text,uuid,date,integer,integer,integer,date,text,text) from anon;
revoke execute on function public.apply_farm_lot_event() from anon, authenticated;

-- Views should obey the caller's RLS policies instead of the view owner's.
alter view public.farm_health_alerts set (security_invoker = true);
alter view public.farm_feed_cost_summary set (security_invoker = true);

-- Debate policies had redundant permissive own-user policies; the broader
-- V0.9 access policies already include owners.
drop policy if exists debates_select_own on public.debates;
drop policy if exists debates_update_own on public.debates;

-- Cover foreign keys flagged by the Supabase performance advisor.
create index if not exists applications_job_id_idx on public.applications(job_id);
create index if not exists farm_expenses_lot_id_idx on public.farm_expenses(lot_id);
create index if not exists farm_lot_costs_created_by_idx on public.farm_lot_costs(created_by);
create index if not exists farm_lot_events_created_by_idx on public.farm_lot_events(created_by);
create index if not exists farm_lot_health_created_by_idx on public.farm_lot_health(created_by);

-- Remove the identical duplicate index flagged on job_scores.
drop index if exists public.job_scores_candidate_final_idx;
