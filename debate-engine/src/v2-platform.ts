import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDebate, listDebates, saveDebate } from "./store.js";
import { getWorkspace } from "./workspace-store.js";
import { listDebateExecutionSteps } from "./supabase-store.js";
import { routeDecision } from "./decision-router.js";
import { selectAgents } from "./agent-registry.js";
import { buildScenarios } from "./scenario-engine.js";
import { assessRisks } from "./risk-engine.js";
import { arbitrateDecision } from "./arbitration.js";
import { buildDecisionReport } from "./report-engine.js";
import type { Debate, DebateConfig } from "./types.js";

type Actor = { id: string; email?: string };
type EventRow = { id: string; debate_id: string; event_type: string; actor: string; payload: Record<string, any>; created_at: string };
type EvidenceItem = { id: string; claim: string; sourceName: string; url: string; excerpt?: string; qualityScore?: number; materiality: "low"|"medium"|"high"|"critical"; status: string; checkedAt?: string; httpStatus?: number; limitations?: string[] };
type Metric = { score: number|null; numerator: number; denominator: number; label: string; limitations: string[] };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c] ?? ""));
const json = (v: unknown) => JSON.stringify(v);
function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" });
  res.end(json(data));
}
function config(): DebateConfig {
  const provider = (v: string|undefined): "openai"|"gemini" => v === "gemini" ? "gemini" : "openai";
  const model = (p: "openai"|"gemini") => p === "gemini" ? (process.env.GEMINI_MODEL || "gemini-3.8-flash") : (process.env.OPENAI_MODEL || "gpt-4.1-mini");
  const a=provider(process.env.ARCHITECT_PROVIDER), r=provider(process.env.RED_TEAM_PROVIDER || "gemini"), j=provider(process.env.JUDGE_PROVIDER);
  return { maxRounds:3, convergenceScore:85, architect:{provider:a,model:model(a)}, redTeam:{provider:r,model:model(r)}, judge:{provider:j,model:model(j)} };
}
function supaConfig() {
  const url=process.env.SUPABASE_URL?.replace(/\/$/,"");
  const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("Supabase serveur non configuré.");
  return {url,key};
}
async function db<T>(path:string, init:RequestInit={}):Promise<T> {
  const c=supaConfig();
  const r=await fetch(c.url+"/rest/v1/"+path,{...init,headers:{apikey:c.key,Authorization:"Bearer "+c.key,"Content-Type":"application/json",...(init.headers??{})}});
  const t=await r.text();
  if(!r.ok) throw new Error("Supabase "+r.status+": "+t.slice(0,400));
  return t ? JSON.parse(t) as T : undefined as T;
}
async function addEvent(debateId:string, actor:string, type:string, payload:Record<string,any>) {
  const event={id:randomUUID(),occurredAt:new Date().toISOString(),...payload};
  await db("debate_events",{method:"POST",headers:{Prefer:"return=minimal"},body:json({debate_id:debateId,event_type:type,actor,payload:event})});
  return event;
}
async function events(debateId:string):Promise<EventRow[]> {
  return db<EventRow[]>("debate_events?select=id,debate_id,event_type,actor,payload,created_at&debate_id=eq."+encodeURIComponent(debateId)+"&order=created_at.asc&limit=1000");
}
async function body(req:IncomingMessage):Promise<any> {
  let raw="";
  for await(const chunk of req) { raw+=chunk; if(Buffer.byteLength(raw)>500_000) throw new Error("Corps de requête trop volumineux."); }
  try { return JSON.parse(raw||"{}"); } catch { throw new Error("JSON invalide."); }
}
function metric(label:string, values:number[], denominator:number, limitations:string[]=[]):Metric {
  if(!denominator) return {score:null,numerator:0,denominator:0,label,limitations:[...limitations,"Aucune observation exploitable."]};
  const numerator=values.length;
  return {score:Math.round(values.reduce((a,b)=>a+b,0)/denominator*100)/100,numerator,denominator,label,limitations};
}
export function calculateV2Quality(input:{claims:any[];evidence:EvidenceItem[];falsifications:any[];scenarioRatings:number[];outcomes:any[];approval:any|null;criticalIssues:string[]}){
  const claims=input.claims.filter(c=>c?.materiality!=="low");
  const evidenceCoverage=metric("Couverture des affirmations matérielles",claims.filter(c=>Array.isArray(c.evidenceRefs)&&c.evidenceRefs.length>0).map(()=>100),claims.length);
  const verified=input.evidence.filter(e=>["content_checked","corroborated"].includes(e.status));
  const sourceVerification=metric("Accessibilité des sources",verified.map(()=>100),input.evidence.length,["Une URL accessible n'est pas une confirmation sémantique du contenu."]);
  const tested=input.falsifications.filter(x=>["tested","refuted","not_falsified"].includes(x.status));
  const falsificationCoverage=metric("Couverture des tests de réfutation",tested.map(()=>100),input.falsifications.length);
  const scenarioRobustness=input.scenarioRatings.length?metric("Robustesse des scénarios",input.scenarioRatings,input.scenarioRatings.length):{score:null,numerator:0,denominator:0,label:"Robustesse des scénarios",limitations:["Aucune évaluation comparative des options dans les scénarios."]};
  const resolved=input.criticalIssues.length===0?100:0;
  const reasoningIntegrity={score:input.claims.length?Math.max(0,100-input.criticalIssues.length*15):null,numerator:Math.max(0,input.claims.length-input.criticalIssues.length),denominator:input.claims.length,label:"Intégrité du raisonnement",limitations:input.claims.length?[]:["Aucune affirmation extraite."]};
  const governanceCompleteness={score:input.approval?100:0,numerator:input.approval?1:0,denominator:1,label:"Complétude de gouvernance",limitations:input.approval?[]:["Approbation humaine non enregistrée."]};
  const scored=input.outcomes.filter(o=>typeof o.probability==="number"&&typeof o.observed==="number"&&(o.observed===0||o.observed===1));
  const brier=scored.length?scored.reduce((s,o)=>s+Math.pow(o.probability-o.observed,2),0)/scored.length:null;
  const outcomeCalibration={score:brier===null?null:Math.round((1-brier)*10000)/100,numerator:scored.length,denominator:input.outcomes.length,label:"Calibration des résultats (1 − Brier)",limitations:brier===null?["Aucun résultat binaire associé à une probabilité préalable."]:[]};
  const ratedEvidence=input.evidence.filter(e=>typeof e.qualityScore==="number"&&Number.isFinite(e.qualityScore)&&e.qualityScore>=0&&e.qualityScore<=100);
  const evidenceReliability=ratedEvidence.length?Math.round(ratedEvidence.reduce((sum,e)=>sum+(e.qualityScore??0),0)/ratedEvidence.length*100)/100:null;
  const decisionRobustness=scenarioRobustness.score;
  const qualityParts=[evidenceCoverage.score,sourceVerification.score,falsificationCoverage.score,scenarioRobustness.score,reasoningIntegrity.score,governanceCompleteness.score].filter((x):x is number=>x!==null);
  const decisionQuality=qualityParts.length>=4?Math.round(qualityParts.reduce((a,b)=>a+b,0)/qualityParts.length*100)/100:null;
  return {version:"2.0.0",evidenceCoverage,sourceVerification,falsificationCoverage,scenarioRobustness,reasoningIntegrity,governanceCompleteness,outcomeCalibration,evidenceReliabilityScore:evidenceReliability,decisionRobustnessScore:decisionRobustness,decisionQualityScore:decisionQuality,qualityPartsAvailable:qualityParts.length,qualityPartsRequired:4,criticalIssues:input.criticalIssues,warning:"Ces indicateurs mesurent la couverture des éléments enregistrés. Ils ne prouvent ni la vérité d'une affirmation ni la qualité réelle d'une décision sans évaluation indépendante."};
}
function privateAddress(address:string):boolean {
  if(isIP(address)===4){const p=address.split(".").map(Number);return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127);}
  const a=address.toLowerCase();return a==="::1"||a==="::"||a.startsWith("fc")||a.startsWith("fd")||a.startsWith("fe80")||a.startsWith("::ffff:127.")||a.startsWith("::ffff:10.");
}
async function checkSource(urlText:string,excerpt?:string):Promise<{status:string;httpStatus?:number;checkedAt:string;limitations:string[]}> {
  const checkedAt=new Date().toISOString();
  let url:URL;
  try { url=new URL(urlText); } catch { return {status:"rejected",checkedAt,limitations:["URL invalide."]}; }
  if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443"||url.hostname==="localhost"||url.hostname.endsWith(".local")||url.hostname.endsWith(".internal")) return {status:"rejected",checkedAt,limitations:["Seules les URL HTTPS publiques sans identifiants ni port non standard sont autorisées."]};
  try {
    const addresses=isIP(url.hostname)?[url.hostname]:(await lookup(url.hostname,{all:true,verbatim:true})).map(x=>x.address);
    if(!addresses.length||addresses.some(privateAddress)) return {status:"rejected",checkedAt,limitations:["Hôte privé, local ou non résolu : requête bloquée."]};
    const response=await fetch(url.toString(),{method:"GET",redirect:"manual",signal:AbortSignal.timeout(8000),headers:{"User-Agent":"AFE-CI-Evidence-Check/2.0","Range":"bytes=0-65535"}});
    if(response.status>=300&&response.status<400) return {status:"redirect_review",httpStatus:response.status,checkedAt,limitations:["Redirection non suivie automatiquement ; vérifier la destination séparément."]};
    if(!response.ok) return {status:"unavailable",httpStatus:response.status,checkedAt,limitations:["La source n'a pas répondu avec un statut HTTP de succès."]};
    if(!excerpt?.trim()) { await response.body?.cancel(); return {status:"reachable",httpStatus:response.status,checkedAt,limitations:["URL accessible ; contenu non vérifié faute d'extrait de référence."]}; }
    const reader=response.body?.getReader();
    let content="";
    if(reader) {
      const decoder=new TextDecoder();
      while(content.length<65536) { const part=await reader.read(); if(part.done) break; content+=decoder.decode(part.value,{stream:true}); }
      await reader.cancel().catch(()=>{});
    }
    const normalize=(value:string)=>value.toLocaleLowerCase("fr").replace(/\s+/g," ").trim();
    const found=normalize(content).includes(normalize(excerpt));
    return {status:found?"content_checked":"reachable",httpStatus:response.status,checkedAt,limitations:found?["L'extrait fourni a été retrouvé dans l'échantillon consulté ; cela ne prouve pas à lui seul l'affirmation."]:["URL accessible, mais extrait non retrouvé dans les 64 premiers Ko consultés."]};
  } catch(error) { return {status:"unavailable",checkedAt,limitations:[error instanceof Error?error.message:"Échec du contrôle réseau."]}; }
}
function buildFalsificationPlan(debate:Debate) {
  const claims=debate.rounds.flatMap(r=>r.architect.claims.map(c=>({...c,round:r.round})));
  const attacks=debate.rounds.flatMap(r=>r.redTeam.attacks.map(a=>({...a,round:r.round})));
  return claims.filter(c=>c.type!=="opinion").map(c=>{
    const related=attacks.filter(a=>a.claimId===c.id||!a.claimId);
    return {id:randomUUID(),claimId:c.id,claim:c.statement,round:c.round,impact:c.type==="fact"?"high":"medium",falsifiers:related.flatMap(a=>a.evidenceNeeded),tests:[...new Set(related.map(a=>a.argument))],threshold:null,status:"not_tested",result:null,limitations:["Le seuil de réfutation doit être défini avant le test par l'utilisateur ou le responsable métier.","Les objections du modèle constituent des pistes de test, pas des preuves."]};
  });
}
const DOMAIN_MODULES=[
 {id:"strategy",version:"1.0.0",label:"Stratégie et développement",owner:"AFE-CI",supportedDecisionTypes:["strategic","comparison"],claimTaxonomy:["marché","positionnement","croissance","avantage concurrentiel"],riskTaxonomy:["exécution","concurrence","financement","adoption"],criteriaTemplates:["valeur","différenciation","faisabilité","réversibilité"],evidenceGuidance:["données de marché datées","entretiens utilisateurs","résultats pilotes"],requiredHumanReview:["décision irréversible","engagement financier majeur"],limitations:["Cadre d'aide à la décision, pas un conseil professionnel certifié."]},
 {id:"agriculture",version:"1.0.0",label:"Agriculture et agro-industrie",owner:"AFE-CI",supportedDecisionTypes:["operational","financial","strategic"],claimTaxonomy:["rendement","intrants","saisonnalité","débouchés"],riskTaxonomy:["climat","sanitaire","prix","logistique"],criteriaTemplates:["marge nette","cycle","mortalité","débouchés"],evidenceGuidance:["devis fournisseurs datés","relevés de production","prix observés localement"],requiredHumanReview:["investissement lourd","sécurité sanitaire"],limitations:["Les prix et rendements ne sont jamais supposés sans données."]},
 {id:"finance",version:"1.0.0",label:"Finance et investissement",owner:"AFE-CI",supportedDecisionTypes:["financial","comparison"],claimTaxonomy:["revenu","coût","trésorerie","rendement"],riskTaxonomy:["liquidité","contrepartie","taux","concentration"],criteriaTemplates:["VAN","ROI","trésorerie","sensibilité"],evidenceGuidance:["états financiers","devis","hypothèses documentées"],requiredHumanReview:["produit réglementé","engagement de crédit"],limitations:["Ne remplace pas un conseil financier ou réglementaire habilité."]},
 {id:"legal-compliance",version:"1.0.0",label:"Droit et conformité",owner:"AFE-CI",supportedDecisionTypes:["validation","operational"],claimTaxonomy:["obligation","autorisation","contrat","juridiction"],riskTaxonomy:["non-conformité","sanction","litige","données"],criteriaTemplates:["base légale","juridiction","exposition","contrôle"],evidenceGuidance:["textes officiels à jour","jurisprudence vérifiée","avis habilité"],requiredHumanReview:["toute conclusion juridique engageante"],limitations:["Ne constitue pas un avis juridique."]},
 {id:"governance",version:"1.0.0",label:"Gouvernance et organisation",owner:"AFE-CI",supportedDecisionTypes:["strategic","operational"],claimTaxonomy:["responsabilité","délégation","contrôle","performance"],riskTaxonomy:["conflit d'intérêts","fraude","contrôle","continuité"],criteriaTemplates:["séparation des tâches","traçabilité","redevabilité"],evidenceGuidance:["procédures","journaux","contrôles observés"],requiredHumanReview:["changement de délégation","conflit d'intérêts"],limitations:["Les règles internes doivent être validées par l'organisation."]},
 {id:"risk-operations-tech",version:"1.0.0",label:"Risques, opérations et technologie",owner:"AFE-CI",supportedDecisionTypes:["operational","strategic"],claimTaxonomy:["disponibilité","sécurité","capacité","dépendance"],riskTaxonomy:["cyber","fournisseur","résilience","données"],criteriaTemplates:["impact","probabilité","détectabilité","maîtrise"],evidenceGuidance:["tests","journaux","incidents","revues techniques"],requiredHumanReview:["risque critique","données sensibles"],limitations:["Les contrôles doivent être testés dans l'environnement réel."]}
];
async function authorisedCase(id:string,userId:string) {
  const debate=await getDebate(id,userId);
  if(!debate) return null;
  return debate;
}
async function roleFor(debate:Debate,userId:string) {
  if(!debate.workspaceId) return "owner";
  const workspace=await getWorkspace(debate.workspaceId,userId);
  return workspace?.role??null;
}
export async function handleV2Request(req:IncomingMessage,res:ServerResponse,path:string,user:Actor):Promise<boolean> {
  if(req.method==="GET"&&path==="/decision-cases/domains"){send(res,200,{modules:DOMAIN_MODULES});return true;}
  if(req.method==="GET"&&path==="/decision-cases"){
    const debates=await listDebates(user.id);
    send(res,200,{cases:debates});return true;
  }
  if(req.method==="POST"&&path==="/decision-cases"){
    const input=await body(req);
    if(typeof input.question!=="string"||input.question.trim().length<8) {send(res,400,{error:"La question doit contenir au moins 8 caractères."});return true;}
    const requestedMode=["debate","decision","hybrid"].includes(input.mode)?input.mode:undefined;
    const route=routeDecision({question:input.question,context:input.context,requestedMode,highStakes:input.highStakes===true});
    if(input.workspaceId){const w=await getWorkspace(input.workspaceId,user.id);if(!w||!["owner","admin","editor"].includes(w.role)){send(res,403,{error:"Accès insuffisant à cet espace."});return true;}}
    const debate:Debate={id:randomUUID(),userId:user.id,workspaceId:input.workspaceId??null,question:input.question.trim(),context:typeof input.context==="string"?input.context.trim():"",status:"running",rounds:[],config:config()};
    await saveDebate(debate);
    await db("debates?id=eq."+encodeURIComponent(debate.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:json({mode:route.mode})});
    const agents=selectAgents(route);
    await addEvent(debate.id,user.id,"case_created",{route,agents,highStakes:input.highStakes===true,domainModuleId:input.domainModuleId??null,featureFlags:{v2_evidence_graph:true,v2_adaptive_deliberation:true,v2_falsification:true,v2_scenario_simulation:true,v2_human_governance:true,v2_outcome_tracking:true,v2_strategic_memory:true}});
    send(res,201,{case:debate,route,agents,accepted:true});return true;
  }
  const match=path.match(/^\/decision-cases\/([^/]+)(?:\/(.*))?$/);
  if(!match) return false;
  const id=decodeURIComponent(match[1]), action=match[2]??"";
  const debate=await authorisedCase(id,user.id);
  if(!debate){send(res,404,{error:"Cas introuvable ou accès refusé."});return true;}
  const allEvents=await events(id);
  if(req.method==="GET"&&action===""){
    send(res,200,{case:debate,events:allEvents});return true;
  }
  if(req.method==="GET"&&action==="progress"){
    const steps=await listDebateExecutionSteps(id);
    send(res,200,{case:debate,steps,complete:debate.status!=="running"});return true;
  }
  if(req.method==="POST"&&action==="run"){
    await addEvent(id,user.id,"case_run_requested",{mode:"v2",acceptedAt:new Date().toISOString()});
    send(res,202,{accepted:true,caseId:id,next:"POST /debates/"+id+"/advance"});return true;
  }
  if(req.method==="GET"&&action==="evidence"){
    const evidence=allEvents.filter(e=>e.event_type==="evidence_added"||e.event_type==="evidence_checked"||e.event_type==="evidence_rejected");
    send(res,200,{evidence});return true;
  }
  if(req.method==="POST"&&action==="evidence"){
    const input=await body(req);
    if(typeof input.claim!=="string"||input.claim.trim().length<5||typeof input.url!=="string"||!input.url.trim()){send(res,400,{error:"Une affirmation et une URL source sont obligatoires."});return true;}
    const item:EvidenceItem={id:randomUUID(),claim:input.claim.trim(),sourceName:String(input.sourceName??"Source fournie"),url:input.url.trim(),excerpt:typeof input.excerpt==="string"?input.excerpt.slice(0,1200):undefined,qualityScore:typeof input.qualityScore==="number"&&input.qualityScore>=0&&input.qualityScore<=100?input.qualityScore:undefined,materiality:["low","medium","high","critical"].includes(input.materiality)?input.materiality:"medium",status:"unverified",limitations:["Une référence fournie n'est pas une preuve vérifiée."]};
    await addEvent(id,user.id,"evidence_added",{evidence:item});
    send(res,201,{evidence:item});return true;
  }
  const verifyMatch=action.match(/^evidence\/([^/]+)\/verify$/);
  if(req.method==="POST"&&verifyMatch){
    const evidenceId=decodeURIComponent(verifyMatch[1]);
    const sourceEvent=allEvents.find(e=>e.event_type==="evidence_added"&&e.payload.evidence?.id===evidenceId);
    if(!sourceEvent){send(res,404,{error:"Élément de preuve introuvable."});return true;}
    const checked=await checkSource(sourceEvent.payload.evidence.url,sourceEvent.payload.evidence.excerpt);
    const item={...sourceEvent.payload.evidence,...checked};
    await addEvent(id,user.id,"evidence_checked",{evidence:item});
    send(res,200,{evidence:item});return true;
  }
  if(req.method==="POST"&&action==="falsification"){
    const plan=buildFalsificationPlan(debate);
    await addEvent(id,user.id,"falsification_plan_created",{plan});
    send(res,201,{plan});return true;
  }
  if(req.method==="POST"&&action==="scenarios"){
    const input=await body(req);
    try{
      const scenarios=buildScenarios(input);
      const scenarioRatings=Array.isArray(input.optionRatings)?input.optionRatings.filter((n:any)=>Number.isFinite(n)&&n>=0&&n<=100):[];
      await addEvent(id,user.id,"scenario_completed",{horizon:input.horizon,baseline:input.baseline,scenarios,scenarioRatings,limitations:["Scénarios qualitatifs : ils ne constituent pas des prévisions probabilistes."]});
      send(res,201,{scenarios,scenarioRatings});return true;
    }catch(error){send(res,400,{error:error instanceof Error?error.message:"Scénarios invalides."});return true;}
  }
  if(req.method==="POST"&&action==="risks"){
    const input=await body(req);
    try{const risks=assessRisks(Array.isArray(input.risks)?input.risks:[]);await addEvent(id,user.id,"risk_assessed",{risks});send(res,201,{risks});return true;}
    catch(error){send(res,400,{error:error instanceof Error?error.message:"Risques invalides."});return true;}
  }
  if(req.method==="POST"&&action==="interventions"){
    const input=await body(req);
    if(typeof input.action!=="string"||typeof input.reason!=="string"||input.reason.trim().length<4){send(res,400,{error:"Action et justification sont obligatoires."});return true;}
    const intervention={id:randomUUID(),actorId:user.id,action:input.action.slice(0,80),text:String(input.text??"").slice(0,3000),reason:input.reason.slice(0,1000),occurredAt:new Date().toISOString()};
    await addEvent(id,user.id,"human_intervention",{intervention});
    send(res,201,{intervention});return true;
  }
  if(req.method==="POST"&&action==="approve"){
    const input=await body(req), role=await roleFor(debate,user.id);
    if(!role||!["owner","admin"].includes(role)){send(res,403,{error:"Seul le propriétaire ou un administrateur peut enregistrer une approbation."});return true;}
    if(!["approved","rejected","returned_for_revision"].includes(input.status)||typeof input.reason!=="string"||input.reason.trim().length<5){send(res,400,{error:"Statut et justification sont obligatoires."});return true;}
    const created=allEvents.find(e=>e.event_type==="case_created");
    const highStakes=created?.payload.highStakes===true;
    if(highStakes&&created?.actor===user.id){send(res,409,{error:"Double contrôle requis : l'initiateur ne peut pas approuver seul une décision à enjeu élevé."});return true;}
    const approval={id:randomUUID(),actorId:user.id,role,status:input.status,reason:input.reason.slice(0,1500),occurredAt:new Date().toISOString()};
    await addEvent(id,user.id,"approval_recorded",{approval});
    send(res,201,{approval});return true;
  }
  if(req.method==="POST"&&action==="outcomes"){
    const input=await body(req);
    if(typeof input.metric!=="string"||typeof input.unit!=="string"||typeof input.observedValue!=="number"||!Number.isFinite(input.observedValue)){send(res,400,{error:"Indicateur, unité et valeur observée sont obligatoires."});return true;}
    if(input.probability!==undefined&&(!Number.isFinite(input.probability)||input.probability<0||input.probability>1)){send(res,400,{error:"La probabilité doit être comprise entre 0 et 1."});return true;}
    const outcome={id:randomUUID(),metric:input.metric,unit:input.unit,targetValue:typeof input.targetValue==="number"?input.targetValue:null,observedValue:input.observedValue,probability:input.probability??null,observed:input.observed===0||input.observed===1?input.observed:null,period:String(input.period??""),source:String(input.source??"Déclaration utilisateur"),method:String(input.method??""),quality:["independent","documented","declared","estimated"].includes(input.quality)?input.quality:"declared",recordedBy:user.id,recordedAt:new Date().toISOString()};
    await addEvent(id,user.id,"outcome_recorded",{outcome});
    send(res,201,{outcome});return true;
  }
  if(req.method==="GET"&&action==="memory"){
    const memory=allEvents.filter(e=>e.event_type==="memory_lesson_proposed"||e.event_type==="memory_lesson_validated"||e.event_type==="memory_lesson_deprecated");
    send(res,200,{memory});return true;
  }
  if(req.method==="POST"&&action==="memory"){
    const input=await body(req);
    if(typeof input.lesson!=="string"||input.lesson.trim().length<12||!Array.isArray(input.sourceCaseIds)||input.sourceCaseIds.length<1){send(res,400,{error:"Une leçon et au moins un cas source sont obligatoires."});return true;}
    const lesson={id:randomUUID(),lesson:input.lesson.trim().slice(0,2000),scope:["case","workspace","domain"].includes(input.scope)?input.scope:"case",sourceCaseIds:[...new Set(input.sourceCaseIds.map(String))],status:"pending_validation",limitations:["Une leçon issue d'un seul cas ne devient pas une règle générale."]};
    await addEvent(id,user.id,"memory_lesson_proposed",{lesson});
    send(res,201,{lesson});return true;
  }
  const memoryValidate=action.match(/^memory\/([^/]+)\/validate$/);
  if(req.method==="POST"&&memoryValidate){
    const input=await body(req),role=await roleFor(debate,user.id);
    if(!role||!["owner","admin"].includes(role)){send(res,403,{error:"Validation réservée au propriétaire ou à un administrateur."});return true;}
    const proposed=allEvents.find(e=>e.event_type==="memory_lesson_proposed"&&e.payload.lesson?.id===decodeURIComponent(memoryValidate[1]));
    if(!proposed){send(res,404,{error:"Leçon introuvable."});return true;}
    const lesson=proposed.payload.lesson;
    if(lesson.sourceCaseIds.length<2){send(res,409,{error:"Validation générale refusée : au moins deux cas sources indépendants sont requis."});return true;}
    await addEvent(id,user.id,"memory_lesson_validated",{lessonId:lesson.id,validatedBy:user.id,reason:String(input.reason??"Validation humaine")});
    send(res,200,{validated:true,lessonId:lesson.id});return true;
  }
  if(req.method==="GET"&&action==="quality"){
    const evidence=allEvents.filter(e=>e.event_type==="evidence_added").map(e=>e.payload.evidence as EvidenceItem);
    const claims=debate.rounds.flatMap(r=>r.architect.claims);
    const falsifications=allEvents.filter(e=>e.event_type==="falsification_plan_created").flatMap(e=>e.payload.plan??[]);
    const scenarios=allEvents.filter(e=>e.event_type==="scenario_completed");
    const ratings=scenarios.flatMap(e=>e.payload.scenarioRatings??[]);
    const outcomes=allEvents.filter(e=>e.event_type==="outcome_recorded").map(e=>e.payload.outcome);
    const approval=allEvents.find(e=>e.event_type==="approval_recorded")?.payload.approval??null;
    const criticalIssues=debate.rounds.flatMap(r=>r.redTeam.attacks.filter(a=>a.severity==="critical").map(a=>a.argument));
    const quality=calculateV2Quality({claims,evidence,falsifications,scenarioRatings:ratings,outcomes,approval,criticalIssues});
    send(res,200,{quality});return true;
  }
  if(req.method==="GET"&&action==="report"){
    const evidence=allEvents.filter(e=>e.event_type==="evidence_added").map(e=>e.payload.evidence as EvidenceItem);
    const scenarios=allEvents.filter(e=>e.event_type==="scenario_completed").flatMap(e=>e.payload.scenarios??[]);
    const risks=allEvents.filter(e=>e.event_type==="risk_assessed").flatMap(e=>e.payload.risks??[]);
    const criticalIssues=debate.rounds.flatMap(r=>r.redTeam.attacks.filter(a=>a.severity==="critical").map(a=>a.argument));
    const ratings=allEvents.filter(e=>e.event_type==="scenario_completed").flatMap(e=>e.payload.scenarioRatings??[]);
    const outcomes=allEvents.filter(e=>e.event_type==="outcome_recorded").map(e=>e.payload.outcome);
    const approval=allEvents.find(e=>e.event_type==="approval_recorded")?.payload.approval??null;
    const quality=calculateV2Quality({claims:debate.rounds.flatMap(r=>r.architect.claims),evidence,falsifications:allEvents.filter(e=>e.event_type==="falsification_plan_created").flatMap(e=>e.payload.plan??[]),scenarioRatings:ratings,outcomes,approval,criticalIssues});
    const decision=debate.finalDecision;
    const arbitration=arbitrateDecision({preferredOption:decision?.winner==="architect"?"Architecte":decision?.winner==="red_team"?"Red Team":undefined,alternatives:["Architecte","Red Team"],evidenceReliabilityScore:quality.evidenceReliabilityScore,decisionRobustnessScore:quality.decisionRobustnessScore,unresolvedCriticalIssues:criticalIssues,mandatoryConditions:decision?.reversalConditions??[]});
    const report=buildDecisionReport({title:"Rapport de décision AFE-CI V2",question:debate.question,executiveSummary:decision?.decision??"Analyse en cours ou décision non disponible.",arbitration,scenarios,risks,evidenceLimitations:evidence.filter(e=>e.status!=="content_checked").map(e=>e.claim+": source non confirmée sémantiquement"),actionPlan:decision?.tests??[]});
    send(res,200,{report,quality,events:allEvents});return true;
  }
  return false;
}

