import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerUrl = new URL("../src/autonomous-agents/worker.ts", import.meta.url);
const atomicMigrationUrl = new URL("../supabase/migrations/20261112160000_afe_agent_mission_execution_atomic_commit.sql", import.meta.url);

test("mission worker requires a substantive summary, analysis and concrete deliverables before completion", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /function validateMissionDeliverables/);
  assert.match(source, /synthèse opérationnelle vérifiable est obligatoire/);
  assert.match(source, /Analyse insuffisante/);
  assert.match(source, /Livrable absent ou trop sommaire/);
  assert.equal((source.match(/validateMissionDeliverables\(output\)/g) ?? []).length, 2);
});

test("a completed operational task must provide a concrete task-level deliverable", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /deliverable:\s*string/);
  assert.match(source, /deliverable:\{type:"string"\}/);
  assert.match(source, /Chaque tâche terminée doit fournir un livrable concret/);
  assert.match(source, /Chaque tâche terminée doit fournir un livrable concret : /);
});

test("worker commits deliverables, review evidence, task updates and mission state through one atomic RPC", async () => {
  const source = await readFile(workerUrl, "utf8");
  const sql = await readFile(atomicMigrationUrl, "utf8");
  assert.match(source, /async function commitMissionExecution/);
  assert.match(source, /rpc\/commit_afe_agent_mission_execution/);
  assert.equal((source.match(/await commitMissionExecution\(claim,output,reviewReport\)/g) ?? []).length, 2);
  for (const event of ["mission.deliverables.submitted","mission.evidence.reviewed","coo.tasks.incomplete","mission.awaiting_coo_validation"]) {
    assert.ok(sql.includes(event), "Missing transactionally persisted event " + event);
  }
  assert.match(sql, /UPDATE public\.afe_operational_tasks/);
  assert.match(sql, /UPDATE public\.afe_agent_missions/);
  assert.equal(source.includes("syncCooTaskResults"), false);
  assert.equal(source.includes("recordMissionDeliverables"), false);
});

test("incomplete or blocked COO tasks remain partial and cannot be silently marked as completed", async () => {
  const sql = await readFile(atomicMigrationUrl, "utf8");
  assert.match(sql, /TASK_RESULT_COVERAGE_MISMATCH/);
  assert.match(sql, /TASK_RESULT_VALIDATION_FAILED/);
  assert.match(sql, /execution_state', 'partial'/);
  assert.match(sql, /blocked_task_count/);
  assert.match(sql, /status = 'paused'/);
  assert.match(sql, /coo\.tasks\.incomplete/);
  assert.match(sql, /result\.item ->> 'status' <> 'done'/);
});

test("independent evidence review is computed before the same atomic commit in both worker paths", async () => {
  const source = await readFile(workerUrl, "utf8");
  const sql = await readFile(atomicMigrationUrl, "utf8");
  assert.match(source, /import \{ reviewMissionEvidence \} from "\.\/review\.js"/);
  assert.match(source, /const INDEPENDENT_REVIEWER_ID = "system:independent-evidence-gate"/);
  assert.equal((source.match(/await recordMissionReview\(claim,mission,output,provider\)/g) ?? []).length, 2);
  assert.equal((source.match(/await commitMissionExecution\(claim,output,reviewReport\)/g) ?? []).length, 2);
  const reviewCall = source.indexOf("await recordMissionReview(claim,mission,output,provider)");
  const commitCall = source.indexOf("await commitMissionExecution(claim,output,reviewReport)", reviewCall);
  assert.ok(reviewCall >= 0 && commitCall > reviewCall);
  assert.equal(source.includes('event_type:"mission.evidence.reviewed"'), false);
  assert.match(sql, /mission\.evidence\.reviewed/);
  assert.match(sql, /semanticReviewerType/);
  assert.match(sql, /closureEligible', false/);
});
