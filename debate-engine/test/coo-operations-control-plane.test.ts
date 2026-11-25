import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261107190000_afe_ci_coo_operations_control_plane.sql", import.meta.url);
const alertWorkflowUrl = new URL("../supabase/migrations/20261109081327_coo_alert_resolution_workflow.sql", import.meta.url);
const alertWorkflowIndexesUrl = new URL("../supabase/migrations/20261109081603_coo_alert_workflow_fk_indexes.sql", import.meta.url);
const platformUrl = new URL("../src/coo-platform.ts", import.meta.url);
const reportingUrl = new URL("../src/coo-reporting.ts", import.meta.url);
const indexesUrl = new URL("../supabase/migrations/20261107200000_afe_ci_coo_foreign_key_indexes.sql", import.meta.url);
const idempotencyRecoveryUrl = new URL("../supabase/migrations/20261110113000_coo_orchestration_idempotency_recovery.sql", import.meta.url);
const taskIdempotencyFallbackUrl = new URL("../supabase/migrations/20261110193310_coo_task_idempotency_fallback.sql", import.meta.url);
const headsUrl = new URL("../supabase/migrations/20261107210000_afe_ci_coo_department_heads.sql", import.meta.url);
const serverUrl = new URL("../src/server.ts", import.meta.url);
const vercelUrl = new URL("../vercel.json", import.meta.url);

test("COO migration creates workspace-scoped operational control-plane entities", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["afe_org_departments","afe_operational_tasks","afe_coo_alerts","afe_coo_reports","afe_coo_settings"]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS public\\." + table));
  }
  assert.match(sql, /FOREIGN KEY \(task_id, workspace_id\)/);
  assert.match(sql, /FOREIGN KEY \(department_id, workspace_id\)/);
  assert.match(sql, /UNIQUE \(id, workspace_id\)/);
});

test("COO tables are RLS enabled and inaccessible to browser roles", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM anon, authenticated/);
  assert.match(sql, /GRANT ALL ON TABLE public\.%I TO service_role/);
});

test("mission records gain department, operational owner, due date and progress fields", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const column of ["department_id","operational_owner_user_id","due_at","progress_percent","blocked_reason"]) {
    assert.match(sql, new RegExp("ADD COLUMN IF NOT EXISTS " + column));
  }
});

test("COO API protects independent arbitration and human validation from operational assignment", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /Le COO ne peut pas affecter ni diriger une tâche de l'Arbitrage indépendant ou de la Validation humaine/);
  assert.match(source, /Cette fonction est protégée de la gestion opérationnelle du COO/);
  assert.match(source, /is_independent/);
  assert.match(source, /human_only/);
});

test("COO mission and task mutations validate workspace-scoped assignments", async () => {
  const source = await readFile(platformUrl, "utf8");
  const migration = await readFile(p11dMigrationUrl, "utf8");
  assert.match(source, /validateDepartment\(workspaceId, departmentId\)/);
  assert.match(source, /validateAgent\(workspaceId, assignedAgentId, departmentId\)/);
  assert.match(source, /validateMember\(workspaceId, assignedUserId\)/);
  assert.match(source, /rpc\/afe_create_coo_task_with_audit/);
  assert.match(source, /rpc\/afe_create_coo_mission_with_audit/);
  assert.match(migration, /coo\.task\.created/);
  assert.match(migration, /coo\.mission\.created/);
});

test("COO control plane is routed through the authenticated server and has a dedicated page", async () => {
  const server = await readFile(serverUrl, "utf8");
  assert.match(server, /COO_HTML, handleCooRequest, handleCooReportWorker/);
  assert.match(server, /handleCooRequest\(req,res,path,user\)/);
  assert.match(server, /path==="\/coo"/);
  assert.match(server, /handleCooReportWorker\(req,res\)/);
});

test("daily executive reporting has a scheduled server-side worker", async () => {
  const source = await readFile(platformUrl, "utf8");
  const config = JSON.parse(await readFile(vercelUrl, "utf8"));
  assert.match(source, /\/internal\/coo-report-worker/);
  assert.match(source, /daily_report_enabled=eq\.true/);
  assert.match(source, /coo\.report\.daily/);
  assert.ok(config.crons.some((x: {path:string;schedule:string}) => x.path === "/internal/coo-report-worker" && x.schedule === "0 8 * * *"));
});

test("COO dashboard exposes portfolio, departments, tasks, alerts and DG reports", async () => {
  const source = await readFile(platformUrl, "utf8");
  for (const label of ["Portefeuille des missions","Directions","Tâches & affectations","Alertes","Reporting DG","Paramètres COO"]) {
    assert.ok(source.includes(label), "Missing dashboard area: " + label);
  }
});

test("COO foreign keys have dedicated covering indexes", async () => {
  const sql = await readFile(indexesUrl, "utf8");
  for (const index of [
    "afe_agents_department_workspace_idx",
    "afe_agent_missions_department_workspace_idx",
    "afe_agent_missions_operational_owner_idx",
    "afe_operational_tasks_mission_workspace_idx",
    "afe_operational_tasks_department_workspace_idx",
    "afe_operational_tasks_assigned_agent_workspace_idx",
    "afe_coo_alerts_mission_workspace_idx",
    "afe_coo_alerts_task_workspace_idx",
    "afe_coo_reports_generated_by_idx",
    "afe_coo_settings_coo_user_idx"
  ]) assert.ok(sql.includes(index), "Missing FK index " + index);
});

test("only the designated COO or workspace governance can operate and resolve alerts", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /if \(p\[6\] && method === "POST"\) \{ await canOperate\(workspaceId, user\); send\(res, 200, await actOnAlert\(workspaceId, user, p\[6\], await readBody\(req\)\)\);/);
  assert.match(source, /rank\[member\.role\] < rank\.editor/);
});

