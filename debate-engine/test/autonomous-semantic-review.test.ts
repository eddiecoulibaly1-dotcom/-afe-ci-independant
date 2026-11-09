import test from "node:test";
import assert from "node:assert/strict";
import { reviewMissionSemantics } from "../src/autonomous-agents/semantic-review.js";

const input = {
  workspaceId: "workspace-a",
  missionId: "mission-a",
  submittingAgentId: "executor-a",
  executorProvider: "openai" as const,
  objective: "Évaluer les risques opérationnels.",
  acceptanceCriteria: ["Les risques sont classés"],
  expectedTaskIds: ["task-1"],
  result: {
    summary: "Synthèse des risques opérationnels.",
    analysis: "Les constats identifient les causes et les impacts.",
    deliverables: ["Rapport des risques classés avec recommandations."],
    task_results: [{ taskId: "task-1", status: "done" as const, progressPercent: 100, summary: "Tâche réalisée.", deliverable: "Livrable vérifiable de la tâche." }]
  }
};

test("semantic reviewer uses a provider distinct from the executor and verifies exact dossier citations", async () => {
  const report = await reviewMissionSemantics(input, async (args: any) => {
    assert.equal(args.provider, "gemini");
    return {
      verdict: "accepted",
      findings: [{
        code: "OBJECTIVE_MET", severity: "minor", message: "Le livrable correspond à l'objectif.",
        citations: [{ sourceId: "mission.deliverable.1", quote: "Rapport des risques classés" }]
      }]
    } as any;
  }, new Date("2026-11-08T12:00:00.000Z"));
  assert.equal(report.verdict, "accepted");
  assert.equal(report.citationsVerified, true);
  assert.equal(report.closureEligible, false);
  assert.equal(report.findings[0].citations[0].quote, "Rapport des risques classés");
});

test("semantic reviewer rejects citations not present verbatim in the mission dossier", async () => {
  await assert.rejects(() => reviewMissionSemantics(input, async () => ({
    verdict: "accepted",
    findings: [{
      code: "MADE_UP", severity: "minor", message: "Citation inventée.",
      citations: [{ sourceId: "mission.deliverable.1", quote: "Cette phrase n'existe pas dans le dossier." }]
    }]
  } as any)), /SEMANTIC_REVIEW_UNVERIFIED_CITATION/);
});

test("semantic reviewer downgrades accepted verdict when a major finding exists", async () => {
  const report = await reviewMissionSemantics(input, async () => ({
    verdict: "accepted",
    findings: [{ code: "GAP", severity: "major", message: "Un critère reste insuffisamment démontré.", citations: [] }]
  } as any));
  assert.equal(report.verdict, "revision_required");
});

test("semantic reviewer rejects malformed model output", async () => {
  await assert.rejects(() => reviewMissionSemantics(input, async () => ({ verdict: "accepted" } as any)), /SEMANTIC_REVIEW_INVALID_OUTPUT/);
});
