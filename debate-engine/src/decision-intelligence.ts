/**
 * Debate Engine V2.1 — Decision Intelligence & Quantitative Reasoning
 *
 * Pure decision-support primitives. Missing inputs remain explicit; no market
 * values or financial assumptions are fabricated by this module.
 */

export type DecisionIntent =
  | "financial" | "comparison" | "strategic" | "operational"
  | "forecast" | "general";

export type EvidenceKind = "verified" | "estimate" | "assumption" | "missing";

export interface DecisionCriterion {
  id: string;
  label: string;
  weight: number;
  scoreA: number;
  scoreB: number;
  evidence: EvidenceKind;
  note?: string;
}

export interface QuantitativeOptionInput {
  label: string;
  startingUnits: number;
  purchaseCostPerUnit: number;
  feedCostPerUnit: number;
  healthCostPerUnit: number;
  laborAndOverhead: number;
  infrastructureCost: number;
  otherCosts: number;
  mortalityRate: number;
  salePricePerUnit: number;
  extraRevenue?: number;
  cycleDays?: number;
  evidence?: Record<string, EvidenceKind>;
}

export interface QuantitativeResult {
  label: string;
  soldUnits: number;
  totalCost: number;
  revenue: number;
  netResult: number;
  netMargin: number | null;
  roi: number | null;
  costPerSoldUnit: number | null;
  breakEvenSalePrice: number | null;
  cycleDays: number | null;
  missingInputs: string[];
  evidenceSummary: Record<EvidenceKind, number>;
}

const FINANCIAL_TERMS = /rentabil|b[eé]n[eé]fice|r[eé]sultat net|marge|co[uû]t|invest(?:ir|is|it|issons|issez|issent|issement)|tr[eé]sorerie|chiffre d'affaires|prix de revient|seuil de rentabilit|\bcapital\b|\bfinanc(?:er|ement)\b|\b\d[\d\s.,]*\s*(?:fcfa|f\s*cfa|euros?|usd|dollars?)\b/i;
const COMPARISON_TERMS = /lequel|laquelle|compar|entre .+ et |meilleur|pr[eé]f[eé]rable|alternative|option/i;
const STRATEGIC_TERMS = /strat[eé]gie|positionnement|d[eé]cision|d[eé]velopper|lancer|priorit[eé]/i;
const OPERATIONAL_TERMS = /processus|organisation|op[eé]ration|production|logistique|ex[eé]cution/i;
const FORECAST_TERMS = /pr[eé]voir|pr[eé]vision|projection|[eé]volution|avenir|d'ici /i;

