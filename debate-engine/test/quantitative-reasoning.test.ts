import test from "node:test";
import assert from "node:assert/strict";
import { buildQuantitativeAudit, quantitativePromptGuidance, canDeclareEconomicWinner } from "../src/quantitative-reasoning.js";
import { ARCHITECT_SYSTEM, RED_TEAM_SYSTEM, JUDGE_SYSTEM, redTeamPrompt, judgePrompt } from "../src/prompts.js";

const completeOption = (label: string, salePricePerUnit: number) => ({
  label,
  startingUnits: 100,
  purchaseCostPerUnit: 1000,
  feedCostPerUnit: 1500,
  healthCostPerUnit: 100,
  laborAndOverhead: 20000,
  infrastructureCost: 10000,
  otherCosts: 5000,
  mortalityRate: 0.1,
  salePricePerUnit,
  evidence: {
    startingUnits: "verified" as const,
    purchaseCostPerUnit: "verified" as const,
    feedCostPerUnit: "estimate" as const,
    healthCostPerUnit: "estimate" as const,
    laborAndOverhead: "assumption" as const,
    infrastructureCost: "assumption" as const,
    otherCosts: "assumption" as const,
    mortalityRate: "estimate" as const,
    salePricePerUnit: "verified" as const
  }
});

test("calculates option economics and compares two complete options", () => {
  const audit = buildQuantitativeAudit([
    completeOption("Option A", 3500),
    completeOption("Option B", 4000)
  ], true);

  assert.equal(audit.status, "calculated");
  assert.equal(audit.options[0].result?.soldUnits, 90);
  assert.equal(audit.options[0].result?.totalCost, 295000);
  assert.equal(audit.options[0].result?.revenue, 315000);
  assert.equal(audit.comparison?.winner, "B");
});

test("keeps the decision indeterminate when required data is missing", () => {
  const incomplete = completeOption("Option A", 3500);
  incomplete.feedCostPerUnit = null;
  const audit = buildQuantitativeAudit([
    incomplete,
    completeOption("Option B", 4000)
  ], true);

  assert.equal(audit.status, "incomplete");
  assert.equal(audit.comparison, null);
  assert.ok(audit.options[0].missingInputs.includes("coût alimentaire unitaire"));
  assert.ok(audit.instructions.some(item => item.includes("aucun gagnant")));
});

test("does not activate quantitative calculations for non-quantitative debates", () => {
  const audit = buildQuantitativeAudit(undefined, false);
  assert.equal(audit.status, "not_applicable");
  assert.equal(audit.options.length, 0);
});

test("provides explicit anti-fabrication instructions to the model", () => {
  const guidance = quantitativePromptGuidance();
  assert.ok(guidance.includes("utilise null"));
  assert.ok(guidance.includes("N'invente aucun prix"));
});

test("never declares an economic winner when a required input is missing", () => {
  const incomplete = completeOption("Option A", 3500);
  incomplete.feedCostPerUnit = null;
  const audit = buildQuantitativeAudit([incomplete, completeOption("Option B", 4000)], true);
  assert.equal(audit.status, "incomplete");
  assert.equal(audit.comparison, null);
  assert.equal(canDeclareEconomicWinner(audit), false);
});

test("does not declare a winner when fewer than two complete options are compared", () => {
  const audit = buildQuantitativeAudit([completeOption("Option A", 3500)], true);
  assert.equal(audit.comparison, null);
  assert.equal(canDeclareEconomicWinner(audit), false);
});

test("allows an economic winner only after a complete deterministic comparison", () => {
  const audit = buildQuantitativeAudit([completeOption("Option A", 3500), completeOption("Option B", 4000)], true);
  assert.equal(audit.status, "calculated");
  assert.notEqual(audit.comparison, null);
  assert.equal(canDeclareEconomicWinner(audit), true);
});

test("connects the quantitative rules to the three agent system instructions", () => {
  assert.ok(ARCHITECT_SYSTEM.includes("quantitativeOptions"));
  assert.ok(RED_TEAM_SYSTEM.includes("Ne remplace jamais une valeur absente par zéro"));
  assert.ok(JUDGE_SYSTEM.includes("aucun gagnant économique ne peut être désigné"));
});

test("passes the deterministic quantitative report to Red Team and Arbiter", () => {
  const audit = buildQuantitativeAudit([completeOption("Option A", 3500), completeOption("Option B", 4000)], true);
  const round = {
    round: 1,
    architect: { position: "Comparaison", claims: [], assumptions: [], risks: [], alternatives: [], scoreExpected: 50, nextTests: [] },
    redTeam: { verdict: "challenge" as const, attacks: [], unresolvedQuestions: [] },
    judge: { status: "revise" as const, winner: "neither" as const, architectScore: 50, redTeamScore: 50, architectScorecard: { buyerValue: 0, sellerValue: 0, coteDIvoireFit: 0, marketplaceLiquidity: 0, differentiation: 0, trustFraud: 0, technicalFeasibility: 0, acquisition: 0, monetization: 0 }, redTeamScorecard: { buyerValue: 0, sellerValue: 0, coteDIvoireFit: 0, marketplaceLiquidity: 0, differentiation: 0, trustFraud: 0, technicalFeasibility: 0, acquisition: 0, monetization: 0 }, acceptedClaims: [], rejectedClaims: [], criticalDisagreements: [], decision: "", rationale: [], nextRoundObjective: "", confidence: "low" as const, risks: [], tests: [], reversalConditions: [] },
    quantitativeAudit: audit,
    createdAt: new Date().toISOString()
  };
  assert.ok(redTeamPrompt("Comparer deux options", undefined, round).includes("RAPPORT QUANTITATIF DÉTERMINISTE"));
  assert.ok(judgePrompt("Comparer deux options", undefined, round, 85).includes("RAPPORT QUANTITATIF DÉTERMINISTE"));
});
