import type { DebateMode, DecisionRoute } from "./decision-router.js";

export type UnifiedAgentRole = "architect" | "red_team" | "evidence" | "scenario" | "risk" | "judge";
export interface AgentDefinition {
  role: UnifiedAgentRole;
  label: string;
  purpose: string;
  modes: DebateMode[];
  required: boolean;
}

export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  { role: "architect", label: "Architecte", purpose: "Construire les options, hypothèses et arguments.", modes: ["debate", "decision", "hybrid"], required: true },
  { role: "red_team", label: "Équipe contradictoire", purpose: "Réfuter les arguments et rechercher les angles morts.", modes: ["debate", "hybrid"], required: true },
  { role: "evidence", label: "Vérification des preuves", purpose: "Qualifier les affirmations et contrôler les références.", modes: ["debate", "decision", "hybrid"], required: false },
  { role: "scenario", label: "Analyse des scénarios", purpose: "Comparer les trajectoires plausibles et leurs conditions.", modes: ["decision", "hybrid"], required: false },
  { role: "risk", label: "Analyse des risques", purpose: "Évaluer les risques, leur criticité et les mesures de maîtrise.", modes: ["decision", "hybrid"], required: false },
  { role: "judge", label: "Arbitre", purpose: "Rendre une conclusion motivée à partir des éléments disponibles.", modes: ["debate", "decision", "hybrid"], required: true }
] as const;

/** Selects only agents relevant to the route; no provider call is made here. */
export function selectAgents(route: DecisionRoute): AgentDefinition[] {
  return AGENT_REGISTRY.filter(agent =>
    agent.required || (
      agent.modes.includes(route.mode) &&
      ((agent.role === "evidence" && route.requiresEvidence) ||
       (agent.role === "scenario" && route.requiresScenarios) ||
       (agent.role === "risk" && route.requiresRiskAssessment))
    )
  );
}
