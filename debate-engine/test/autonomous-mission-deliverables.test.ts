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

test("worker records deliverable evidence before task synchronization and COO review", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /async function recordMissionDeliverables/);
  assert.match(source, /event_type:"mission\.deliverables\.submitted"/);
  assert.match(source, /taskDeliverables:/);
  assert.equal((source.match(/await recordMissionDeliverables\(claim,output\)/g) ?? []).length, 2);
  assert.equal(source.includes("finish_afe_agent_mission"), false);
  const submitted = source.indexOf("await recordMissionDeliverables(claim,output)");
  assert.ok(submitted >= 0 && submitted < source.indexOf("syncCooTaskResults(claim,mission,output)"));
  assert.match(source, /mission\.awaiting_coo_validation/);
});

test("incomplete or blocked COO tasks cannot be silently marked as completed", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /Le résultat de mission ne couvre pas toutes les tâches COO attendues/);
  assert.match(source, /status:"paused"/);
  assert.match(source, /coo\.tasks\.incomplete/);
  assert.match(source, /result\.status!=="done"/);
});

test("independent evidence review is recorded before task synchronization in both worker paths", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /import \{ reviewMissionEvidence \} from "\.\/review\.js"/);
  assert.match(source, /const INDEPENDENT_REVIEWER_ID = "system:independent-evidence-gate"/);
  assert.match(source, /event_type:"mission\.evidence\.reviewed"/);
  assert.match(source, /reviewerType:"deterministic_independent_evidence_gate"/);
  assert.equal((source.match(/await recordMissionReview\(claim,mission,output\)/g) ?? []).length, 2);
  assert.match(source, /A rejected report is preserved for the COO/);
  const reviewCall = source.indexOf("await recordMissionReview(claim,mission,output)");
  const taskSync = source.indexOf("const taskSync=await syncCooTaskResults", reviewCall);
  assert.ok(reviewCall >= 0 && taskSync > reviewCall);
  assert.equal(source.includes("finish_afe_agent_mission"), false);
  assert.match(source, /status:"paused",result:pendingResult/);
});
