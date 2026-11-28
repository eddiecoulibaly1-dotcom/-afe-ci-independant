import test from "node:test";
import assert from "node:assert/strict";
import { validateAmbiguousCooDispatchRecovery } from "../src/coo-dispatch-recovery.js";

const keys = (runKey: string, count: number) => Array.from({ length: count }, (_, i) => ({ coo_task_key: runKey + ":task:" + i }));

test("E13.2 runtime: no mission means caller may retry only after authoritative read-back", () => {
  assert.equal(validateAmbiguousCooDispatchRecovery(null, "run:dept", 2, []), null);
});

test("E13.2 runtime: complete committed dispatch is recovered with exact mission/task count", () => {
  assert.deepEqual(validateAmbiguousCooDispatchRecovery("mission-42", "run:dept", 3, keys("run:dept", 3)), { missionId: "mission-42", taskCount: 3 });
});

test("E13.2 runtime: partial task persistence refuses automatic redispatch", () => {
  assert.throws(() => validateAmbiguousCooDispatchRecovery("mission-42", "run:dept", 3, keys("run:dept", 2)), /No automatic redispatch/);
});

test("E13.2 runtime: duplicate task keys are rejected even when task count matches", () => {
  assert.throws(() => validateAmbiguousCooDispatchRecovery("mission-42", "run:dept", 2, [{ coo_task_key: "run:dept:task:0" }, { coo_task_key: "run:dept:task:0" }]), /No automatic redispatch/);
});

test("E13.2 runtime: unexpected or missing stable task key is rejected", () => {
  assert.throws(() => validateAmbiguousCooDispatchRecovery("mission-42", "run:dept", 2, [{ coo_task_key: "run:dept:task:0" }, { coo_task_key: "foreign:task:1" }]), /No automatic redispatch/);
});

test("E13.2 runtime: invalid expected task count is rejected before recovery", () => {
  assert.throws(() => validateAmbiguousCooDispatchRecovery("mission-42", "run:dept", -1, []), /Invalid expected task count/);
  assert.throws(() => validateAmbiguousCooDispatchRecovery("mission-42", "run:dept", 1.5, []), /Invalid expected task count/);
});
