import type { AuditFinding, EvidenceArtifact } from "./evidence.js";
import type { Contribution, Deliberation } from "./deliberation.js";
export type ArbitrationDecision={findingId:string;decision:"upheld"|"partially_upheld"|"rejected"|"unresolved";rationale:string;evidenceIds:string[];dissent:string[]};
export type ArbitrationReport={deliberationId:string;workspaceId:string;status:"proposed"|"human_review_required";decisions:ArbitrationDecision[];unresolvedDisagreements:string[];limitations:string[];humanApprovalRequired:true;createdAt:string};
export function buildArbitration(input:{deliberation:Deliberation;findings:AuditFinding[];evidence:ReadonlyMap<string,EvidenceArtifact>;decisions:ArbitrationDecision[];limitations?:string[]},now=new Date()):ArbitrationReport{
 const d=input.deliberation;
 if(d.status!=="arbitrating")throw new Error("Deliberation must be in arbitration state.");
 const contributionIds=new Set(d.contributions.map(c=>c.id));
 for(const decision of input.decisions){
  if(!input.findings.some(f=>f.id===decision.findingId))throw new Error("Arbitration references unknown finding.");
  if(decision.evidenceIds.some(id=>!input.evidence.has(id)))throw new Error("Arbitration references unknown evidence.");
  if(!decision.rationale.trim())throw new Error("Every arbitration decision needs a rationale.");
 }
 const unresolved=input.decisions.filter(x=>x.decision==="unresolved").map(x=>x.findingId);
 const hasDissent=d.contributions.some(c=>c.kind==="objection"||c.kind==="rebuttal");
 return{deliberationId:d.id,workspaceId:d.workspaceId,status:"human_review_required",decisions:input.decisions,
  unresolvedDisagreements:unresolved,limitations:[...(input.limitations??[]),...(hasDissent?["Contradictions entre agents conservées; elles ne sont pas effacées par l'arbitrage."]:[])],
  humanApprovalRequired:true,createdAt:now.toISOString()};
}
