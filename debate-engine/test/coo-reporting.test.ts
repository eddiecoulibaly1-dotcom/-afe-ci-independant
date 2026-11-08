import test from "node:test";
import assert from "node:assert/strict";
import { buildCooDataQuality, resolveTaskDepartmentId } from "../src/coo-reporting.js";

test("a task inherits the effective department resolved for its mission", () => {
  assert.equal(resolveTaskDepartmentId({}, { effective_department_id: "dept-inferred" }), "dept-inferred");
});

test("explicit task department takes precedence over mission and agent fallbacks", () => {
  assert.equal(resolveTaskDepartmentId({ department_id: "dept-task" }, { effective_department_id: "dept-mission" }, { department_id: "dept-agent" }), "dept-task");
});

test("agent department is the fallback when the task and mission have no effective department", () => {
  assert.equal(resolveTaskDepartmentId({}, null, { department_id: "dept-agent" }), "dept-agent");
});

test("completed mission is verified only when it has at least one task and every task is done", () => {
  const result = buildCooDataQuality(
    [
      { id: "verified", status: "completed", effective_department_id: "d1" },
      { id: "no-task", status: "completed", effective_department_id: "d1" },
      { id: "incomplete", status: "completed", effective_department_id: "d2" }
    ],
    [
      { id: "t1", mission_id: "verified", status: "done" },
      { id: "t2", mission_id: "incomplete", status: "done" },
      { id: "t3", mission_id: "incomplete", status: "blocked" }
    ],
    [{ missionCount: 2 }, { missionCount: 1 }]
  );
  assert.equal(result.completedVerifiedMissionCount, 1);
  assert.deepEqual(result.completedWithoutTasks.map(x => x.id), ["no-task"]);
  assert.deepEqual(result.completedWithIncompleteTasks.map(x => x.id), ["incomplete"]);
});

test("reconciliation detects missing department allocation without treating it as zero activity", () => {
  const result = buildCooDataQuality(
    [
      { id: "assigned", status: "running", effective_department_id: "d1" },
      { id: "unassigned", status: "queued", effective_department_id: null }
    ],
    [],
    [{ missionCount: 1 }]
  );
  assert.equal(result.missionCount, 2);
  assert.equal(result.assignedMissionCount, 1);
  assert.equal(result.unassignedMissionCount, 1);
  assert.equal(result.departmentMissionCount, 1);
  assert.equal(result.findings.length, 1);
});

test("reconciliation detects department performance totals that do not match assigned missions", () => {
  const result = buildCooDataQuality(
    [{ id: "m1", status: "running", effective_department_id: "d1" }],
    [],
    [{ missionCount: 2 }]
  );
  assert.ok(result.findings.some(x => x.includes("ventilation des missions par direction")));
});
