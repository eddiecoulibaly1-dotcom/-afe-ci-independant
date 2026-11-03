import test from "node:test";
import assert from "node:assert/strict";
import { runDebate } from "../src/engine.js";
import type { DebateConfig, Proposal, Critique, JudgeDecision } from "../src/types.js";
import type { QuantitativeOptionDraft } from "../src/quantitative-reasoning.js";
import type { callModel } from "../src/providers.js";

const scorecard = { buyerValue: 90, sellerValue: 90, coteDIvoireFit: 90, marketplaceLiquidity: 90, differentiation: 90, trustFraud: 90, technicalFeasibility: 90, acquisition: 90, monetization: 90 };
const option = (label: string, price: number, feedCost: number | null): QuantitativeOptionDraft => ({
  label, startingUnits: 100, purchaseCostPerUnit: 1000, feedCostPerUnit: feedCost, healthCostPerUnit: 100,
  laborAndOverhead: 20000, infrastructureCost: 10000, otherCosts: 5000, mortalityRate: 0.1, salePricePerUnit: price
});

test("end-to-end: an incomplete financial input overrides an AI-declared economic winner", async () => {
  const architect: Proposal = {
    position: "Option A est nettement plus rentable et doit gagner.",
    claims: [], assumptions: [], risks: [], alternatives: ["Option B"], scoreExpected: 95, nextTests: [],
    quantitativeOptions: [option("Option A", 5000, null), option("Option B", 4000, 1500)]
  };
  const redTeam: Critique = {
    verdict: "challenge", attacks: [{ severity: "critical", argument: "Le coût alimentaire de A est absent.", evidenceNeeded: ["Coût alimentaire unitaire"], confidence: 1 }],
    unresolvedQuestions: ["Quel est le coût alimentaire réel de A ?"]
  };
  const judge: JudgeDecision = {
    status: "converged", winner: "architect", architectScore: 95, redTeamScore: 10,
    architectScorecard: scorecard, redTeamScorecard: scorecard, acceptedClaims: [], rejectedClaims: [],
    criticalDisagreements: [], decision: "Option A gagne économiquement.", rationale: ["Score élevé pour A."],
    confidence: "high", risks: [], tests: [], reversalConditions: []
  };
  const responses: Record<string, unknown> = { architect_proposal: architect, red_team_critique: redTeam, judge_decision: judge };
  const mockedCaller: typeof callModel = async <T>(args: Parameters<typeof callModel>[0]): Promise<T> => {
    const response = responses[args.schemaName];
    assert.ok(response, `Appel inattendu : ${args.schemaName}`);
    return response as T;
  };
  const config: DebateConfig = {
    maxRounds: 1, convergenceScore: 85,
    architect: { provider: "openai", model: "mock" },
    redTeam: { provider: "openai", model: "mock" },
    judge: { provider: "openai", model: "mock" }
  };

  const result = await runDebate("Quelle option est la plus rentable financièrement ?", undefined, config, mockedCaller);
  const round = result.rounds[0];
  assert.equal(result.rounds.length, 1);
  assert.equal(round.quantitativeAudit?.status, "incomplete");
  assert.equal(round.quantitativeAudit?.comparison, null);
  assert.equal(round.judge.winner, "neither");
  assert.equal(round.judge.status, "unresolved");
  assert.equal(result.status, "unresolved");
  assert.match(round.judge.decision, /Arbitrage économique suspendu/);
  assert.ok(round.judge.tests?.some(item => item.includes("coût alimentaire unitaire")));
});