test("operational departments can have accountable human heads while executive and independent lines stay protected", async () => {
  const sql = await readFile(headsUrl, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS director_user_id/);
  assert.match(sql, /afe_org_departments_director_user_idx/);
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /if \(uid\) await validateMember\(workspaceId, uid\)/);
  assert.match(source, /Le responsable du COO se désigne dans les paramètres de gouvernance/);
  assert.match(source, /old\.slug === "direction-generale"/);
});

test("blocked and paused missions generate a COO alert and dashboard indicator", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /mission-blocked:/);
  assert.match(source, /blockedMissions:/);
});

test("COO alert lifecycle automatically resolves cleared task and mission conditions", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /alert\.alert_type\?\.startsWith\("task_"/);
  assert.match(source, /workflow_status: "pending_verification"/);
  assert.match(source, /condition_cleared_pending_verification/);
});

test("COO alert resolution is rejected while a linked task or mission remains blocked", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /ensureAlertConditionCleared\(workspaceId, alert\)/);
  assert.match(source, /task\.status === "blocked" \|\| clean\(task\.blocked_reason, 3000\)/);
  assert.match(source, /mission\.status === "paused" \|\| clean\(mission\.blocked_reason, 3000\)/);
  assert.match(source, /ne peut pas être résolue : la tâche est toujours bloquée/);
  assert.match(source, /ne peut pas être résolue : la mission est toujours suspendue/);
});


const cooGrantsUrl = new URL("../supabase/migrations/20261107212500_afe_ci_coo_scoped_operational_grants.sql", import.meta.url);

test("COO level-2 grants are workspace-scoped, reversible and limited to operational capabilities", async () => {
  const sql = await readFile(cooGrantsUrl, "utf8");
  for (const capability of ["coo.organization.read","coo.workload.read","coo.missions.create","coo.tasks.create"]) {
    assert.ok(sql.includes(capability), "Missing COO capability " + capability);
  }
  assert.match(sql, /settings\.coo_autonomy_level = 2/);
  assert.match(sql, /settings\.coo_kill_switch = false/);
  assert.match(sql, /settings\.coo_enabled = true/);
  assert.match(sql, /workspace_scoped/);
  assert.match(sql, /reversible_only/);
  assert.match(sql, /ON CONFLICT \(agent_id, tool_key\) DO UPDATE/);
  assert.doesNotMatch(sql, /service_role|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test("COO orchestration requires explicit grants and checks the grant scope server-side", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /async function requireCooCapability/);
  assert.match(source, /grant\.permission !== permission/);
  assert.match(source, /grant\.approval_required !== false/);
  assert.match(source, /grant\.limits\?\.workspace_scoped !== true/);
  assert.match(source, /grant\.limits\?\.reversible_only !== true/);
  for (const capability of ["coo.organization.read","coo.workload.read","coo.missions.create","coo.tasks.create"]) {
    assert.ok(source.includes('"' + capability + '"'), "Missing enforced capability " + capability);
  }
});

test("COO plans include live workload and respect deterministic capacity ceilings", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /afe_agent_missions\?workspace_id=.*status=in\.\(queued,planning,running,waiting_approval,paused\)/);
  assert.match(source, /afe_operational_tasks\?workspace_id=.*status=not\.in\.\(done,cancelled\)/);
  assert.match(source, /x\.workload\.activeMissions < 2/);
  assert.match(source, /x\.workload\.openTasks < 10/);
  assert.match(source, /maxTasksPerRun/);
  assert.match(source, /capabilityGrants\[2\]\.limits\?\.max_per_run/);
});

test("sensitive COO workstreams are held for human approval before any dispatch", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /const sensitiveAction =/);
  assert.doesNotMatch(source, /const sensitiveAction = \/\(\?:payer\|paiement/);
  assert.match(source, /Approbation humaine obligatoire/);
  assert.match(source, /if \(sensitiveItems\.length > 0\)/);
  assert.match(source, /const status = "dispatched"/);
  assert.match(source, /Routine DG decisions are recorded for follow-up/);
  assert.doesNotMatch(source, /const status = plan\.decisionsRequired\.length \? "approval_required"/);
});

test("COO orchestration recovery enforces database-level task idempotency", async () => {
  const sql = await readFile(idempotencyRecoveryUrl, "utf8");
  assert.match(sql, /duplicate mission tasks exist; reconcile them before applying this migration/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS idempotency_key text/);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS afe_operational_tasks_workspace_idempotency_uidx/);
  assert.match(sql, /ON public\.afe_operational_tasks\(workspace_id, idempotency_key\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /CREATE TRIGGER afe_coo_runs_touch_updated_at/);
});

test("COO manual creation requires stable idempotency keys while the database fallback remains available", async () => {
  const sql = await readFile(taskIdempotencyFallbackUrl, "utf8");
  assert.ok(sql.includes("BEFORE INSERT ON public.afe_operational_tasks"));
  assert.ok(sql.includes("NEW.mission_id::text || ':' || md5(lower(btrim(NEW.title)))"));
  assert.ok(sql.includes("'manual:' || gen_random_uuid()::text"));
  const source = await readFile(platformUrl, "utf8");
  const missionStart = source.indexOf("async function createMission(workspaceId: string, user: AuthUser, input: any)");
  const taskStart = source.indexOf("async function createTask(workspaceId: string, user: AuthUser, input: any)");
  const patchStart = source.indexOf("async function patchTask(workspaceId: string, user: AuthUser, id: string, input: any)", taskStart);
  assert.ok(missionStart >= 0 && taskStart > missionStart && patchStart > taskStart);
  const mission = source.slice(missionStart, taskStart);
  const task = source.slice(taskStart, patchStart);
  assert.match(mission, /if \(!idempotencyKey \|\| idempotencyKey.length > 160\)/);
  assert.match(task, /if \(!idempotencyKey \|\| idempotencyKey.length > 160\)/);
  assert.match(mission, /p_idempotency_key: idempotencyKey/);
  assert.match(task, /p_idempotency_key: idempotencyKey/);
  assert.doesNotMatch(mission + task, /clean\(input\.idempotencyKey, 160\) \|\| randomUUID\(\)/);
});
 
