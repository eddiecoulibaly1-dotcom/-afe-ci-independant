/**
 * AFE-CI Debate Engine — auditable compliance gates.
 * Pure deterministic controls; these gates never invent evidence or select a winner.
 */
export type EvidenceStatus = "verified" | "partially_verified" | "pending_verification" | "contested" | "rejected" | "unsupported";
export interface EvidenceSourceInput {
  id: string; url: string; domain: string; sourceClass: string;
  contentRetrieved: boolean; publishedAt?: string | null; retrievedAt?: string | null;
  supportsClaim?: boolean; excerpt?: string | null;
}
export interface ClaimEvidenceInput { id: string; statement: string; impact: "low"|"medium"|"high"|"critical"; sources: EvidenceSourceInput[]; }
export interface EvidenceFinding { claimId: string; status: EvidenceStatus; independentDomains: number; hasInstitutionalSource: boolean; reasons: string[]; }
export interface ArgumentInput { id: string; text: string; kind: "claim"|"evidence"|"refutation"|"analysis"|"consequence"|"revision"; }
export interface NoveltyFinding { argumentId: string; duplicateOf: string|null; similarity: number; novel: boolean; }
export interface ConvergenceInput { score: number; threshold?: number; criticalObjections: number; unsupportedCriticalClaims: number; pendingCriticalClaims: number; roundsWithNovelContribution: number; minimumRounds?: number; }
export interface ConvergenceFinding { eligible: boolean; score: number; threshold: number; blockers: string[]; }
export interface ReportAuditInput {
  executiveSummary?: string; decisionRationale?: string; evidenceCount?: number;
  unresolvedObjections?: number; optionsCount?: number; risksCount?: number;
  financialLimitations?: string[]; citations?: Array<{url:string;claim:string;status:string}>;
}
const normalize=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const tokens=(s:string)=>new Set(normalize(s).split(/\s+/).filter(x=>x.length>2));
export function textSimilarity(a:string,b:string):number {
  const aa=tokens(a),bb=tokens(b); if(!aa.size||!bb.size)return 0;
  let intersection=0; for(const t of aa)if(bb.has(t))intersection++;
  return intersection/(aa.size+bb.size-intersection);
}
export function auditClaimEvidence(claims:ClaimEvidenceInput[]):EvidenceFinding[] {
  return claims.map(claim=>{
    const usable=claim.sources.filter(s=>s.contentRetrieved&&/^https:\/\//i.test(s.url)&&s.supportsClaim!==false&&Boolean(s.excerpt?.trim()));
    const domains=new Set(usable.map(s=>s.domain.toLowerCase()).filter(Boolean));
    const institutional=usable.some(s=>["official","government","international","institutional"].includes(s.sourceClass));
    const reasons:string[]=[];
    if(!claim.sources.length)reasons.push("Aucune source associée.");
    if(usable.length!==claim.sources.length)reasons.push("Au moins une source n'a pas été ouverte ou ne contient pas d'extrait probant.");
    if(domains.size<2)reasons.push("Moins de deux domaines indépendants exploitables.");
    if(!institutional)reasons.push("Aucune source institutionnelle ou internationale exploitable.");
    const contradicted=claim.sources.some(s=>s.contentRetrieved&&s.supportsClaim===false);
    const status:EvidenceStatus=contradicted?"contested":usable.length===0?"pending_verification":domains.size>=2&&institutional&&usable.length===claim.sources.length?"verified":"partially_verified";
    return {claimId:claim.id,status,independentDomains:domains.size,hasInstitutionalSource:institutional,reasons};
  });
}
export function auditNovelty(previous:ArgumentInput[], current:ArgumentInput[], threshold=0.82):NoveltyFinding[] {
  return current.map(arg=>{
    let bestId:string|null=null,best=0;
    for(const old of previous){const sim=textSimilarity(arg.text,old.text);if(sim>best){best=sim;bestId=old.id;}}
    return {argumentId:arg.id,duplicateOf:best>=threshold?bestId:null,similarity:Number(best.toFixed(3)),novel:best<threshold};
  });
}
export function evaluateConvergence(input:ConvergenceInput):ConvergenceFinding {
  const threshold=input.threshold??85, minimumRounds=input.minimumRounds??2, blockers:string[]=[];
  if(!Number.isFinite(input.score)||input.score<threshold)blockers.push(`Score de convergence inférieur au seuil requis (${threshold}/100).`);
  if(input.criticalObjections>0)blockers.push(`${input.criticalObjections} objection(s) critique(s) non résolue(s).`);
  if(input.unsupportedCriticalClaims>0)blockers.push(`${input.unsupportedCriticalClaims} affirmation(s) critique(s) non étayée(s).`);
  if(input.pendingCriticalClaims>0)blockers.push(`${input.pendingCriticalClaims} affirmation(s) critique(s) encore en attente de vérification.`);
  if(input.roundsWithNovelContribution<minimumRounds)blockers.push("Progression insuffisante : nombre minimal de rounds avec contribution nouvelle non atteint.");
  return {eligible:blockers.length===0,score:input.score,threshold,blockers};
}
export function auditStrategicReport(input:ReportAuditInput):{complete:boolean;missing:string[];warnings:string[]} {
  const missing:string[]=[],warnings:string[]=[];
  if(!input.executiveSummary?.trim())missing.push("Synthèse exécutive absente.");
  if(!input.decisionRationale?.trim())missing.push("Justification de la décision absente.");
  if(!input.optionsCount)missing.push("Comparaison des options absente.");
  if(!input.risksCount)missing.push("Registre des risques absent.");
  if(!input.evidenceCount)missing.push("Aucune preuve enregistrée.");
  if((input.unresolvedObjections??0)>0)warnings.push(`${input.unresolvedObjections} objection(s) restent ouvertes.`);
  if((input.financialLimitations??[]).length)warnings.push("L'analyse financière comporte des limites : aucune rentabilité ne doit être présentée comme démontrée.");
  for(const citation of input.citations??[])if(!/^https:\/\//i.test(citation.url)||!citation.claim.trim())warnings.push("Citation invalide ou non reliée à une affirmation.");
  return {complete:missing.length===0,missing,warnings};
}
