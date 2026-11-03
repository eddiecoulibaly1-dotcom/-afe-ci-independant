import { classifyDecisionIntent, type DecisionIntent } from "./decision-intelligence.js";

export type DebateMode = "debate" | "decision" | "hybrid";
export type DecisionComplexity = "standard" | "complex" | "critical";

export interface DecisionRouteInput {
  question: string;
  context?: string;
  requestedMode?: DebateMode;
  highStakes?: boolean;
}

export interface DecisionRoute {
  mode: DebateMode;
  intents: DecisionIntent[];
  complexity: DecisionComplexity;
  requiresEvidence: boolean;
  requiresScenarios: boolean;
  requiresRiskAssessment: boolean;
  rationale: string[];
}

/** Routes a request without calling an LLM. Explicit user mode always wins. */
export function routeDecision(input: DecisionRouteInput): DecisionRoute {
  const question = input.question.trim();
  if (!question) throw new Error("DECISION_QUESTION_REQUIRED");

  const intents = classifyDecisionIntent(question);
  const text = `${question} ${input.context ?? ""}`.toLocaleLowerCase("fr");
  const asksForDecision = /faut-il|devrions-nous|dois-je|quel choix|quelle option|décider|recommand|investir|lancer|choisir/.test(text);
  const asksForDebate = /pour ou contre|débat|controvers|est-il vrai|faut-il interdire|doit-elle|doit-il/.test(text);
  const mode = input.requestedMode ?? (asksForDecision && asksForDebate ? "hybrid" : asksForDecision ? "decision" : "debate");
  const complexity: DecisionComplexity = input.highStakes ? "critical"
    : intents.length >= 3 || text.length > 1800 ? "complex" : "standard";
  const rationale = [
    `Qualification automatique : ${intents.join(", ")}.`,
    input.requestedMode ? "Le mode explicitement demandé par l'utilisateur est prioritaire." : "Le mode a été sélectionné à partir de la formulation et de l'intention détectée."
  ];

  return {
    mode, intents, complexity,
    requiresEvidence: mode !== "debate" || intents.includes("financial") || intents.includes("forecast"),
    requiresScenarios: mode !== "debate" || intents.includes("forecast"),
    requiresRiskAssessment: mode !== "debate" || input.highStakes === true,
    rationale
  };
}