test("partial COO dispatch failures remain visible with their created missions and audit event", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /const partial = createdMissions\.length > 0/);
  assert.match(source, /const recoveryStatus = partial \? "partial" : outcomeUnknown \? "planning" : "failed"/);
  assert.match(source, /const outcomeUnknown = isNetworkOutcomeUnknown\(error\)/);
  assert.match(source, /coo\.orchestration\.outcome_unknown/);
  assert.match(source, /missions_created: createdMissions\.length/);
  assert.match(source, /createdMissions\.push\(dispatchRecord\)/);
  assert.match(source, /dispatchRecord\.taskCount = createdTasks\.length/);
  assert.match(source, /coo\.orchestration\.partial_failure/);
});

test("COO UI preserves the same idempotency key after a partial run so the run can be resumed", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.ok(source.includes('if(result.run?.status!=="partial")localStorage.removeItem(storageKey);'));
  assert.ok(source.includes("La clé est conservée ; relance la même instruction après le délai de reprise."));
  assert.ok(source.includes('["planning","partial"].includes(resumableRun.status)'));
});

test("COO UI recovers the idempotency key from persisted partial runs when browser storage was cleared", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.ok(source.includes('const existingState=await api(base()+"orchestrations");'));
  assert.ok(source.includes('x.instruction===instruction&&["planning","partial"].includes(x.status)'));
  assert.ok(source.includes("recoverable?.idempotency_key"));
  assert.ok(source.includes("Impossible de vérifier l’historique et de sécuriser la clé d’idempotence."));
});

test("COO execution trigger is Preview-only, DG-owner-only and respects the kill switch", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /resource === "execute-next"/);
  assert.match(source, /process\.env\.VERCEL_ENV !== "preview"/);
  assert.match(source, /requireAccess\(workspaceId, user, "owner"\)/);
  assert.match(source, /cfg\.coo_enabled \|\| cfg\.coo_kill_switch/);
  assert.match(source, /runAgentWorkerForWorkspace\(workspaceId\)/);
  assert.match(source, /coo\.execution\.worker_triggered/);
});

test("COO portfolio offers bounded worker execution and exposes verified mission outputs", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /for\s*\(let i=0;i<5;i\+\+\)/);
  assert.match(source, /if\s*\(!r\.claimed\)\s*break/);
  assert.match(source, /m\.result\?\.summary/);
  assert.match(source, /m\.result\.deliverables/);
  assert.match(source, /m\.blocked_reason/);
});


test("agent worker preserves partial mission results atomically when COO tasks are blocked", async () => {
  const workerUrl = new URL("../src/autonomous-agents/worker.ts", import.meta.url);
  const migrationUrl = new URL("../supabase/migrations/20261112144356_afe_agent_mission_execution_atomic_commit.sql", import.meta.url);
  const source = await readFile(workerUrl, "utf8");
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(source, /rpc\/commit_afe_agent_mission_execution/);
  assert.match(sql, /execution_state', 'partial'/);
  assert.match(sql, /blocked_task_count/);
  assert.match(sql, /status = 'paused'/);
  assert.match(sql, /blocked_reason = pg_catalog\.left\(v_reason, 3000\)/);
  assert.match(sql, /coo\.tasks\.incomplete/);
  assert.match(sql, /lease_token = NULL/);
  assert.match(source, /error:error instanceof Error\?error\.message/);
});


test("COO archived reports are human-readable and support one-click copy plus PDF and Word exports", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /function reportText\(/);
  assert.match(source, /function reportHtml\(/);
  assert.match(source, /navigator\.clipboard\.writeText\(reportText\(r\)\)/);
  assert.match(source, /id="copyReport"/);
  assert.match(source, /id="downloadPdf"/);
  assert.match(source, /id="downloadWord"/);
  assert.match(source, /jsPDF/);
  assert.match(source, /lib\.Packer\.toBlob/);
  assert.match(source, /Qualité et limites des données/i);
  assert.match(source, /missionCount!==byDept/);
});

test("COO mission portfolio exposes one-click copy with complete mission results and Android fallback", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /id="copyCooPortfolio"/);
  assert.match(source, /Copier tous les résultats du portefeuille/);
  assert.match(source, /AFE-CI — PORTEFEUILLE DES MISSIONS/);
  assert.match(source, /Compte rendu de l'agent/);
  assert.match(source, /Livrables :/);
  assert.match(source, /Blocage :/);
  assert.match(source, /navigator\.clipboard\.writeText\(textValue\)/);
  assert.match(source, /document\.execCommand\("copy"\)/);
  assert.match(source, /lines\.join\("\\n"\)/);
});


test("COO reporting reconciles legacy missions through their assigned agent department", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /const resolution = resolveMissionDepartment\(m, agent\)/);
  assert.match(source, /department_resolution: resolution\.source/);
  assert.match(source, /effective_department_id === d\.id/);
  assert.match(source, /unassignedMissions: data\.missions\.filter\(m => !m\.effective_department_id\)\.length/);
});

