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
 const repositories=(process.env.AFE_EVIDENCE_REPOSITORIES??"").split(",").map(x=>x.trim()).filter(Boolean);
 const refs=(process.env.AFE_EVIDENCE_REFS??"feature/autonomous-organization-v1").split(",").map(x=>x.trim()).filter(Boolean);
 const prefixes=(process.env.AFE_EVIDENCE_PATH_PREFIXES??"debate-engine/src/,debate-engine/test/,debate-engine/supabase/migrations/").split(",").map(x=>x.trim()).filter(Boolean);
 return{allowedRepositories:new Set(repositories),allowedRefs:new Set(refs),allowedPathPrefixes:prefixes,maxBytes:180000,maxExcerptChars:12000};
}
async function collectEvidence(workspaceId:string,deliberationId:string,requests:any[]):Promise<EvidenceArtifact[]>{
 if(!requests.length)return [];
 const policy=evidencePolicy(),provider=githubProvider(),out:EvidenceArtifact[]=[];
 for(const item of requests.slice(0,12)){
  const repository=safeText(item.repository,200),ref=safeText(item.ref,120),path=safeText(item.path,500);
  const commitSha=safeText(item.commitSha,40);
  if(!repository||!ref||!path||!/^[0-9a-f]{40}$/.test(commitSha))throw new Error("Evidence request is incomplete or has an invalid commit SHA.");
  const artifact=await collectGitEvidence({workspaceId,repository,ref,commitSha,path,startLine:Number.isInteger(item.startLine)?item.startLine:undefined,endLine:Number.isInteger(item.endLine)?item.endLine:undefined},policy,provider);
  const rows=await db<any[]>("afe_evidence_artifacts", {...post,body:JSON.stringify({id:randomUUID(),workspace_id:workspaceId,deliberation_id:deliberationId,source_kind:artifact.sourceKind,source_uri:artifact.sourceUri,repository:artifact.repository,source_ref:artifact.ref,commit_sha:artifact.commitSha,source_path:artifact.path,line_start:artifact.lineStart,line_end:artifact.lineEnd,content_sha256:artifact.contentSha256,collector_version:artifact.collectorVersion,access_mode:artifact.accessMode,verification:artifact.verification,excerpt:artifact.excerpt,metadata:artifact.metadata})});
  const row=rows[0];if(!row)throw new Error("Evidence artifact was not persisted.");
  out.push({...artifact,id:row.id});
 }
 return out;
}
function evidenceMap(xs:EvidenceArtifact[]){return new Map(xs.map(x=>[x.id,x]));}
const contributionSchema={type:"object",additionalProperties:false,properties:{kind:{type:"string",enum:["position","objection","rebuttal","evidence_review","revision"]},body:{type:"string"},evidenceIds:{type:"array",items:{type:"string"}},respondsTo:{type:"string"}},required:["kind","body","evidenceIds","respondsTo"]};
const findingSchema={type:"object",additionalProperties:false,properties:{id:{type:"string"},title:{type:"string"},statement:{type:"string"},severity:{type:"string",enum:["critical","high","medium","low","info"]},likelihood:{type:"integer",minimum:1,maximum:5},impact:{type:"integer",minimum:1,maximum:5},rationale:{type:"string"},evidenceIds:{type:"array",items:{type:"string"}},verification:{type:"string",enum:["verified","partially_verified","unverified","out_of_scope"]},limitations:{type:"array",items:{type:"string"}},counterArguments:{type:"array",items:{type:"string"}},recommendation:{type:"string"},closureCriteria:{type:"array",items:{type:"string"}}},required:["id","title","statement","severity","likelihood","impact","rationale","evidenceIds","verification","limitations","counterArguments","recommendation","closureCriteria"]};
const decisionSchema={type:"object",additionalProperties:false,properties:{findingId:{type:"string"},decision:{type:"string",enum:["upheld","partially_upheld","rejected","unresolved"]},rationale:{type:"string"},evidenceIds:{type:"array",items:{type:"string"}},dissent:{type:"array",items:{type:"string"}}},required:["findingId","decision","rationale","evidenceIds","dissent"]};
async function model<T>(agent:Agent,schemaName:string,schema:any,prompt:string):Promise<T>{
 const provider=agent.model_provider==="gemini"?"gemini":"openai";
 return callModel<T>({provider,model:agent.model_id??"",schemaName,system:(agent.mandate??"")+ "\n"+(agent.system_instructions??"")+"\nTu es un participant à une revue contradictoire. N'invente jamais de preuves. Réponds en français.",prompt,schema});
}
async function persistContribution(workspaceId:string,deliberationId:string,c:any,agentId:string,round:number){
 const key="r"+round+":"+agentId+":"+c.kind;
 const rows=await db<any[]>("afe_deliberation_contributions?on_conflict=deliberation_id,idempotency_key",{method:"POST",headers:{"Prefer":"resolution=ignore-duplicates,return=representation"},body:JSON.stringify({workspace_id:workspaceId,deliberation_id:deliberationId,round_no:round,agent_id:agentId,contribution_type:c.kind,body:safeText(c.body,20000),evidence_ids:c.evidenceIds??[],responds_to:c.respondsTo||null,idempotency_key:key})});
 return rows[0];
}
async function saveReport(report:any){
 const rows=await db<any[]>("afe_arbitration_reports?on_conflict=deliberation_id",{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=representation"},body:JSON.stringify({workspace_id:report.workspaceId,deliberation_id:report.deliberationId,status:report.status,decisions:report.decisions,unresolved_disagreements:report.unresolvedDisagreements,limitations:report.limitations,human_approval_required:true})});
 if(!rows[0])throw new Error("Arbitration report was not persisted.");return rows[0];
}
export async function runMissionDeliberation(mission:Mission,primaryAgent:Agent){
 const config=mission.input_context?.deliberation;
 if(!config||config.enabled!==true)return null;
 const participants=(Array.isArray(config.participantAgentIds)?config.participantAgentIds:[]).filter((x:any)=>typeof x==="string").slice(0,4);
 const agents=await db<Agent[]>("afe_agents?workspace_id=eq."+enc(mission.workspace_id)+"&id=in.("+participants.map(enc).join(",")+")&status=eq.active");
 if(agents.length<2||agents.length!==participants.length)throw new Error("Une délibération exige au moins deux agents actifs du même espace.");
 if(!agents.some(a=>a.id===primaryAgent.id))agents.unshift(primaryAgent);
 const prior=await db<PersistedDeliberation[]>("afe_deliberations?mission_id=eq."+enc(mission.id)+"&workspace_id=eq."+enc(mission.workspace_id)+"&limit=1");
 let row=prior[0];
 if(!row){const created=createDeliberation({workspaceId:mission.workspace_id,missionId:mission.id,maxRounds:Number(config.maxRounds)||3,maxContributions:Math.min(24,agents.length*3)});const saved=await db<any[]>("afe_deliberations",{...post,body:JSON.stringify({id:created.id,workspace_id:created.workspaceId,mission_id:created.missionId,max_rounds:created.maxRounds,max_contributions:created.maxContributions})});row=saved[0];}
 if(!row)throw new Error("Deliberation persistence failed.");
 if(row.status==="completed"){const reports=await db<any[]>("afe_arbitration_reports?deliberation_id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id)+"&order=created_at.desc&limit=1");return {deliberationId:row.id,evidenceCount:0,contributionCount:0,findingCount:0,arbitrationReportId:reports[0]?.id??null,humanApprovalRequired:true,reusedCompleted:true};}
 const evidence=await collectEvidence(mission.workspace_id,row.id,Array.isArray(config.evidenceRequests)?config.evidenceRequests:[]);
 const eMap=evidenceMap(evidence);
 let state:Deliberation=createDeliberation({workspaceId:mission.workspace_id,missionId:mission.id,maxRounds:row.max_rounds,maxContributions:row.max_contributions});
 state={...state,id:row.id};
 const persisted=await db<any[]>("afe_deliberation_contributions?deliberation_id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id)+"&order=round_no.asc,created_at.asc");
 state={...state,round:Math.max(1,...persisted.map(c=>Number(c.round_no)||1)),contributions:persisted.map(c=>({id:c.id,round:c.round_no,agentId:c.agent_id,kind:c.contribution_type,body:c.body,evidenceIds:c.evidence_ids??[],respondsTo:c.responds_to??undefined,createdAt:c.created_at}))};
 const findings:AuditFinding[]=[];
 for(let round=state.round;round<=state.maxRounds;round++){
  for(const participant of agents){
   if(state.contributions.length>=state.maxContributions)break;
   const priorContrib=state.contributions.find(c=>c.round===round&&c.agentId===participant.id);
   if(priorContrib)continue;
   const output=await model<any>(participant,"afe_deliberation_contribution",{type:"object",additionalProperties:false,properties:{kind:contributionSchema.properties.kind,body:{type:"string"},evidenceIds:contributionSchema.properties.evidenceIds,respondsTo:contributionSchema.properties.respondsTo,findings:{type:"array",items:findingSchema}},required:["kind","body","evidenceIds","respondsTo","findings"]},
    "MISSION: "+mission.title+"\nOBJECTIF: "+mission.objective+"\nTOUR: "+round+"\nCONTRIBUTIONS PRÉCÉDENTES: "+JSON.stringify(state.contributions)+"\nPREUVES VÉRIFIÉES: "+JSON.stringify(evidence)+"\nProduis une contribution contradictoire et des constats. Une affirmation sans preuve doit être non vérifiée.");
   const validEvidence=(output.evidenceIds??[]).filter((id:string)=>eMap.has(id));
   const contribution={kind:output.kind as ContributionKind,body:safeText(output.body,20000),evidenceIds:validEvidence,respondsTo:state.contributions.some(c=>c.id===output.respondsTo)?output.respondsTo:undefined};
   const saved=await persistContribution(mission.workspace_id,row.id,contribution,participant.id,round);
   if(saved)state=addContribution(state,{agentId:participant.id,...contribution});
   for(const f of output.findings??[]){try{findings.push(validateFinding(f,eMap));}catch{/* Invalid/unsubstantiated findings are excluded from verified findings. */}}
  }
  if(round<state.maxRounds&&state.contributions.length<state.maxContributions)state=advanceRound(state);
 }
 state=beginArbitration(state);
 await db("afe_deliberations?id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({status:"arbitrating",current_round:state.round,updated_at:new Date().toISOString()})});
 const arbitrator=agents.find(a=>a.id!==primaryAgent.id)??agents[0];
 const uniqueFindings=[...new Map(findings.map(f=>[f.id,f])).values()];
 const arb=await model<any>(arbitrator,"afe_arbitration_decision",{type:"object",additionalProperties:false,properties:{decisions:{type:"array",items:decisionSchema},limitations:{type:"array",items:{type:"string"}}},required:["decisions","limitations"]},
  "ARBITRAGE INDÉPENDANT. Évalue chaque constat sans inventer de preuve. Préserve les désaccords. CONSTATS: "+JSON.stringify(uniqueFindings)+"\nCONTRIBUTIONS: "+JSON.stringify(state.contributions)+"\nPREUVES: "+JSON.stringify(evidence)+"\nRetourne une décision pour chaque constat.");
 const report=buildArbitration({deliberation:state,findings:uniqueFindings,evidence:eMap,decisions:(arb.decisions??[]) as ArbitrationDecision[],limitations:arb.limitations??[]});
 report.decisions=report.decisions.map(decision=>({...decision,finding:uniqueFindings.find(f=>f.id===decision.findingId)??null})) as any;
 const savedReport=await saveReport(report);
 await db("afe_deliberations?id=eq."+enc(row.id)+"&workspace_id=eq."+enc(mission.workspace_id),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({status:"completed",updated_at:new Date().toISOString()})});
 return {deliberationId:row.id,evidenceCount:evidence.length,contributionCount:state.contributions.length,findingCount:uniqueFindings.length,arbitrationReportId:savedReport.id,humanApprovalRequired:true};
}
