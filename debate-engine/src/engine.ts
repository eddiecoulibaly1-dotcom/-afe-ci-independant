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

function normalizeTerminalDecision(judge: JudgeDecision): JudgeDecision {
  const winner = winnerFromScores(judge);
  if (winner === "neither") {
    return {
      ...judge,
      status: "unresolved",
      winner: "neither",
      confidence: "low",
      decision: judge.decision || "Aucune option ne domine suffisamment : un test discriminant est nécessaire avant de choisir."
    };
  }

  if (judge.status === "unresolved" || judge.status === "revise") {
    const provisional = judge.confidence !== "high" || (judge.criticalDisagreements ?? []).length > 0;
    return {
      ...judge,
      status: provisional ? "provisional" : "converged",
      winner,
      confidence: provisional ? (judge.confidence === "low" ? "low" : "moderate") : "high",
      decision: judge.decision?.startsWith("Décision") ? judge.decision : `Décision provisoire : ${decisionLabel(winner)}. ${judge.decision || "La comparaison finale donne un avantage suffisant à cette option."}`,
      rationale: [...(judge.rationale ?? []), `Normalisation terminale : l'écart final de ${scoreDelta(judge)} points permet de départager les options.`]
    };
  }

  return { ...judge, winner };
}

function terminalFromLastRound(debate: Debate, reason: string): Debate {
  const last = debate.rounds.at(-1);
  if (!last) return buildContinuityDebate(debate.question, debate.context, debate.config ?? defaultConfig(), reason);
  const normalized = normalizeTerminalDecision(last.judge);
  const finalDecision: JudgeDecision = {
    ...normalized,
    rationale: [...normalized.rationale, `Débat terminé proprement : ${reason}`]
  };
  debate.status = finalDecision.status === "converged" || finalDecision.status === "provisional" ? finalDecision.status : "unresolved";
  debate.finalDecision = finalDecision;
  return debate;
}

function defaultConfig(): DebateConfig {
  return {
    maxRounds: 3,
    convergenceScore: 85,
    architect: { provider: "openai", model: "gpt-4.1-mini" },
    redTeam: { provider: "openai", model: "gpt-4.1-mini" },
    judge: { provider: "openai", model: "gpt-4.1-mini" }
  };
}

// Availability guarantee: if the model provider is temporarily unavailable,
// the discussion space still returns a usable, explicitly provisional decision
// instead of exposing a technical error to the user.
function buildContinuityDebate(question: string, context: string | undefined, config: DebateConfig, reason: string): Debate {
  const architect: Proposal = {
    position: `Mode de continuité : structurer immédiatement une première approche testable pour la question « ${question} ».`,
    claims: [{ id: "continuity-hypothesis", statement: "La meilleure première étape est une expérimentation limitée, mesurable et réversible.", type: "hypothesis", confidence: 0.55, evidenceRequired: true }],
    assumptions: ["Les contraintes et ressources disponibles doivent être vérifiées sur le terrain.", "Une expérimentation limitée permet de réduire le risque avant un déploiement plus large."],
    risks: ["Données de marché incomplètes", "Hypothèses non encore validées", "Risque d'exécution locale"],
    alternatives: ["Lancer directement à grande échelle", "Réduire le périmètre et tester une hypothèse critique"],
    scoreExpected: 50,
    nextTests: ["Identifier les trois hypothèses les plus critiques.", "Définir un pilote de petite taille avec un critère de réussite mesurable.", "Mesurer coût, adoption, satisfaction et réachat avant extension."]
  };
  const redTeam: Critique = {
    verdict: "challenge",
    attacks: [
      { severity: "high", argument: "Le périmètre initial doit être suffisamment concentré pour éviter de disperser les ressources.", evidenceNeeded: ["Taille du marché initial", "Coût d'acquisition", "Capacité opérationnelle"], confidence: 0.7 },
      { severity: "medium", argument: "Les hypothèses commerciales et opérationnelles doivent être testées avant d'investir davantage.", evidenceNeeded: ["Premières transactions", "Marge", "Taux de réachat"], confidence: 0.75 }
    ],
    strongestAlternative: "Un pilote court et mesurable avant tout élargissement.",
    unresolvedQuestions: ["Quel indicateur démontrera réellement la traction ?", "Quel seuil doit déclencher l'extension ou l'arrêt ?"]
  };
  const scorecard: Scorecard = { buyerValue: 5, sellerValue: 5, coteDIvoireFit: 6, marketplaceLiquidity: 4, differentiation: 4, trustFraud: 5, technicalFeasibility: 7, acquisition: 4, monetization: 4 };
  const judge: JudgeDecision = {
    status: "provisional", winner: "neither", architectScore: 50, redTeamScore: 50,
    architectScorecard: scorecard, redTeamScorecard: scorecard,
    acceptedClaims: ["Un pilote limité et mesurable est préférable à un déploiement irréversible."],
    rejectedClaims: [],
    criticalDisagreements: [],
    decision: "Mode de continuité : préparer un pilote limité, mesurable et réversible avant toute extension.",
    rationale: ["Le moteur principal n'a pas pu terminer l'analyse automatique.", `Continuité activée : ${reason}`, "Aucune option n'est artificiellement déclarée gagnante sans comparaison fiable."],
    confidence: "low",
    risks: architect.risks,
    tests: architect.nextTests,
    reversalConditions: ["Réviser la décision dès que les données terrain montrent une option clairement supérieure."]
  };
  const round: DebateRound = { round: 1, architect, redTeam, judge, evidenceAudit: auditClaims(architect.claims), createdAt: new Date().toISOString() };
  return { id: randomUUID(), question, context, status: "provisional", rounds: [round], finalDecision: judge, config };
}

