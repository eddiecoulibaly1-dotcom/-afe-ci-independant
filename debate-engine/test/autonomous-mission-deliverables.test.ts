import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerUrl = new URL("../src/autonomous-agents/worker.ts", import.meta.url);

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

test("worker records deliverable evidence in workspace-scoped audit events before mission completion", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /async function recordMissionDeliverables/);
  assert.match(source, /event_type:"mission\.deliverables\.submitted"/);
  assert.match(source, /taskDeliverables:/);
  assert.equal((source.match(/recordMissionDeliverables\(claim,output\)/g) ?? []).length, 2);
  assert.ok(source.indexOf("await recordMissionDeliverables(claim,output)") < source.indexOf('rpc/finish_afe_agent_mission'));
});

test("incomplete or blocked COO tasks cannot be silently marked as completed", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /Le résultat de mission ne couvre pas toutes les tâches COO attendues/);
  assert.match(source, /status:"paused"/);
  assert.match(source, /coo\.tasks\.incomplete/);
  assert.match(source, /result\.status!=="done"/);
});

test("independent evidence review is recorded before task synchronization and mission completion in both worker paths", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /import \{ reviewMissionEvidence \} from "\.\/review\.js"/);
  assert.match(source, /const INDEPENDENT_REVIEWER_ID = "system:independent-evidence-gate"/);
  assert.match(source, /event_type:"mission\.evidence\.reviewed"/);
  assert.match(source, /reviewerType:"deterministic_independent_evidence_gate"/);
  assert.equal((source.match(/await recordMissionReview\(claim,mission,output\)/g) ?? []).length, 2);
  assert.match(source, /if\(report\.verdict==="rejected"\) throw new Error/);
  const reviewCall = source.indexOf("await recordMissionReview(claim,mission,output)");
  const taskSync = source.indexOf("const taskSync=await syncCooTaskResults", reviewCall);
  const missionFinish = source.indexOf("rpc/finish_afe_agent_mission", reviewCall);
  assert.ok(reviewCall >= 0 && taskSync > reviewCall && missionFinish > taskSync);
});
