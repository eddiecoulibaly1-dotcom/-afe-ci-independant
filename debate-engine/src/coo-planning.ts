export type CooWorkstream = {
  departmentSlug: string;
  missionTitle: string;
  objective: string;
  priority: number;
  dueInHours: number;
  tasks: Array<{ title: string; description: string; priority: number; dueInHours: number }>;
};

export function consolidateDepartmentWorkstreams<T extends CooWorkstream>(
  streams: T[]
): { workstreams: T[]; mergedDepartmentSlugs: string[] } {
  const grouped = new Map<string, T>();
  const merged = new Set<string>();

  for (const stream of streams) {
    const existing = grouped.get(stream.departmentSlug);
    if (!existing) {
      grouped.set(stream.departmentSlug, {
        ...stream,
        tasks: [...stream.tasks]
      });
      continue;
    }

    merged.add(stream.departmentSlug);
    const priorTitle = existing.missionTitle;
    existing.missionTitle = (priorTitle.slice(0, 190) + " (plan consolidé)").slice(0, 220);
    existing.objective = [
      existing.objective,
      "Volet complémentaire — " + stream.missionTitle + " : " + stream.objective
    ].filter(Boolean).join("\n\n");
    existing.tasks.push(...stream.tasks);
    // Keep the earliest deadline so consolidation never relaxes a commitment.
    existing.dueInHours = Math.min(existing.dueInHours, stream.dueInHours);
    // Preserve the first workstream's priority rather than guessing the priority scale.
  }

  return {
    workstreams: [...grouped.values()],
    mergedDepartmentSlugs: [...merged]
  };
}

export type CooRunReconciliationIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
};

export type CooRunReconciliation = {
  status: "consistent" | "incomplete" | "inconsistent";
  counts: {
    plannedWorkstreams: number;
    dispatchEntries: number;
    linkedMissions: number;
    recordedMissionsCreated: number;
    expectedTasks: number;
    actualTasks: number;
  };
  issues: CooRunReconciliationIssue[];
};

