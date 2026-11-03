import test from "node:test";
import assert from "node:assert/strict";
import {
  auditRoundContinuity,
  calculateOptionEconomics,
  calculateWeightedComparison,
  classifyDecisionIntent,
  compareEconomics
} from "../src/decision-intelligence.js";

test("classifies a profitability comparison as financial and comparative", () => {
  const intents = classifyDecisionIntent("Entre les pintades et les poulets, lequel donne la meilleure rentabilité et le meilleur résultat net ?");
  assert.ok(intents.includes("financial"));
  assert.ok(intents.includes("comparison"));
});

test("calculates complete unit economics without inventing missing inputs", () => {
  const result = calculateOptionEconomics({
    label: "Lot A",
    startingUnits: 100,
    purchaseCostPerUnit: 1500,
    feedCostPerUnit: 2800,
    healthCostPerUnit: 250,
    laborAndOverhead: 30000,
    infrastructureCost: 20000,
    otherCosts: 10000,
    mortalityRate: 0.08,
    salePricePerUnit: 6500,
    cycleDays: 90,
    evidence: { startingUnits: "verified", salePricePerUnit: "estimate" }
  });
  assert.equal(result.soldUnits, 92);
  assert.equal(result.totalCost, 515000);
  assert.equal(result.revenue, 598000);
  assert.equal(result.netResult, 83000);
  assert.equal(result.missingInputs.length, 0);
  assert.equal(result.evidenceSummary.verified, 1);
  assert.equal(result.evidenceSummary.estimate, 1);
  assert.equal(result.evidenceSummary.missing, 7);
});

test("refuses to declare a financial winner when required inputs are missing", () => {
  const incomplete = calculateOptionEconomics({
    label: "Option incomplète",
    startingUnits: 100,
    purchaseCostPerUnit: 1000,
    feedCostPerUnit: 0,
    healthCostPerUnit: 0,
    laborAndOverhead: 0,
    infrastructureCost: 0,
    otherCosts: 0,
    mortalityRate: 0.1,
    salePricePerUnit: Number.NaN
  });
  assert.ok(incomplete.missingInputs.length > 0);
  const complete = calculateOptionEconomics({
    label: "Option complète",
    startingUnits: 10,
    purchaseCostPerUnit: 10,
    feedCostPerUnit: 10,
    healthCostPerUnit: 1,
    laborAndOverhead: 1,
    infrastructureCost: 1,
    otherCosts: 1,
    mortalityRate: 0,
    salePricePerUnit: 50
  });
  assert.equal(compareEconomics(incomplete, complete).winner, "indeterminate");
});

test("validates weighted criteria and computes normalized scores", () => {
  const result = calculateWeightedComparison([
    { id: "margin", label: "Marge", weight: 60, scoreA: 80, scoreB: 60, evidence: "verified" },
    { id: "risk", label: "Risque", weight: 40, scoreA: 50, scoreB: 75, evidence: "estimate" }
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.scoreA, 68);
  assert.equal(result.scoreB, 66);
  assert.equal(result.winner, "A");
});

test("requires the arbiter to explain changes in winner between rounds", () => {
  const audit = auditRoundContinuity([
    { round: 1, architectPosition: "Option A", redTeamAlternative: "Option B", decision: "A", winner: "architect" },
    { round: 2, architectPosition: "Option A", redTeamAlternative: "Option B", decision: "B", winner: "red_team" }
  ]);
  assert.equal(audit.requiresExplanation, true);
  assert.equal(audit.winnerChanges.length, 1);
  assert.equal(audit.winnerChanges[0].explanationRequired, true);
});
