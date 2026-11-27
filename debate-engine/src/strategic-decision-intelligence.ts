export type DecisionAlternative = {
 id:string; title:string; description?:string; evidenceIds?:string[];
 impact?:number|null; risk?:number|null; urgency?:number|null; effort?:number|null;
 reversibility?:number|null; confidence?:number|null; dependencies?:string[];
};
export type DecisionEvidence = {id:string;kind:"warning"|"trend"|"risk"|"scenario"|"option"|"snapshot"|"mission"|"task";label:string;observedAt?:string|null;sourceId?:string|null;details?:string};
export type DecisionPackInput={workspaceId:string;question:string;scope?:string;generatedAt?:string;sourceEvidence?:DecisionEvidence[];assumptions?:string[];constraints?:string[];unknowns?:string[];alternatives:DecisionAlternative[];scenarioSet?:Array<{id:string;name:string;assumption:string;confidence?:number;impactByAlternative?:Record<string,number|null>}>};
const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const finite=(v:any):v is number=>typeof v==="number"&&Number.isFinite(v);
const bounded=(v:number|null|undefined,min=0,max=5)=>finite(v)?Math.max(min,Math.min(max,v)):null;
export function buildDecisionPack(input:DecisionPackInput){
 if(!input.workspaceId.trim())throw new Error("workspaceId requis");
 if(!input.question.trim())throw new Error("Question de décision requise");
 if(!Array.isArray(input.alternatives)||input.alternatives.length<2)throw new Error("Au moins deux alternatives sont requises");
 const ids=new Set<string>();for(const a of input.alternatives){if(!a.id.trim()||ids.has(a.id))throw new Error("Identifiants d’alternatives invalides ou dupliqués");ids.add(a.id);if(!a.title.trim())throw new Error("Titre d’alternative requis");}
 const evidenceIds=new Set((input.sourceEvidence??[]).map(e=>e.id));for(const a of input.alternatives)for(const eid of a.evidenceIds??[])if(!evidenceIds.has(eid))throw new Error("Référence de preuve inconnue: "+eid);
 const packId="decision:"+input.workspaceId+":"+input.question.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,64);
 const evidenceFreshness=(input.sourceEvidence??[]).map(e=>({id:e.id,observedAt:e.observedAt??null,ageDays:e.observedAt?Math.max(0,Math.floor((Date.parse(input.generatedAt??new Date().toISOString())-Date.parse(e.observedAt))/86400000)):null}));
 return {schemaVersion:1,id:packId,workspaceId:input.workspaceId,question:input.question.trim(),scope:input.scope??"Non précisé",generatedAt:input.generatedAt??new Date().toISOString(),evidence:[...(input.sourceEvidence??[])],evidenceFreshness,assumptions:[...(input.assumptions??[])],constraints:[...(input.constraints??[])],unknowns:[...(input.unknowns??[])],alternatives:input.alternatives.map(a=>({...a,dependencies:[...(a.dependencies??[])],evidenceIds:[...(a.evidenceIds??[])]})),scenarioSet:input.scenarioSet??[],governance:{approvalRequired:true,executionAuthorized:false,autoExecution:false,decisionAuthority:"DG"},warnings:(input.sourceEvidence??[]).length?[]:["Dossier sans preuve source: conclusions limitées aux hypothèses déclarées"]};
}
export type DecisionWeights={impact:number;risk:number;urgency:number;effort:number;reversibility:number;confidence:number};
const DEFAULT_WEIGHTS:DecisionWeights={impact:0.25,risk:0.2,urgency:0.2,effort:0.15,reversibility:0.1,confidence:0.1};
export function scoreAlternatives(alternatives:DecisionAlternative[],weights:Partial<DecisionWeights>={}){
 if(alternatives.length<2)throw new Error("Comparer au moins deux alternatives");
 const w={...DEFAULT_WEIGHTS,...weights};const sum=Object.values(w).reduce((a,b)=>a+b,0);if(!finite(sum)||sum<=0||Object.values(w).some(v=>!finite(v)||v<0))throw new Error("Pondérations invalides");
 const normalized=Object.fromEntries(Object.entries(w).map(([k,v])=>[k,v/sum]) as Array<[keyof DecisionWeights,number]>);
 return alternatives.map(a=>{const values={impact:bounded(a.impact),risk:bounded(a.risk),urgency:bounded(a.urgency),effort:bounded(a.effort),reversibility:bounded(a.reversibility),confidence:bounded(a.confidence)};let numerator=0,denominator=0;for(const[k,weight]of Object.entries(normalized) as Array<[keyof DecisionWeights,number]>){const v=values[k];if(v===null)continue;const utility=k==="risk"||k==="effort"?5-v:v;numerator+=utility*weight;denominator+=weight;}const score=denominator?Math.round((numerator/denominator)*20):null;return{id:a.id,title:a.title,score,coverage:Math.round(denominator*100),missing:Object.entries(values).filter(([,v])=>v===null).map(([k])=>k),values,rank:null as number|null};}).sort((a,b)=>(b.score??-1)-(a.score??-1)).map((x,i)=>({...x,rank:x.score===null?null:i+1}));
}
export function compareDecisionScenarios(pack:ReturnType<typeof buildDecisionPack>,scenarioIds?:string[]){
 const selected=scenarioIds?.length?pack.scenarioSet.filter(s=>scenarioIds.includes(s.id)):pack.scenarioSet;
 if(selected.length<2)throw new Error("Comparer au moins deux scénarios");
 const alternatives=pack.alternatives.map(a=>({id:a.id,title:a.title,results:selected.map(s=>({scenarioId:s.id,scenarioName:s.name,impact:s.impactByAlternative?.[a.id]??null,confidence:s.confidence??null,assumption:s.assumption})),averageImpact:selected.map(s=>s.impactByAlternative?.[a.id]).filter(finite).length?selected.map(s=>s.impactByAlternative?.[a.id]).filter(finite).reduce((a,b)=>a+b,0)/selected.map(s=>s.impactByAlternative?.[a.id]).filter(finite).length:null}));
 return {scenarioCount:selected.length,alternatives,limitations:["Impacts fournis par scénario; les valeurs absentes restent inconnues.","Comparaison indicative: les scénarios ne constituent pas des probabilités."],readOnly:true};
}
