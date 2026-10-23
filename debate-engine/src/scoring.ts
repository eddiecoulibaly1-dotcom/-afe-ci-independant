import type { JudgeDecision, ScoreDimension, Scorecard } from "./types.js";

export const SCORE_WEIGHTS: Record<ScoreDimension, number> = {
  buyerValue: 15,
  sellerValue: 15,
  coteDIvoireFit: 15,
  marketplaceLiquidity: 15,
  differentiation: 10,
  trustFraud: 10,
  technicalFeasibility: 10,
  acquisition: 5,
  monetization: 5
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function calculateScore(scorecard: Scorecard): number {
  const weighted = (Object.keys(SCORE_WEIGHTS) as ScoreDimension[]).reduce(
    (sum, dimension) => sum + (clamp(scorecard[dimension]) * SCORE_WEIGHTS[dimension]) / 100,
    0
  );
  return Math.round(weighted * 100) / 100;
}

export function applyDecisionPenalties(
  baseScore: number,
  criticalDisagreements: number,
  unresolvedQuestions: number,
  criticalAttacks: number
): number {
  const penalty = Math.min(25, criticalDisagreements * 5 + Math.min(unresolvedQuestions, 5) * 1.5 + Math.min(criticalAttacks, 3) * 2);
  return Math.round(clamp(baseScore - penalty) * 100) / 100;
}

export function finalizeJudgeScore(
  judge: JudgeDecision,
  unresolvedQuestions: number,
  criticalAttacks: number
): JudgeDecision {
  const architectScore = applyDecisionPenalties(
    calculateScore(judge.architectScorecard),
    judge.criticalDisagreements.length,
    unresolvedQuestions,
    criticalAttacks
  );
  const redTeamScore = applyDecisionPenalties(
    calculateScore(judge.redTeamScorecard),
    judge.criticalDisagreements.length,
    unresolvedQuestions,
    criticalAttacks
  );

  return { ...judge, architectScore, redTeamScore };
}

export function scoreDelta(judge: JudgeDecision): number {
  return Math.round(Math.abs(judge.architectScore - judge.redTeamScore) * 100) / 100;
}
