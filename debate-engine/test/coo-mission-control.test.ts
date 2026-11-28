import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/autonomous-agents/worker.ts", import.meta.url), "utf8");
const coo = await readFile(new URL("../src/coo-platform.ts", import.meta.url), "utf8");

test("mission evidence submission is recorded before independent review in both worker paths", () => {
  assert.equal((worker.match(/await recordMissionDeliverables\(claim,output\)/g) ?? []).length, 2);
  assert.equal((worker.match(/const reviewReport=await recordMissionReview\(claim,mission,output,provider\)/g) ?? []).length, 2);
  const submit = worker.indexOf("await recordMissionDeliverables(claim,output)");
  const review = worker.indexOf("const reviewReport=await recordMissionReview(claim,mission,output,provider)", submit);
  assert.ok(submit >= 0 && review > submit);
  const workspaceSubmit = worker.indexOf("await recordMissionDeliverables(claim,output)", submit + 1);
  const workspaceReview = worker.indexOf("const reviewReport=await recordMissionReview(claim,mission,output,provider)", review + 1);
  assert.ok(workspaceSubmit >= 0 && workspaceReview > workspaceSubmit);
});

test("agent completion is reported as awaiting COO validation, never as accepted completion", () => {
  assert.equal((worker.match(/awaitingCooValidation:true/g) ?? []).length, 2);
  assert.equal((worker.match(/completed:true/g) ?? []).length, 0);
  assert.match(worker, /independentReview:reviewReport/);
  assert.match(worker, /status:"paused",result:pendingResult/);
  assert.match(worker, /mission\.awaiting_coo_validation/);
});

test("COO portfolio exposes pending reviews, requested corrections, accepted reviews and findings", () => {
  assert.match(coo, /reviewPending=missions\.filter/);
  assert.match(coo, /revisionRequired=missions\.filter/);
  assert.match(coo, /independentAccepted=missions\.filter/);
  assert.match(coo, /metric\("Soumises à validation",reviewPending\.length\)/);
  assert.match(coo, /metric\("Corrections demandées",revisionRequired\.length\)/);
  assert.match(coo, /metric\("Revues acceptées",independentAccepted\.length\)/);
  assert.match(coo, /metric\("Anomalies relevées",reviewFindings\)/);
  assert.match(coo, /Revue indépendante : /);
});

test("a correction request persists a visible revision state and invalidates the previous review", () => {
  assert.match(coo, /status: "revision_required", closureEligible: false, revisionNote: note/);
  assert.match(coo, /mission\.evidence\.review\.invalidated/);
  assert.match(coo, /coo\.mission\.revision_requested/);
});

test("COO closure requires an accepted independent review and complete operational task evidence", () => {
  assert.match(coo, /independentReview\?\.verdict !== "accepted"/);
  assert.match(coo, /operationalTasks\.some\(\(task: any\) => task\.status !== "done"\)/);
  assert.match(coo, /expectedIds\.size !== completed\.length/);
  assert.match(coo, /closureEligible: true/);
});