/** Read-only reconciliation of a persisted COO run against mission/task rows. */
export function reconcileCooRun(
  run: any,
  missions: any[],
  tasks: any[],
  departmentSlugs: Record<string, string> = {}
): CooRunReconciliation {
  const plan = run?.plan ?? {};
  const workstreams = Array.isArray(plan.workstreams) ? plan.workstreams : [];
  const dispatchEntries = Array.isArray(plan.dispatched) ? plan.dispatched : [];
  const runId = String(run?.id ?? "");
  const dispatchedIds = new Set(dispatchEntries.map((entry: any) => String(entry?.missionId ?? "")).filter(Boolean));
  const linkedMissions = missions.filter((mission: any) =>
    String(mission?.input_context?.cooRunId ?? "") === runId || dispatchedIds.has(String(mission?.id ?? ""))
  );
  const linkedIds = new Set(linkedMissions.map((mission: any) => String(mission.id)));
  const runTasks = tasks.filter((task: any) => linkedIds.has(String(task?.mission_id ?? "")));
  const issues: CooRunReconciliationIssue[] = [];
  const add = (code: string, severity: "warning" | "error", message: string) => issues.push({ code, severity, message });
  const bySlug = new Map<string, any[]>();
  for (const entry of dispatchEntries) {
    const slug = String(entry?.departmentSlug ?? "");
    const list = bySlug.get(slug) ?? [];
    list.push(entry);
    bySlug.set(slug, list);
  }
  const workstreamBySlug = new Map<string, any[]>();
  for (const stream of workstreams) {
    const slug = String(stream?.departmentSlug ?? "");
    const list = workstreamBySlug.get(slug) ?? [];
    list.push(stream);
    workstreamBySlug.set(slug, list);
  }
  const strict = run?.status === "dispatched";
  const missingSeverity: "warning" | "error" = strict ? "error" : "warning";

  for (const [slug, streams] of workstreamBySlug) {
    if (streams.length > 1) add("duplicate_workstream", "error", "Le plan contient plusieurs chantiers pour la direction " + slug + ".");
  }
  for (const [slug, entries] of bySlug) {
    if (entries.length > 1) add("duplicate_dispatch", "error", "Plusieurs entrées de dispatch existent pour la direction " + slug + ".");
  }
  const intentionallyNotDispatched = ["approval_required", "cancelled"].includes(String(run?.status ?? ""));
  if (!intentionallyNotDispatched) {
    for (const [slug] of workstreamBySlug) {
      if (!bySlug.has(slug)) add("missing_dispatch", missingSeverity, "Le chantier " + slug + " n'a pas d'entrée de dispatch persistée.");
    }
  }
  for (const entry of dispatchEntries) {
    const slug = String(entry?.departmentSlug ?? "");
    const missionId = String(entry?.missionId ?? "");
    const mission = missions.find((item: any) => String(item?.id ?? "") === missionId);
    if (!mission) {
      add("missing_mission", missingSeverity, "Mission référencée mais introuvable : " + missionId + ".");
      continue;
    }
    const actualRunId = String(mission?.input_context?.cooRunId ?? "");
    if (actualRunId !== runId) add("mission_run_mismatch", "error", "La mission " + missionId + " n'est pas reliée au run attendu (cooRunId=" + (actualRunId || "absent") + ").");
    const actualSlug = departmentSlugs[String(mission?.department_id ?? "")] ?? "";
    if (actualSlug && slug && actualSlug !== slug) add("mission_department_mismatch", "error", "La mission " + missionId + " est rattachée à " + actualSlug + " au lieu de " + slug + ".");
    const stream = workstreamBySlug.get(slug)?.[0];
    const expectedTaskCount = Array.isArray(stream?.tasks) ? stream.tasks.length : Number(entry?.taskCount ?? 0);
    if (stream && Number(entry?.taskCount) !== expectedTaskCount) add("dispatch_task_count_mismatch", "error", "Le dispatch " + slug + " annonce " + Number(entry?.taskCount ?? 0) + " tâche(s), le plan en prévoit " + expectedTaskCount + ".");
    const missionTasks = tasks.filter((task: any) => String(task?.mission_id ?? "") === missionId);
    if (missionTasks.length !== expectedTaskCount) add("task_count_mismatch", missingSeverity, "La mission " + missionId + " possède " + missionTasks.length + " tâche(s), contre " + expectedTaskCount + " attendue(s).");
    const expectedKeys = stream ? stream.tasks.map((_task: any, index: number) => runId + ":" + slug + ":task:" + index) : [];
    const actualKeys = missionTasks.map((task: any) => String(task?.coo_task_key ?? ""));
    if (stream && expectedKeys.length && expectedKeys.some((key: string) => !actualKeys.includes(key))) add("missing_task_key", missingSeverity, "Des clés de tâches attendues sont absentes pour la mission " + missionId + ".");
    if (stream && actualKeys.some((key: string) => key && !expectedKeys.includes(key))) add("unexpected_task_key", "error", "La mission " + missionId + " contient une clé de tâche étrangère au plan.");
    if (actualKeys.some((key: string) => !key)) add("task_key_missing", "error", "Au moins une tâche de la mission " + missionId + " n'a pas de clé COO.");
    if (new Set(actualKeys.filter(Boolean)).size !== actualKeys.filter(Boolean).length) add("duplicate_task_key", "error", "La mission " + missionId + " contient des clés COO dupliquées.");
    const contextTasks = Array.isArray(mission?.input_context?.cooTasks) ? mission.input_context.cooTasks : [];
    const contextTaskIds = contextTasks.map((task: any) => String(task?.id ?? "")).filter(Boolean);
    const actualTaskIds = missionTasks.map((task: any) => String(task?.id ?? "")).filter(Boolean);
    if (contextTasks.length !== expectedTaskCount || contextTaskIds.length !== actualTaskIds.length || contextTaskIds.some((id: string) => !actualTaskIds.includes(id))) {
      add("mission_task_context_mismatch", missingSeverity, "Le contexte cooTasks de la mission " + missionId + " ne correspond pas aux tâches réellement enregistrées.");
    }
  }
  for (const mission of linkedMissions) {
    if (!dispatchedIds.has(String(mission?.id ?? ""))) add("orphan_mission", "error", "Mission liée au run mais absente du registre de dispatch : " + String(mission?.id ?? "") + ".");
  }
  const recordedCount = Number(run?.missions_created ?? 0);
  if (recordedCount !== linkedMissions.length) add("mission_count_mismatch", missingSeverity, "Le run indique " + recordedCount + " mission(s) créée(s), alors que " + linkedMissions.length + " mission(s) sont reliées au run.");
  const expectedTasks = workstreams.reduce((sum: number, stream: any) => sum + (Array.isArray(stream?.tasks) ? stream.tasks.length : 0), 0);
  const counts = {
    plannedWorkstreams: workstreams.length,
    dispatchEntries: dispatchEntries.length,
    linkedMissions: linkedMissions.length,
    recordedMissionsCreated: recordedCount,
    expectedTasks,
    actualTasks: runTasks.length
  };
  return {
    status: issues.some(issue => issue.severity === "error") ? "inconsistent" : issues.length ? "incomplete" : "consistent",
    counts,
    issues
  };
}

