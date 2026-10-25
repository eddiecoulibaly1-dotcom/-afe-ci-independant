import { randomUUID } from "node:crypto";
import type { Debate, DebateConfig, DebateRound, Proposal, Critique, JudgeDecision, Scorecard } from "./types.js";
import { proposalSchema, critiqueSchema, judgeSchema } from "./schema.js";
import { callModel } from "./providers.js";
import { ARCHITECT_SYSTEM, RED_TEAM_SYSTEM, JUDGE_SYSTEM, architectPrompt, redTeamPrompt, judgePrompt } from "./prompts.js";
import { finalizeJudgeScore, scoreDelta } from "./scoring.js";
import { auditClaims } from "./evidence.js";

const emptyScorecard = (): Scorecard => ({ buyerValue: 0, sellerValue: 0, coteDIvoireFit: 0, marketplaceLiquidity: 0, differentiation: 0, trustFraud: 0, technicalFeasibility: 0, acquisition: 0, monetization: 0 });
const DECISION_GAP = 2.5;

function winnerFromScores(judge: JudgeDecision): "architect" | "red_team" | "neither" {
  const delta = judge.architectScore - judge.redTeamScore;
  if (Math.abs(delta) < DECISION_GAP) return "neither";
  return delta > 0 ? "architect" : "red_team";
}
function decisionLabel(winner: "architect" | "red_team") { return winner === "architect" ? "Architecte" : "Red Team"; }

function buildActionableDecision(judge: JudgeDecision, evidenceAudit: ReturnType<typeof auditClaims>, finalRound: boolean): JudgeDecision {
  const winner = winnerFromScores(judge);
  if (!finalRound) return { ...judge, status: "revise", winner, confidence: "low" };
  if (winner === "neither") {
    return {
      ...judge, status: "unresolved", winner: "neither", confidence: "low",
      decision: "Aucune option ne domine suffisamment : conserver les deux options et exécuter un test discriminant avant de choisir.",
      rationale: [...judge.rationale, `Écart final inférieur à ${DECISION_GAP} points : les alternatives restent réellement indissociables après arbitrage.`],
      risks: [...(judge.risks ?? []), "Le moteur ne dispose pas d'un avantage suffisamment net pour recommander une option."],
      tests: [...(judge.tests ?? []), ...(evidenceAudit.nextTests ?? [])]
    };
  }

  const evidenceRisk = evidenceAudit.unsupportedCriticalClaims.length + evidenceAudit.unsupportedHighImpactClaims.length;
  const criticalAttacks = (judge.criticalDisagreements ?? []).length;
  const confidence: "high" | "moderate" | "low" = evidenceRisk === 0 && criticalAttacks === 0 && scoreDelta(judge) >= 8 ? "high" : scoreDelta(judge) >= 4 ? "moderate" : "low";
  const provisional = evidenceRisk > 0 || criticalAttacks > 0 || confidence !== "high";
  const status = provisional ? "provisional" : "converged";
  const winnerLabel = decisionLabel(winner);
  const riskList = [
    ...(judge.risks ?? []),
    ...(judge.criticalDisagreements ?? []).map((x) => `Risque à surveiller : ${x}`),
    ...(evidenceAudit.nextTests ?? []).slice(0, 4).map((x) => `Validation nécessaire : ${x}`)
  ].slice(0, 8);
  const tests = [...new Set([...(judge.tests ?? []), ...(evidenceAudit.nextTests ?? [])])].slice(0, 8);
  const reversalConditions = [
    `Inverser la décision si un test critique invalide l'hypothèse centrale de ${winnerLabel}.`,
    `Inverser la décision si l'alternative obtient un avantage d'au moins ${DECISION_GAP} points sur les mêmes critères après test.`,
    ...(judge.criticalDisagreements ?? []).slice(0, 2).map((x) => `Réexaminer si ce désaccord devient un blocage de faisabilité : ${x}`)
  ];

  return {
    ...judge, status, winner, confidence, risks: riskList, tests, reversalConditions,
    decision: `${status === "provisional" ? "Décision provisoire" : "Décision"} : ${winnerLabel}. ${judge.decision}`,
    rationale: [...judge.rationale, `Le score comparatif donne l'avantage à ${winnerLabel} de ${scoreDelta(judge)} points.`, provisional ? "Les objections et lacunes de preuve abaissent la confiance mais ne bloquent pas la décision : elles deviennent des risques et des tests." : "Aucune objection restante ne justifie de retarder la décision."]
  };
}

