import test from "node:test";
import assert from "node:assert/strict";
import { buildQuantitativeAudit, quantitativePromptGuidance } from "../src/quantitative-reasoning.js";

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
