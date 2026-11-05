import test from "node:test";
import assert from "node:assert/strict";
import { routeDecision } from "../src/decision-router.js";
import { selectAgents } from "../src/agent-registry.js";
import { buildScenarios } from "../src/scenario-engine.js";
import { assessRisks } from "../src/risk-engine.js";
import { arbitrateDecision } from "../src/arbitration.js";
import { buildDecisionReport } from "../src/report-engine.js";
import { createAuditEvent, verifyAuditSequence } from "../src/audit-engine.js";

test("router respects an explicit mode and detects a complex financial decision", () => {
  const route = routeDecision({ question: "Faut-il investir 50 millions FCFA dans une unité agricole ?", requestedMode: "hybrid" });
  assert.equal(route.mode, "hybrid");
  assert.ok(route.intents.includes("financial"));
  assert.equal(route.requiresScenarios, true);
});

// Regression coverage for French investment wording and West African currency amounts.
test("financial intent detects investment verbs and amounts expressed in FCFA", () => {
  assert.ok(routeDecision({ question: "Faut-il investir 50 millions FCFA dans une unité agricole ?" }).intents.includes("financial"));
  assert.ok(routeDecision({ question: "Quel capital financer pour lancer cette activité ?" }).intents.includes("financial"));
});

test("agent registry activates only capabilities relevant to the selected mode", () => {
  const route = routeDecision({ question: "Faut-il investir dans cette activité ?", requestedMode: "decision" });
  const roles = selectAgents(route).map(agent => agent.role);
  assert.ok(roles.includes("scenario"));
  assert.ok(roles.includes("risk"));
  assert.ok(!roles.includes("red_team"));
});

test("scenario engine creates qualitative scenarios without numeric forecasts", () => {
  const scenarios = buildScenarios({ horizon: "12 mois", baseline: "Activité actuelle", drivers: [
    { name: "Demande", currentState: "stable", favourableDevelopment: "hausse", adverseDevelopment: "baisse", evidenceStatus: "estimated" }
  ] });
  assert.equal(scenarios.length, 3);
  assert.equal(scenarios[0].id, "optimistic");
});

test("risk engine validates scales and orders risks by exposure", () => {
  const risks = assessRisks([
    { id: "r1", description: "Risque modéré", likelihood: 2, impact: 2 },
    { id: "r2", description: "Risque élevé", likelihood: 5, impact: 5 }
  ]);
  assert.equal(risks[0].id, "r2");
  assert.equal(risks[0].level, "critical");
  assert.throws(() => assessRisks([{ id: "bad", description: "x", likelihood: 6, impact: 2 }]), /RISK_SCALE_INVALID/);
});

test("arbitration remains indeterminate when evidence scores are absent", () => {
  const result = arbitrateDecision({ preferredOption: "A", alternatives: ["B"], evidenceReliabilityScore: null, decisionRobustnessScore: 90, unresolvedCriticalIssues: [] });
  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.preferredOption, null);
});

test("decision report is provisional when evidence limitations remain", () => {
  const arbitration = arbitrateDecision({ preferredOption: "A", alternatives: ["B"], evidenceReliabilityScore: 80, decisionRobustnessScore: 80, unresolvedCriticalIssues: [] });
  const report = buildDecisionReport({ title: "Rapport", question: "Quel choix ?", executiveSummary: "Résumé", arbitration, scenarios: [], risks: [], evidenceLimitations: ["Prix non vérifié"], actionPlan: [] });
  assert.equal(report.status, "provisional");
});

test("audit event sequence detects duplicate identifiers", () => {
  const event = createAuditEvent({ id: "e1", caseId: "c1", actor: "system", type: "request_classified", payload: {} });
  const result = verifyAuditSequence([event, event]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.duplicateIds, ["e1"]);
});
