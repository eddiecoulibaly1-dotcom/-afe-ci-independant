import { randomUUID } from "node:crypto";
import type { Debate, DebateConfig, DebateRound, Proposal, Critique, JudgeDecision, Scorecard } from "./types.js";
import { proposalSchema, critiqueSchema, judgeSchema } from "./schema.js";
import { callModel } from "./providers.js";
import { ARCHITECT_SYSTEM, RED_TEAM_SYSTEM, JUDGE_SYSTEM, architectPrompt, redTeamPrompt, judgePrompt } from "./prompts.js";
import { finalizeJudgeScore } from "./scoring.js";
import { auditClaims } from "./evidence.js";

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
  const evidenceBlocking = Boolean(scored.evidenceAudit?.blocking);
  const architectReady =
    scored.architectScore >= threshold &&
    scored.criticalDisagreements.length === 0 &&
    unresolvedQuestions <= 1 &&
    criticalAttacks === 0 &&
    !evidenceBlocking;

  if (architectReady) {
    return { ...scored, status: "converged", winner: "architect" };
  }

  return {
    ...scored,
    status: "revise",
    winner: scored.redTeamScore > scored.architectScore ? "red_team" : "neither"
  };
}

function terminalFromLastRound(debate: Debate, reason: string): Debate {
  const last = debate.rounds.at(-1);
  if (!last) throw new Error(reason);
  const finalDecision: JudgeDecision = {
    ...last.judge,
    status: last.judge.status === "converged" ? "converged" : "unresolved",
    rationale: [...last.judge.rationale, `Débat terminé proprement : ${reason}`]
  };
  debate.status = finalDecision.status === "converged" ? "converged" : "unresolved";
  debate.finalDecision = finalDecision;
  return debate;
}

export async function runDebate(question: string, context: string | undefined, config: DebateConfig): Promise<Debate> {
  const debate: Debate = { id: randomUUID(), question, context, status: "running", rounds: [], config };

  for (let roundNo = 1; roundNo <= config.maxRounds; roundNo++) {
    let architect: Proposal;
    try {
      architect = await callModel<Proposal>({
        ...config.architect,
        system: ARCHITECT_SYSTEM,
        prompt: architectPrompt(question, context, debate.rounds, debate.rounds.at(-1)?.judge.nextRoundObjective),
        schemaName: "architect_proposal",
        schema: proposalSchema
      });
    } catch (error) {
      return terminalFromLastRound(debate, `l’Architecte n’a pas répondu à temps (${error instanceof Error ? error.message : String(error)})`);
    }

    const evidenceAudit = auditClaims(architect.claims);
    const partial: DebateRound = {
      round: roundNo,
      architect,
      evidenceAudit,
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
        rationale: [],
        evidenceAudit
      },
      createdAt: new Date().toISOString()
    };

    try {
      partial.redTeam = await callModel<Critique>({
        ...config.redTeam,
        system: RED_TEAM_SYSTEM,
        prompt: redTeamPrompt(question, context, partial),
        schemaName: "red_team_critique",
        schema: critiqueSchema
      });
    } catch (error) {
      if (debate.rounds.length) return terminalFromLastRound(debate, `la Red Team n’a pas répondu à temps (${error instanceof Error ? error.message : String(error)})`);
      throw error;
    }

    try {
      const rawJudge = await callModel<JudgeDecision>({
        ...config.judge,
        system: JUDGE_SYSTEM,
        prompt: judgePrompt(question, context, partial, config.convergenceScore),
        schemaName: "judge_decision",
        schema: judgeSchema
      });

      partial.judge = applyConvergencePolicy(
        { ...rawJudge, evidenceAudit },
        config.convergenceScore,
        partial.redTeam.unresolvedQuestions.length,
        partial.redTeam.attacks.filter((attack) => attack.severity === "critical").length
      );
    } catch (error) {
      if (debate.rounds.length) return terminalFromLastRound(debate, `l’Arbitre n’a pas répondu à temps (${error instanceof Error ? error.message : String(error)})`);
      throw error;
    }

    debate.rounds.push(partial);

    if (partial.judge.status === "converged") {
      debate.status = "converged";
      debate.finalDecision = partial.judge;
      return debate;
    }
  }

  // maxRounds is a hard completion boundary: never leave the request hanging.
  debate.status = "unresolved";
  debate.finalDecision = debate.rounds.at(-1)?.judge;
  return debate;
}
