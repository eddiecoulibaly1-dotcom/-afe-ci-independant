# AFE-CI Autonomous Organization V1 — P1–P9 implementation status

**Branch:** `feature/autonomous-organization-v1`  
**Environment:** preview / isolated test database only. No production approval.

## Delivered in this increment

- P1 API surface for workspace-scoped agent listing, creation, seeding of six specialist departments, configuration and lifecycle status.
- P2 durable mission intake, idempotency key, server-persisted queue, status inspection, pause/cancel controls and a database claim function using `FOR UPDATE SKIP LOCKED`, expiring leases and a fencing token. This is queue infrastructure, not yet a completed autonomous runtime.
- P3 private/proposed memory intake and admin validation/rejection before validated workspace sharing.
- P4 explicit agent-to-agent message handoffs within the same workspace.
- P5 role-gated administration, append-only mission/agent events, human approval inbox and decisions.
- P6 workspace dashboard counts for agent, mission, approval, message and memory states.
- P7 test plan and gates below. A passing test suite is not claimed until executed.

## API routes

All routes are under `/team/api/workspaces/:workspaceId` and use the existing bearer authentication in the parent server:
- `GET|POST /agents`; POST body `{ "action": "seed" }` seeds missing department agents as drafts.
- `GET|PATCH /agents/:agentId`
- `GET|POST /missions`; POST persists a mission and returns 202.
- `GET|POST /missions/:missionId` (pause/cancel by admins)
- `GET|POST /memory`; `POST /memory/:memoryId` to validate/reject/supersede
- `GET|POST /messages`
- `GET|POST /approvals`
- `GET /agent-dashboard (the legacy Team & Governance `/dashboard` route remains unchanged)`

Minimum roles: viewer for reads; editor for mission intake, memory proposals and messages; admin for agent configuration, approval decisions, seed and mission pause/cancel. Workspace ownership/admin membership is checked server-side before each request. The service-role key is never returned to the client.

## Runtime status and limitations

The queue claim function is a database primitive only. A server-side worker endpoint now exists at `/internal/agent-worker`. It authenticates a dedicated `AGENT_WORKER_SECRET` (or Vercel `CRON_SECRET`), atomically claims one mission, calls the configured model to produce a structured analysis deliverable, persists the result using a lease-fenced completion RPC, and schedules bounded retries on failure. `vercel.json` configures a one-minute Cron trigger; Vercel Cron runs only on Production deployments, so it is intentionally not active on this Preview branch. The worker does not execute external tools, payments, production changes, or other side effects. It is a background analysis worker, not yet the full autonomous tool-using agent runtime. End-to-end queue execution, crash/restart, live approval suspension/resume and real cron invocation still require a controlled environment test and secrets configuration.

## Worker deployment prerequisites\n\n- Configure `SUPABASE_URL` and server-only `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`).\n- Configure `AGENT_WORKER_SECRET` (or `CRON_SECRET`) as a high-entropy secret in the deployment environment.\n- Configure at least one valid model key (`OPENAI_API_KEY` or `GEMINI_API_KEY`) and optionally `AGENT_DEFAULT_PROVIDER`, `OPENAI_MODEL`, or `GEMINI_MODEL`.\n- The Vercel Cron schedule is enabled only after a Production deployment; Preview deployments must be tested by an authenticated manual invocation.\n- The endpoint processes one mission per invocation. Multiple invocations may run concurrently; database row locking and lease fencing prevent duplicate active claims.\n\n## P7 acceptance gates before autonomy is enabled

1. Typecheck and complete unit/integration test suite.
2. Cross-workspace access denial for every route and related row.
3. Concurrent worker claims yield one lease only; expired leases can be reclaimed.
4. Stale lease token cannot finish a reclaimed mission.
5. Idempotent intake and idempotent side-effect adapters.
6. Retry exhaustion and bounded backoff.
7. Process termination/restart resumes from durable checkpoint.
8. Approval suspends a run and only a fresh authorized human decision resumes it.
9. Agent cannot grant itself tools, raise autonomy, approve itself, or access secrets.
10. Browser closure has no effect on an already claimed server-side run.
11. Rate, token, wall-clock and per-tool quotas enforced and audited.
12. Production deploy/migrations remain separately approved.

## Explicit safety boundary

All seeded agents start as `draft`; default autonomy is L2 but activation is an admin action. The mission API caps requested autonomy at the agent's configured level. No generic tool execution endpoint is exposed. High-impact and external actions remain blocked until a registered tool adapter and payload-bound approval workflow are implemented and tested.


## P8 — Approval lifecycle

