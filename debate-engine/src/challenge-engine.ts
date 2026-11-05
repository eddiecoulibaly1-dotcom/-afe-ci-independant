export const CHALLENGE_PRIORITY_VERSION = "1.0.0";

export interface ChallengeFactors {
  impact: number;
  evidenceGap: number;
  uncertainty: number;
  dependency: number;
  reversalCost: number;
}

export interface ChallengePriority {
  version: string;
  score: number;
  factors: ChallengeFactors;
  formula: string;
}

export function calculateChallengePriority(factors: ChallengeFactors): ChallengePriority {
  const values = Object.values(factors);
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error("CHALLENGE_FACTOR_OUT_OF_RANGE");
  }
  const score =
    0.30 * factors.impact +
    0.25 * factors.evidenceGap +
    0.20 * factors.uncertainty +
    0.15 * factors.dependency +
    0.10 * factors.reversalCost;
  return {
    version: CHALLENGE_PRIORITY_VERSION,
    score: Math.round(score * 100) / 100,
    factors,
    formula: "0.30 × impact + 0.25 × evidenceGap + 0.20 × uncertainty + 0.15 × dependency + 0.10 × reversalCost"
  };
}

export function challengeBand(score: number): "low" | "moderate" | "high" | "critical" {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("CHALLENGE_SCORE_OUT_OF_RANGE");
  return score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "moderate" : "low";
}