test("COO reports reconcile mission totals and flag completed missions without task evidence", async () => {
  const source = await readFile(platformUrl, "utf8");
  const reporting = await readFile(reportingUrl, "utf8");
  assert.match(source, /buildCooDataQuality\(fullData\.missions, fullData\.tasks, dashboard\.departmentPerformance\)/);
  assert.match(source, /dataQuality: \{ \.\.\.dataQuality \}/);
  assert.match(reporting, /const tasksByMission = new Map<string, ReportingTask\[\]>\(\)/);
  assert.match(reporting, /completedWithoutTasks = completed\.filter/);
  assert.match(reporting, /unassignedMissionCount: unassignedMissions\.length/);
  assert.match(source, /quality\.completedWithoutTasks/);
  assert.match(source, /quality\.unassignedMissionCount/);
  const duplicateGuard = "arr(quality.findings).some((x)=>/mission\\(s\\).*sans tâche opérationnelle associée/i.test(x))";
  assert.equal(source.split(duplicateGuard).length - 1, 2, "both PDF/HTML and plain-text report renderers must suppress duplicate completed-without-tasks findings");
});


test("COO report separates current portfolio indicators from activity created during the declared period", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.ok(source.includes("const periodActivity = buildCooReportActivity(fullData.missions, fullData.tasks, periodStart, periodEnd);"));
  assert.ok(source.includes("const data = fullData;"));
  assert.ok(source.includes("const dashboard = computeDashboard(data);"));
  assert.ok(source.includes("scopeDescription:"));
  assert.ok(source.includes("period_start: periodStart, period_end: periodEnd, idempotency_key: key, report_content: reportContent"));
});

test("COO reporting resolves legacy agent ownership only through an exact department slug", async () => {
  const source = await readFile(platformUrl, "utf8");
  const reporting = await readFile(reportingUrl, "utf8");
  assert.match(source, /agentTokens\.slice\(index, index \+ departmentTokens\.length\)\.join\("-"\) === d\.slug/);
  assert.match(source, /inferred_from_agent_slug/);
  assert.match(reporting, /mission\?\.effective_department_id/);
  assert.match(source, /department_resolution: resolution\.source/);
  assert.match(source, /resolveTaskDepartmentId\(t, mission,/);
});

test("COO report reconciliation distinguishes verified, unverified and incomplete completed missions", async () => {
  const source = await readFile(platformUrl, "utf8");
  const reporting = await readFile(reportingUrl, "utf8");
  assert.match(reporting, /completedWithoutTasks = completed\.filter/);
  assert.match(reporting, /completedWithIncompleteTasks = completed\.filter/);
  assert.match(reporting, /completedVerified = completed\.filter/);
  assert.match(source, /completedVerifiedMissions: completedVerifiedMissionCount/);
  assert.match(source, /completedUnverifiedMissions: completedWithoutTasks\.length \+ completedWithIncompleteTasks\.length/);
  assert.match(reporting, /completedWithIncompleteTasks: completedWithIncompleteTasks\.map/);
  assert.match(reporting, /ne correspond pas au nombre de missions affectées/);
});

test("COO report regeneration preserves archived snapshots and uses exact period idempotency", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.ok(source.includes("buildCooReportIdempotencyKey(reportType, periodStart, periodEnd)"));
  assert.ok(source.includes("schemaVersion: 2"));
  assert.equal(source.includes("Rebuild an existing period report with the corrected reconciliation logic"), false);
  assert.equal(source.includes("report_content: reportContent, period_start: periodStart, period_end: periodEnd, generated_by:"), false);
});


test("COO mission review dossier is workspace-scoped and exposes submissions, reviews, tasks, approvals and audit events", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /p\[6\] && p\[7\] === "review"/);
  assert.match(source, /afe_agent_events\?workspace_id=.*mission_id=/);
  assert.match(source, /afe_operational_tasks\?workspace_id=.*mission_id=/);
  assert.match(source, /afe_agent_approvals\?workspace_id=.*mission_id=/);
  assert.match(source, /independentReview: latestReview/);
  assert.match(source, /canValidate: access\.role === "owner"/);
  assert.match(source, /async function renderMissionReview\(missionId\)/);
  assert.match(source, /Soumission de l’agent/);
  assert.match(source, /Revue indépendante/);
  assert.match(source, /Historique de contrôle et validations/);
  assert.match(source, /data-review-mission/);
  assert.match(source, /Livrables soumis — validation COO requise/);
});

test("COO closure requires an accepted independent review and every operational task completed", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /action === "accept_closure"/);
  assert.match(source, /independentReview\?\.verdict !== "accepted"/);
  assert.match(source, /operationalTasks\.some\(\(task: any\) => task\.status !== "done"\)/);
  assert.match(source, /expectedIds\.size !== completed\.length/);
  assert.match(source, /clean\(t\.deliverable, 4000\)\.length >= 20/);
  assert.match(source, /event_type: "coo\.mission\.human_decision"/);
  assert.match(source, /access\.role === "owner"/);
});

test("COO correction request is auditable and returns the mission to the durable queue", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /action === "request_revision"/);
  assert.match(source, /cooRevisionRequest:/);
  assert.match(source, /status: "queued", blocked_reason: note/);
  assert.match(source, /event_type: "coo\.mission\.revision_requested"/);
  assert.match(source, /Demander une correction et relancer/);
});


test("COO correction requests invalidate the previous independent review until a fresh report is submitted", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /mission\.evidence\.review\.invalidated/);
  assert.match(source, /latestReviewEvent = \[\.\.\.reviewEvents\]\.reverse\(\)\.find/);
  assert.match(source, /event_type=in\.\(mission\.evidence\.reviewed,mission\.evidence\.review\.invalidated\)/);
  assert.match(source, /invalidatesPreviousReview: true/);
});


