# E12 — Implementation status (2026-11-27)

## Implemented on development branch
- E12.1 Decision Pack Builder: evidence references, assumptions, constraints, unknowns, freshness, stable IDs, workspace scope.
- E12.2 Alternative trade-off scoring: deterministic normalized weights, bounded score, missing-data coverage.
- E12.3 Scenario comparison: read-only comparison, scenario assumptions and missing-impact limitations.
- E12.4 Integrated plan engine: required owner/deliverable fields, dependency validation, topological order, cycle detection.
- E12.5 Decision lifecycle: DG arbitration, rationale, immutable approval snapshot, separation of duty.
- E12.6 Governance gates: approval separate from execution authorization; no autonomous dispatch.
- E12.7 Outcome evaluation engine and UI: baseline/expected/actual, variance, evidence requirement, unknowns preserved; evaluation submission requires evidence and a concrete lesson, and closure is gated until the evaluation is saved.
- E12.8 UI/API foundation: decision dashboard route, list/create packs, score view, governed actions, plan/evaluation API endpoints.

## Database
Migration `20261127223000_afe_org_decision_packs.sql` applied to TEST Supabase project only.
- workspace scoped unique key
- RLS enabled
- zero client policies
- privileges revoked from anon/authenticated
- service_role granted
- no production migration.

## CI
CI validation includes TypeScript typecheck and unit/integration tests. Final validation must be reported against the latest commit SHA only.

## Not yet fully completed / caveats
- E12.6 bridge hardened: a DG-authorized integrated plan can be converted idempotently into E10 proposal drafts. The bridge is editor-gated, requires the immutable approval record and execution-authorization event, handles concurrent unique-key conflicts by read-back, and never dispatches missions. The proposal drafts still require the existing E10 governance/dispatch workflow.
- Authenticated Preview runtime and real use...[truncated]