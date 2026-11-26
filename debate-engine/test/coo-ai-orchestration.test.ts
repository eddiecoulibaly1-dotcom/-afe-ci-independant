import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261107220000_afe_ci_coo_ai_orchestration_engine.sql", import.meta.url);
const platformUrl = new URL("../src/coo-platform.ts", import.meta.url);
const indexesUrl = new URL("../supabase/migrations/20261107223000_afe_ci_coo_ai_foreign_key_indexes.sql", import.meta.url);
const atomicityUrl = new URL("../supabase/migrations/20261126100000_coo_orchestration_atomicity_and_resume.sql", import.meta.url);

test("COO AI schema binds a workspace-scoped agent and exposes bounded autonomy and emergency stop", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const column of ["coo_agent_id","coo_enabled","coo_autonomy_level","coo_kill_switch","coo_max_workstreams","coo_max_tasks_per_workstream"]) {
    assert.match(sql, new RegExp("ADD COLUMN IF NOT EXISTS " + column));
  }
  assert.match(sql, /FOREIGN KEY \(coo_agent_id, workspace_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.afe_coo_runs/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.afe_coo_runs FROM anon, authenticated/);
});

test("COO orchestrator calls a model, restricts delegation to active non-independent directors and persists run records", async () => {
  const source = await readFile(platformUrl, "utf8");
  const migration = await readFile(atomicityUrl, "utf8");
  assert.match(source, /callModel<CooPlan>/);
  assert.match(source, /coo_kill_switch/);
  assert.match(source, /coo_autonomy_level/);
  assert.match(source, /afe_coo_runs/);
  assert.match(source, /!d\.is_independent && !d\.human_only/);
  assert.match(source, /department\.director_agent_id/);
  assert.match(migration, /coo\.delegation\.dispatched/);
  assert.match(source, /coo\.orchestration\.completed/);
});

test("COO orchestration blocks only sensitive actions requiring a reserved human decision", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /if \(sensitiveItems\.length > 0 && requiredDecisionPending\)/);
  assert.match(source, /Approbation humaine obligatoire/);
  assert.match(source, /Routine DG decisions are recorded for follow-up/);
  assert.match(source, /const status = "dispatched"/);
});

test("COO orchestration endpoint is authenticated and settings cap autonomy at level 2", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /resource === "orchestrate" && method === "POST"/);
  assert.match(source, /requireAccess\(workspaceId, user, "owner"\)/);
  assert.match(source, /level !== 1 && level !== 2/);
  assert.match(source, /Le niveau 3 reste verrouillé/);
  assert.match(source, /cooAgentId/);
  assert.match(source, /cooRun/);
});

test("COO AI foreign keys have covering indexes", async () => {
  const sql = await readFile(indexesUrl, "utf8");
  for (const index of ["afe_coo_runs_coo_agent_workspace_idx","afe_coo_runs_initiated_by_idx","afe_coo_settings_coo_agent_workspace_idx"]) {
    assert.ok(sql.includes(index), "Missing index " + index);
  }
});

test("COO missions carry task identifiers through atomic dispatch and workers synchronize results", async () => {
  const platform = await readFile(platformUrl, "utf8");
  const worker = await readFile(new URL("../src/autonomous-agents/worker.ts", import.meta.url), "utf8");
  const migration = await readFile(atomicityUrl, "utf8");
  assert.match(platform, /rpc\/dispatch_coo_workstream_atomic/);
  assert.match(migration, /'cooTasks',tasks/);
  assert.match(worker, /task_results/);
  assert.match(worker, /syncCooTaskResults/);
  assert.match(worker, /rpc\/apply_coo_task_results_atomic/);
  assert.match(migration, /status='paused'/);
  assert.match(migration, /coo\.tasks\.incomplete/);
});

test("COO dispatch is transactional and task identities are unique for resumable retries", async () => {
  const migration = await readFile(atomicityUrl, "utf8");
  const source = await readFile(platformUrl, "utf8");
  assert.match(migration, /dispatch_coo_workstream_atomic/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS afe_operational_tasks_coo_task_key_uq/);
  assert.match(migration, /ON CONFLICT\(workspace_id,mission_id,coo_task_key\) WHERE coo_task_key IS NOT NULL/);
  assert.match(source, /rpc\/dispatch_coo_workstream_atomic/);
  assert.match(source, /task_key: missionKey \+ ":task:" \+ index/);
  assert.match(source, /Persist the validated plan before dispatch/);
  assert.match(source, /priorRun\?\.plan\?\.workstreams\?\.length/);
  assert.match(source, /\["dispatched","cancelled"\]\.includes\(priorRun\.status\)/);
  assert.match(source, /priorApprovalPending/);
});


