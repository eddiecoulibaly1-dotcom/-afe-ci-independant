import test from "node:test";
import assert from "node:assert/strict";
import { reviewMissionEvidence } from "../src/autonomous-agents/review.js";

const valid = {
  workspaceId: "workspace-a",
  missionId: "mission-a",
  submittingAgentId: "agent-executor",
  reviewerAgentId: "agent-reviewer",
  expectedTaskIds: ["task-1"],
  objective: "Évaluer les risques opérationnels et proposer des recommandations vérifiables.",
  acceptanceCriteria: ["Les risques sont classés", "Les recommandations sont priorisées"],
  result: {
    summary: "Synthèse opérationnelle des risques identifiés et des recommandations proposées.",
    analysis: "Les constats identifient les risques opérationnels, leurs causes et leurs impacts. L’analyse formule des recommandations priorisées et précise les limites ainsi que les prochaines étapes.",
    deliverables: ["Rapport documenté présentant les risques classés, les recommandations et les références vérifiables."],
    task_results: [{
      taskId: "task-1", status: "done" as const, progressPercent: 100,
      summary: "Tâche achevée avec éléments de preuve documentés.",
      deliverable: "Livrable de tâche détaillant les résultats concrets et les références vérifiables."
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

test("qualitative review reports objective alignment, traceability and analytical depth", () => {
  const report = reviewMissionEvidence(valid, new Date("2026-11-08T12:00:00.000Z"));
  assert.equal(report.qualityChecks.length, 3);
  assert.ok(report.qualityChecks.some(x => x.criterion === "objective_alignment"));
  assert.ok(report.qualityChecks.some(x => x.criterion === "traceability"));
  assert.ok(report.qualityChecks.some(x => x.criterion === "analytical_depth"));
  assert.ok(report.qualityScore >= 0 && report.qualityScore <= 100);
  assert.equal(report.closureEligible, false);
});

test("review requests revision when evidence has no traceability or analytical structure", () => {
  const report = reviewMissionEvidence({
    ...valid,
    result: {
      ...valid.result,
      analysis: "Le travail est bon et les résultats sont satisfaisants selon notre appréciation.",
      deliverables: ["Un document final qui présente simplement le travail effectué sans références concrètes."]
    }
  });
  assert.equal(report.verdict, "revision_required");
  assert.ok(report.findings.some(x => x.code === "QUALITY_TRACEABILITY"));
  assert.ok(report.findings.some(x => x.code === "QUALITY_ANALYTICAL_DEPTH"));
});
