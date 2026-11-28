export type DependencyKind = "task" | "mission" | "department";
export type DependencyRelation = "hard_prerequisite" | "input_reference" | "parallel" | "human_gate";
export type EscalationLevel = "none" | "warning" | "director" | "dg" | "critical";

export type EscalationThresholds = {
  warning_after_minutes: number;
  director_after_minutes: number;
  dg_after_minutes: number;
  critical_after_minutes: number;
  pending_review_after_minutes: number;
};

export function dependencyNodeKey(kind: DependencyKind, id: string): string {
  if (!kind || !id?.trim()) throw new Error("Identifiant de nœud de dépendance invalide.");
  return kind + ":" + id.trim();
}

export function escalationLevel(
  elapsedMinutes: number,
  thresholds: EscalationThresholds,
  pendingDgReview = false
): EscalationLevel {
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) return "none";
  if (pendingDgReview) return elapsedMinutes >= thresholds.pending_review_after_minutes ? "dg" : "none";
  if (elapsedMinutes >= thresholds.critical_after_minutes) return "critical";
  if (elapsedMinutes >= thresholds.dg_after_minutes) return "dg";
  if (elapsedMinutes >= thresholds.director_after_minutes) return "director";
  if (elapsedMinutes >= thresholds.warning_after_minutes) return "warning";
  return "none";
}

export function validateProposedRelation(
  dependentKind: "task" | "mission",
  dependentId: string,
  prerequisiteKind: DependencyKind,
  prerequisiteId: string,
  relationType: DependencyRelation
): void {
  if (!dependentId?.trim() || !prerequisiteId?.trim()) throw new Error("Les deux extrémités de la dépendance sont obligatoires.");
  if (dependentKind === prerequisiteKind && dependentId === prerequisiteId) throw new Error("Un élément ne peut pas dépendre de lui-même.");
  if (prerequisiteKind === "department" && relationType !== "input_reference" && relationType !== "human_gate") {
    throw new Error("Une direction peut être une référence ou un point de validation, mais pas un prérequis technique dur.");
  }
  if (relationType === "hard_prerequisite" && prerequisiteKind === "department") {
    throw new Error("Un prérequis dur doit pointer vers une mission ou une tâche qui produit un livrable.");
  }
}

export function isEscalationIncrease(previous: EscalationLevel | null, next: EscalationLevel): boolean {
  const rank: Record<EscalationLevel, number> = { none: 0, warning: 1, director: 2, dg: 3, critical: 4 };
  return rank[next] > rank[previous ?? "none"];
}