test("report department activity is distinct from active department configuration", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.ok(source.includes("departmentsWithActivity: deptPerformance.filter(d => d.active && (d.missionCount > 0 || d.taskCount > 0)).length"));
  assert.ok(source.includes("Directions configurées actives : "));
  assert.ok(source.includes("Directions ayant une activité : "));
});

test("legacy archived reports disclose missing period and verification data without inventing zero values", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.ok(source.includes("Activité sur la période : non disponible dans cette version du rapport archivé."));
  assert.ok(source.includes("Vérification des missions terminées : non disponible dans cette version du rapport archivé."));
});




const archiveMigrationUrl = new URL("../supabase/migrations/20261109064541_afe_ci_coo_mission_archives.sql", import.meta.url);
const archiveHierarchyMigrationUrl = new URL("../supabase/migrations/20261109071000_afe_ci_coo_mission_archive_hierarchy.sql", import.meta.url);

test("completed COO missions are automatically archived once with a numbered record and completion date", async () => {
  const sql = await readFile(archiveMigrationUrl, "utf8");
  for (const expected of [
    "CREATE TABLE IF NOT EXISTS public.afe_coo_mission_archives",
    "mission_number text not null",
    "unique (workspace_id, mission_id)",
    "create or replace function public.afe_coo_archive_completed_mission()",
    "if new.status <> 'completed' then return new; end if",
    "new.completed_at::date",
    "on conflict (workspace_id, mission_id) do nothing",
    "create trigger afe_coo_archive_completed_mission_trigger"
  ]) assert.ok(sql.toLowerCase().includes(expected.toLowerCase()), "Missing archive invariant: " + expected);
});

test("existing completed missions are backfilled and source mission rows are retained", async () => {
  const sql = await readFile(archiveMigrationUrl, "utf8");
  assert.ok(sql.toLowerCase().includes("insert into public.afe_coo_mission_archives"));
  assert.ok(sql.toLowerCase().includes("where m.status='completed'"));
  assert.ok(sql.toLowerCase().includes("on conflict (workspace_id, mission_id) do nothing"));
  assert.equal(sql.toLowerCase().includes("delete from public.afe_agent_missions"), false);
});

test("mission archive documents are copied into private workspace-scoped storage", async () => {
  const sql = await readFile(archiveMigrationUrl, "utf8");
  for (const expected of [
    "public.afe_coo_mission_archive_documents",
    "source_document_id uuid references public.debate_workspace_documents",
    "foreign key (archive_id, workspace_id)",
    "afe_coo_archives_server_only",
    "afe_coo_archive_documents_server_only",
    "grant all on public.afe_coo_mission_archives"
  ]) assert.ok(sql.toLowerCase().includes(expected.toLowerCase()), "Missing document archive control: " + expected);
});

test("archive snapshots include the complete delegated mission tree, tasks and events", async () => {
  const sql = await readFile(archiveHierarchyMigrationUrl, "utf8");
  for (const expected of [
    "with recursive mission_tree",
    "child.parent_mission_id = parent.id",
    "related_missions_snapshot",
    "events_snapshot",
    "public.afe_operational_tasks",
    "public.afe_agent_events",
    "update public.afe_coo_mission_archives"
  ]) assert.ok(sql.includes(expected), "Missing hierarchical archive snapshot: " + expected);
});

test("COO archive API is workspace-scoped and requires DG attestation for complete status", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.ok(source.includes('resource === "archives" && method === "GET"'));
  assert.ok(source.includes("afe_coo_mission_archives?workspace_id=eq."));
  assert.ok(source.includes('p[7] === "complete"'));
  assert.ok(source.includes('requireAccess(workspaceId, user, "owner")'));
  assert.ok(source.includes('document_status: "complete"'));
  assert.ok(source.includes("coo.mission_archive.completeness_confirmed"));
  assert.equal(source.includes("document_checklist:"), false);
});

test("COO archive interface supports mission/date search, snapshots, report attachments and downloads", async () => {
  const source = await readFile(platformUrl, "utf8");
  for (const expected of [
    'data-tab="archives"',
    "async function renderArchives()",
    "Rechercher par numéro, mission, direction ou date",
    "Rapports des directions contributrices",
    "Photographie des tâches à la clôture",
    "Télécharger",
    "uploadArchiveFiles",
    "confirmArchiveComplete"
  ]) assert.ok(source.includes(expected), "Missing archive UI capability: " + expected);
});


test("the final DG closure decision is appended to the archive event snapshot after the completion trigger", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.ok(source.includes('const decisionEventRows = await db<any[]>("afe_agent_events"'));
  assert.ok(source.includes('event_type: "coo.mission.human_decision"'));
  assert.ok(source.includes('afe_coo_mission_archives?workspace_id=eq.'));
  assert.ok(source.includes('events_snapshot: eventsSnapshot'));
  assert.ok(source.includes('event.id === decisionEvent.id'));
});

test("COO alert workflow migration adds accountable ownership, evidence, verification and append-only history", async () => {
  const sql = await readFile(alertWorkflowUrl, "utf8");
  for (const column of ["workflow_status","assigned_to","assigned_at","due_at","diagnosis","corrective_action","evidence_reference","resolution_summary","verified_by","verified_at","reopen_count","last_reopened_at"]) {
    assert.match(sql, new RegExp("ADD COLUMN IF NOT EXISTS " + column));
  }
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.afe_coo_alert_events/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.afe_coo_alert_events FROM anon, authenticated/);
  assert.match(sql, /GRANT ALL ON TABLE public\.afe_coo_alert_events TO service_role/);
});

test("COO alert closure requires evidence, a distinct verifier and a cleared underlying condition", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /action === "submit_for_verification"/);
  assert.match(source, /action === "verify"/);
  assert.match(source, /alert\.assigned_to === user\.id/);
  assert.match(source, /await ensureAlertConditionCleared\(workspaceId, alert\)/);
  assert.match(source, /La clôture directe est désactivée/);
  assert.match(source, /evidenceReference\.length < 10/);
  assert.match(source, /resolutionSummary\.length < 20/);
});