export type CooDecisionRegisterEntry = {
  id: string;
  label: string;
  detail: string;
  required: boolean;
  status: "pending" | "approved" | "rejected";
  decision: "approve" | "reject" | null;
  note: string;
  decidedBy: string | null;
  decidedAt: string | null;
};

export function createCooDecisionRegister(
  runId: string,
  decisionsRequired: string[] = [],
  sensitiveItems: string[] = []
): CooDecisionRegisterEntry[] {
  const routine = decisionsRequired.filter(text => !/approbation humaine obligatoire/i.test(String(text ?? "")));
  const register: CooDecisionRegisterEntry[] = routine.map((label, index) => ({
    id: runId + ":dg:" + index,
    label: String(label).trim().slice(0, 1200),
    detail: "",
    required: false,
    status: "pending",
    decision: null,
    note: "",
    decidedBy: null,
    decidedAt: null
  })).filter(entry => entry.label.length > 0);
  const sensitive = sensitiveItems.map(item => String(item).trim()).filter(Boolean);
  if (sensitive.length) register.push({
    id: runId + ":dg:sensitive",
    label: "Approbation DG obligatoire — délégation d’actions sensibles",
    detail: sensitive.map((item, index) => (index + 1) + ". " + item).join("\n").slice(0, 12000),
    required: true,
    status: "pending",
    decision: null,
    note: "",
    decidedBy: null,
    decidedAt: null
  });
  return register;
}

export function applyCooDecisionRegister(
  entries: CooDecisionRegisterEntry[],
  decisionId: string,
  decision: "approve" | "reject",
  note: string,
  decidedBy: string,
  decidedAt: string
): { entries: CooDecisionRegisterEntry[]; changed: boolean; target: CooDecisionRegisterEntry | null } {
  const target = entries.find(entry => entry.id === decisionId) ?? null;
  if (!target) return { entries, changed: false, target: null };
  if (target.status !== "pending") {
    if (target.decision === decision) return { entries, changed: false, target };
    throw new Error("Une décision DG déjà enregistrée ne peut pas être inversée.");
  }
  const updated = entries.map(entry => entry.id === decisionId ? {
    ...entry,
    status: decision === "approve" ? "approved" as const : "rejected" as const,
    decision,
    note: note.trim().slice(0, 2000),
    decidedBy,
    decidedAt
  } : entry);
  return { entries: updated, changed: true, target: updated.find(entry => entry.id === decisionId) ?? null };
}

export function hasPendingRequiredCooDecisions(entries: CooDecisionRegisterEntry[]): boolean {
  return entries.some(entry => entry.required && entry.status !== "approved");
}

export function hasRejectedRequiredCooDecisions(entries: CooDecisionRegisterEntry[]): boolean {
  return entries.some(entry => entry.required && entry.status === "rejected");
}
