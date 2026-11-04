import { randomUUID } from "node:crypto";

export type ProjectPhase =
  | "intake" | "discovery" | "specification" | "architecture"
  | "implementation" | "verification" | "staging" | "delivery"
  | "blocked" | "cancelled";

export type ActionRisk =
  | "read_only" | "local_change" | "development_branch"
  | "test_deployment" | "production_deployment"
  | "production_migration" | "external_spend"
  | "secret_access" | "irreversible";

export type AuthorizationDecision =
  | { outcome: "allowed"; reason: string }
  | { outcome: "approval_required"; reason: string; approvalKey: string }
  | { outcome: "blocked"; reason: string };

export type EvidenceState = "prepared" | "executed" | "verified" | "delivered";

export interface Requirement {
  id: string;
  statement: string;
  priority: "must" | "should" | "could";
  acceptanceCriteria: string[];
  source: "user" | "system" | "inferred";
}

export interface ProjectBrief {
  name: string;
  objective: string;
  targetUsers: string[];
  constraints: string[];
  requirements: Requirement[];
  nonGoals: string[];
}

export interface ArchitectureDecision {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  alternatives: string[];
  consequences: string[];
}

export interface WorkEvidence {
  id: string;
  artifact: string;
  state: EvidenceState;
  description: string;
  timestamp: string;
  proof?: string;
}

export interface ApprovalRecord {
  key: string;
  risk: ActionRisk;
  approved: boolean;
  approvedAt?: string;
  scope: string;
}

export interface DevelopmentProject {
  id: string;
  brief: ProjectBrief;
  phase: ProjectPhase;
  architecture: ArchitectureDecision[];
  evidence: WorkEvidence[];
  approvals: ApprovalRecord[];
  createdAt: string;
  updatedAt: string;
}

const HIGH_RISK = new Set<ActionRisk>([
  "production_deployment", "production_migration", "external_spend",
  "secret_access", "irreversible"
]);

const PHASE_ORDER: ProjectPhase[] = [
  "intake", "discovery", "specification", "architecture",
  "implementation", "verification", "staging", "delivery"
];

