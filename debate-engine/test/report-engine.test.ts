import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategicReportPrompt } from "../src/report-engine.js";
import type { Debate } from "../src/types.js";

test("le rapport reprend le débat et impose la traçabilité des preuves et des chiffres", () => {
  const debate = {
    id: "test",
    question: "DJAWA peut-elle croître ?",
    context: "Budget plafond : 500 millions FCFA.",
    status: "provisional",
    rounds: [{
      round: 1,
      architect: { position: "Tester un MVP", claims: [], assumptions: [], risks: [], alternatives: [], scoreExpected: 70, nextTests: [] },
      redTeam: { verdict: "challenge", attacks: [], unresolvedQuestions: [] },
      judge: { status: "provisional", winner: "neither", architectScore: 50, redTeamScore: 50, architectScorecard: {}, redTeamScorecard: {}, acceptedClaims: [], rejectedClaims: [], criticalDisagreements: [], decision: "Tester", rationale: [] }
    }],
    finalDecision: { status: "provisional", winner: "neither", architectScore: 50, redTeamScore: 50, architectScorecard: {}, redTeamScorecard: {}, acceptedClaims: [], rejectedClaims: [], criticalDisagreements: [], decision: "Tester", rationale: [] }
  } as unknown as Debate;
  const prompt = buildStrategicReportPrompt(debate);
  assert.match(prompt, /500 millions FCFA/);
  assert.match(prompt, /N'invente aucun chiffre/);
  assert.match(prompt, /référence/);
  assert.match(prompt, /CONDITIONAL_GO/);
});
