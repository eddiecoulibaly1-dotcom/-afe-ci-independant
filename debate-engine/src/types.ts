export type Provider = "openai" | "gemini";
export type AgentRole = "architect" | "red_team" | "judge";
export type DecisionStatus = "revise" | "converged" | "unresolved";

export type ScoreDimension =
  | "buyerValue" | "sellerValue" | "coteDIvoireFit" | "marketplaceLiquidity"
  | "differentiation" | "trustFraud" | "technicalFeasibility" | "acquisition" | "monetization";

export interface Scorecard { buyerValue:number; sellerValue:number; coteDIvoireFit:number; marketplaceLiquidity:number; differentiation:number; trustFraud:number; technicalFeasibility:number; acquisition:number; monetization:number; }
export interface Claim { id:string; statement:string; type:"fact"|"hypothesis"|"opinion"; confidence:number; evidenceRequired:boolean; evidenceRefs?:string[]; }
export interface Proposal { position:string; claims:Claim[]; assumptions:string[]; risks:string[]; alternatives:string[]; scoreExpected:number; nextTests:string[]; }
export interface Attack { claimId?:string; severity:"low"|"medium"|"high"|"critical"; argument:string; evidenceNeeded:string[]; counterproposal?:string; confidence:number; }
export interface Critique { verdict:"challenge"|"accept"|"mixed"; attacks:Attack[]; strongestAlternative?:string; unresolvedQuestions:string[]; }
export interface EvidenceRecord { claimId:string; classification:"fact"|"hypothesis"|"opinion"; status:"supported"|"unsupported"|"not_required"; evidenceRefs:string[]; rationale:string; confidence:number; impact:"low"|"medium"|"high"|"critical"; }
export interface EvidenceAudit { records:EvidenceRecord[]; unsupportedCriticalClaims:string[]; unsupportedHighImpactClaims:string[]; confidence:number; blocking:boolean; nextTests:string[]; }
export interface JudgeDecision { status:DecisionStatus; winner:"architect"|"red_team"|"neither"; architectScore:number; redTeamScore:number; architectScorecard:Scorecard; redTeamScorecard:Scorecard; acceptedClaims:string[]; rejectedClaims:string[]; criticalDisagreements:string[]; decision:string; rationale:string[]; nextRoundObjective?:string; evidenceAudit?:EvidenceAudit; }
export interface DebateRound { round:number; architect:Proposal; redTeam:Critique; judge:JudgeDecision; evidenceAudit?:EvidenceAudit; createdAt:string; }
export interface Debate { id:string; userId?:string; question:string; context?:string; status:"running"|"converged"|"unresolved"; rounds:DebateRound[]; finalDecision?:JudgeDecision; config?:DebateConfig; }
export interface DebateConfig { maxRounds:number; convergenceScore:number; architect:{provider:Provider;model:string}; redTeam:{provider:Provider;model:string}; judge:{provider:Provider;model:string}; }
