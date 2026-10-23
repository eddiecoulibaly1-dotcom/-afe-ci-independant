import { randomUUID } from "node:crypto";
import type { Debate, DebateConfig, DebateRound, Proposal, Critique, JudgeDecision, Scorecard } from "./types.js";
import { proposalSchema, critiqueSchema, judgeSchema } from "./schema.js";
import { callModel } from "./providers.js";
import { ARCHITECT_SYSTEM, RED_TEAM_SYSTEM, JUDGE_SYSTEM, architectPrompt, redTeamPrompt, judgePrompt } from "./prompts.js";
import { finalizeJudgeScore } from "./scoring.js";

const emptyScorecard = (): Scorecard => ({
  buyerValue: 0,
  sellerValue: 0,
  coteDIvoireFit: 0,
  marketplaceLiquidity: 0,
  differentiation: 0,
  trustFraud: 0,
  technicalFeasibility: 0,
  acquisition: 0,
  monetization: 0
});

function applyConvergencePolicy(
  judge: JudgeDecision,
  threshold: number,
  unresolvedQuestions: number,
  criticalAttacks: number
): JudgeDecision {
  const scored = finalizeJudgeScore(judge, unresolvedQuestions, criticalAttacks);
  const architectReady =
    scored.architectScore >= threshold &&
    scored.criticalDisagreements.length === 0 &&
    unresolvedQuestions <= 1 &&
    criticalAttacks === 0;

  if (architectReady) {
    return { ...scored, status: "converged", winner: "architect" };
  }

  return {
    ...scored,
    status: "revise",
    winner: scored.redTeamScore > scored.architectScore ? "red_team" : "neither"
  };
}

export async function runDebate(question: string, context: string | undefined, config: DebateConfig): Promise<Debate> {
  const debate: Debate = { id: randomUUID(), question, context, status: "running", rounds: [], config };

  for (let roundNo = 1; roundNo <= config.maxRounds; roundNo++) {
    const architect = await callModel<Proposal>({
      ...config.architect,
      system: ARCHITECT_SYSTEM,
      prompt: architectPrompt(question, context, debate.rounds, debate.rounds.at(-1)?.judge.nextRoundObjective),
      schemaName: "architect_proposal",
      schema: proposalSchema
    });

    const partial: DebateRound = {
      round: roundNo,
      architect,
      redTeam: { verdict: "challenge", attacks: [], unresolvedQuestions: [] },
      judge: {
        status: "revise",
        winner: "neither",
        architectScore: 0,
        redTeamScore: 0,
        architectScorecard: emptyScorecard(),
        redTeamScorecard: emptyScorecard(),
        acceptedClaims: [],
        rejectedClaims: [],
        criticalDisagreements: [],
        decision: "",
        rationale: []
      },
      createdAt: new Date().toISOString()
    };

    partial.redTeam = await callModel<Critique>({
      ...config.redTeam,
      system: RED_TEAM_SYSTEM,
      prompt: redTeamPrompt(question, context, partial),
      schemaName: "red_team_critique",
      schema: critiqueSchema
    });

    const rawJudge = await callModel<JudgeDecision>({
      ...config.judge,
      system: JUDGE_SYSTEM,
      prompt: judgePrompt(question, context, partial, config.convergenceScore),
      schemaName: "judge_decision",
      schema: judgeSchema
    });

    partial.judge = applyConvergencePolicy(
      rawJudge,
      config.convergenceScore,
      partial.redTeam.unresolvedQuestions.length,
      partial.redTeam.attacks.filter((attack) => attack.severity === "critical").length
    );

    debate.rounds.push(partial);

    if (partial.judge.status === "converged") {
      debate.status = "converged";
      debate.finalDecision = partial.judge;
      return debate;
    }
  }

  debate.status = "unresolved";
  debate.finalDecision = debate.rounds.at(-1)?.judge;
  return debate;
}