function applyConvergencePolicy(judge: JudgeDecision, unresolvedQuestions: number, criticalAttacks: number, finalRound: boolean): JudgeDecision {
  const scored = finalizeJudgeScore(judge, unresolvedQuestions, criticalAttacks);
  return buildActionableDecision(scored, scored.evidenceAudit ?? { records: [], unsupportedCriticalClaims: [], unsupportedHighImpactClaims: [], confidence: 1, blocking: false, nextTests: [] }, finalRound);
}

function terminalFromLastRound(debate: Debate, reason: string): Debate {
  const last = debate.rounds.at(-1);
  if (!last) throw new Error(reason);
  const finalDecision: JudgeDecision = { ...last.judge, status: last.judge.status === "converged" || last.judge.status === "provisional" ? last.judge.status : "unresolved", rationale: [...last.judge.rationale, `Débat terminé proprement : ${reason}`] };
  debate.status = finalDecision.status === "converged" || finalDecision.status === "provisional" ? finalDecision.status : "unresolved";
  debate.finalDecision = finalDecision;
  return debate;
}

export async function runDebate(question: string, context: string | undefined, config: DebateConfig): Promise<Debate> {
  const debate: Debate = { id: randomUUID(), question, context, status: "running", rounds: [], config };
  for (let roundNo = 1; roundNo <= config.maxRounds; roundNo++) {
    const finalRound = roundNo === config.maxRounds;
    let architect: Proposal;
    try {
      architect = await callModel<Proposal>({ ...config.architect, system: ARCHITECT_SYSTEM, prompt: architectPrompt(question, context, debate.rounds, debate.rounds.at(-1)?.judge.nextRoundObjective), schemaName: "architect_proposal", schema: proposalSchema });
    } catch (error) {
      return terminalFromLastRound(debate, `l’Architecte n’a pas répondu à temps (${error instanceof Error ? error.message : String(error)})`);
    }

    const evidenceAudit = auditClaims(architect.claims);
    const partial: DebateRound = { round: roundNo, architect, evidenceAudit, redTeam: { verdict: "challenge", attacks: [], unresolvedQuestions: [] }, judge: { status: "revise", winner: "neither", architectScore: 0, redTeamScore: 0, architectScorecard: emptyScorecard(), redTeamScorecard: emptyScorecard(), acceptedClaims: [], rejectedClaims: [], criticalDisagreements: [], decision: "", rationale: [], evidenceAudit }, createdAt: new Date().toISOString() };
    try {
      partial.redTeam = await callModel<Critique>({ ...config.redTeam, system: RED_TEAM_SYSTEM, prompt: redTeamPrompt(question, context, partial), schemaName: "red_team_critique", schema: critiqueSchema });
    } catch (error) {
      if (debate.rounds.length) return terminalFromLastRound(debate, `la Red Team n’a pas répondu à temps (${error instanceof Error ? error.message : String(error)})`);
      throw error;
    }
    try {
      const rawJudge = await callModel<JudgeDecision>({ ...config.judge, system: JUDGE_SYSTEM, prompt: judgePrompt(question, context, partial, config.convergenceScore), schemaName: "judge_decision", schema: judgeSchema });
      partial.judge = applyConvergencePolicy({ ...rawJudge, evidenceAudit }, partial.redTeam.unresolvedQuestions.length, partial.redTeam.attacks.filter((attack) => attack.severity === "critical").length, finalRound);
    } catch (error) {
      if (debate.rounds.length) return terminalFromLastRound(debate, `l’Arbitre n’a pas répondu à temps (${error instanceof Error ? error.message : String(error)})`);
      throw error;
    }
    debate.rounds.push(partial);
    if (partial.judge.status === "converged" || partial.judge.status === "provisional") { debate.status = partial.judge.status; debate.finalDecision = partial.judge; return debate; }
  }
  debate.status = "unresolved";
  debate.finalDecision = debate.rounds.at(-1)?.judge;
  return debate;
}
