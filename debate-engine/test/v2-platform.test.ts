import test from "node:test";
import assert from "node:assert/strict";
import { calculateV2Quality } from "../src/v2-platform.js";

test("V2 separates source accessibility from evidence quality", () => {
  const result = calculateV2Quality({
    claims: [{ id: "c1", evidenceRefs: ["https://example.org/report"], materiality: "high" }],
    evidence: [{ id: "e1", claim: "Une affirmation", sourceName: "Source", url: "https://example.org/report", status: "reachable", qualityScore: 72, materiality: "high" }],
    falsifications: [{ id: "f1", status: "tested" }],
    scenarioRatings: [75, 80],
    outcomes: [{ probability: 0.8, observed: 1 }],
    approval: { status: "approved" },
    criticalIssues: []
  });
  assert.equal(result.evidenceCoverage.score, 100);
  assert.equal(result.sourceVerification.score, 0);
  assert.equal(result.evidenceReliabilityScore, 72);
  assert.equal(result.decisionRobustnessScore, 77.5);
  assert.equal(result.outcomeCalibration.score, 96);
});

test("V2 does not invent evidence reliability or scenario robustness when inputs are absent", () => {
  const result = calculateV2Quality({
    claims: [{ id: "c1", evidenceRefs: [] }],
    evidence: [{ id: "e1", claim: "x", sourceName: "x", url: "https://example.org", status: "unverified", materiality: "high" }],
    falsifications: [],
    scenarioRatings: [],
    outcomes: [],
    approval: null,
    criticalIssues: ["objection critique"]
  });
  assert.equal(result.evidenceReliabilityScore, null);
  assert.equal(result.decisionRobustnessScore, null);
  assert.equal(result.outcomeCalibration.score, null);
  assert.equal(result.decisionQualityScore, 0);
});
