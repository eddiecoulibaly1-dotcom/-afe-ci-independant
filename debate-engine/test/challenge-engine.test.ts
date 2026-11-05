import test from "node:test";
import assert from "node:assert/strict";
import { calculateChallengePriority, challengeBand } from "../src/challenge-engine.js";
import { routeDecision } from "../src/decision-router.js";
import { selectAgents } from "../src/agent-registry.js";

test("challenge priority applies the versioned, explainable factor weights", () => {
  const priority = calculateChallengePriority({ impact: 80, evidenceGap: 60, uncertainty: 50, dependency: 40, reversalCost: 70 });
  assert.equal(priority.score, 62);
  assert.equal(priority.version, "1.0.0");
  assert.equal(challengeBand(priority.score), "high");
});

test("challenge priority rejects invented or out-of-range factor values", () => {
  assert.throws(() => calculateChallengePriority({ impact: 101, evidenceGap: 0, uncertainty: 0, dependency: 0, reversalCost: 0 }), /CHALLENGE_FACTOR_OUT_OF_RANGE/);
});

test("decision mode keeps the Red Team agent in the actual execution path", () => {
  const route = routeDecision({ question: "Faut-il investir dans cette activité ?", requestedMode: "decision" });
  assert.ok(selectAgents(route).some(agent => agent.role === "red_team"));
});