export function classifyDecisionIntent(question: string): DecisionIntent[] {
  const intents: DecisionIntent[] = [];
  if (FINANCIAL_TERMS.test(question)) intents.push("financial");
  if (COMPARISON_TERMS.test(question)) intents.push("comparison");
  if (STRATEGIC_TERMS.test(question)) intents.push("strategic");
  if (OPERATIONAL_TERMS.test(question)) intents.push("operational");
  if (FORECAST_TERMS.test(question)) intents.push("forecast");
  return intents.length ? intents : ["general"];
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function calculateOptionEconomics(input: QuantitativeOptionInput): QuantitativeResult {
  const missingInputs: string[] = [];
  const required: Array<[string, number]> = [
    ["nombre initial de sujets", input.startingUnits],
    ["coût d'achat unitaire", input.purchaseCostPerUnit],
    ["coût alimentaire unitaire", input.feedCostPerUnit],
    ["coût sanitaire unitaire", input.healthCostPerUnit],
    ["main-d'œuvre et frais généraux", input.laborAndOverhead],
    ["coût des infrastructures", input.infrastructureCost],
    ["autres coûts", input.otherCosts],
    ["taux de mortalité", input.mortalityRate],
    ["prix de vente unitaire", input.salePricePerUnit]
  ];
  for (const [name, value] of required) {
    if (!finiteNonNegative(value)) missingInputs.push(name);
  }
  if (input.mortalityRate > 1) missingInputs.push("taux de mortalité exprimé entre 0 et 1");

  const valid = missingInputs.length === 0;
  const soldUnits = valid ? input.startingUnits * (1 - input.mortalityRate) : 0;
  const totalCost = valid
    ? input.startingUnits * (input.purchaseCostPerUnit + input.feedCostPerUnit + input.healthCostPerUnit)
      + input.laborAndOverhead + input.infrastructureCost + input.otherCosts
    : 0;
  const revenue = valid ? soldUnits * input.salePricePerUnit + (input.extraRevenue ?? 0) : 0;
  const netResult = valid ? revenue - totalCost : 0;
  const invested = valid ? totalCost : 0;
  const evidenceSummary: Record<EvidenceKind, number> = { verified: 0, estimate: 0, assumption: 0, missing: 0 };
  const evidenceKeys = ["startingUnits", "purchaseCostPerUnit", "feedCostPerUnit", "healthCostPerUnit", "laborAndOverhead", "infrastructureCost", "otherCosts", "mortalityRate", "salePricePerUnit"];
  for (const key of evidenceKeys) {
    const kind = input.evidence?.[key] ?? "missing";
    evidenceSummary[kind]++;
  }

  return {
    label: input.label,
    soldUnits,
    totalCost,
    revenue,
    netResult,
    netMargin: valid && revenue > 0 ? netResult / revenue : null,
    roi: valid && invested > 0 ? netResult / invested : null,
    costPerSoldUnit: valid && soldUnits > 0 ? totalCost / soldUnits : null,
    breakEvenSalePrice: valid && soldUnits > 0 ? Math.max(0, totalCost - (input.extraRevenue ?? 0)) / soldUnits : null,
    cycleDays: input.cycleDays !== undefined && finiteNonNegative(input.cycleDays) ? input.cycleDays : null,
    missingInputs,
    evidenceSummary
  };
}

export function compareEconomics(a: QuantitativeResult, b: QuantitativeResult) {
  if (a.missingInputs.length || b.missingInputs.length) {
    return {
      winner: "indeterminate" as const,
      reason: "La comparaison financière est incomplète : au moins une option comporte des données manquantes ou invalides."
    };
  }
  if (a.netResult === b.netResult) {
    return { winner: "tie" as const, reason: "Les deux options présentent le même résultat net selon les données fournies." };
  }
  const winner = a.netResult > b.netResult ? a : b;
  const other = winner === a ? b : a;
  return {
    winner: winner === a ? "A" as const : "B" as const,
    reason: `${winner.label} présente un résultat net supérieur de ${Math.round((winner.netResult - other.netResult) * 100) / 100} selon les données fournies.`
  };
}

export function validateCriteria(criteria: DecisionCriterion[]): { valid: boolean; errors: string[]; totalWeight: number } {
  const errors: string[] = [];
  if (!criteria.length) errors.push("Au moins un critère est requis.");
  const ids = new Set<string>();
  for (const c of criteria) {
    if (!c.id.trim() || ids.has(c.id)) errors.push(`Identifiant de critère vide ou dupliqué : ${c.id}`);
    ids.add(c.id);
    if (!Number.isFinite(c.weight) || c.weight < 0) errors.push(`Poids invalide pour ${c.label}.`);
    if (![c.scoreA, c.scoreB].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) errors.push(`Notes invalides pour ${c.label} : elles doivent être comprises entre 0 et 100.`);
  }
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.001) errors.push(`La somme des poids doit être égale à 100 (actuellement ${totalWeight}).`);
  return { valid: errors.length === 0, errors, totalWeight };
}

export function calculateWeightedComparison(criteria: DecisionCriterion[]) {
  const validation = validateCriteria(criteria);
  if (!validation.valid) return { ...validation, scoreA: null, scoreB: null, gap: null, winner: "indeterminate" as const };
  const scoreA = criteria.reduce((sum, c) => sum + c.scoreA * c.weight / 100, 0);
  const scoreB = criteria.reduce((sum, c) => sum + c.scoreB * c.weight / 100, 0);
  return {
    ...validation,
    scoreA: Math.round(scoreA * 100) / 100,
    scoreB: Math.round(scoreB * 100) / 100,
    gap: Math.round(Math.abs(scoreA - scoreB) * 100) / 100,
    winner: scoreA === scoreB ? "tie" as const : scoreA > scoreB ? "A" as const : "B" as const
  };
}

export interface RoundPosition {
  round: number;
  architectPosition: string;
  redTeamAlternative?: string;
  decision: string;
  winner: "architect" | "red_team" | "neither";
}

export function auditRoundContinuity(history: RoundPosition[]) {
  const changes: Array<{ fromRound: number; toRound: number; previousWinner: string; nextWinner: string; explanationRequired: true }> = [];
  for (let i = 1; i < history.length; i++) {
    const previous = history[i - 1];
    const current = history[i];
    if (previous.winner !== current.winner) {
      changes.push({
        fromRound: previous.round,
        toRound: current.round,
        previousWinner: previous.winner,
        nextWinner: current.winner,
        explanationRequired: true
      });
    }
  }
  return {
    roundCount: history.length,
    winnerChanges: changes,
    requiresExplanation: changes.length > 0,
    instruction: changes.length
      ? "L'Arbitre doit expliquer chaque changement de gagnant, identifier les nouvelles informations qui le justifient et préciser si la décision précédente est abandonnée ou seulement révisée."
      : "Aucun changement de gagnant n'a été détecté entre les tours disponibles."
  };
}
