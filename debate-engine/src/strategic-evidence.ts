import type { Debate, Claim } from "./types.js";
export interface StrategicEvidenceSummary {
  verified: string[];
  hypotheses: string[];
  unverified: string[];
  gaps: string[];
  references: Array<{claim:string;references:string[];status:"pending_verification"|"unsupported"|"not_provided"}>;
}
export function buildStrategicEvidenceSummary(debate: Debate): StrategicEvidenceSummary {
  const claims: Claim[] = debate.rounds.flatMap(round => round.architect.claims ?? []);
  const unique = new Map<string,Claim>();
  for (const claim of claims) unique.set(claim.id + ":" + claim.statement, claim);
  const values=[...unique.values()];
  const hypotheses=values.filter(c=>c.type==="hypothesis").map(c=>c.statement);
  const factual=values.filter(c=>c.type==="fact");
  const unverified=factual.map(c=>c.statement);
  const references=factual.map(c=>{
    const refs=(c.evidenceRefs??[]).filter(Boolean);
    return {claim:c.statement,references:refs,status:refs.length?"pending_verification" as const:"unsupported" as const};
  });
  const gaps=references.filter(r=>r.status!=="pending_verification").map(r=>"Référence absente pour : "+r.claim);
  if(references.some(r=>r.status==="pending_verification"))gaps.push("Les références déclarées doivent être ouvertes, datées et contrôlées indépendamment ; leur simple présence ne constitue pas une vérification.");
  if(!values.length)gaps.push("Aucune affirmation structurée n'a été enregistrée par les agents.");
  return {verified:[],hypotheses,unverified,gaps,references};
}