test("COO alert workflow records every material transition and supports controlled reopening", async () => {
  const source = await readFile(platformUrl, "utf8");
  for (const event of ["taken_in_charge","diagnosis_recorded","remediation_started","submitted_for_verification","resolution_verified","verification_rejected","reopened"]) {
    assert.ok(source.includes(event), "Missing alert history event: " + event);
  }
  assert.match(source, /afe_coo_alert_events/);
  assert.match(source, /patch\.reopen_count = Number\(alert\.reopen_count \|\| 0\) \+ 1/);
  assert.match(source, /patch\.last_reopened_at = stamp/);
});

test("COO alert UI exposes the full treatment cycle and action history", async () => {
  const source = await readFile(platformUrl, "utf8");
  for (const label of ["Enregistrer le diagnostic","Démarrer / mettre à jour la correction","Soumettre à vérification","Valider la résolution","Refuser et retourner en correction","Réouvrir l’alerte","Charger l’historique des actions"]) {
    assert.ok(source.includes(label), "Missing alert workflow control: " + label);
  }
});

test("COO alert condition reappearance reopens the alert and records a system history event", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /workflow_status: "reopened"/);
  assert.match(source, /reopen_count: Number\(found\[0\]\.reopen_count \|\| 0\) \+ 1/);
  assert.match(source, /last_reopened_at: reopenedAt/);
  assert.match(source, /appendAlertEvent\(workspaceId, found\[0\]\.id, null, "condition_reappeared"/);
});

test("COO automatic condition clearance never bypasses evidence and independent verification", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /await ensureAlertConditionCleared\(workspaceId, alert\)/);
  assert.match(source, /clean\(alert\.evidence_reference, 2000\)\.length < 10/);
  assert.match(source, /clean\(alert\.resolution_summary, 4000\)\.length < 20/);
  assert.match(source, /condition_cleared_pending_verification/);
  assert.match(source, /found\[0\]\.workflow_status === "pending_verification"/);
});

test("COO alert workflow foreign keys have dedicated indexes", async () => {
  const sql = await readFile(alertWorkflowIndexesUrl, "utf8");
  for (const index of ["afe_coo_alerts_verified_by_idx","afe_coo_alert_events_alert_id_idx","afe_coo_alert_events_actor_id_idx"]) {
    assert.ok(sql.includes(index), "Missing alert workflow FK index: " + index);
  }
});

test("COO alert verification requires an assigned owner and a different reviewer", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /if \(!alert\.assigned_to\) throw fail\("Cette alerte doit d'abord être prise en charge/);
  assert.match(source, /if \(alert\.assigned_to === user\.id\) throw fail\("La vérification doit être effectuée par une personne différente/);
});

test("COO alerts can be assigned or transferred only to an eligible member of the same workspace", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /if \(action === "assign"\)/);
  assert.match(source, /await validateMember\(workspaceId, assignedTo\)/);
  assert.match(source, /members\.filter\(m => rank\[m\.role as Role\] >= rank\.editor\)/);
  assert.match(source, /Affecter \/ transférer/);
  assert.match(source, /patch\.assigned_to = assignedTo/);
});

test("COO alert reopening invalidates stale closure evidence so a fresh proof is required", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /evidence_reference: "", resolution_summary: "", verification_note: ""/);
  assert.match(source, /patch\.evidence_reference = ""; patch\.resolution_summary = ""; patch\.verification_note = ""/);
});


const p11dMigrationUrl = new URL("../supabase/migrations/20261115235223_afe_p11d_atomic_coo_creation_audit.sql", import.meta.url);
const p11dRecoveryMigrationUrl = new URL("../supabase/migrations/20261116000043_afe_p11d_orchestration_atomic_recovery.sql", import.meta.url);
const p11dLegacyBackfillMigrationUrl = new URL("../supabase/migrations/20261116000931_afe_p11d_legacy_audit_backfill.sql", import.meta.url);

