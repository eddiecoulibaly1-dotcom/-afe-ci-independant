import type { ArbitrationResult } from "./arbitration.js";
import type { AssessedRisk } from "./risk-engine.js";
import type { Scenario } from "./scenario-engine.js";
export interface DecisionReportInput {
  title: string;
  question: string;
  executiveSummary: string;
  arbitration: ArbitrationResult;
  scenarios: Scenario[];
  risks: AssessedRisk[];
  evidenceLimitations: string[];
  actionPlan: string[];
}
export interface DecisionReport extends DecisionReportInput {
  generatedAt: string;
  status: "complete" | "provisional";
}
export function buildDecisionReport(input: DecisionReportInput): DecisionReport {
  if (!input.title.trim() || !input.question.trim()) throw new Error("REPORT_TITLE_AND_QUESTION_REQUIRED");
  const provisional = input.arbitration.verdict === "indeterminate" ||
    input.arbitration.verdict === "favorable_with_conditions" ||
    input.evidenceLimitations.length > 0;
  return { ...input, generatedAt: new Date().toISOString(), status: provisional ? "provisional" : "complete" };
}
