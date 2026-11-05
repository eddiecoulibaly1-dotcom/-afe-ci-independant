# AFE-CI Autonomous Organization V1 — P1–P7 implementation status

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
- `GET /dashboard`

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
