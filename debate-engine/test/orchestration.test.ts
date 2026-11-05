import test from "node:test";
import assert from "node:assert/strict";
import { applyConvergencePolicy, runDebate, runDebateAgentStep } from "../src/engine.js";
import { auditClaims } from "../src/evidence.js";
import type { Debate, DebateConfig, Proposal, Critique, JudgeDecision } from "../src/types.js";
import type { callModel } from "../src/providers.js";
import { proposalSchema, critiqueSchema, judgeSchema } from "../src/schema.js";

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


test("all provider JSON schemas satisfy strict required-property rules recursively", () => {
  const visit = (schema: any, path: string) => {
    if (!schema || typeof schema !== "object") return;
    if (schema.type === "object" && schema.properties) {
      assert.equal(schema.additionalProperties, false, path + " must reject additional properties");
      assert.deepEqual(
        [...(schema.required ?? [])].sort(),
        Object.keys(schema.properties).sort(),
        path + " must require every declared property for strict JSON output"
      );
      for (const [key, child] of Object.entries(schema.properties)) visit(child, path + "." + key);
    }
    if (schema.items) visit(schema.items, path + "[]");
    for (const [index, branch] of (schema.anyOf ?? []).entries()) visit(branch, path + ".anyOf[" + index + "]");
  };
  visit(proposalSchema, "proposalSchema");
  visit(critiqueSchema, "critiqueSchema");
  visit(judgeSchema, "judgeSchema");
});


test("BR-DEC-001: three-round debate forwards prior arguments and objections to every agent", async () => {
  const topics = [
    "Faut-il investir dans une unité semi-industrielle d'attiéké ?",
    "Une banque doit-elle externaliser son dispositif de contrôle permanent ?",
    "Une PME doit-elle migrer son infrastructure vers le cloud ?",
    "Une collectivité doit-elle lancer un programme de transport public ?",
    "Une entreprise doit-elle adopter une politique de recrutement à distance ?"
  ];
  for (const question of topics) {
    const prompts: Array<{ schema: string; prompt: string }> = [];
    let architectTurn = 0;
    let redTeamTurn = 0;
    const caller: typeof callModel = async <T>(args: Parameters<typeof callModel>[0]): Promise<T> => {
      prompts.push({ schema: args.schemaName, prompt: args.prompt });
      if (args.schemaName === "architect_proposal") {
        architectTurn += 1;
        return { ...architect, position: "Analyse " + architectTurn + " : " + question,
          claims: [], assumptions: ["Hypothèse nouvelle " + architectTurn],
          nextTests: ["Test discriminant " + architectTurn] } as T;
      }
      if (args.schemaName === "red_team_critique") {
        redTeamTurn += 1;
        return { ...emptyCritique, attacks: [{ severity: "medium", argument: "Objection nouvelle " + redTeamTurn,
          evidenceNeeded: ["Preuve " + redTeamTurn], confidence: 0.7 }] } as T;
      }
      return { ...judge, confidence: "high", criticalDisagreements: [],
        decision: "Décision argumentée du tour " + (redTeamTurn) } as T;
    };
    const result = await runDebate(question, "Contexte de test", { ...config, maxRounds: 3 }, caller);
    assert.equal(result.rounds.length, 3, "trois tours doivent être exécutés");
    assert.equal(architectTurn, 3);
    assert.equal(redTeamTurn, 3);
    const secondArchitect = prompts.find(x => x.schema === "architect_proposal" && x.prompt.includes("Analyse 1"));
    const secondRedTeam = prompts.find(x => x.schema === "red_team_critique" && x.prompt.includes("Objection nouvelle 1"));
    const secondJudge = prompts.find(x => x.schema === "judge_decision" && x.prompt.includes("Objection nouvelle 1"));
    assert.ok(secondArchitect, "l'Architecte reçoit l'historique du tour précédent");
    assert.ok(secondRedTeam, "la Red Team reçoit les objections déjà formulées");
    assert.ok(secondJudge, "l'Arbitre reçoit les désaccords et décisions précédents");
    assert.match(result.rounds[1].architect.assumptions[0], /2$/);
    assert.match(result.rounds[2].architect.assumptions[0], /3$/);
  }
});

test("BR-DEC-001: blocking unsupported facts suspend a decision despite a decisive favorable score", () => {
  const blockedAudit = auditClaims([{
    id: "critical-fact-without-proof",
    statement: "Une affirmation factuelle déterminante sans référence.",
    type: "fact",
    confidence: 0.99,
    evidenceRequired: true,
    evidenceRefs: []
  }]);
  const highScoreJudge: JudgeDecision = {
    ...judge,
    status: "converged",
    winner: "architect",
    architectScore: 99,
    redTeamScore: 1,
    confidence: "high",
    criticalDisagreements: [],
    decision: "Retenir l'option de l'Architecte."
  };
  const result = applyConvergencePolicy({ ...highScoreJudge, evidenceAudit: blockedAudit }, 0, 0, true);
  assert.equal(result.winner, "neither");
  assert.equal(result.status, "unresolved");
  assert.equal(result.confidence, "low");
  assert.match(result.decision, /suspendue/i);
});
