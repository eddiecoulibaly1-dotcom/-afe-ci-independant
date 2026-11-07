import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261107190000_afe_ci_coo_operations_control_plane.sql", import.meta.url);
const platformUrl = new URL("../src/coo-platform.ts", import.meta.url);
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
  assert.match(source, /if \(p\[6\] && method === "POST"\) \{ await canOperate\(workspaceId, user\); send\(res, 200, await actOnAlert/);
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
  assert.match(source, /status: "resolved", resolved_by: null, resolved_at: nowIso\(\)/);
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
  assert.match(source, /if \(Array\.isArray\(plan\.decisionsRequired\).*length > 0\)/);
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
