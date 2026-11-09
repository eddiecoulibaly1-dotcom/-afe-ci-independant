import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261107190000_afe_ci_coo_operations_control_plane.sql", import.meta.url);
const alertWorkflowUrl = new URL("../supabase/migrations/20261109081327_coo_alert_resolution_workflow.sql", import.meta.url);
const alertWorkflowIndexesUrl = new URL("../supabase/migrations/20261109081603_coo_alert_workflow_fk_indexes.sql", import.meta.url);
const platformUrl = new URL("../src/coo-platform.ts", import.meta.url);
const reportingUrl = new URL("../src/coo-reporting.ts", import.meta.url);
const indexesUrl = new URL("../supabase/migrations/20261107200000_afe_ci_coo_foreign_key_indexes.sql", import.meta.url);
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
  assert.match(source, /validateDepartment\(workspaceId, departmentId\)/);
  assert.match(source, /validateAgent\(workspaceId, assignedAgentId, departmentId\)/);
  assert.match(source, /validateMember\(workspaceId, assignedUserId\)/);
  assert.match(source, /coo\.task\.created/);
  assert.match(source, /coo\.mission\.created/);
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

test("partial COO dispatch failures remain visible with their created missions and audit event", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /const partial = createdMissions\.length > 0/);
  assert.match(source, /status: partial \? "partial" : "failed"/);
  assert.match(source, /missions_created: createdMissions\.length/);
  assert.match(source, /createdMissions\.push\(dispatchRecord\)/);
  assert.match(source, /dispatchRecord\.taskCount = createdTasks\.length/);
  assert.match(source, /coo\.orchestration\.partial_failure/);
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


test("agent worker preserves partial mission results when COO tasks are blocked", async () => {
  const workerUrl = new URL("../src/autonomous-agents/worker.ts", import.meta.url);
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /execution_state:"partial"/);
  assert.match(source, /blocked_task_count:blockedCount/);
  assert.match(source, /status:"paused"/);
  assert.match(source, /blocked_reason:reason\.slice\(0,3000\)/);
  assert.match(source, /event_type:"coo\.tasks\.incomplete"/);
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
