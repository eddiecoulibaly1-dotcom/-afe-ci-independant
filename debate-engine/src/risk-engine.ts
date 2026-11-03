export type RiskLevel = "low" | "moderate" | "high" | "critical";
export interface RiskInput {
  id: string;
  description: string;
  likelihood: number;
  impact: number;
  mitigation?: string;
  owner?: string;
}
export interface AssessedRisk extends RiskInput { score: number; level: RiskLevel; }
export function assessRisks(risks: RiskInput[]): AssessedRisk[] {
  const ids = new Set<string>();
  return risks.map(risk => {
    if (!risk.id.trim() || ids.has(risk.id)) throw new Error(`RISK_ID_INVALID_OR_DUPLICATED:${risk.id}`);
    ids.add(risk.id);
    if (![risk.likelihood, risk.impact].every(v => Number.isInteger(v) && v >= 1 && v <= 5)) throw new Error(`RISK_SCALE_INVALID:${risk.id}`);
    const score = risk.likelihood * risk.impact;
    const level: RiskLevel = score >= 20 ? "critical" : score >= 12 ? "high" : score >= 6 ? "moderate" : "low";
    return { ...risk, score, level };
  }).sort((a,b) => b.score - a.score);
}
