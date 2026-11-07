# AFE-CI — COO Operations Control Plane

**Version:** 1.0.0  
**Branch:** `feature/autonomous-organization-v1`  
**Status:** Code added; validation and isolated database application still required  
**Production:** Not deployed, not migrated, not approved

## 1. Purpose

The COO Control Plane is the operational command surface for the Direction des Opérations. It extends the existing AFE-CI TypeScript/Vercel and Supabase architecture. It does not create a second application runtime or database.

Entry point: `/coo`  
API prefix: `/team/api/workspaces/:workspaceId/coo`

The existing Team & Governance page links to the COO page. Authentication uses the existing Supabase session stored by the application and the existing server-side bearer-token validation.

## 2. Functional modules

### 2.1 Central dashboard

The dashboard consolidates:
- total, active, completed, failed and overdue missions;
- open, blocked and overdue operational tasks;
- active departments;
- open and critical alerts;
- pending human approvals;
- performance by department;
- missions at risk and recent operational work.

No synthetic productivity score is generated. Completion rates are shown only when there is a meaningful denominator.

### 2.2 Institutional departments

The first access seeds the workspace with the institutional catalogue:
- Direction générale;
- Direction des Opérations (COO);
- Stratégie & Développement;
- Finance & Investissements;
- Risques & Contrôle;
- Gouvernance & Conformité;
- Evidence Intelligence;
- Secrétariat général des missions;
- Opérations de mission;
- Audit qualité;
- Documentation & Reporting;
- Infrastructure & Sécurité;
- Arbitrage indépendant;
- Autorité de validation humaine.

The two independent functions are marked `is_independent`; human validation is also marked `human_only`. The COO interface cannot modify their mandates, deactivate them or assign their work. Their reporting line is not placed under the COO.

Existing agents are associated with their matching departments when the catalogue is initialized. Agents remain subject to their existing draft/active lifecycle and authorization rules.

### 2.3 Mission portfolio

The COO can register a mission against:
- an operational department;
- an active specialist agent in the same workspace;
- an optional operational owner who is a member of the workspace;
- priority, objective, context and due date.

Missions are persisted in the existing `afe_agent_missions` queue. New operational metadata includes department, operational owner, due date, progress percentage and blocked reason. Existing worker lifecycle, retries, leases and mission results remain the execution source of truth.

The COO can update operational progress, due date and blocked reason. The COO cannot force a worker status to completed or bypass approval gates.

### 2.4 Task assignment

The new `afe_operational_tasks` register supports:
- department and optional mission;
- assignment to a workspace member and/or an active agent;
- priority, due date, status and progress;
- blocked reason and completion timestamp.

A task linked to a mission must belong to the same department. User and agent assignments are checked server-side against the workspace. The COO cannot assign work to independent arbitration or human validation.

### 2.5 Alerts

The alert register deduplicates operational signals by workspace and stable key. Current rules:
- overdue active mission;
- failed mission;
- human approval waiting for more than 24 hours;
- overdue task;
- blocked task.

Alerts can be acknowledged or resolved by an authorized operator. A resolved signal is reopened if the same underlying condition is detected again.

Alerts are refreshed when the dashboard, alert centre or report generation is read. A separate continuous alert daemon is not claimed.

### 2.6 Reporting to the Direction générale

The report generator snapshots:
- portfolio indicators;
- performance by department;
- missions at risk;
- priority alerts;
- pending human approvals and critical escalations.

The report is stored in `afe_coo_reports` and an in-app notification is sent to the workspace owner, who represents the Direction générale by default. A daily report schedule is configured by `report_hour_utc` (default 08:00 UTC) and `daily_report_enabled` (default true).

The Vercel Cron configuration invokes `/internal/coo-report-worker` hourly. The worker generates a daily report only for workspaces whose configured UTC hour matches the current hour. The report key is idempotent for the daily period. The worker requires `CRON_SECRET` or `COO_REPORT_WORKER_SECRET`.

Vercel Cron is not active on Preview deployments. The presence of the schedule in this branch does not mean a report has been delivered or that Production is enabled.

## 3. Data model

The additive migration is:

`supabase/migrations/20261107190000_afe_ci_coo_operations_control_plane.sql`

It introduces:
- `afe_org_departments`
- `afe_operational_tasks`
- `afe_coo_alerts`
- `afe_coo_reports`
- `afe_coo_settings`

