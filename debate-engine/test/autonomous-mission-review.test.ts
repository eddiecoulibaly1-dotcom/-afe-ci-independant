import test from "node:test";
import assert from "node:assert/strict";
import { reviewMissionEvidence } from "../src/autonomous-agents/review.js";

const valid = {
  workspaceId: "workspace-a",
  missionId: "mission-a",
  submittingAgentId: "agent-executor",
  reviewerAgentId: "agent-reviewer",
  expectedTaskIds: ["task-1"],
  result: {
    summary: "A complete operational summary with verifiable outcome.",
    analysis: "The work was assessed against the requested objective and its acceptance criteria.",
    deliverables: ["A documented deliverable containing concrete results and traceable references."],
    task_results: [{
      taskId: "task-1", status: "done" as const, progressPercent: 100,
      summary: "Task completed with evidence.",
      deliverable: "A task-level output with concrete content and verifiable references."
    }]
  }
};

test("independent reviewer accepts complete evidence but never authorizes closure", () => {
  const report = reviewMissionEvidence(valid, new Date("2026-11-08T12:00:00.000Z"));
  assert.equal(report.verdict, "accepted");
  assert.equal(report.closureEligible, false);
  assert.equal(report.reviewerAgentId, "agent-reviewer");
});

test("reviewer cannot certify its own submission", () => {
  assert.throws(() => reviewMissionEvidence({ ...valid, reviewerAgentId: "agent-executor" }), /distinct/);
});

test("missing task evidence blocks acceptance", () => {
  const report = reviewMissionEvidence({ ...valid, result: { ...valid.result, task_results: [] } });
  assert.equal(report.verdict, "rejected");
  assert.ok(report.findings.some(x => x.code === "TASK_RESULT_MISSING"));
});

test("incomplete tasks require revision and cannot be closed", () => {
  const report = reviewMissionEvidence({
    ...valid,
    result: { ...valid.result, task_results: [{ taskId: "task-1", status: "in_progress", progressPercent: 60 }] }
  });
  assert.equal(report.verdict, "revision_required");
  assert.equal(report.closureEligible, false);
});

test("cross-workspace data is not accepted as a review input without explicit workspace scope", () => {
  assert.throws(() => reviewMissionEvidence({ ...valid, workspaceId: "" }), /scope/);
});
