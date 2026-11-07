import type { AuditFinding, EvidenceArtifact } from "./evidence.js";
import type { Contribution, Deliberation } from "./deliberation.js";
export type ArbitrationDecision={findingId:string;decision:"upheld"|"partially_upheld"|"rejected"|"unresolved";rationale:string;evidenceIds:string[];dissent:string[]};
export type ArbitrationReport={deliberationId:string;workspaceId:string;status:"proposed"|"human_review_required";decisions:ArbitrationDecision[];unresolvedDisagreements:string[];limitations:string[];humanApprovalRequired:true;createdAt:string};
export function buildArbitration(input:{deliberation:Deliberation;findings:AuditFinding[];evidence:ReadonlyMap<string,EvidenceArtifact>;decisions:ArbitrationDecision[];limitations?:string[];status?:"proposed"|"human_review_required"},now=new Date()):ArbitrationReport{
 const d=input.deliberation;
 if(d.status!=="arbitrating")throw new Error("Deliberation must be in arbitration state.");
 const seen=new Set<string>();
 for(const decision of input.decisions){
  const finding=input.findings.find(f=>f.id===decision.findingId);
  if(!finding)throw new Error("Arbitration references unknown finding.");
  if(seen.has(decision.findingId))throw new Error("Arbitration must contain exactly one decision per finding.");
  seen.add(decision.findingId);
  if(decision.evidenceIds.some(id=>!input.evidence.has(id)))throw new Error("Arbitration references unknown evidence.");
  if(decision.evidenceIds.some(id=>!finding.evidenceIds.includes(id)))throw new Error("Arbitration evidence must be linked to the finding being decided.");
  if(!decision.rationale.trim())throw new Error("Every arbitration decision needs a rationale.");
 }
 if(input.findings.some(f=>!seen.has(f.id)))throw new Error("Arbitration is missing a decision for one or more findings.");
 const unresolved=input.decisions.filter(x=>x.decision==="unresolved").map(x=>x.findingId);
 const hasDissent=d.contributions.some(c=>c.kind==="objection"||c.kind==="rebuttal");
 return{deliberationId:d.id,workspaceId:d.workspaceId,status:input.status??"human_review_required",decisions:input.decisions,
  unresolvedDisagreements:unresolved,limitations:[...(input.limitations??[]),...(hasDissent?["Contradictions entre agents conservées; elles ne sont pas effacées par l'arbitrage."]:[])],
  humanApprovalRequired:true,createdAt:now.toISOString()};
}
