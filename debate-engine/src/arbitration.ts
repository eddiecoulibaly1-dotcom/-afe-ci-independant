export type ArbitrationVerdict = "favorable" | "favorable_with_conditions" | "unfavorable" | "indeterminate";
export interface ArbitrationInput {
  preferredOption?: string;
  alternatives: string[];
  evidenceReliabilityScore: number | null;
  decisionRobustnessScore: number | null;
  unresolvedCriticalIssues: string[];
  mandatoryConditions?: string[];
}
export interface ArbitrationResult {
  verdict: ArbitrationVerdict;
  preferredOption: string | null;
  rationale: string[];
  conditions: string[];
  confidence: "low" | "moderate" | "high";
}
/** Applies explicit guardrails; an LLM cannot override missing evidence or critical blockers. */
export function arbitrateDecision(input: ArbitrationInput): ArbitrationResult {
  const evidence = input.evidenceReliabilityScore;
  const robustness = input.decisionRobustnessScore;
  if ((evidence !== null && (!Number.isFinite(evidence) || evidence < 0 || evidence > 100)) ||
      (robustness !== null && (!Number.isFinite(robustness) || robustness < 0 || robustness > 100))) {
    throw new Error("ARBITRATION_SCORE_OUT_OF_RANGE");
  }
  const conditions = [...(input.mandatoryConditions ?? [])];
  if (!input.preferredOption || evidence === null || robustness === null || evidence < 40 || robustness < 40) {
    return { verdict: "indeterminate", preferredOption: null, rationale: ["Les informations ou scores disponibles ne permettent pas de soutenir une recommandation suffisamment fiable."], conditions, confidence: "low" };
  }
  if (input.unresolvedCriticalIssues.length) {
    return { verdict: "favorable_with_conditions", preferredOption: input.preferredOption, rationale: ["Des points critiques restent non résolus ; la recommandation ne peut être considérée comme définitive."], conditions: [...conditions, ...input.unresolvedCriticalIssues], confidence: "low" };
  }
  if (robustness < 60 || evidence < 60) {
    return { verdict: "favorable_with_conditions", preferredOption: input.preferredOption, rationale: ["La solution présente un avantage, mais sa robustesse ou la fiabilité des preuves reste limitée."], conditions, confidence: "moderate" };
  }
  if (robustness < 70 || evidence < 70 || conditions.length) {
    return { verdict: "favorable_with_conditions", preferredOption: input.preferredOption, rationale: ["La recommandation est soutenue, sous réserve du respect des conditions explicites."], conditions, confidence: "moderate" };
  }
  return { verdict: "favorable", preferredOption: input.preferredOption, rationale: ["Les seuils minimaux de fiabilité documentaire et de robustesse décisionnelle sont atteints."], conditions: [], confidence: "high" };
}
