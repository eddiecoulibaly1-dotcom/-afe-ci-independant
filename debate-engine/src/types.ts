import type { QuantitativeAudit, QuantitativeOptionDraft } from "./quantitative-reasoning.js";
import type { StrategicFinancialCalculation } from "./strategic-financial.js";
export type Provider = "openai" | "gemini";
export type AgentRole = "architect" | "red_team" | "judge";
export type DecisionStatus = "revise" | "converged" | "provisional" | "unresolved";

export type ScoreDimension =
  | "buyerValue" | "sellerValue" | "coteDIvoireFit" | "marketplaceLiquidity"
  | "differentiation" | "trustFraud" | "technicalFeasibility" | "acquisition" | "monetization";

export interface Scorecard { buyerValue:number; sellerValue:number; coteDIvoireFit:number; marketplaceLiquidity:number; differentiation:number; trustFraud:number; technicalFeasibility:number; acquisition:number; monetization:number; }
export interface Claim { id:string; statement:string; type:"fact"|"hypothesis"|"opinion"; confidence:number; evidenceRequired:boolean; evidenceRefs?:string[]; }
export interface Proposal { position:string; claims:Claim[]; assumptions:string[]; risks:string[]; alternatives:string[]; scoreExpected:number; nextTests:string[]; quantitativeOptions?:QuantitativeOptionDraft[]; }
export interface Attack { claimId?:string; severity:"low"|"medium"|"high"|"critical"; argument:string; evidenceNeeded:string[]; counterproposal?:string; confidence:number; }
export interface Critique { verdict:"challenge"|"accept"|"mixed"; attacks:Attack[]; strongestAlternative?:string; unresolvedQuestions:string[]; }
export interface EvidenceRecord { claimId:string; classification:"fact"|"hypothesis"|"opinion"; status:"supported"|"pending_verification"|"unsupported"|"not_required"; evidenceRefs:string[]; rationale:string; confidence:number; impact:"low"|"medium"|"high"|"critical"; }
export interface EvidenceAudit { records:EvidenceRecord[]; unsupportedCriticalClaims:string[]; unsupportedHighImpactClaims:string[]; pendingVerificationClaims?:string[]; confidence:number; blocking:boolean; nextTests:string[]; }
export interface StrategicReport {
  financialCalculations?: StrategicFinancialCalculation;
  decisionLabel: "GO" | "CONDITIONAL_GO" | "NO_GO";
  executiveSummary: string;
  decisionRationale: string;
  confidence: "high" | "moderate" | "low";
  evidence: { verified:string[]; hypotheses:string[]; unverified:string[]; gaps:string[]; references:Array<{claim:string;references:string[];status:"supported"|"unsupported"|"not_provided"}> };
  optionsComparison: Array<{option:string;strengths:string[];weaknesses:string[];assessment:string}>;
  financialModel: { currency:string; warning:string; assumptions:Array<{metric:string;value:number|null;unit:string;basis:"observed"|"provided"|"assumption"|"unknown";explanation:string}>; scenarios:Array<{name:string;horizon:string;activeUsers:number|null;monthlyRevenuePerActive:number|null;monthlyVariableCostPerActive:number|null;monthlyFixedCosts:number|null;operatingResult:number|null;conclusion:string}>; unitEconomics:string[]; limitations:string[] };
  risks: Array<{risk:string;severity:"critical"|"high"|"medium"|"low";earlyIndicators:string[];response:string}>;
  roadmap: Array<{period:string;objective:string;actions:string[];kpis:string[]}>;
  experiments: Array<{name:string;duration:string;target:string;protocol:string[];successCriteria:string[];stopCriteria:string[]}>;
  immediateDecisions:string[];
  missingData:string[];
  limitations:string[];
}
export interface JudgeDecision { strategicReport?:StrategicReport; status:DecisionStatus; winner:"architect"|"red_team"|"neither"; architectScore:number; redTeamScore:number; architectScorecard:Scorecard; redTeamScorecard:Scorecard; acceptedClaims:string[]; rejectedClaims:string[]; criticalDisagreements:string[]; decision:string; rationale:string[]; nextRoundObjective?:string; evidenceAudit?:EvidenceAudit; confidence?:"high"|"moderate"|"low"; risks?:string[]; tests?:string[]; reversalConditions?:string[]; }
export interface DebateRound { round:number; architect:Proposal; redTeam:Critique; redTeamCompleted?:boolean; judge:JudgeDecision; evidenceAudit?:EvidenceAudit; quantitativeAudit?:QuantitativeAudit; createdAt:string; }
export interface Debate { id:string; userId?:string; workspaceId?:string|null; question:string; context?:string; status:"running"|"converged"|"provisional"|"unresolved"; rounds:DebateRound[]; finalDecision?:JudgeDecision; config?:DebateConfig; }
export interface DebateConfig { maxRounds:number; convergenceScore:number; architect:{provider:Provider;model:string}; redTeam:{provider:Provider;model:string}; judge:{provider:Provider;model:string}; }
