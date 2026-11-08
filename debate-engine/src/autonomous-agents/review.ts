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
  const result = input.result ?? {};
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
    closureEligible: false
  };
}
