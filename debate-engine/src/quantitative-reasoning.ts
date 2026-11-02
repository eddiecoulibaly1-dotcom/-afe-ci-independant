/**
 * Debate Engine V2.1 — Quantitative Reasoning Orchestrator
 *
 * Deterministic bridge between model-proposed inputs and decision calculations.
 * The model may propose values, but only this module computes financial outputs.
 */

import {
  calculateOptionEconomics,
  compareEconomics,
  type EvidenceKind,
  type QuantitativeOptionInput,
  type QuantitativeResult
} from "./decision-intelligence.js";

export type QuantitativeValue = number | null;

export interface QuantitativeOptionDraft {
  label: string;
  startingUnits: QuantitativeValue;
  purchaseCostPerUnit: QuantitativeValue;
  feedCostPerUnit: QuantitativeValue;
  healthCostPerUnit: QuantitativeValue;
  laborAndOverhead: QuantitativeValue;
  infrastructureCost: QuantitativeValue;
  otherCosts: QuantitativeValue;
  mortalityRate: QuantitativeValue;
  salePricePerUnit: QuantitativeValue;
  extraRevenue?: QuantitativeValue;
  cycleDays?: QuantitativeValue;
  evidence?: Partial<Record<keyof Omit<QuantitativeOptionInput, "label" | "evidence">, EvidenceKind>>;
}

export interface QuantitativeAudit {
  applicable: boolean;
  status: "not_applicable" | "incomplete" | "calculated";
  options: Array<{
    label: string;
    result: QuantitativeResult | null;
    missingInputs: string[];
  }>;
  comparison: ReturnType<typeof compareEconomics> | null;
  instructions: string[];
}

const REQUIRED_FIELDS: Array<[keyof QuantitativeOptionDraft, string]> = [
  ["startingUnits", "nombre initial de sujets"],
  ["purchaseCostPerUnit", "coût d'achat unitaire"],
  ["feedCostPerUnit", "coût alimentaire unitaire"],
  ["healthCostPerUnit", "coût sanitaire unitaire"],
  ["laborAndOverhead", "main-d'œuvre et frais généraux"],
  ["infrastructureCost", "coût des infrastructures"],
  ["otherCosts", "autres coûts"],
  ["mortalityRate", "taux de mortalité"],
  ["salePricePerUnit", "prix de vente unitaire"]
];

function toCalculatorInput(draft: QuantitativeOptionDraft): QuantitativeOptionInput {
  const value = (key: keyof QuantitativeOptionDraft): number =>
    typeof draft[key] === "number" ? draft[key] as number : Number.NaN;
  return {
    label: draft.label,
    startingUnits: value("startingUnits"),
    purchaseCostPerUnit: value("purchaseCostPerUnit"),
    feedCostPerUnit: value("feedCostPerUnit"),
    healthCostPerUnit: value("healthCostPerUnit"),
    laborAndOverhead: value("laborAndOverhead"),
    infrastructureCost: value("infrastructureCost"),
    otherCosts: value("otherCosts"),
    mortalityRate: value("mortalityRate"),
    salePricePerUnit: value("salePricePerUnit"),
    extraRevenue: typeof draft.extraRevenue === "number" ? draft.extraRevenue : 0,
    cycleDays: typeof draft.cycleDays === "number" ? draft.cycleDays : undefined,
    evidence: draft.evidence as Record<string, EvidenceKind> | undefined
  };
}

export function buildQuantitativeAudit(
  drafts: QuantitativeOptionDraft[] | undefined,
  applicable: boolean
): QuantitativeAudit {
  if (!applicable || !drafts?.length) {
    return {
      applicable,
      status: "not_applicable",
      options: [],
      comparison: null,
      instructions: applicable
        ? ["Le sujet appelle une comparaison chiffrée, mais aucune option chiffrée n'a été fournie."]
        : []
    };
  }

  const options = drafts.map(draft => {
    const missingInputs = REQUIRED_FIELDS
      .filter(([key]) => typeof draft[key] !== "number" || !Number.isFinite(draft[key] as number))
      .map(([, label]) => label);
    const result = calculateOptionEconomics(toCalculatorInput(draft));
    return {
      label: draft.label,
      result: missingInputs.length ? null : result,
      missingInputs: [...new Set([...missingInputs, ...result.missingInputs])]
    };
  });

  const complete = options.every(option => option.result !== null);
  const comparison = complete && options.length === 2
    ? compareEconomics(options[0].result!, options[1].result!)
    : null;

  const instructions = complete
    ? [
        "Les résultats ci-dessous ont été calculés par le moteur ; ne les recalculez pas à partir d'estimations implicites.",
        "La Red Team doit vérifier les hypothèses, les unités, les coûts oubliés et la sensibilité des résultats.",
        "L'Arbitre doit distinguer le résultat mathématique de la fiabilité des données d'entrée."
      ]
    : [
        "Ne déclarez aucun gagnant économique tant que les variables obligatoires ne sont pas renseignées pour toutes les options.",
        "Listez les données manquantes et proposez la manière la plus rapide de les obtenir.",
        "Ne remplacez jamais une donnée absente par zéro ni par une valeur inventée."
      ];

  return {
    applicable: true,
    status: complete ? "calculated" : "incomplete",
    options,
    comparison,
    instructions
  };
}

export function quantitativePromptGuidance(): string {
  return `RAISONNEMENT QUANTITATIF OBLIGATOIRE
- Détermine si la question exige une comparaison chiffrée.
- Si oui, identifie les options et fournis les variables disponibles dans un bloc quantitativeOptions structuré.
- Pour chaque variable, indique une valeur numérique uniquement si elle est explicitement présente dans le contexte ou une preuve consultable ; sinon utilise null.
- Associe à chaque valeur son statut de preuve : verified, estimate ou assumption. Ne présente jamais une estimation comme un prix observé.
- Précise toujours la devise, l'unité, la période et la géographie dans les hypothèses ou les éléments de contexte.
- N'invente aucun prix, coût, volume, taux de mortalité, rendement ou délai.
- Le moteur calcule les résultats ; ne fabrique pas de résultat net, de marge ou de ROI.`;
}

/** A quantitative debate cannot name an economic winner without two complete calculated options. */
export function canDeclareEconomicWinner(audit: QuantitativeAudit): boolean {
  return audit.applicable && audit.status === "calculated" && audit.comparison !== null &&
    audit.comparison.winner !== "indeterminate";
}
