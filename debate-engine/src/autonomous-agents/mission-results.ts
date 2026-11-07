export type ChildMissionStatus = "completed" | "failed" | "cancelled" | "queued" | "running" | "waiting_approval" | string;

export interface ChildMissionRecord {
  missionId: string;
  title: string;
  status: ChildMissionStatus;
  result: unknown;
  failureCode: string | null;
  failureMessage: string | null;
}

export function buildChildMissionContext(children: ChildMissionRecord[]) {
  const nonTerminal = children.filter(child => !["completed", "failed", "cancelled"].includes(child.status));
  if (nonTerminal.length) {
    throw new Error("Coordinator mission is blocked until every child mission reaches a terminal state.");
  }
  const completed = children.filter(child => child.status === "completed").length;
  const failed = children.filter(child => child.status === "failed").length;
  const cancelled = children.filter(child => child.status === "cancelled").length;
  return {
    childMissionResults: children,
    childMissionOutcomeSummary: {
      total: children.length,
      completed,
      failed,
      cancelled,
      requiresAttention: failed + cancelled > 0,
      empty: children.length === 0
    }
  };
}

export function coordinatorSynthesisInstructions() {
  return [
    "Tu es l'agent coordinateur chargé de consolider les sous-missions.",
    "Examine chaque résultat enfant et son statut. Un résultat failed ou cancelled n'est jamais une réussite.",
    "Distingue explicitement les résultats confirmés, les échecs, les annulations, les informations manquantes et les hypothèses.",
    "Explique l'effet de chaque échec ou annulation sur l'objectif global; ne masque pas les lacunes et ne fabrique pas de résultat.",
    "Compare les conclusions des enfants, relève contradictions et dépendances, puis formule une synthèse intégrée et cohérente.",
    "Si des enfants ont échoué ou été annulés, indique ce qui peut être conclu, ce qui reste incertain et les actions correctives nécessaires.",
    "Si aucun enfant n'est présent, indique explicitement que la synthèse ne repose sur aucune sous-mission."
  ].join("\\n");
}
