import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/autonomous-agents/worker.ts", import.meta.url), "utf8");
const coo = await readFile(new URL("../src/coo-platform.ts", import.meta.url), "utf8");
const atomic = await readFile(new URL("../supabase/migrations/20261112144356_afe_agent_mission_execution_atomic_commit.sql", import.meta.url), "utf8");

test("mission evidence review is computed first and persisted atomically with deliverables in both worker paths", () => {
  assert.equal((worker.match(/const reviewReport=await recordMissionReview\(claim,mission,output,provider\)/g) ?? []).length, 2);
  assert.equal((worker.match(/await commitMissionExecution\(claim,output,reviewReport\)/g) ?? []).length, 2);
  const review = worker.indexOf("const reviewReport=await recordMissionReview(claim,mission,output,provider)");
  const commit = worker.indexOf("await commitMissionExecution(claim,output,reviewReport)", review);
  assert.ok(review >= 0 && commit > review);
  assert.equal(worker.includes("recordMissionDeliverables"), false);
  assert.equal(worker.includes('event_type:"mission.evidence.reviewed"'), false);
  assert.match(atomic, /mission\.deliverables\.submitted/);
  assert.match(atomic, /mission\.evidence\.reviewed/);
});

test("agent completion is reported as awaiting COO validation, never as accepted completion", () => {
  assert.equal((worker.match(/awaitingCooValidation:true/g) ?? []).length, 2);
  assert.equal((worker.match(/completed:true/g) ?? []).length, 0);
  assert.match(worker, /independentReview:reviewReport/);
  assert.match(worker, /rpc\/commit_afe_agent_mission_execution/);
  assert.match(atomic, /status = 'paused'/);
  assert.match(atomic, /'coo_review'/);
  assert.match(atomic, /mission\.awaiting_coo_validation/);
  assert.equal(worker.includes("finish_afe_agent_mission"), false);
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


test("manual mission and task creation persist one intent key across retries and clear it only after success", () => {
  assert.match(coo, /function pendingIntentKey\(storageKey,payload\)/);
  assert.match(coo, /saved\?\.fingerprint===fingerprint/);
  assert.match(coo, /localStorage\.setItem\(storageKey,JSON\.stringify\(\{fingerprint,key\}\)\)/);
  assert.match(coo, /idempotencyKey:key/);
  assert.match(coo, /afe-coo-create-mission:/);
  assert.match(coo, /afe-coo-create-task:/);
  assert.match(coo, /clearPendingIntentKey\(storageKey,key\)/);
  assert.match(coo, /La même clé sera conservée pour le prochain essai/);
});

test("mission and task creation emit audit and assignment side effects only for the winning insert", () => {
  assert.equal((coo.match(/const inserted = Boolean\(/g) ?? []).length, 2);
  assert.equal((coo.match(/if \(inserted\) \{/g) ?? []).length, 2);
  const missionInsert = coo.indexOf("const inserted = Boolean(mission)");
  const missionAudit = coo.indexOf('event_type: "coo.mission.created"', missionInsert);
  const missionGate = coo.indexOf("if (inserted)", missionInsert);
  assert.ok(missionGate > missionInsert && missionAudit > missionGate);
  const taskInsert = coo.indexOf("const inserted = Boolean(task?.id)");
  const taskAudit = coo.indexOf('"coo.task.created"', taskInsert);
  const taskGate = coo.indexOf("if (inserted)", taskInsert);
  assert.ok(taskGate > taskInsert && taskAudit > taskGate);
  assert.ok(coo.indexOf('notify(assignedUserId, "coo.task.assigned"', taskGate) > taskGate);
});
