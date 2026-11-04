import { callModel } from "./providers.js";
import type { Debate, StrategicReport } from "./types.js";

const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;
const strings = { type: "array", items: { type: "string" } } as const;
const reportSchema = {
  type: "object", additionalProperties: false,
  properties: {
    decisionLabel: { type: "string", enum: ["GO", "CONDITIONAL_GO", "NO_GO"] },
    executiveSummary: { type: "string" },
    decisionRationale: { type: "string" },
    confidence: { type: "string", enum: ["high", "moderate", "low"] },
    evidence: { type: "object", additionalProperties: false, properties: {
      verified: strings, hypotheses: strings, unverified: strings, gaps: strings,
      references: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        claim: { type: "string" }, references: strings, status: { type: "string", enum: ["supported", "unsupported", "not_provided"] }
      }, required: ["claim", "references", "status"] } }
    }, required: ["verified", "hypotheses", "unverified", "gaps", "references"] },
    optionsComparison: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      option: { type: "string" }, strengths: strings, weaknesses: strings, assessment: { type: "string" }
    }, required: ["option", "strengths", "weaknesses", "assessment"] } },
    financialModel: { type: "object", additionalProperties: false, properties: {
      currency: { type: "string" }, warning: { type: "string" },
      assumptions: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        metric: { type: "string" }, value: nullableNumber, unit: { type: "string" },
        basis: { type: "string", enum: ["observed", "provided", "assumption", "unknown"] }, explanation: { type: "string" }
      }, required: ["metric", "value", "unit", "basis", "explanation"] } },
      scenarios: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        name: { type: "string" }, horizon: { type: "string" }, activeUsers: nullableNumber,
        monthlyRevenuePerActive: nullableNumber, monthlyVariableCostPerActive: nullableNumber,
        monthlyFixedCosts: nullableNumber, operatingResult: nullableNumber,
        conclusion: { type: "string" }
      }, required: ["name", "horizon", "activeUsers", "monthlyRevenuePerActive", "monthlyVariableCostPerActive", "monthlyFixedCosts", "operatingResult", "conclusion"] } },
      unitEconomics: strings, limitations: strings
    }, required: ["currency", "warning", "assumptions", "scenarios", "unitEconomics", "limitations"] },
    risks: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      risk: { type: "string" }, severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      earlyIndicators: strings, response: { type: "string" }
    }, required: ["risk", "severity", "earlyIndicators", "response"] } },
    roadmap: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      period: { type: "string" }, objective: { type: "string" }, actions: strings, kpis: strings
    }, required: ["period", "objective", "actions", "kpis"] } },
    experiments: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      name: { type: "string" }, duration: { type: "string" }, target: { type: "string" },
      protocol: strings, successCriteria: strings, stopCriteria: strings
    }, required: ["name", "duration", "target", "protocol", "successCriteria", "stopCriteria"] } },
    immediateDecisions: strings,
    missingData: strings,
    limitations: strings
  },
  required: ["decisionLabel", "executiveSummary", "decisionRationale", "confidence", "evidence", "optionsComparison", "financialModel", "risks", "roadmap", "experiments", "immediateDecisions", "missingData", "limitations"]
} as const;

export function buildStrategicReportPrompt(debate: Debate): string {
  const payload = {
    question: debate.question,
    context: debate.context ?? "",
    rounds: debate.rounds.map(round => ({
      round: round.round,
      architect: round.architect,
      redTeam: round.redTeam,
      judge: round.judge,
      evidenceAudit: round.evidenceAudit ?? null,
      quantitativeAudit: round.quantitativeAudit ?? null
    })),
    finalDecision: debate.finalDecision ? {
      status: debate.finalDecision.status,
      winner: debate.finalDecision.winner,
      decision: debate.finalDecision.decision,
      rationale: debate.finalDecision.rationale,
      confidence: debate.finalDecision.confidence,
      risks: debate.finalDecision.risks,
      tests: debate.finalDecision.tests,
      reversalConditions: debate.finalDecision.reversalConditions,
      architectScore: debate.finalDecision.architectScore,
      redTeamScore: debate.finalDecision.redTeamScore
    } : null
  };
  return "QUESTION ET CONTEXTE :\n" + debate.question + "\n\nDONNÉES DU DÉBAT :\n" +
    JSON.stringify(payload, null, 2) +
    "\n\nProduis un rapport de décision stratégique complet, substantiel et exploitable, dans le style d'une note de comité d'investissement. " +
    "Le rapport doit être comparable à une analyse professionnelle comprenant synthèse exécutive, verdict explicite, preuves, comparaison des options, modèle financier, scénarios, économie unitaire, risques, feuille de route, expérimentation et décisions immédiates. " +
    "Ne répète pas simplement les tours : transforme-les en analyse structurée, hiérarchisée et actionnable. " +
    "RÈGLES DE PREUVE : les seules références disponibles sont celles présentes dans les données fournies. N'invente aucun lien, organisme, étude, citation, source ou donnée externe. Une affirmation sans référence doit être classée comme hypothèse ou non vérifiée. " +
    "RÈGLES FINANCIÈRES : n'invente aucun chiffre, prix, coût, taux, volume, revenu, CAC, LTV ou résultat. Reprends les chiffres explicitement fournis. Une valeur inconnue doit être null et son statut doit être unknown. Les scénarios qualitatifs restent possibles avec des valeurs numériques nulles. Tout chiffre calculé doit être une opération arithmétique directe sur des valeurs fournies et doit être expliqué. Les hypothèses de travail explicitement proposées par l'utilisateur doivent être identifiées comme telles, jamais comme des observations. " +
    "DÉCISION : choisis obligatoirement GO, CONDITIONAL_GO ou NO_GO. Si les données sont insuffisantes, choisis CONDITIONAL_GO ou NO_GO selon les éléments disponibles et précise les conditions vérifiables, plutôt que de produire une conclusion indéterminée. " +
    "Distingue clairement faits, hypothèses, opinions, inconnues et limites. Présente les risques les plus dangereux, des indicateurs précoces, des critères de réussite et d'arrêt. " +
    "Langue obligatoire : français exclusivement, style professionnel, précis et accessible. Aucun texte narratif en anglais. Retourne uniquement le JSON conforme au schéma.";
}

export async function generateStrategicReport(debate: Debate): Promise<StrategicReport> {
  if (!debate.finalDecision || debate.status === "running") {
    throw new Error("Le rapport stratégique ne peut être produit qu'après la fin du débat.");
  }
  const provider = debate.config?.judge.provider ?? "openai";
  const model = debate.config?.judge.model ?? "gpt-4.1-mini";
  return callModel<StrategicReport>({
    provider, model,
    schemaName: "strategic_report",
    schema: reportSchema,
    system: "Tu es le rédacteur indépendant des rapports stratégiques AFE-CI Debate Engine. Tu transformes les résultats d'un débat contradictoire en rapport professionnel de décision. Tu respectes strictement les preuves et les limites des données. " +
      "Ne récompense pas l'éloquence, ne crée pas de consensus artificiel et ne transforme jamais une hypothèse en fait. Le rapport doit être approfondi, cohérent, lisible et directement exploitable par un dirigeant."
      ,
    prompt: buildStrategicReportPrompt(debate)
  });
}
