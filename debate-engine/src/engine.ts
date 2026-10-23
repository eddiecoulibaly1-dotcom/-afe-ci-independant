import { randomUUID } from "node:crypto";
import type { Debate, DebateConfig, DebateRound, Proposal, Critique, JudgeDecision } from "./types.js";
import { proposalSchema, critiqueSchema, judgeSchema } from "./schema.js";
import { callModel } from "./providers.js";
import { ARCHITECT_SYSTEM, RED_TEAM_SYSTEM, JUDGE_SYSTEM, architectPrompt, redTeamPrompt, judgePrompt } from "./prompts.js";

export async function runDebate(question: string, context: string | undefined, config: DebateConfig): Promise<Debate> {
  const debate: Debate = { id: randomUUID(), question, context, status: "running", rounds: [] };

  for (let roundNo = 1; roundNo <= config.maxRounds; roundNo++) {
    const architect = await callModel<Proposal>({
      ...config.architect, system: ARCHITECT_SYSTEM,
      prompt: architectPrompt(question, context, debate.rounds),
      schemaName: "architect_proposal", schema: proposalSchema
    });

    const partial: DebateRound = {
      round: roundNo,
      architect,
      redTeam: { verdict: "challenge", attacks: [], unresolvedQuestions: [] },
      judge: { status: "revise", winner: "neither", architectScore: 0, redTeamScore: 0, acceptedClaims: [], rejectedClaims: [], criticalDisagreements: [], decision: "", rationale: [] },
      createdAt: new Date().toISOString()
    };

    partial.redTeam = await callModel<Critique>({
      ...config.redTeam, system: RED_TEAM_SYSTEM,
      prompt: redTeamPrompt(question, context, partial),
      schemaName: "red_team_critique", schema: critiqueSchema
    });

    partial.judge = await callModel<JudgeDecision>({
      ...config.judge, system: JUDGE_SYSTEM,
      prompt: judgePrompt(question, context, partial, config.convergenceScore),
      schemaName: "judge_decision", schema: judgeSchema
    });

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
