import test from "node:test";
import assert from "node:assert/strict";
import { runDebateAgentStep } from "../src/engine.js";
import type { Debate, DebateConfig, Proposal, Critique, JudgeDecision } from "../src/types.js";
import type { callModel } from "../src/providers.js";

const scorecard = { buyerValue: 80, sellerValue: 80, coteDIvoireFit: 80, marketplaceLiquidity: 80, differentiation: 80, trustFraud: 80, technicalFeasibility: 80, acquisition: 80, monetization: 80 };
const config: DebateConfig = {
  maxRounds: 1, convergenceScore: 85,
  architect: { provider: "openai", model: "mock" },
  redTeam: { provider: "openai", model: "mock" },
  judge: { provider: "openai", model: "mock" }
};
const debate: Debate = { id: "resume-test", question: "Quelle option choisir ?", status: "running", rounds: [], config };
const architect: Proposal = { position: "Option A", claims: [], assumptions: [], risks: [], alternatives: [], scoreExpected: 80, nextTests: [] };
const emptyCritique: Critique = { verdict: "challenge", attacks: [], unresolvedQuestions: [] };
const judge: JudgeDecision = {
  status: "converged", winner: "architect", architectScore: 90, redTeamScore: 20,
  architectScorecard: scorecard, redTeamScorecard: scorecard, acceptedClaims: [], rejectedClaims: [],
  criticalDisagreements: [], decision: "Retenir l'option A.", rationale: []
};
const responses: Record<string, unknown> = { architect_proposal: architect, red_team_critique: emptyCritique, judge_decision: judge };
const mockedCaller: typeof callModel = async <T>(args: Parameters<typeof callModel>[0]): Promise<T> => {
  assert.ok(responses[args.schemaName], "Schéma inattendu : " + args.schemaName);
  return responses[args.schemaName] as T;
};

test("durable orchestration executes architect, red team and judge as resumable steps", async () => {
  const afterArchitect = await runDebateAgentStep(debate, "architect", 1, mockedCaller);
  assert.equal(afterArchitect.status, "running");
  assert.equal(afterArchitect.rounds[0].architect.position, "Option A");
  const afterRedTeam = await runDebateAgentStep(afterArchitect, "red_team", 1, mockedCaller);
  assert.deepEqual(afterRedTeam.rounds[0].redTeam, emptyCritique);
  assert.equal(afterRedTeam.rounds[0].redTeamCompleted, true);
  await assert.rejects(() => runDebateAgentStep(afterRedTeam, "red_team", 1, mockedCaller), /STEP_ALREADY_COMPLETED/);
  // An empty Red Team response is valid; the journal determines recovery order.
  const afterJudge = await runDebateAgentStep(afterRedTeam, "judge", 1, mockedCaller);
  assert.equal(afterJudge.rounds.length, 1);
  assert.notEqual(afterJudge.status, "running");
  assert.ok(afterJudge.finalDecision?.decision);
});