export function createProject(brief: ProjectBrief, now = new Date()): DevelopmentProject {
  validateBrief(brief);
  const timestamp = now.toISOString();
  return {
    id: randomUUID(),
    brief: structuredClone(brief),
    phase: "intake",
    architecture: [],
    evidence: [],
    approvals: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function validateBrief(brief: ProjectBrief): void {
  if (!brief.name.trim()) throw new Error("Le nom du projet est obligatoire.");
  if (!brief.objective.trim()) throw new Error("L'objectif du projet est obligatoire.");
  if (brief.requirements.length === 0) throw new Error("Au moins une exigence doit être définie.");
  const ids = new Set<string>();
  for (const requirement of brief.requirements) {
    if (!requirement.id.trim() || ids.has(requirement.id)) {
      throw new Error("Chaque exigence doit avoir un identifiant unique.");
    }
    ids.add(requirement.id);
    if (!requirement.statement.trim()) throw new Error(`L'exigence ${requirement.id} est vide.`);
    if (requirement.priority === "must" && requirement.acceptanceCriteria.length === 0) {
      throw new Error(`L'exigence obligatoire ${requirement.id} doit avoir un critère d'acceptation.`);
    }
  }
}

export function authorizeAction(
  risk: ActionRisk,
  approvals: ApprovalRecord[],
  scope: string
): AuthorizationDecision {
  if (risk === "read_only" || risk === "local_change" || risk === "development_branch" || risk === "test_deployment") {
    return { outcome: "allowed", reason: "Action limitée à un périmètre non productif et réversible." };
  }
  if (!HIGH_RISK.has(risk)) {
    return { outcome: "blocked", reason: "Catégorie de risque inconnue ou non autorisée." };
  }
  const key = `${risk}:${scope.trim()}`;
  const approval = approvals.find((item) => item.key === key && item.risk === risk && item.scope === scope && item.approved);
  if (approval) return { outcome: "allowed", reason: "Approbation explicite retrouvée pour ce périmètre exact." };
  return {
    outcome: "approval_required",
    reason: "Une approbation explicite est requise avant cette opération sensible.",
    approvalKey: key
  };
}

export function recordApproval(
  project: DevelopmentProject,
  risk: ActionRisk,
  scope: string,
  approved: boolean,
  now = new Date()
): DevelopmentProject {
  if (!HIGH_RISK.has(risk)) throw new Error("Une approbation ne peut être enregistrée que pour une action sensible.");
  if (!scope.trim()) throw new Error("Le périmètre de l'approbation est obligatoire.");
  const key = `${risk}:${scope}`;
  const approvals = project.approvals.filter((item) => item.key !== key);
  approvals.push({ key, risk, scope, approved, ...(approved ? { approvedAt: now.toISOString() } : {}) });
  return { ...project, approvals, updatedAt: now.toISOString() };
}

export function advancePhase(
  project: DevelopmentProject,
  next: ProjectPhase,
  now = new Date()
): DevelopmentProject {
  if (next === "blocked" || next === "cancelled") {
    return { ...project, phase: next, updatedAt: now.toISOString() };
  }
  const currentIndex = PHASE_ORDER.indexOf(project.phase);
  const nextIndex = PHASE_ORDER.indexOf(next);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
    throw new Error(`Transition de phase invalide : ${project.phase} -> ${next}.`);
  }
  if (next === "verification" && !hasEvidenceState(project, "executed")) {
    throw new Error("La vérification exige au moins une preuve d'exécution.");
  }
  if (next === "delivery" && !deliveryReadiness(project).ready) {
    throw new Error("La livraison est bloquée : les preuves obligatoires sont incomplètes.");
  }
  return { ...project, phase: next, updatedAt: now.toISOString() };
}

export function recordEvidence(
  project: DevelopmentProject,
  input: Omit<WorkEvidence, "id" | "timestamp">,
  now = new Date()
): DevelopmentProject {
  if (!input.artifact.trim() || !input.description.trim()) {
    throw new Error("L'artefact et sa description sont obligatoires.");
  }
  if (input.state === "verified" && !input.proof?.trim()) {
    throw new Error("Une preuve vérifiable est obligatoire pour marquer un artefact comme vérifié.");
  }
  if (input.state === "delivered" && !project.evidence.some((item) =>
    item.artifact === input.artifact && item.state === "verified"
  )) {
    throw new Error("Un artefact ne peut être livré avant sa vérification.");
  }
  const evidence: WorkEvidence = {
    ...input,
    id: randomUUID(),
    timestamp: now.toISOString()
  };
  return { ...project, evidence: [...project.evidence, evidence], updatedAt: now.toISOString() };
}

export function deliveryReadiness(project: DevelopmentProject): {
  ready: boolean;
  missing: string[];
  verifiedArtifacts: string[];
} {
  const missing: string[] = [];
  const verifiedArtifacts = [...new Set(project.evidence
    .filter((item) => item.state === "verified")
    .map((item) => item.artifact))];

  if (!project.brief.requirements.every((requirement) => requirement.priority !== "must" || requirement.acceptanceCriteria.length > 0)) {
    missing.push("Critères d'acceptation des exigences obligatoires");
  }
  if (verifiedArtifacts.length === 0) missing.push("Au moins un artefact vérifié");
  if (!project.evidence.some((item) => item.state === "verified" && /test|verification|validation/i.test(item.artifact))) {
    missing.push("Preuve de tests ou de validation vérifiée");
  }
  if (!project.evidence.some((item) => item.state === "verified" && /documentation|readme|guide/i.test(item.artifact))) {
    missing.push("Documentation vérifiée");
  }
  return { ready: missing.length === 0, missing, verifiedArtifacts };
}

function hasEvidenceState(project: DevelopmentProject, state: EvidenceState): boolean {
  return project.evidence.some((item) => item.state === state);
}