The foreign-key index companion migration is `supabase/migrations/20261107200000_afe_ci_coo_foreign_key_indexes.sql`.

It extends:
- `afe_agents.department_id`
- `afe_agent_missions.department_id`
- `afe_agent_missions.operational_owner_user_id`
- `afe_agent_missions.due_at`
- `afe_agent_missions.progress_percent`
- `afe_agent_missions.blocked_reason`

Composite foreign keys bind department, task, mission, agent and alert relationships to the same workspace. All new tables are RLS-enabled, browser roles have no direct table privileges, and server-side access uses the existing Supabase secret credential.

## 4. API surface

| Method | Route | Purpose |
|---|---|---|
| GET | `/dashboard` | Central indicators and consolidated views |
| GET | `/departments` | Institutional directory |
| PATCH | `/departments/:id` | Update operational mandate or active state |
| GET / POST / PATCH | `/missions`, `/missions/:id` | Portfolio and operational progress |
| GET / POST / PATCH | `/tasks`, `/tasks/:id` | Assignment and task lifecycle |
| GET / POST | `/alerts`, `/alerts/:id` | Alert inbox, acknowledge and resolve |
| GET / POST | `/reports`, `/reports/generate` | Reporting history and immediate report |
| GET / PATCH | `/settings` | COO designation and reporting schedule |

Mutations require the workspace owner, an admin, or the designated COO. The COO must be a workspace member. Only the workspace owner can designate the COO and change automatic reporting settings.

## 5. Separation of powers

The COO is responsible for operational coordination and execution discipline, not analytical conclusions.

The application explicitly prevents the COO from:
- assigning work to independent arbitration or human validation;
- changing the mandates of those independent functions;
- deciding the content or outcome of an arbitration;
- marking a mission completed through the operational progress endpoint;
- approving a human decision or bypassing an agent approval.

The workspace owner remains the Direction générale recipient for executive reports. Human approval remains a separate workflow.

## 6. Validation status

| Gate | Result |
|---|---|
| Additive schema migration | <strong>Applied</strong> to isolated Supabase project `afe-ci-test` on 2026-11-07 |
| Table security | <strong>Verified</strong>: five new tables have RLS enabled; no direct grants to `anon` or `authenticated`; server `service_role` grants verified |
| Foreign-key performance | <strong>Verified</strong>: no remaining unindexed-FK findings on COO tables or modified agent/mission relations after the companion index migration |
| TypeScript strict typecheck | <strong>Passed</strong> in GitHub Actions |
| Unit and integration test suite | <strong>Passed</strong> in GitHub Actions (127 tests in the recorded run) |
| Authenticated API runtime and cross-workspace negative tests | Pending |
| End-to-end mission/task creation, assignment, alert lifecycle and notifications | Pending |
| Daily report worker invocation and idempotency in Preview | Pending |
| Browser acceptance of the SSO-protected Preview | Pending |
| Production migration/deployment | Not performed; requires separate explicit approval |

### Advisor notes

The Supabase Security Advisor reports informational `RLS enabled, no policy` findings for the five new server-managed tables. This is intentional: direct browser-role table grants are revoked and the application accesses these tables only through the authenticated server and its service credential. The broader project also has a pre-existing leaked-password-protection warning.

The Supabase Performance Advisor still reports 34 unindexed foreign keys elsewhere in the existing database. None of those findings refer to the new COO tables or the agent/mission relations modified by this increment.

### Remaining operational gates

1. Exercise the authenticated `/coo` page with a workspace owner, designated COO, editor and viewer.
2. Verify cross-workspace IDs are rejected for every read and mutation route.
3. Verify the independent arbitration and human-validation departments cannot be assigned, deactivated or have their mandates changed by the COO.
4. Exercise mission/task creation, task reassignment, progress updates, alert acknowledgement/resolution/reopening, report generation and notification delivery.
5. Invoke `/internal/coo-report-worker` manually in an authorized Preview/test context with the configured secret and verify idempotency. Vercel Cron itself does not run on Preview deployments.
6. Complete browser acceptance on the SSO-protected Preview.
7. Obtain explicit approval before any Production migration, merge to `main` or Production deployment.

The implementation is CI-validated and its schema exists only in `afe-ci-test`. It is not yet declared live in Production or fully operational until the remaining runtime gates pass.
