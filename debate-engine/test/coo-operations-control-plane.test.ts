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