export async function runDebate(question: string, context: string | undefined, config: DebateConfig): Promise<Debate> {
  const debate: Debate = { id: randomUUID(), question, context, status: "running", rounds: [], config };
  for (let roundNo = 1; roundNo <= config.maxRounds; roundNo++) {
    const finalRound = roundNo === config.maxRounds;
    let architect: Proposal;
    try {
      architect = await callModel<Proposal>({ ...config.architect, system: ARCHITECT_SYSTEM, prompt: architectPrompt(question, context, debate.rounds, debate.rounds.at(-1)?.judge.nextRoundObjective), schemaName: "architect_proposal", schema: proposalSchema });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return terminalFromLastRound(debate, `continuité automatique activée (${reason})`);
    }

    const evidenceAudit = auditClaims(architect.claims);
    const partial: DebateRound = { round: roundNo, architect, evidenceAudit, redTeam: { verdict: "challenge", attacks: [], unresolvedQuestions: [] }, judge: { status: "revise", winner: "neither", architectScore: 0, redTeamScore: 0, architectScorecard: emptyScorecard(), redTeamScorecard: emptyScorecard(), acceptedClaims: [], rejectedClaims: [], criticalDisagreements: [], decision: "", rationale: [], evidenceAudit }, createdAt: new Date().toISOString() };
    try {
      partial.redTeam = await callModel<Critique>({ ...config.redTeam, system: RED_TEAM_SYSTEM, prompt: redTeamPrompt(question, context, partial), schemaName: "red_team_critique", schema: critiqueSchema });
    } catch (error) {
      if (debate.rounds.length) return terminalFromLastRound(debate, "la Red Team n'a pas pu terminer l'analyse; dernière décision conservée");
      return buildContinuityDebate(question, context, config, "la Red Team n'a pas pu terminer l'analyse");
    }
    try {
      const rawJudge = await callModel<JudgeDecision>({ ...config.judge, system: JUDGE_SYSTEM, prompt: judgePrompt(question, context, partial, config.convergenceScore), schemaName: "judge_decision", schema: judgeSchema });
      partial.judge = applyConvergencePolicy({ ...rawJudge, evidenceAudit }, partial.redTeam.unresolvedQuestions.length, partial.redTeam.attacks.filter((attack) => attack.severity === "critical").length, finalRound);
    } catch (error) {
      if (debate.rounds.length) return terminalFromLastRound(debate, "l'Arbitre n'a pas pu terminer l'analyse; dernière décision conservée");
      return buildContinuityDebate(question, context, config, "l'Arbitre n'a pas pu terminer l'analyse");
    }
    debate.rounds.push(partial);
    if (partial.judge.status === "converged" || partial.judge.status === "provisional") { debate.status = partial.judge.status; debate.finalDecision = partial.judge; return debate; }
  }
  debate.status = "unresolved";
  debate.finalDecision = debate.rounds.at(-1)?.judge;
  return debate;
}
