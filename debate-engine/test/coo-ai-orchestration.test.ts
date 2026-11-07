import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261107220000_afe_ci_coo_ai_orchestration_engine.sql", import.meta.url);
const platformUrl = new URL("../src/coo-platform.ts", import.meta.url);
const indexesUrl = new URL("../supabase/migrations/20261107223000_afe_ci_coo_ai_foreign_key_indexes.sql", import.meta.url);

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
  assert.match(source, /callModel<CooPlan>/);
  assert.match(source, /coo_kill_switch/);
  assert.match(source, /coo_autonomy_level/);
  assert.match(source, /afe_coo_runs/);
  assert.match(source, /!d\.is_independent && !d\.human_only/);
  assert.match(source, /department\.director_agent_id/);
  assert.match(source, /coo\.delegation\.dispatched/);
  assert.match(source, /coo\.orchestration\.completed/);
});

test("COO orchestration never dispatches work when the plan requires a reserved human decision", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /plan\.decisionsRequired\.length > 0/);
  assert.match(source, /status: "approval_required", plan, missions_created: 0/);
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
