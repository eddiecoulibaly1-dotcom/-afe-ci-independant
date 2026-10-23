export type Provider = "openai" | "gemini";
export type AgentRole = "architect" | "red_team" | "judge";
export type DecisionStatus = "revise" | "converged" | "unresolved";

export interface Claim {
  id: string;
  statement: string;
  type: "fact" | "hypothesis" | "opinion";
  confidence: number;
  evidenceRequired: boolean;
}

export interface Proposal {
  position: string;
  claims: Claim[];
  assumptions: string[];
  risks: string[];
  alternatives: string[];
  scoreExpected: number;
  nextTests: string[];
}

export interface Attack {
  claimId?: string;
  severity: "low" | "medium" | "high" | "critical";
  argument: string;
  evidenceNeeded: string[];
  counterproposal?: string;
  confidence: number;
}

export interface Critique {
  verdict: "challenge" | "accept" | "mixed";
  attacks: Attack[];
  strongestAlternative?: string;
  unresolvedQuestions: string[];
}

export interface JudgeDecision {
  status: DecisionStatus;
  winner: "architect" | "red_team" | "neither";
  architectScore: number;
  redTeamScore: number;
  acceptedClaims: string[];
  rejectedClaims: string[];
  criticalDisagreements: string[];
  decision: string;
  rationale: string[];
  nextRoundObjective?: string;
}

export interface DebateRound {
  round: number;
  architect: Proposal;
  redTeam: Critique;
  judge: JudgeDecision;
  createdAt: string;
}

export interface Debate {
  id: string;
  question: string;
  context?: string;
  status: "running" | "converged" | "unresolved";
  rounds: DebateRound[];
  finalDecision?: JudgeDecision;
  config?: DebateConfig;
}

export interface DebateConfig {
  maxRounds: number;
  convergenceScore: number;
  architect: { provider: Provider; model: string };
  redTeam: { provider: Provider; model: string };
  judge: { provider: Provider; model: string };
}
