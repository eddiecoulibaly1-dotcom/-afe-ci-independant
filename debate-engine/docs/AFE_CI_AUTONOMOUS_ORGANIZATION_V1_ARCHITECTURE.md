# AFE-CI Autonomous Organization V1 — Architecture & P0 Security Baseline

**Status:** P0 foundation in progress · Preview only · Not production-approved  
**Branch:** `feature/autonomous-organization-v1`  
**Parent baseline:** Team & Governance preview branch `feature/team-governance-engine`

## 1. Product objective

Turn workspace departments into server-operated specialist AI agents. A workspace remains the organizational and authorization boundary; an agent is a configured specialist operating inside that workspace. The UI is a control plane only. It submits missions, displays durable status and results, and collects human approvals. It does not execute agent work in the browser.

## 2. Non-negotiable execution requirement

Mission creation must persist a durable record before execution is requested. The server-side runtime must continue after the browser, tab, or phone closes. Each operation is represented by an idempotent step with a persisted checkpoint, lease, bounded retries, and an auditable event. An interrupted worker may be reclaimed after lease expiry. No correctness property may depend on a browser timer, open WebSocket, service worker, or mobile process.

## 3. Architecture decision

The current product is an established TypeScript Node HTTP application deployed as Vercel Functions, with Supabase Postgres/Auth as its persistent system of record. Keep that stack; do not introduce a parallel eve application or a second database.

The execution layer must be selected and proven against the existing custom Node/Vercel function entrypoint before P2:
- Preferred candidate: Vercel Workflow SDK + Vercel World for durable orchestration, if the current Vercel build integration can safely instrument the existing custom Node server and emit protected workflow/step consumers.
- Fallback candidate: a database-backed mission/step queue with atomic Postgres claim/lease RPCs and an independently scheduled server-side dispatcher. The dispatcher must be hosted by Vercel/Supabase infrastructure, not by a browser or an in-process timer.
- Do not use the Workflow Postgres World on Vercel: its worker requires a long-lived process and the official guidance says it is not compatible with serverless Vercel deployments.

No runtime is declared production-ready until restart/replay, concurrent-claim, lease-expiry, retry, cancellation, and approval-resume tests pass.

## 4. Trust boundaries and security

1. Authenticate every human request using the existing Supabase Auth server validation.
2. Resolve workspace membership and role on the server for every read or mutation.
3. Agent, mission, run, step, memory, message, event, approval, and tool-grant tables are server-managed. Browser roles have no direct table privileges; RLS is enabled with no client policies.
4. Never put Supabase secret/service-role keys, provider keys, workflow credentials, or internal worker secrets in browser code, logs, prompts, or Git.
5. Each agent is bound to one workspace. Composite foreign keys prevent cross-workspace agent/mission/message/memory relationships.
6. Tool execution is allow-list based. A model cannot create new tools, elevate its own grants, change its autonomy level, or bypass approval policy.
7. External side effects are denied by default. Production deployment, financial transactions, legal commitments, user invitations, destructive changes, and changes to access policy require explicit human approval.
8. Human approval is bound to a specific action payload hash, actor, scope, expiry, and one-time decision. Editing the payload invalidates the approval.
9. Agent memory starts as proposed. Only explicitly validated memory may become shared organizational knowledge.
10. Every mission transition, tool call, delegation, approval, retry, and result is journaled. Secrets and unnecessary personal data are excluded from event payloads.

## 5. Autonomy levels

- L1 — Analyse: read permitted context, research, calculate, draft, recommend.
- L2 — Produce: create/update drafts and workspace artifacts under scoped grants.
- L3 — Execute reversible, pre-authorized operations only. Every tool has a per-agent allow-list, quotas, idempotency, and audit.
- Human approval required for high/critical risk, irreversible, external, financial, legal, production, or permission-changing actions. No agent may approve its own action.

## 6. Core entities

- Agent: workspace, identity, mandate, specialty, prompt version, status, model policy, autonomy level.
- Tool grant: exact tool key, permission, approval requirement, quotas, enabled state.
- Mission: objective, context, priority, requester, agent, lifecycle, retry policy, idempotency.
- Run: runtime identifier, checkpoint, status, resource usage, timestamps.
- Step: ordered idempotent unit, payload, attempts, lease, result/error.
- Event: append-only actor/action journal.
- Message: scoped agent-to-agent handoff.
- Memory: agent-private or workspace-shared, proposed/validated/rejected.
- Approval: immutable requested action, risk, approver, decision, expiry.

## 7. Mission lifecycle

`queued → planning → running → waiting_approval → running → completed`

Alternative terminal/holding states: `paused`, `failed`, `cancelled`. Retries are bounded and only transient failures are retried. A lease token prevents a stale worker from completing a step after another worker has reclaimed it. Idempotency keys prevent duplicate external effects.

## 8. Agent department catalogue (initial target)

- Strategy & Development
- Finance & Investments
- Governance & Regulatory Compliance
- Technology & Engineering
- Risk & Internal Control
- Research & Foresight

Department names are configurable. Their initial mandate templates will be versioned and may not be treated as legal or financial authority.

## 9. P0 acceptance criteria

- Agent data model is workspace-scoped and protected by composite foreign keys.
- RLS enabled and direct browser grants revoked for all agent tables.
- No credentials or privileged secrets committed.
- Mission, run, step, event, message, memory, approval and tool-grant entities have explicit lifecycle and constraints.
- Architecture records the server-side execution requirement and a verified runtime decision gate.
- No production migration, merge, or production deployment.