test("P1.1-D COO mission creation delegates mission, event and audit to one transaction", async () => {
  const source = await readFile(platformUrl, "utf8");
  const migration = await readFile(p11dMigrationUrl, "utf8");
  const start = source.indexOf("async function createMission(workspaceId: string, user: AuthUser, input: any)");
  const end = source.indexOf("async function createTask(workspaceId: string, user: AuthUser, input: any)", start);
  assert.ok(start >= 0 && end > start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /rpc\/afe_create_coo_mission_with_audit/);
  assert.match(implementation, /p_idempotency_key: idempotencyKey/);
  assert.match(implementation, /if \(!idempotencyKey \|\| idempotencyKey.length > 160\)/);
  assert.doesNotMatch(implementation, /afe_agent_missions\?on_conflict|afe_agent_events|await audit\(/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.afe_create_coo_mission_with_audit/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /INSERT INTO public\.afe_agent_events/);
  assert.match(migration, /INSERT INTO public\.debate_workspace_audit/);
});

test("P1.1-D COO task creation commits audit and assignment notification atomically", async () => {
  const source = await readFile(platformUrl, "utf8");
  const migration = await readFile(p11dMigrationUrl, "utf8");
  const start = source.indexOf("async function createTask(workspaceId: string, user: AuthUser, input: any)");
  const end = source.indexOf("async function patchTask(workspaceId: string, user: AuthUser, id: string, input: any)", start);
  assert.ok(start >= 0 && end > start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /rpc\/afe_create_coo_task_with_audit/);
  assert.match(implementation, /p_idempotency_key: idempotencyKey/);
  assert.match(implementation, /if \(!idempotencyKey \|\| idempotencyKey.length > 160\)/);
  assert.doesNotMatch(implementation, /afe_operational_tasks\?on_conflict|await audit\(|await notify\(/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.afe_create_coo_task_with_audit/);
  assert.match(migration, /INSERT INTO public\.debate_workspace_audit/);
  assert.match(migration, /INSERT INTO public\.notifications/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test("P1.1-D transactional RPCs are server-only and do not bypass RLS with SECURITY DEFINER", async () => {
  const migration = await readFile(p11dMigrationUrl, "utf8");
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.afe_create_coo_mission_with_audit/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.afe_create_coo_task_with_audit/);
  assert.match(migration, /TO service_role/);
});


test("P1.1-D retries repair legacy mission and task audit traces without duplicating notifications", async () => {
  const recovery = await readFile(p11dRecoveryMigrationUrl, "utf8");
  assert.match(recovery, /COO_MISSION_IDEMPOTENCY_KEY_CONFLICT/);
  assert.match(recovery, /COO_TASK_IDEMPOTENCY_KEY_CONFLICT/);
  assert.match(recovery, /recovered/);
  assert.match(recovery, /notifications_source_key_uidx/);
  assert.match(recovery, /source_key = v_source_key/);
  assert.match(recovery, /ON CONFLICT DO NOTHING/);
});


test("P1.1-D legacy backfill is idempotent and limited to COO-owned rows", async () => {
  const backfill = await readFile(p11dLegacyBackfillMigrationUrl, "utf8");
  assert.match(backfill, /m\.department_id IS NOT NULL/);
  assert.match(backfill, /t\.department_id IS NOT NULL/);
  assert.match(backfill, /NOT EXISTS/);
  assert.match(backfill, /coo\.mission\.created/);
  assert.match(backfill, /coo\.task\.created/);
  assert.match(backfill, /backfilled',true/);
});

test("COO dashboard GET is bounded, read-only and does not reconcile alerts or provision departments", async () => {
  const source = await readFile(platformUrl, "utf8");
  const match = source.match(/async function handleDashboard\([\s\S]*?\n}\nasync function generateReport/);
  assert.ok(match, "Dashboard handler must remain independently identifiable");
  const handler = match[0];
  assert.equal((handler.match(/snapshot\(workspaceId\)/g) ?? []).length, 1,
    "Dashboard should build its response from one consistent snapshot");
  assert.doesNotMatch(handler, /refreshAlerts\(/,
    "GET dashboard must not trigger per-record alert reconciliation");
  assert.doesNotMatch(handler, /ensureDepartments\(/,
    "GET dashboard must not provision or rewrite department records");
});


test("COO task completion requires concrete evidence or a documented exception", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /function validateCompletionEvidence\(input: any\)/);
  assert.match(source, /Clôture refusée : fournissez une preuve concrète ou une exception justifiée d'au moins 30 caractères/);
  assert.match(source, /Object\.assign\(patch, validateCompletionEvidence\(input\)\)/);
  assert.match(source, /completionEvidenceChanged: entityType === "task" && Boolean\(after\.completion_evidence\)/);
  assert.match(source, /completionExceptionChanged: entityType === "task" && Boolean\(after\.completion_exception_reason\)/);
  assert.match(source, /completion_evidence: \{ title, description, reference, url, submitted_at: nowIso\(\) \}/);
});

const e2StatusMigrationUrl = new URL("../supabase/migrations/20261125120000_afe_coo_status_invariants_e2.sql", import.meta.url);

test("E2 task status invariants require blocked reasons and normalize completion and reopen transitions", async () => {
  const source = await readFile(platformUrl, "utf8");
  const patchStart = source.indexOf("async function patchTask(");
  const patchEnd = source.indexOf("async function patchMission(", patchStart);
  const patch = source.slice(patchStart, patchEnd);
  assert.match(patch, /Une tâche bloquée doit obligatoirement comporter un motif de blocage/);
  assert.match(patch, /patch\.progress_percent = Math\.min\(Number\(patch\.progress_percent \?\? old\.progress_percent \?\? 0\), 99\)/);
  assert.match(patch, /patch\.status === "done".*patch\.progress_percent = 100/);
  assert.match(patch, /patch\.status === "todo" \|\| patch\.status === "in_progress" \|\| patch\.status === "cancelled"/);
});

test("E2 worker completion path writes structured E1 evidence atomically", async () => {
  const sql = await readFile(e2StatusMigrationUrl, "utf8");
  assert.match(sql, /completion_evidence = CASE/);
  assert.match(sql, /'title', t\.title/);
  assert.match(sql, /'description', pg_catalog\.left\(parsed\.deliverable, 6000\)/);
  assert.match(sql, /completion_exception_reason = NULL/);
  assert.match(sql, /commit_afe_agent_mission_execution/);
});

test("E3 reconciliation derives mission progress from non-cancelled operational tasks and flags mismatches", async () => {
  const source = await readFile(platformUrl, "utf8");
  const start = source.indexOf("function reconcileMissionProgress(");
  const end = source.indexOf("function computeDashboard(", start);
  assert.ok(start >= 0 && end > start, "reconciliation helper must exist before dashboard calculation");
  const helper = source.slice(start, end);
  assert.match(helper, /status !== "cancelled"/);
  assert.match(helper, /task\.status === "done" \? 100/);
  assert.match(helper, /Math\.round\(missionTasks\.reduce/);
  assert.match(helper, /storedProgressPercent !== expectedProgressPercent/);
  assert.match(helper, /Mission completed while operational tasks remain incomplete/);
  assert.match(helper, /Mission reports 100% while tasks are incomplete/);
});

test("E3 dashboard exposes reconciliation status and discrepancy counts without mutating data", async () => {
  const source = await readFile(platformUrl, "utf8");
  const start = source.indexOf("function computeDashboard(");
  const end = source.indexOf("async function createMission(", start);
  const dashboard = source.slice(start, end);
  assert.match(dashboard, /progressDiscrepancyMissions: reconciliationDiscrepancies\.length/);
  assert.match(dashboard, /progressReconciliation: \{ checkedMissionCount:/);
  assert.match(dashboard, /status: reconciliationDiscrepancies\.length \? "needs_attention" : "consistent"/);
  const handlerStart = source.indexOf("function handleDashboard(");
  const handlerEnd = source.indexOf("async function generateReport(", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(handler, /PATCH|refreshAlerts\(|reconcileMissionProgress\([^)]*\)\s*=/, "dashboard reconciliation must remain read-only");
});

test("E4 mission and task updates record before-after changes with actor, origin and correlation", async () => {
  const source = await readFile(platformUrl, "utf8");
  const start = source.indexOf("function buildAuditChangeDetails(");
  const end = source.indexOf("async function patchTask(", start);
  assert.ok(start >= 0 && end > start, "E4 audit detail builder must be present");
  const builder = source.slice(start, end);
  assert.match(builder, /schemaVersion: 1/);
  assert.match(builder, /origin: "coo-api"/);
  assert.match(builder, /actor: \{ userId: actor\.id/);
  assert.match(builder, /correlationId: suppliedCorrelation \|\| null/);
  assert.match(builder, /operationId:/);
  assert.match(builder, /changes\[field\] = \{ before: before\[field\] \?\? null, after: nextValue \?\? null \}/);
  assert.match(builder, /justification:/);
  assert.match(source, /afe_coo_patch_task_with_audit/);
  assert.match(source, /afe_coo_patch_mission_with_audit/);
  assert.match(source, /p_audit_details: auditDetails/);
});

test("E4 audit attribution cannot be overridden by client-provided origin", async () => {
  const source = await readFile(platformUrl, "utf8");
  const start = source.indexOf("function buildAuditChangeDetails(");
  const end = source.indexOf("async function patchTask(", start);
  const builder = source.slice(start, end);
  assert.match(builder, /origin: "coo-api"/);
  assert.doesNotMatch(builder, /clean\(input\.auditOrigin/);
});

test("E5 mission closure lifecycle rejects blocked, terminal-invalid and incomplete states", async () => {
  const source = await readFile(platformUrl, "utf8");
  const start = source.indexOf("function validateMissionClosureLifecycle(");
  const end = source.indexOf("function reconcileMissionProgress(", start);
  assert.ok(start >= 0 && end > start, "E5 lifecycle guard helper must exist");
  const helper = source.slice(start, end);
  assert.match(helper, /mission\.status === "completed"/);
  assert.match(helper, /\["paused", "failed", "cancelled"\]/);
  assert.match(helper, /blocked_reason/);
  assert.match(helper, /!operationalTasks\.length/);
  assert.match(helper, /task\.status !== "done"/);
  assert.match(helper, /prerequisite\.status !== "completed"/);
  assert.match(source, /validateMissionClosureLifecycle\(mission, operationalTasks, prerequisiteMissions\)/);
  assert.match(source, /Clôture refusée : " \+ lifecycleError/);
});

test("E5 closure reads prerequisite missions and verifies completed status", async () => {
  const source = await readFile(platformUrl, "utf8");
  const start = source.indexOf('if (action === "accept_closure")');
  const end = source.indexOf('throw fail("Action de contrôle inconnue.', start);
  const closure = source.slice(start, end);
  assert.match(closure, /afe_agent_mission_dependencies/);
  assert.match(closure, /afe_agent_missions\?workspace_id=eq/);
  assert.match(closure, /select=id,status/);
  assert.match(closure, /validateMissionClosureLifecycle/);
});

test("E8 mission and task patches use atomic RPC with optimistic concurrency and audit", async () => {
  const source = await readFile(platformUrl, "utf8");
  const taskStart = source.indexOf("async function patchTask(");
  const missionStart = source.indexOf("async function patchMission(", taskStart);
  const task = source.slice(taskStart, missionStart);
  const missionEnd = source.indexOf("async function handleSupervision(", missionStart);
  const mission = source.slice(missionStart, missionEnd);
  assert.match(task, /afe_coo_patch_task_with_audit/);
  assert.match(task, /p_expected_status: String\(old\.status\)/);
  assert.match(task, /p_expected_updated_at: old\.updated_at/);
  assert.match(task, /buildAuditChangeDetails\("task"/);
  assert.match(task, /concurrent détectée/);
  assert.match(mission, /afe_coo_patch_mission_with_audit/);
  assert.match(mission, /p_expected_updated_at: found\[0\]\.updated_at/);
  assert.match(mission, /buildAuditChangeDetails\("mission"/);
  assert.match(mission, /concurrente détectée/);
  assert.doesNotMatch(task, /await audit\(workspaceId, user\.id, "coo\.task\.updated"/);
  assert.doesNotMatch(mission, /await audit\(workspaceId, user\.id, "coo\.mission\.updated"/);
});

test("E6 closure is guarded by compare-and-set status and timestamp", async () => {
  const source = await readFile(platformUrl, "utf8");
  const start = source.indexOf('if (action === "accept_closure")');
  const end = source.indexOf('throw fail("Action de contrôle inconnue.', start);
  const closure = source.slice(start, end);
  assert.match(closure, /status=neq\.completed/);
  assert.match(closure, /updated_at=eq\." \+ enc\(String\(mission\.updated_at\)\)/);
  assert.match(closure, /if \(!closureRows\[0\]\) throw fail\("Clôture concurrente détectée/);
});