test("E9.2-D4 retry resumes an interrupted orchestration with the persisted plan and stable mission/task keys", async () => {
  const source = await readFile(platformUrl, "utf8");
  const migration = await readFile(atomicityUrl, "utf8");
  assert.match(source, /let generatedPlan: CooPlan \| null = \(priorRun\?\.plan\?\.workstreams\?\.length \? priorRun\.plan : null\)/);
  assert.match(source, /generatedPlan \?\? await callModel<CooPlan>/);
  assert.match(source, /priorRun\?\.plan\?\.dispatched \? \[\.\.\.priorRun\.plan\.dispatched\] : \[\]/);
  assert.match(source, /run\.id \+ ":" \+ department\.slug/);
  assert.match(source, /missionKey \+ ":task:" \+ index/);
  assert.match(migration, /ON CONFLICT\(workspace_id,idempotency_key\) DO NOTHING/);
  assert.match(migration, /ON CONFLICT\(workspace_id,mission_id,coo_task_key\) WHERE coo_task_key IS NOT NULL DO NOTHING/);
  assert.match(migration, /SELECT id INTO tid FROM public\.afe_operational_tasks WHERE workspace_id=p_workspace_id AND mission_id=m\.id AND coo_task_key=tkey/);
  assert.match(source, /existingDispatchIndex>=0\)createdMissions\[existingDispatchIndex\]=dispatchEntry;else createdMissions\.push\(dispatchEntry\)/);
});

test("E9.2-D5 orchestration history exposes a read-only Run-Mission-Task reconciliation API and UI", async () => {
  const source = await readFile(platformUrl, "utf8");
  const planning = await readFile(new URL("../src/coo-planning.ts", import.meta.url), "utf8");
  assert.match(source, /reconcileCooRun\(run, missions, tasks, departmentSlugs\)/);
  assert.match(source, /input_context->>cooRunId=eq\./);
  assert.match(source, /coo_task_key/);
  assert.match(source, /reconciliationSummary/);
  assert.match(source, /data-tab="orchestrations">Historique COO/);
  assert.match(source, /async function renderOrchestrations\(/);
  assert.match(source, /Rapprochement en lecture seule/);
  for (const code of ["missing_dispatch","missing_mission","mission_run_mismatch","orphan_mission","task_count_mismatch","missing_task_key","task_key_missing","unexpected_task_key","mission_task_context_mismatch","mission_count_mismatch"]) {
    assert.ok(planning.includes(code), "Missing reconciliation detection " + code);
  }
  assert.match(planning, /export function reconcileCooRun/);
});

test("E9.2-D6 DG decisions are owner-only, immutable, audited and resume approved sensitive runs", async () => {
  const source = await readFile(platformUrl, "utf8");
  const planning = await readFile(new URL("../src/coo-planning.ts", import.meta.url), "utf8");
  assert.match(source, /resource === "orchestrations" && p\[6\] && p\[7\] === "decisions"/);
  assert.match(source, /requireAccess\(workspaceId, user, "owner"\)/);
  assert.match(planning, /status: decision === "approve"/);
  assert.match(source, /coo\.orchestration\.dg_decision/);
  assert.match(source, /orchestrateCooInstruction\(workspaceId, user, \{ instruction: run\.instruction, idempotencyKey: run\.idempotency_key \}\)/);
  assert.match(source, /status: rejectedRequired \? "cancelled" : run\.status/);
  assert.match(source, /data-dg-decision="approve"/);
  assert.match(source, /data-dg-decision="reject"/);
  assert.match(source, /role==="owner"/);
  assert.match(source, /hasPendingRequiredCooDecisions/);
  assert.match(planning, /export function createCooDecisionRegister/);
  assert.match(planning, /export function applyCooDecisionRegister/);
  assert.match(planning, /Une décision DG déjà enregistrée ne peut pas être inversée/);
  assert.match(planning, /hasRejectedRequiredCooDecisions/);
});

test("E9.2-D7 validates the plan shape and all delegation limits before dispatch", async () => {
  const source = await readFile(platformUrl, "utf8");
  const planning = await readFile(new URL("../src/coo-planning.ts", import.meta.url), "utf8");
  assert.match(source, /Structure du plan COO invalide/);
  assert.match(source, /validateCooPlan\(plan, \{ maxWorkstreams, maxTasksPerWorkstream: maxTasks, maxTasksPerRun \}, eligible\.map\(item => item\.slug\)\)/);
  assert.match(source, /Plan COO rejeté avant dispatch/);
  assert.match(source, /validationIssues\.length/);
  for (const code of ["summary_invalid","priority_invalid","department_not_eligible","department_duplicate","workstream_deadline_invalid","task_deadline_invalid","task_priority_invalid","task_title_duplicate","total_task_limit","decisions_invalid","assumptions_invalid"]) assert.ok(planning.includes(code));
  assert.match(planning, /export function validateCooPlan/);
});
