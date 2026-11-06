import { randomUUID } from "node:crypto";
import { callModel } from "../providers.js";
import { collectGitEvidence, type EvidenceArtifact, type EvidencePolicy, type ReadOnlyGitProvider, validateFinding, type AuditFinding } from "./evidence.js";
import { addContribution, advanceRound, beginArbitration, createDeliberation, type ContributionKind, type Deliberation } from "./deliberation.js";
import { buildArbitration, type ArbitrationDecision } from "./arbitration.js";

type Agent = { id:string; workspace_id:string; name:string; mandate:string; system_instructions?:string|null; status:string; model_provider?:string; model_id?:string };
type Mission = { id:string; workspace_id:string; title:string; objective:string; input_context:any };
type PersistedDeliberation = { id:string; workspace_id:string; mission_id:string; status:string; current_round:number; max_rounds:number; max_contributions:number };
const enc=(v:string)=>encodeURIComponent(v);
function cfg(){const url=process.env.SUPABASE_URL?.replace(/\/$/,"");const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Supabase unavailable for deliberation.");return{url,key};}
async function db<T>(path:string,init:RequestInit={}):Promise<T>{const c=cfg();const r=await fetch(c.url+"/rest/v1/"+path,{...init,headers:{apikey:c.key,Authorization:"Bearer "+c.key,"Content-Type":"application/json",...(init.headers??{})},signal:AbortSignal.timeout(20000)});const t=await r.text();if(!r.ok)throw new Error("Supabase "+r.status+": "+t.slice(0,400));return t?JSON.parse(t) as T:undefined as T;}
const post={method:"POST",headers:{"Prefer":"return=representation"}};
const safeText=(v:unknown,max=16000)=>typeof v==="string"?v.trim().slice(0,max):"";
function githubProvider():ReadOnlyGitProvider{
 const token=process.env.GITHUB_READ_TOKEN??process.env.GITHUB_TOKEN;
 async function request(url:string){const r=await fetch(url,{headers:{Accept:"application/vnd.github+json",...(token?{Authorization:"Bearer "+token}:{})},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error("GitHub evidence read failed: "+r.status);return r.json() as Promise<any>;}
 return {
  async resolveCommit(repository,ref){const x=await request("https://api.github.com/repos/"+repository+"/commits/"+encodeURIComponent(ref));return String(x.sha??"");},
  async readFile(repository,commitSha,path){const x=await request("https://api.github.com/repos/"+repository+"/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref="+commitSha);if(x.type!=="file"||typeof x.content!=="string")throw new Error("Evidence path is not a regular file.");return Buffer.from(x.content.replace(/\n/g,""),"base64").toString("utf8");}
 };
}
function evidencePolicy():EvidencePolicy{
 const repositories=(process.env.AFE_EVIDENCE_REPOSITORIES??"eddiecoulibaly1-dotcom/-afe-ci-independant").split(",").map(x=>x.trim()).filter(Boolean);
 const refs=(process.env.AFE_EVIDENCE_REFS??"feature/autonomous-organization-v1").split(",").map(x=>x.trim()).filter(Boolean);
 const prefixes=(process.env.AFE_EVIDENCE_PATH_PREFIXES??"debate-engine/src/,debate-engine/test/,debate-engine/supabase/migrations/,debate-engine/docs/,debate-engine/package.json").split(",").map(x=>x.trim()).filter(Boolean);
 return{allowedRepositories:new Set(repositories),allowedRefs:new Set(refs),allowedPathPrefixes:prefixes,maxBytes:180000,maxExcerptChars:12000};
}
async function collectEvidence(workspaceId:string,deliberationId:string,requests:any[]):Promise<{artifacts:EvidenceArtifact[];limitations:string[]}>{
 const policy=evidencePolicy(),provider=githubProvider(),out:EvidenceArtifact[]=[],limitations:string[]=[];
 let work=requests.slice(0,12);
 if(!work.length){
  const repository=[...policy.allowedRepositories][0],ref=[...policy.allowedRefs][0];
  if(!repository||!ref)return{artifacts:[],limitations:["Aucune source de dépôt autorisée n'est configurée; aucune preuve n'a été collectée."]};
  try{
   const commitSha=await provider.resolveCommit(repository,ref);
   const paths=(process.env.AFE_EVIDENCE_DEFAULT_PATHS??"debate-engine/package.json,debate-engine/src/autonomous-agents/evidence.ts,debate-engine/src/autonomous-agents/deliberation.ts,debate-engine/src/autonomous-agents/arbitration.ts,debate-engine/src/autonomous-agents/orchestration.ts,debate-engine/src/autonomous-agents/worker.ts,debate-engine/test/autonomous-deliberation-concurrency.test.ts,debate-engine/supabase/migrations/20261106160000_evidence_deliberation_arbitration.sql").split(",").map(x=>x.trim()).filter(Boolean).slice(0,12);
   work=paths.map(path=>({repository,ref,commitSha,path}));
  }catch(error){return{artifacts:[],limitations:["Découverte du commit impossible : "+(error instanceof Error?error.message:"erreur source").slice(0,240)]};}
 }
 for(const item of work){
  try{
   const repository=safeText(item.repository,200),ref=safeText(item.ref,120),path=safeText(item.path,500);
   if(!repository||!ref||!path)throw new Error("Source incomplète.");
   const commitSha=safeText(item.commitSha,40)||await provider.resolveCommit(repository,ref);
   if(!/^[0-9a-f]{40}$/.test(commitSha))throw new Error("Commit SHA invalide.");
   const artifact=await collectGitEvidence({workspaceId,repository,ref,commitSha,path,startLine:Number.isInteger(item.startLine)?item.startLine:undefined,endLine:Number.isInteger(item.endLine)?item.endLine:undefined},policy,provider);
   const payload={workspace_id:workspaceId,deliberation_id:deliberationId,source_kind:artifact.sourceKind,source_uri:artifact.sourceUri,repository:artifact.repository,source_ref:artifact.ref,commit_sha:artifact.commitSha,source_path:artifact.path,line_start:artifact.lineStart,line_end:artifact.lineEnd,content_sha256:artifact.contentSha256,collector_version:artifact.collectorVersion,access_mode:artifact.accessMode,verification:artifact.verification,excerpt:artifact.excerpt,metadata:artifact.metadata};
   const rows=await db<any[]>("afe_evidence_artifacts?on_conflict=workspace_id,content_sha256,repository,commit_sha,source_path,line_start,line_end",{method:"POST",headers:{"Prefer":"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(payload)});
   let row=rows[0];
   if(!row){
    const existing=await db<any[]>("afe_evidence_artifacts?workspace_id=eq."+enc(workspaceId)+"&content_sha256=eq."+enc(artifact.contentSha256)+"&repository=eq."+enc(repository)+"&commit_sha=eq."+enc(commitSha)+"&source_path=eq."+enc(path)+"&line_start=eq."+artifact.lineStart+"&line_end=eq."+artifact.lineEnd+"&limit=1");
    row=existing[0];
   }
   if(!row)throw new Error("Preuve non persistée après insertion idempotente.");
   out.push({...artifact,id:row.id});
  }catch(error){limitations.push("Source non collectée ("+safeText(item.path,180)+") : "+(error instanceof Error?error.message:"erreur inconnue").slice(0,240));}
 }
 return{artifacts:out,limitations};
}
function evidenceMap(xs:EvidenceArtifact[]){return new Map(xs.map(x=>[x.id,x]));}
export function findFirstIncompleteRound(participantIds:string[],maxRounds:number,contributions:Array<{agentId:string;round:number}>){
 const rounds=Math.max(1,Math.min(8,maxRounds));
 for(let round=1;round<=rounds;round++)if(participantIds.some(agentId=>!contributions.some(c=>c.agentId===agentId&&c.round===round)))return round;
 return rounds;
}
export function assessDeliberationCoverage(participantIds:string[],maxRounds:number,contributions:Array<{agentId:string;round:number}>){
 const rounds=Math.max(1,Math.min(8,maxRounds));
 const expected=rounds*participantIds.length;
 const completed=new Set(contributions.map(c=>c.round+":"+c.agentId));
 const missing:Array<{agentId:string;round:number}>=[];
 for(let round=1;round<=rounds;round++)for(const agentId of participantIds)if(!completed.has(round+":"+agentId))missing.push({agentId,round});
 return{expected,completed:participantIds.length*rounds-missing.length,missing,complete:missing.length===0};
}
function decodeContributionBody(raw:string):{text:string;findings:AuditFinding[]}{
 try{const parsed=JSON.parse(raw);if(parsed&&parsed.schema==="afe-contribution-v2"&&typeof parsed.text==="string"&&Array.isArray(parsed.findings))return{text:parsed.text,findings:parsed.findings as AuditFinding[]};}catch{}
 return{text:raw,findings:[]};
}
function encodeContributionBody(body:string,items:AuditFinding[]):string{
 const pack=(maxBody:number,maxFindings:number,maxText:number)=>{
  const compact=items.slice(0,maxFindings).map(f=>({
   ...f,title:safeText(f.title,maxText),statement:safeText(f.statement,maxText*2),
   rationale:safeText(f.rationale,maxText),riskRationale:safeText(f.riskRationale,maxText),
   recommendation:safeText(f.recommendation,maxText*2),
   evidenceIds:f.evidenceIds.slice(0,12),
   evidenceAssessments:(f.evidenceAssessments??[]).slice(0,6).map(a=>({...a,rationale:safeText(a.rationale,maxText)})),
   limitations:f.limitations.slice(0,4).map(x=>safeText(x,maxText)),
   counterArguments:f.counterArguments.slice(0,4).map(x=>safeText(x,maxText)),
   closureCriteria:f.closureCriteria.slice(0,4).map(x=>safeText(x,maxText))
  }));
  return JSON.stringify({schema:"afe-contribution-v2",text:safeText(body,maxBody),findings:compact});
 };
 const limits:ReadonlyArray<readonly [number,number,number]>=[[4000,4,700],[2000,3,400],[1000,2,250]];
 for(const [maxBody,maxFindings,maxText] of limits){
  const encoded=pack(maxBody,maxFindings,maxText);
  if(Buffer.byteLength(encoded,"utf8")<=19500)return encoded;
 }
 return JSON.stringify({schema:"afe-contribution-v2",text:safeText(body,500),findings:[]});
}
function normalizeFindingText(value:string){return value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();}
function consolidateFindings(items:AuditFinding[]):AuditFinding[]{
 const groups:AuditFinding[]=[];
 for(const item of items){
  const normalized=normalizeFindingText(item.title+" "+item.statement);
  const tokens=new Set(normalized.split(" ").filter(x=>x.length>3));
  let target:AuditFinding|undefined;
  for(const candidate of groups){
   if(candidate.severity!==item.severity)continue;
   const other=new Set(normalizeFindingText(candidate.title+" "+candidate.statement).split(" ").filter(x=>x.length>3));
   const intersection=[...tokens].filter(x=>other.has(x)).length;
   const similarity=intersection/Math.max(1,new Set([...tokens,...other]).size);
   if(normalized===normalizeFindingText(candidate.title+" "+candidate.statement)||similarity>=0.88){target=candidate;break;}
  }
  if(!target){groups.push({...item,evidenceIds:[...new Set(item.evidenceIds)],evidenceAssessments:[...(item.evidenceAssessments??[])],duplicateIds:[]} as any);continue;}
  (target as any).duplicateIds=[...new Set([...((target as any).duplicateIds??[]),item.id])];
  target.evidenceIds=[...new Set([...target.evidenceIds,...item.evidenceIds])];
  target.evidenceAssessments=[...(target.evidenceAssessments??[]),...(item.evidenceAssessments??[])].filter((a,i,x)=>x.findIndex(y=>y.evidenceId===a.evidenceId&&y.relation===a.relation&&y.rationale===a.rationale)===i);
  target.limitations=[...new Set([...target.limitations,...item.limitations])];
  target.counterArguments=[...new Set([...target.counterArguments,...item.counterArguments])];
  target.closureCriteria=[...new Set([...target.closureCriteria,...item.closureCriteria])];
 }
 return groups;
}
function normalizeArgumentText(value:string){return value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();}
function argumentSimilarity(left:string,right:string){
 const a=new Set(normalizeArgumentText(left).split(" ").filter(x=>x.length>3)),b=new Set(normalizeArgumentText(right).split(" ").filter(x=>x.length>3));
 const intersection=[...a].filter(x=>b.has(x)).length;return intersection/Math.max(1,new Set([...a,...b]).size);
}
export function contributionQualityIssue(state:Deliberation,agentId:string,round:number,kind:ContributionKind,body:string,evidenceIds:string[],respondsTo?:string):string|null{
 if(round===1&&kind!=="position")return "Le premier tour doit présenter des positions indépendantes.";
 if(round>1){
  const target=state.contributions.find(c=>c.id===respondsTo);
  if(!target||target.agentId===agentId)return "Chaque contribution après le premier tour doit répondre à une contribution existante d'un autre agent.";
  if(kind==="position")return "Les tours suivants doivent produire une objection, une réfutation, une revue de preuve ou une révision.";
 }
 const priorEvidence=new Set(state.contributions.flatMap(c=>c.evidenceIds));
 const hasNewEvidence=evidenceIds.some(id=>!priorEvidence.has(id));
 const duplicate=state.contributions.find(c=>argumentSimilarity(c.body,body)>=0.92);
 if(duplicate&&!hasNewEvidence)return "Contribution répétitive écartée : aucun argument nouveau ni nouvelle preuve n'a été apporté.";
 return null;
}
const contributionSchema={type:"object",additionalProperties:false,properties:{kind:{type:"string",enum:["position","objection","rebuttal","evidence_review","revision"]},body:{type:"string"},evidenceIds:{type:"array",items:{type:"string"}},respondsTo:{type:"string"}},required:["kind","body","evidenceIds","respondsTo"]};
const findingSchema={type:"object",additionalProperties:false,properties:{id:{type:"string"},title:{type:"string"},statement:{type:"string"},severity:{type:"string",enum:["critical","high","medium","low","info","not_rated"]},likelihood:{type:["integer","null"],minimum:1,maximum:5},impact:{type:["integer","null"],minimum:1,maximum:5},riskRationale:{type:"string"},rationale:{type:"string"},evidenceIds:{type:"array",items:{type:"string"}},evidenceAssessments:{type:"array",items:{type:"object",additionalProperties:false,properties:{evidenceId:{type:"string"},relation:{type:"string",enum:["supports","contradicts","context_only"]},rationale:{type:"string"}},required:["evidenceId","relation","rationale"]}},verification:{type:"string",enum:["verified","partially_verified","unverified","out_of_scope"]},limitations:{type:"array",items:{type:"string"}},counterArguments:{type:"array",items:{type:"string"}},recommendation:{type:"string"},closureCriteria:{type:"array",items:{type:"string"}}},required:["id","title","statement","severity","likelihood","impact","riskRationale","rationale","evidenceIds","evidenceAssessments","verification","limitations","counterArguments","recommendation","closureCriteria"]};
const decisionSchema={type:"object",additionalProperties:false,properties:{findingId:{type:"string"},decision:{type:"string",enum:["upheld","partially_upheld","rejected","unresolved"]},rationale:{type:"string"},evidenceIds:{type:"array",items:{type:"string"}},dissent:{type:"array",items:{type:"string"}}},required:["findingId","decision","rationale","evidenceIds","dissent"]};
async function model<T>(agent:Agent,schemaName:string,schema:any,prompt:string):Promise<T>{
 const provider=agent.model_provider==="gemini"?"gemini":"openai";
 return callModel<T>({provider,model:agent.model_id??"",schemaName,system:(agent.mandate??"")+ "\n"+(agent.system_instructions??"")+"\nTu es un participant à une revue contradictoire. N'invente jamais de preuves. Réponds en français.",prompt,schema});
}
async function persistContribution(workspaceId:string,deliberationId:string,c:any,agentId:string,round:number){
 const key="r"+round+":"+agentId+":"+c.kind;
 const rows=await db<any[]>("afe_deliberation_contributions?on_conflict=deliberation_id,idempotency_key",{method:"POST",headers:{"Prefer":"resolution=ignore-duplicates,return=representation"},body:JSON.stringify({workspace_id:workspaceId,deliberation_id:deliberationId,round_no:round,agent_id:agentId,contribution_type:c.kind,body:encodeContributionBody(c.body,c.findings??[]),evidence_ids:c.evidenceIds??[],responds_to:c.respondsTo||null,idempotency_key:key})});
 if(rows[0])return rows[0];
 const existing=await db<any[]>("afe_deliberation_contributions?workspace_id=eq."+enc(workspaceId)+"&deliberation_id=eq."+enc(deliberationId)+"&idempotency_key=eq."+enc(key)+"&limit=1");
 return existing[0];
}
async function saveReport(report:any){
 const rows=await db<any[]>("afe_arbitration_reports?on_conflict=deliberation_id",{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=representation"},body:JSON.stringify({workspace_id:report.workspaceId,deliberation_id:report.deliberationId,status:report.status,decisions:report.decisions,unresolved_disagreements:report.unresolvedDisagreements,limitations:report.limitations,human_approval_required:true})});
 if(!rows[0])throw new Error("Arbitration report was not persisted.");return rows[0];
}
export async function runMissionDeliberation(mission:Mission,primaryAgent:Agent){
 const config=mission.input_context?.deliberation;
 if(!config||config.enabled!==true)return null;
 const configuredParticipants:unknown[]=Array.isArray(config.participantAgentIds)?config.participantAgentIds:[];
 const participants=[...new Set(configuredParticipants.filter((x):x is string=>typeof x==="string"&&x.trim().length>0).map(x=>x.trim()))].slice(0,4);
 const agents=await db<Agent[]>("afe_agents?workspace_id=eq."+enc(mission.workspace_id)+"&id=in.("+participants.map(enc).join(",")+")&status=eq.active");
 if(agents.length<2||agents.length!==participants.length)throw new Error("Une délibération exige au moins deux agents actifs du même espace.");

 const prior=await db<PersistedDeliberation[]>("afe_deliberations?mission_id=eq."+enc(mission.id)+"&workspace_id=eq."+enc(mission.workspace_id)+"&limit=1");
 let row=prior[0];
 if(!row){const created=createDeliberation({workspaceId:mission.workspace_id,missionId:mission.id,maxRounds:Number(config.maxRounds)||3,maxContributions:Math.min(64,agents.length*Math.max(1,Math.min(8,Number(config.maxRounds)||3)))});const saved=await db<any[]>("afe_deliberations",{...post,body:JSON.stringify({id:created.id,workspace_id:created.workspaceId,mission_id:created.missionId,max_rounds:created.maxRounds,max_contributions:created.maxContributions})});row=saved[0];}
 if(!row)throw new Error("Deliberation persistence failed.");
 const configuredRounds=Math.max(1,Math.min(8,Number(config.maxRounds)||row.max_rounds||3));
 const requiredContributionBudget=Math.min(64,agents.length*configuredRounds);
 if(row.max_contributions<requiredContributionBudget){
  await db("afe_deliberations?id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({max_contributions:requiredContributionBudget,updated_at:new Date().toISOString()})});
  row={...row,max_contributions:requiredContributionBudget};
 }
 if(row.status==="completed"){const reports=await db<any[]>("afe_arbitration_reports?deliberation_id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id)+"&order=created_at.desc&limit=1");return {deliberationId:row.id,evidenceCount:0,contributionCount:0,findingCount:0,arbitrationReportId:reports[0]?.id??null,humanApprovalRequired:true,reusedCompleted:true};}
 const collection=await collectEvidence(mission.workspace_id,row.id,Array.isArray(config.evidenceRequests)?config.evidenceRequests:[]);
 const evidence=collection.artifacts;
 const eMap=evidenceMap(evidence);
 let state:Deliberation=createDeliberation({workspaceId:mission.workspace_id,missionId:mission.id,maxRounds:row.max_rounds,maxContributions:row.max_contributions});
 state={...state,id:row.id};
 const persisted=await db<any[]>("afe_deliberation_contributions?deliberation_id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id)+"&order=round_no.asc,created_at.asc");
 const findings:AuditFinding[]=[];
 const qualityLimitations:string[]=[];
 const restoredContributions=persisted.map(c=>{const decoded=decodeContributionBody(c.body);for(const finding of decoded.findings){try{findings.push(validateFinding(finding,eMap));}catch(error){qualityLimitations.push("Constat restauré écarté : "+(error instanceof Error?error.message:"validation impossible"));}}return{id:c.id,round:c.round_no,agentId:c.agent_id,kind:c.contribution_type,body:decoded.text,evidenceIds:c.evidence_ids??[],respondsTo:c.responds_to??undefined,createdAt:c.created_at};});
 const firstIncompleteRound=findFirstIncompleteRound(agents.map(a=>a.id),row.max_rounds,restoredContributions);
 state={...state,round:firstIncompleteRound,contributions:restoredContributions};
 for(let round=state.round;round<=state.maxRounds;round++){
  for(const participant of agents){
   if(state.contributions.length>=state.maxContributions)break;
   const priorContrib=state.contributions.find(c=>c.round===round&&c.agentId===participant.id);
   if(priorContrib)continue;
   let output:any;
   let lastModelError:unknown;
   for(let attempt=1;attempt<=2;attempt++){
    try{
     output=await model<any>(participant,"afe_deliberation_contribution",{type:"object",additionalProperties:false,properties:{kind:contributionSchema.properties.kind,body:{type:"string"},evidenceIds:contributionSchema.properties.evidenceIds,respondsTo:contributionSchema.properties.respondsTo,findings:{type:"array",items:findingSchema}},required:["kind","body","evidenceIds","respondsTo","findings"]},
    "MISSION: "+mission.title+"\nOBJECTIF: "+mission.objective+"\nTOUR: "+round+"\nCONTRIBUTIONS PRÉCÉDENTES: "+JSON.stringify(state.contributions)+"\nSOURCES COLLECTÉES (la provenance vérifiée ne signifie pas que le contenu soutient un constat): "+JSON.stringify(evidence)+"\nTour 1 : position indépendante. Tours suivants : réponds obligatoirement à une contribution d'un autre agent en renseignant son ID exact dans respondsTo et en choisissant objection, rebuttal, evidence_review ou revision; n'émets pas une nouvelle position générale. N'apporte pas de répétition sans argument nouveau ou preuve nouvelle. Pour chaque preuve citée, retourne evidenceAssessments avec supports/contradicts/context_only et une justification. Une affirmation sans preuve pertinente doit être unverified; ne confonds jamais absence de preuve et preuve d'absence. Si les données ne permettent pas de coter probabilité et impact, utilise null pour les deux et severity=not_rated. Sinon applique score=probabilité×impact : 1–4 low, 5–9 medium, 10–16 high, 17–25 critical; explique la cotation dans riskRationale.");;
     lastModelError=undefined;break;
    }catch(error){lastModelError=error;}
   }
   if(!output){qualityLimitations.push("Agent "+participant.id+" · tour "+round+" : génération échouée après 2 tentatives ("+(lastModelError instanceof Error?lastModelError.message:"erreur modèle inconnue").slice(0,300)+"). Les autres agents poursuivent la délibération.");continue;}
   const validEvidence=(output.evidenceIds??[]).filter((id:string)=>eMap.has(id));
   const validFindings:AuditFinding[]=[];
   for(const finding of (output.findings??[]).slice(0,2)){try{validFindings.push(validateFinding(finding,eMap));}catch(error){qualityLimitations.push("Agent "+participant.id+" · constat écarté : "+(error instanceof Error?error.message:"validation impossible"));}}
   const contribution={kind:output.kind as ContributionKind,body:safeText(output.body,4000),evidenceIds:validEvidence,respondsTo:state.contributions.some(c=>c.id===output.respondsTo)?output.respondsTo:undefined,findings:validFindings};
   const qualityIssue=contributionQualityIssue(state,participant.id,round,contribution.kind,contribution.body,contribution.evidenceIds,contribution.respondsTo);
   if(qualityIssue){qualityLimitations.push("Agent "+participant.id+" · tour "+round+" : "+qualityIssue);continue;}
   const saved=await persistContribution(mission.workspace_id,row.id,contribution,participant.id,round);
   if(saved){state=addContribution(state,{agentId:participant.id,kind:contribution.kind,body:contribution.body,evidenceIds:contribution.evidenceIds,respondsTo:contribution.respondsTo});const lastIndex=state.contributions.length-1;state={...state,contributions:state.contributions.map((item,index)=>index===lastIndex?{...item,id:saved.id}:item)};findings.push(...validFindings);}
  }
  if(round<state.maxRounds&&state.contributions.length<state.maxContributions){
   const roundComplete=agents.every(agent=>state.contributions.some(c=>c.round===round&&c.agentId===agent.id));
   if(!roundComplete){qualityLimitations.push("Tour "+round+" non franchi : au moins un agent n'a pas fourni de contribution recevable. Le moteur conservera ce tour comme point de reprise.");break;}
   state=advanceRound(state);
  }
 }
 state=beginArbitration(state);
 await db("afe_deliberations?id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({status:"arbitrating",current_round:state.round,updated_at:new Date().toISOString()})});
 const activeAgents=await db<Agent[]>("afe_agents?workspace_id=eq."+enc(mission.workspace_id)+"&status=eq.active&limit=20");
 const arbitrator=activeAgents.find(a=>!participants.includes(a.id))??agents.find(a=>a.id!==primaryAgent.id)??agents[0];
 const arbitratorIsIndependent=!participants.includes(arbitrator.id);
 const uniqueFindings=consolidateFindings([...new Map(findings.map(f=>[f.id,f])).values()]);
 const coverage=assessDeliberationCoverage(agents.map(a=>a.id),row.max_rounds,state.contributions);
 const readyForArbitration=coverage.complete&&uniqueFindings.length>0;
 let arb:any={decisions:[],limitations:[]};
 if(readyForArbitration){
  try{
   arb=await model<any>(arbitrator,"afe_arbitration_decision",{type:"object",additionalProperties:false,properties:{decisions:{type:"array",items:decisionSchema},limitations:{type:"array",items:{type:"string"}}},required:["decisions","limitations"]},
    "ARBITRAGE CONTRADICTOIRE FINAL. Tu es un arbitre indépendant des agents participants. Évalue séparément chaque constat et chaque argument contraire. N'invente aucune preuve. Une provenance vérifiée ne prouve pas la pertinence du contenu. Conserve les dissensions explicites. Pour chaque constat, rends une décision motivée et ne cite que les identifiants de preuves effectivement liées à ce constat.\nCONSTATS: "+JSON.stringify(uniqueFindings)+"\nCONTRIBUTIONS: "+JSON.stringify(state.contributions)+"\nPREUVES: "+JSON.stringify(evidence)+"\nRetourne exactement une décision par constat.");
  }catch(error){arb={decisions:[],limitations:["Arbitrage IA non exécuté : "+(error instanceof Error?error.message:"erreur modèle inconnue").slice(0,400)+". Toutes les décisions sont conservées comme non résolues."]};}
 }else{
  arb.limitations.push(coverage.complete
   ?"Aucun constat recevable n'a été consolidé : aucune conclusion substantielle ne peut être soumise à arbitrage."
   :"Arbitrage final suspendu : la couverture des agents et des tours est incomplète. Les constats restent provisoires jusqu'à la reprise de tous les participants.");
 }
 const returned=(arb.decisions??[]) as ArbitrationDecision[];
 const seenDecisions=new Set<string>();
 const validDecisions=returned.filter(x=>uniqueFindings.some(f=>f.id===x.findingId)&&!seenDecisions.has(x.findingId)&&seenDecisions.add(x.findingId));
 const completeDecisions:ArbitrationDecision[]=uniqueFindings.map(f=>{
  if(!readyForArbitration)return{findingId:f.id,decision:"unresolved",rationale:"Constat provisoire : la délibération n'a pas atteint la couverture complète requise pour un arbitrage final.",evidenceIds:[],dissent:["Validation différée jusqu'à la contribution de tous les agents à tous les tours configurés."]};
  const candidate=validDecisions.find(x=>x.findingId===f.id);
  if(!candidate)return{findingId:f.id,decision:"unresolved",rationale:"Aucune décision d'arbitrage exploitable n'a été retournée pour ce constat; investigation complémentaire requise.",evidenceIds:[],dissent:["Décision manquante ou invalide dans la réponse de l'arbitre."]};
  const invalidEvidence=candidate.evidenceIds.some(id=>!f.evidenceIds.includes(id)||!eMap.has(id));
  if(invalidEvidence||!candidate.rationale?.trim())return{findingId:f.id,decision:"unresolved",rationale:"La décision proposée cite une preuve non liée au constat ou ne fournit pas de justification suffisante; elle est écartée.",evidenceIds:[],dissent:["Réponse de l'arbitre rejetée par le contrôle de cohérence automatique."]};
  return candidate;
 });
 const coverageLimitations=coverage.complete?[]:[ "DÉLIBÉRATION INCOMPLÈTE : "+coverage.completed+"/"+coverage.expected+" contributions attendues. Le statut ne peut pas être déclaré completed.", ...coverage.missing.map(x=>"Contribution manquante · agent "+x.agentId+" · tour "+x.round) ];
 const independenceLimitations=arbitratorIsIndependent?[]:["Arbitrageur "+arbitrator.id+" : aucun arbitre distinct des participants n’est disponible; son indépendance n’est pas garantie et doit être confirmée par validation humaine."];
 const report=buildArbitration({deliberation:state,findings:uniqueFindings,evidence:eMap,decisions:completeDecisions,status:readyForArbitration?"human_review_required":"proposed",limitations:[...(arb.limitations??[]),...independenceLimitations,...collection.limitations,...qualityLimitations,...coverageLimitations,...(uniqueFindings.length?[]:["Aucun constat recevable n'a été consolidé; aucune conclusion substantielle ne peut être tirée."]),"Couverture de collecte : "+evidence.length+" sources collectées, "+collection.limitations.length+" sources non collectées, sur "+(evidence.length+collection.limitations.length)+" tentatives."]});
 report.decisions=report.decisions.map(decision=>({...decision,finding:uniqueFindings.find(f=>f.id===decision.findingId)??null})) as any;
 const savedReport=await saveReport(report);
 await db("afe_deliberations?id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({status:coverage.complete?"completed":"open",current_round:Math.min(row.max_rounds,Math.max(1,...state.contributions.map(c=>c.round))),updated_at:new Date().toISOString()})});
 return {deliberationId:row.id,status:coverage.complete?"completed":"incomplete",coverage,evidenceCount:evidence.length,contributionCount:state.contributions.length,findingCount:uniqueFindings.length,arbitrationReportId:savedReport.id,humanApprovalRequired:true,limitations:[...collection.limitations,...qualityLimitations,...coverageLimitations]};
}
