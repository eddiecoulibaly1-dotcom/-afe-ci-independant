-- AFE-CI Debate Engine: remove duplicate legacy policies and indexes.
-- Safe to apply in both Test and Production: every object is guarded by IF EXISTS.
-- No table data, constraints, or canonical indexes are changed.
-- Schedule on a quiet window because DROP INDEX takes a table lock.

begin;

-- These legacy policies have predicates identical to the canonical policies.
-- PostgreSQL combines permissive policies with OR, so duplicates add no access
-- beyond the canonical policy and only make policy evaluation harder to audit.
drop policy if exists debates_select_v09_access on public.debates;
drop policy if exists debates_update_v09_access on public.debates;

-- Keep the canonical indexes introduced by the Debate Engine foreign-key
-- indexing migration; remove their byte-for-byte duplicate legacy counterparts.
drop index if exists public.debate_events_round_idx;
drop index if exists public.debate_evidence_round_idx;
drop index if exists public.debate_share_links_created_by_idx;
drop index if exists public.debate_shares_shared_by_idx;

commit;
