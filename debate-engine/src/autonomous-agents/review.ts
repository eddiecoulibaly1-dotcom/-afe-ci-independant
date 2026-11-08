export type MissionReviewVerdict = "accepted" | "revision_required" | "rejected";
export type MissionReviewFinding = {
  code: string;
  severity: "blocking" | "major" | "minor";
  message: string;
  taskId?: string;
};
export type MissionReviewInput = {
  workspaceId: string;
  missionId: string;
  submittingAgentId: string;
  reviewerAgentId: string;
  expectedTaskIds: readonly string[];
  objective?: string;
  acceptanceCriteria?: readonly string[];
  result: {
    summary?: string;
    analysis?: string;
    deliverables?: readonly string[];
    task_results?: readonly {
      taskId: string;
      status: "done" | "in_progress" | "blocked";
      progressPercent: number;
      blockedReason?: string;
      summary?: string;
      deliverable?: string;
    }[];
  };
};
export type MissionReviewReport = {
  workspaceId: string;
  missionId: string;
  submittingAgentId: string;
  reviewerAgentId: string;
  verdict: MissionReviewVerdict;
  findings: MissionReviewFinding[];
  reviewedAt: string;
  closureEligible: false;
  qualityScore: number;
  qualityChecks: { criterion: string; passed: boolean; detail: string }[];
};

/**
 * Independent, deterministic evidence gate. It evaluates a submitted result;
 * it never changes mission state and never authorizes closure. The caller must
 * persist this report under a distinct reviewer identity and let the COO decide.
 */