- An administrator can request an approval against a mission through `POST /approvals` with `action=request`, mission ID, action key, payload and risk level.
- The database function atomically records the pending approval, transitions the mission to `waiting_approval`, clears its lease and writes an audit event.
- Worker claims explicitly exclude missions with pending approvals.
- An administrator decision is executed through a server-only RPC. Approval requeues the mission only when no other approval remains pending; rejection fails the mission. Decisions are workspace-scoped and row-locked.
- Important boundary: the present analysis-only worker does not independently propose external tool actions. The approval mechanism is now operational for explicit approval requests, but must be connected to future privileged tool adapters before any external action can be considered autonomous.

## P9 — Inter-agent handoff dispatch

- Task/handoff messages are dispatched by the independent worker before it claims a mission.
- Each handoff creates one recipient mission in the same workspace. A unique `source_message_id` and idempotent insert prevent duplicate child missions when Cron retries.
- Dispatch is bounded (maximum 50 per invocation), row-locked with `SKIP LOCKED`, and only `task` / `handoff` message types are dispatched. Questions, responses, reviews and alerts remain in the message inbox.
- The recipient mission carries the sender, message type and payload in its input context and is processed by the same server-side mission worker.
- This implements durable one-way delegation. Automatic response synthesis, dependency graphs, parent-child completion aggregation, multi-agent consensus and recursive planning are not yet implemented and must not be described as finished.

## P8/P9 verification and deployment boundary

- Both migrations were applied to the isolated `afe-ci-test` project only.
- Verified database function privileges: `service_role` can execute the claim, approval and dispatch RPCs; `authenticated` and `anon` cannot.
- Supabase security advisor reports the nine agent tables as RLS-enabled with no policies (intentional deny-by-default because all access is server-mediated); it also reports leaked-password protection disabled in Auth, a separate project setting.
- Static tests cover pending-approval claim exclusion, atomic approval transitions, idempotent handoff creation, bounded dispatch and worker integration. These tests do not substitute for a live multi-worker race test or an end-to-end provider-backed delegation test.
- No production migration, merge to `main`, or production deployment has been performed.


## UI integration increment — 2026-11-06

- Team & Governance now renders workspace-scoped **Agents IA**, **Missions**, **Délégations** and **Approbations IA** views using the existing server API.
- Added defensive normalization for optional API collections before rendering list views.
- Fixed a route collision: autonomous agent metrics now use `/agent-dashboard`; the existing Team & Governance `/dashboard` route remains reserved for its original dashboard response.
- Added source-level UI contract tests. Vercel Preview build/typecheck is used as the deployment build gate; provider-backed browser interaction still requires an authenticated session.
- The current worker remains analysis-only. Delegations are durable one-way handoffs; automatic debate synthesis, consensus, recursive planning and full parent/child completion aggregation remain future implementation work.


## COO Control Plane increment — 2026-11-07

**Implementation added on `feature/autonomous-organization-v1`; validation not yet complete.**

- Added `/coo` operational dashboard and a navigation link from Team & Governance.
- Added workspace-scoped institutional departments, including the COO chain and separately protected independent arbitration and human validation functions.
- Added mission portfolio metadata to the existing durable agent mission records.
- Added operational task assignment to a department, agent and/or workspace member.
- Added department performance indicators, mission/task progress tracking, overdue/blocked/failed/approval alerts and alert acknowledgement/resolution.
- Added daily executive report snapshots and in-app notification to the workspace owner (Direction générale by default).
- Added an hourly Vercel Cron schedule that checks the workspace's configured daily report hour. Requires `CRON_SECRET` or `COO_REPORT_WORKER_SECRET`; Vercel Cron is not active in Preview.
- Added migrations `20261107190000_afe_ci_coo_operations_control_plane.sql` and `20261107200000_afe_ci_coo_foreign_key_indexes.sql`, API/UI source and static contract tests.

### Not yet verified

- All three migrations were applied successfully to the isolated `afe-ci-test` Supabase project on 2026-11-07. The five new tables were verified with RLS enabled; browser roles `anon` and `authenticated` have no direct table grants, while `service_role` has the required privileges.
- GitHub Actions passed TypeScript strict typecheck and the complete test suite on commit `038afc5dc32be34b0e1292ca1e9ebaa2523e7e4d` (127 tests in the run; all passed).
- Supabase Performance Advisor reports no unindexed foreign keys on the new COO tables or the modified agent/mission relations after the companion index migration. Thirty-four pre-existing unindexed-FK findings remain elsewhere in the broader database.
- Supabase Security Advisor reports the expected informational `RLS enabled / no policy` findings for the five server-only tables; this is intentional because browser grants are revoked and the API uses the server secret. The project also has a pre-existing leaked-password-protection warning.
- Authenticated API end-to-end flows, cross-workspace negative tests, actual notification delivery and Cron execution still require runtime integration tests. Vercel Cron does not run on Preview deployments.
- No Production migration, merge to `main`, or Production deployment has been performed.

The control plane must not be described as live/operational until the gates in `docs/AFE_CI_COO_OPERATIONS_CONTROL_PLANE.md` have passed.