export const LAB_V2_HTML = String.raw`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07101d"><title>AFE-CI · Decision Lab V2</title><style>
:root{--bg:#07101d;--panel:#0d1828;--line:#20324a;--text:#edf4ff;--muted:#8ea1bb;--ok:#62d9a4;--warn:#ffd166;--bad:#ff7b8a;--blue:#75a9ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}.wrap{max-width:1180px;margin:auto;padding:16px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center}.title{font-size:26px;font-weight:900}.muted{color:var(--muted)}.layout{display:grid;grid-template-columns:330px 1fr;gap:14px;margin-top:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:14px;margin-bottom:12px}.label{display:block;color:var(--muted);font-size:12px;margin:9px 0 4px}input,textarea,select{width:100%;background:#081321;border:1px solid var(--line);border-radius:9px;padding:10px;color:var(--text);font:inherit}textarea{min-height:92px}.btn,button{background:var(--ok);color:#04130c;border:0;border-radius:9px;padding:10px 12px;font-weight:800;cursor:pointer;margin:4px 3px 4px 0}.secondary{background:#14243a;color:var(--text);border:1px solid var(--line)}.danger{background:#40212a;color:#ffe4e8}.tabs{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0}.tab{background:#14243a;color:var(--text);border:1px solid var(--line)}.tab.active{background:#1d4b3b;color:#dfffee}.panel{display:none}.panel.active{display:block}.pill{display:inline-block;border-radius:99px;background:#14243a;color:var(--muted);padding:3px 8px;font-size:11px}.metric{background:#081321;border:1px solid var(--line);padding:10px;border-radius:10px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metric b{font-size:20px;display:block}.item{border:1px solid var(--line);padding:10px;border-radius:10px;margin:8px 0;overflow-wrap:anywhere}.item h4{margin:0 0 5px}.error{color:var(--bad)}.ok{color:var(--ok)}.warning{color:var(--warn)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#081321;padding:10px;border-radius:9px}.hidden{display:none!important}@media(max-width:820px){.layout{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}.title{font-size:22px}}</style></head><body><div class="wrap"><header class="top"><div><div class="pill">AFE-CI · PLATEFORME V2</div><div class="title">Decision Lab</div><div class="muted">Délibération · preuves · réfutation · scénarios · gouvernance · résultats</div></div><a href="/lab" class="pill">Ouvrir le laboratoire V1</a></header><div class="layout"><aside><section class="card"><h3>Nouveau cas de décision</h3><label class="label">Question stratégique</label><textarea id="q" placeholder="Quelle décision devons-nous prendre ?"></textarea><label class="label">Contexte et contraintes</label><textarea id="ctx" placeholder="Données disponibles, objectifs, budget, territoire…"></textarea><label class="label">Mode</label><select id="mode"><option value="">Automatique</option><option value="debate">Débat contradictoire</option><option value="decision">Décision</option><option value="hybrid">Hybride</option></select><label><input id="high" type="checkbox" style="width:auto"> Décision à enjeu élevé / double contrôle</label><button id="create">Créer le cas</button><div id="createMsg" class="muted"></div></section><section class="card"><h3>Mes cas</h3><div id="cases" class="muted">Chargement…</div></section></aside><main><section class="card"><div id="empty" class="muted">Connecte-toi dans le laboratoire V1, puis ouvre ce laboratoire V2. Les sessions sont partagées entre les deux espaces.</div><div id="active" class="hidden"><div id="caseTitle"></div><div class="tabs"><button class="tab active" data-tab="overview">Vue d'ensemble</button><button class="tab" data-tab="evidence">Preuves</button><button class="tab" data-tab="scenarios">Scénarios</button><button class="tab" data-tab="risks">Risques</button><button class="tab" data-tab="falsification">Réfutation</button><button class="tab" data-tab="governance">Gouvernance</button><button class="tab" data-tab="outcomes">Résultats</button><button class="tab" data-tab="memory">Mémoire</button><button class="tab" data-tab="report">Rapport</button></div><div id="overview" class="panel active"><div id="progress"></div><button id="run" class="btn">Lancer / reprendre l'analyse</button><div id="decision"></div><div id="quality"></div></div><div id="evidence" class="panel"><h3>Graphe de preuves</h3><input id="claim" placeholder="Affirmation à documenter"><input id="sourceName" placeholder="Nom de la source"><input id="url" placeholder="URL HTTPS publique"><textarea id="excerpt" placeholder="Extrait utile (facultatif)"></textarea><input id="evidenceQualityScore" type="number" min="0" max="100" placeholder="Note qualité de la preuve 0–100 (facultatif)"><select id="materiality"><option>medium</option><option>high</option><option>critical</option><option>low</option></select><button id="addEvidence">Ajouter la preuve</button><div id="evidenceList"></div></div><div id="scenarios" class="panel"><h3>Simulation qualitative des futurs</h3><input id="horizon" value="12 mois" placeholder="Horizon"><input id="baseline" placeholder="Situation de référence"><textarea id="drivers" placeholder="Un facteur par ligne : Demande | stable | hausse | baisse | estimated"></textarea><input id="ratings" placeholder="Notes de robustesse 0-100 séparées par des virgules (facultatif)"><button id="buildScenarios">Construire les scénarios</button><div id="scenarioList"></div></div><div id="risks" class="panel"><h3>Registre des risques</h3><input id="riskDesc" placeholder="Description du risque"><div class="metrics"><div><label class="label">Probabilité (1–5)</label><input id="likelihood" type="number" min="1" max="5" value="3"></div><div><label class="label">Impact (1–5)</label><input id="impact" type="number" min="1" max="5" value="3"></div></div><input id="mitigation" placeholder="Mesure de maîtrise"><button id="addRisk">Évaluer le risque</button><div id="riskList"></div></div><div id="falsification" class="panel"><h3>Falsification Engine</h3><p class="muted">Recherche structurée de ce qui pourrait invalider les hypothèses. Un seuil doit être défini avant le test.</p><button id="makeFalsification">Générer le plan de réfutation</button><div id="falsificationList"></div></div><div id="governance" class="panel"><h3>Intervention humaine et approbation</h3><input id="interventionAction" placeholder="Action (clarifier, suspendre, contester…)"><textarea id="interventionText" placeholder="Instruction ou observation"></textarea><input id="interventionReason" placeholder="Justification"><button id="intervene">Enregistrer l'intervention</button><hr><select id="approvalStatus"><option value="approved">Approuver</option><option value="rejected">Rejeter</option><option value="returned_for_revision">Retourner pour révision</option></select><textarea id="approvalReason" placeholder="Motivation de l'approbation ou du rejet"></textarea><button id="approve">Enregistrer la décision humaine</button><div id="governanceList"></div></div><div id="outcomes" class="panel"><h3>Suivi post-décision</h3><input id="outcomeMetric" placeholder="Indicateur"><input id="outcomeUnit" placeholder="Unité"><input id="target" type="number" placeholder="Cible (facultatif)"><input id="actual" type="number" placeholder="Valeur observée"><input id="probability" type="number" min="0" max="1" step="0.01" placeholder="Probabilité prévue 0–1 (facultatif)"><select id="observed"><option value="">Résultat binaire non applicable</option><option value="1">Événement réalisé</option><option value="0">Événement non réalisé</option></select><input id="period" placeholder="Période"><input id="outcomeSource" placeholder="Source et méthode de mesure"><button id="addOutcome">Enregistrer le résultat</button><div id="outcomeList"></div></div><div id="memory" class="panel"><h3>Mémoire stratégique contrôlée</h3><textarea id="lesson" placeholder="Leçon candidate, portée et limites"></textarea><input id="sourceCases" placeholder="IDs de cas sources séparés par des virgules"><button id="proposeLesson">Proposer une leçon</button><div id="memoryList"></div></div><div id="report" class="panel"><h3>Rapport de décision</h3><button id="loadReport">Générer le rapport</button><div id="reportBody"></div></div></div></section></main></div></div><script>
(function(){
const $=id=>document.getElementById(id),session=()=>{try{return JSON.parse(localStorage.getItem('afe-v09-session')||'null')}catch{return null}},E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
let current=null,debate=null,evts=[];
async function api(path,method='GET',data){const s=session();if(!s?.access_token)throw new Error('Session absente. Connecte-toi d’abord dans le laboratoire V1.');const r=await fetch(path,{method,headers:{Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Erreur serveur '+r.status);return d}
function msg(id,text,cls='muted'){const el=$(id);if(el){el.className=cls;el.textContent=text}}
function showTab(name){document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===name));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name))}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
async function loadCases(){const d=await api('/decision-cases');$('cases').innerHTML=(d.cases||[]).map(x=>'<div class="item"><button class="secondary" data-case="'+E(x.id)+'">'+E(x.question)+'</button><div class="pill">'+E(x.status)+'</div></div>').join('')||'<span class="muted">Aucun cas.</span>';document.querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>openCase(b.dataset.case))}
async function createCase(){try{msg('createMsg','Création…');const d=await api('/decision-cases','POST',{question:$('q').value,context:$('ctx').value,mode:$('mode').value||undefined,highStakes:$('high').checked});$('q').value='';await loadCases();await openCase(d.case.id);msg('createMsg','Cas créé.')}catch(e){msg('createMsg',e.message,'error')}}
async function openCase(id){try{current=id;const d=await api('/decision-cases/'+encodeURIComponent(id));debate=d.case;evts=d.events||[];$('empty').classList.add('hidden');$('active').classList.remove('hidden');$('caseTitle').innerHTML='<h2>'+E(debate.question)+'</h2><span class="pill">'+E(debate.status)+'</span>';await refreshAll();showTab('overview')}catch(e){msg('createMsg',e.message,'error')}}
async function refreshAll(){const d=await api('/decision-cases/'+encodeURIComponent(current));debate=d.case;evts=d.events||[];const steps=(await api('/decision-cases/'+encodeURIComponent(current)+'/progress')).steps||[];$('progress').innerHTML='<div class="metrics"><div class="metric"><b>'+steps.filter(x=>x.status==='completed').length+'</b>Étapes terminées</div><div class="metric"><b>'+steps.filter(x=>x.status==='failed').length+'</b>Échecs</div><div class="metric"><b>'+E(debate.status)+'</b>Statut</div></div>';$('decision').innerHTML=debate.finalDecision?'<div class="item"><h3>Décision actuelle</h3>'+E(debate.finalDecision.decision)+'<p class="muted">'+E((debate.finalDecision.rationale||[]).join(' · '))+'</p></div>':'<p class="muted">L’analyse n’a pas encore produit de décision finale.</p>';const q=await api('/decision-cases/'+encodeURIComponent(current)+'/quality');$('quality').innerHTML='<h3>Indicateurs indépendants</h3><div class="metrics">'+[['Preuves',q.quality.evidenceCoverage.score],['Sources accessibles',q.quality.sourceVerification.score],['Réfutation',q.quality.falsificationCoverage.score],['Scénarios',q.quality.scenarioRobustness.score],['Gouvernance',q.quality.governanceCompleteness.score],['Qualité décisionnelle',q.quality.decisionQualityScore]].map(x=>'<div class="metric"><b>'+(x[1]===null?'—':x[1]+'/100')+'</b>'+x[0]+'</div>').join('')+'</div><p class="muted">'+E(q.quality.warning)+'</p>';renderEvents()}
function renderEvents(){const list=(types)=>evts.filter(e=>types.includes(e.event_type));$('evidenceList').innerHTML=list(['evidence_added','evidence_checked']).map(e=>{const v=e.payload.evidence||{};return '<div class="item"><b>'+E(v.claim)+'</b><p>'+E(v.sourceName)+' · <span class="pill">'+E(v.status)+'</span></p><a href="'+E(v.url)+'" target="_blank" rel="noopener">Ouvrir la source</a><button class="secondary" data-verify="'+E(v.id)+'">Vérifier l’accessibilité</button><p class="muted">'+E((v.limitations||[]).join(' · '))+'</p></div>'}).join('')||'<p class="muted">Aucune preuve enregistrée.</p>';document.querySelectorAll('[data-verify]').forEach(b=>b.onclick=async()=>{try{await api('/decision-cases/'+current+'/evidence/'+b.dataset.verify+'/verify','POST',{});await refreshAll()}catch(e){alert(e.message)}});$('scenarioList').innerHTML=list(['scenario_completed']).map(e=>'<div class="item"><pre>'+E(JSON.stringify(e.payload.scenarios,null,2))+'</pre><p class="muted">'+E((e.payload.limitations||[]).join(' · '))+'</p></div>').join('');$('riskList').innerHTML=list(['risk_assessed']).map(e=>'<div class="item"><pre>'+E(JSON.stringify(e.payload.risks,null,2))+'</pre></div>').join('');$('falsificationList').innerHTML=list(['falsification_plan_created']).map(e=>'<div class="item"><pre>'+E(JSON.stringify(e.payload.plan,null,2))+'</pre></div>').join('');$('governanceList').innerHTML=list(['human_intervention','approval_recorded']).map(e=>'<div class="item"><pre>'+E(JSON.stringify(e.payload,null,2))+'</pre></div>').join('');$('outcomeList').innerHTML=list(['outcome_recorded']).map(e=>'<div class="item"><pre>'+E(JSON.stringify(e.payload.outcome,null,2))+'</pre></div>').join('');$('memoryList').innerHTML=list(['memory_lesson_proposed','memory_lesson_validated']).map(e=>'<div class="item"><pre>'+E(JSON.stringify(e.payload,null,2))+'</pre></div>').join('')}
async function run(){try{await api('/decision-cases/'+current+'/run','POST',{});for(let i=0;i<24;i++){const d=await api('/debates/'+current+'/advance','POST',{});await refreshAll();if(d.complete)break;if(d.busy)await new Promise(r=>setTimeout(r,1200))}msg('createMsg','Analyse terminée ou en attente de reprise.')}catch(e){msg('createMsg',e.message,'error')}}
$('create').onclick=createCase;$('run').onclick=run;
$('addEvidence').onclick=async()=>{try{await api('/decision-cases/'+current+'/evidence','POST',{claim:$('claim').value,sourceName:$('sourceName').value,url:$('url').value,excerpt:$('excerpt').value,qualityScore:$('evidenceQualityScore').value===''?undefined:Number($('evidenceQualityScore').value),materiality:$('materiality').value});$('claim').value='';await refreshAll()}catch(e){alert(e.message)}};
$('buildScenarios').onclick=async()=>{try{const drivers=$('drivers').value.split('\\n').filter(Boolean).map(line=>{const p=line.split('|').map(x=>x.trim());return{name:p[0],currentState:p[1]||'non renseigné',favourableDevelopment:p[2]||'amélioration',adverseDevelopment:p[3]||'dégradation',evidenceStatus:['verified','estimated','assumed','unknown'].includes(p[4])?p[4]:'unknown'}});const optionRatings=$('ratings').value.split(',').map(Number).filter(n=>Number.isFinite(n)&&n>=0&&n<=100);await api('/decision-cases/'+current+'/scenarios','POST',{horizon:$('horizon').value,baseline:$('baseline').value,drivers,optionRatings});await refreshAll()}catch(e){alert(e.message)}};
$('addRisk').onclick=async()=>{try{const risk={id:'risk-'+Date.now(),description:$('riskDesc').value,likelihood:Number($('likelihood').value),impact:Number($('impact').value),mitigation:$('mitigation').value};await api('/decision-cases/'+current+'/risks','POST',{risks:[risk]});await refreshAll()}catch(e){alert(e.message)}};
$('makeFalsification').onclick=async()=>{try{await api('/decision-cases/'+current+'/falsification','POST',{});await refreshAll()}catch(e){alert(e.message)}};
$('intervene').onclick=async()=>{try{await api('/decision-cases/'+current+'/interventions','POST',{action:$('interventionAction').value,text:$('interventionText').value,reason:$('interventionReason').value});await refreshAll()}catch(e){alert(e.message)}};
$('approve').onclick=async()=>{try{await api('/decision-cases/'+current+'/approve','POST',{status:$('approvalStatus').value,reason:$('approvalReason').value});await refreshAll()}catch(e){alert(e.message)}};
$('addOutcome').onclick=async()=>{try{const obs=$('observed').value;await api('/decision-cases/'+current+'/outcomes','POST',{metric:$('outcomeMetric').value,unit:$('outcomeUnit').value,targetValue:$('target').value===''?undefined:Number($('target').value),observedValue:Number($('actual').value),probability:$('probability').value===''?undefined:Number($('probability').value),observed:obs===''?undefined:Number(obs),period:$('period').value,source:$('outcomeSource').value});await refreshAll()}catch(e){alert(e.message)}};
$('proposeLesson').onclick=async()=>{try{await api('/decision-cases/'+current+'/memory','POST',{lesson:$('lesson').value,sourceCaseIds:$('sourceCases').value.split(',').map(x=>x.trim()).filter(Boolean)});await refreshAll()}catch(e){alert(e.message)}};
$('loadReport').onclick=async()=>{try{const d=await api('/decision-cases/'+current+'/report');$('reportBody').innerHTML='<div class="item"><span class="pill">'+E(d.report.status)+'</span><h3>'+E(d.report.title)+'</h3><p>'+E(d.report.executiveSummary)+'</p><h4>Arbitrage</h4><pre>'+E(JSON.stringify(d.report.arbitration,null,2))+'</pre><h4>Scénarios</h4><pre>'+E(JSON.stringify(d.report.scenarios,null,2))+'</pre><h4>Risques et plan d’action</h4><pre>'+E(JSON.stringify({risks:d.report.risks,actions:d.report.actionPlan},null,2))+'</pre></div>'}catch(e){alert(e.message)}};
async function init(){if(!session()?.access_token){$('empty').innerHTML='Aucune session active. <a href="/lab">Connecte-toi dans le laboratoire V1</a>, puis recharge cette page.';return}try{await loadCases()}catch(e){$('cases').textContent=e.message}}
init();
})();
</script></body></html>`;