export function reviewMissionEvidence(input: MissionReviewInput, now = new Date()): MissionReviewReport {
  if (!input.workspaceId || !input.missionId) throw new Error("Workspace and mission scope are required.");
  if (!input.submittingAgentId || !input.reviewerAgentId || input.submittingAgentId === input.reviewerAgentId) {
    throw new Error("The reviewer must be distinct from the submitting agent.");
  }
  const findings: MissionReviewFinding[] = [];
  const qualityChecks: MissionReviewReport["qualityChecks"] = [];
  const result = input.result ?? {};
  const summary = typeof result.summary === "string" ? result.summary.trim() : "";
  const analysis = typeof result.analysis === "string" ? result.analysis.trim() : "";
  const deliverables = Array.isArray(result.deliverables) ? result.deliverables : [];
  const combinedEvidence = [summary, analysis, ...deliverables].join(" ").toLocaleLowerCase();
  const objectiveTerms = (input.objective ?? "").toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const meaningfulTerms = [...new Set(objectiveTerms)].filter(term => !["pour","avec","dans","cette","cela","être","avoir","leur","plus","moins","afin","faire"].includes(term));
  const matchedTerms = meaningfulTerms.filter(term => combinedEvidence.includes(term));
  const criteria = (input.acceptanceCriteria ?? []).map(x => x.trim()).filter(Boolean);
  const matchedCriteria = criteria.filter(criterion => {
    const terms = criterion.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
    const significant = terms.filter(term => !["pour","avec","dans","cette","cela","être","avoir","leur","plus","moins","afin","faire"].includes(term));
    return significant.length > 0 && significant.filter(term => combinedEvidence.includes(term)).length / significant.length >= 0.5;
  });
  const objectiveCoverage = meaningfulTerms.length === 0 ? null : matchedTerms.length / meaningfulTerms.length;
  const criteriaCoverage = criteria.length === 0 ? null : matchedCriteria.length / criteria.length;
  qualityChecks.push({criterion:"objective_alignment",passed:(objectiveCoverage === null || objectiveCoverage >= 0.25) && (criteriaCoverage === null || criteriaCoverage === 1),detail:`${matchedTerms.length}/${meaningfulTerms.length} termes de l’objectif et ${matchedCriteria.length}/${criteria.length} critères d’acceptation couverts.`});
  const hasEvidenceMarkers = /(https?:\/\/|\b(page|section|annexe|référence|source|tableau|fichier|livrable|mesure|indicateur|résultat|preuve)\b)/i.test(combinedEvidence);
  qualityChecks.push({criterion:"traceability",passed:hasEvidenceMarkers,detail:hasEvidenceMarkers ? "Au moins un marqueur de traçabilité ou de résultat est présent." : "Aucune référence, source, mesure ou pièce traçable détectée."});
  const hasAnalysisStructure = /\b(faits?|constats?|analyses?|risques?|causes?|impacts?|recommandations?|hypothèses?|limites?|prochaines? étapes?)\b/i.test(analysis);
  qualityChecks.push({criterion:"analytical_depth",passed:hasAnalysisStructure,detail:hasAnalysisStructure ? "L’analyse contient des marqueurs de raisonnement." : "L’analyse ne fait pas apparaître de structure de raisonnement identifiable."});
  if (typeof result.summary !== "string" || result.summary.trim().length < 20) {
    findings.push({ code: "SUMMARY_INSUFFICIENT", severity: "major", message: "The mission summary is missing or too short." });
  }
  if (typeof result.analysis !== "string" || result.analysis.trim().length < 40) {
    findings.push({ code: "ANALYSIS_INSUFFICIENT", severity: "major", message: "The analysis is missing or too short." });
  }
  if (!Array.isArray(result.deliverables) || result.deliverables.length === 0 ||
      result.deliverables.some(item => typeof item !== "string" || item.trim().length < 20)) {
    findings.push({ code: "DELIVERABLES_INSUFFICIENT", severity: "blocking", message: "At least one concrete deliverable is required." });
  }
  const tasks = Array.isArray(result.task_results) ? result.task_results : [];
  const byId = new Map(tasks.map(task => [task.taskId, task]));
  if (byId.size !== tasks.length) {
    findings.push({ code: "DUPLICATE_TASK_RESULT", severity: "blocking", message: "Task results contain duplicate identifiers." });
  }
  for (const taskId of input.expectedTaskIds) {
    const task = byId.get(taskId);
    if (!task) {
      findings.push({ code: "TASK_RESULT_MISSING", severity: "blocking", message: "No result was submitted for an expected task.", taskId });
      continue;
    }
    if (task.status === "done" && (task.progressPercent !== 100 || typeof task.deliverable !== "string" || task.deliverable.trim().length < 20)) {
      findings.push({ code: "TASK_COMPLETION_UNPROVEN", severity: "blocking", message: "A completed task needs 100% progress and a concrete deliverable.", taskId });
    }
    if (task.status === "blocked" && !task.blockedReason?.trim()) {
      findings.push({ code: "BLOCK_REASON_MISSING", severity: "major", message: "A blocked task must explain the blocker.", taskId });
    }
    if (task.status !== "done") {
      findings.push({ code: "TASK_NOT_COMPLETE", severity: "major", message: "The task is not complete; mission closure is not eligible.", taskId });
    }
  }
  for (const task of tasks) {
    if (!input.expectedTaskIds.includes(task.taskId)) {
      findings.push({ code: "UNEXPECTED_TASK_RESULT", severity: "major", message: "A task result does not belong to this mission.", taskId: task.taskId });
    }
  }
  for (const check of qualityChecks) {
    if (!check.passed) findings.push({ code: `QUALITY_${check.criterion.toUpperCase()}`, severity: "major", message: check.detail });
  }
  const qualityScore = Math.round((qualityChecks.filter(x => x.passed).length / Math.max(qualityChecks.length, 1)) * 100);
  const verdict: MissionReviewVerdict = findings.some(x => x.severity === "blocking")
    ? "rejected"
    : findings.length > 0 ? "revision_required" : "accepted";
  return {
    workspaceId: input.workspaceId,
    missionId: input.missionId,
    submittingAgentId: input.submittingAgentId,
    reviewerAgentId: input.reviewerAgentId,
    verdict,
    findings,
    reviewedAt: now.toISOString(),
    closureEligible: false,
    qualityScore,
    qualityChecks
  };
}
