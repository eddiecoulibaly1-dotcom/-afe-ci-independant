import { timingSafeEqual } from "node:crypto";
import { callModel } from "../providers.js";
import { runMissionDeliberation } from "./orchestration.js";
import { reviewMissionEvidence } from "./review.js";

type Claim={mission_id:string;workspace_id:string;agent_id:string;lease_token:string;attempt_count:number};
type MissionTaskResult={taskId:string;status:"done"|"in_progress"|"blocked";progressPercent:number;blockedReason:string;summary:string;deliverable:string};
type MissionResult={summary:string;analysis:string;deliverables:string[];risks:string[];next_steps:string[];assumptions:string[];task_results:MissionTaskResult[]};
const missionResultSchema={type:"object",additionalProperties:false,properties:{
 summary:{type:"string"},analysis:{type:"string"},deliverables:{type:"array",items:{type:"string"}},
 risks:{type:"array",items:{type:"string"}},next_steps:{type:"array",items:{type:"string"}},assumptions:{type:"array",items:{type:"string"}},
 task_results:{type:"array",items:{type:"object",additionalProperties:false,properties:{
  taskId:{type:"string"},status:{type:"string",enum:["done","in_progress","blocked"]},
  progressPercent:{type:"integer",minimum:0,maximum:100},blockedReason:{type:"string"},summary:{type:"string"},deliverable:{type:"string"}
 },required:["taskId","status","progressPercent","blockedReason","summary","deliverable"]}}
},required:["summary","analysis","deliverables","risks","next_steps","assumptions","task_results"]};
function config(){const url=process.env.SUPABASE_URL?.replace(/\/$/,"");const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;const secret=process.env.AGENT_WORKER_SECRET??process.env.CRON_SECRET;if(!url||!key||!secret)throw new Error("Worker configuration incomplete.");return{url,key,secret};}
function sameSecret(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
async function db<T>(path:string,init:RequestInit={}):Promise<T>{const c=config();const r=await fetch(c.url+"/rest/v1/"+path,{...init,headers:{apikey:c.key,Authorization:"Bearer "+c.key,"Content-Type":"application/json",...(init.headers??{})},signal:AbortSignal.timeout(20000)});const t=await r.text();if(!r.ok)throw new Error("Supabase "+r.status+": "+t.slice(0,300));return t?JSON.parse(t) as T:undefined as T;}

function validateMissionDeliverables(output:MissionResult){
 if(!output||typeof output.summary!=="string"||output.summary.trim().length<20)throw new Error("Compte rendu insuffisant : une synthèse opérationnelle vérifiable est obligatoire.");
 if(!output.analysis||output.analysis.trim().length<40)throw new Error("Analyse insuffisante : le raisonnement et les constats doivent être documentés.");
 if(!Array.isArray(output.deliverables)||output.deliverables.length===0||output.deliverables.some(x=>typeof x!=="string"||x.trim().length<20))throw new Error("Livrable absent ou trop sommaire : la mission ne peut pas être clôturée.");
 for(const item of output.deliverables)if(/^(fait|terminé|ok|done|aucun)$/i.test(item.trim()))throw new Error("Un livrable doit décrire un résultat concret, pas un simple statut.");
 for(const task of output.task_results??[]){
  if(task.status==="done"&&(!task.deliverable||task.deliverable.trim().length<20))throw new Error("Chaque tâche terminée doit fournir un livrable concret : "+task.taskId);
  if(task.status==="done"&&task.progressPercent!==100)throw new Error("Une tâche terminée doit être à 100 % : "+task.taskId);
  if(task.status==="blocked"&&!task.blockedReason.trim())throw new Error("Une tâche bloquée doit comporter un motif : "+task.taskId);
 }
}
const INDEPENDENT_REVIEWER_ID = "system:independent-evidence-gate";
async function recordMissionReview(claim:Claim,mission:any,output:MissionResult){
 const expectedTaskIds:string[] = Array.isArray(mission.input_context?.cooTasks)
  ? mission.input_context.cooTasks.map((task:any)=>String(task.id)).filter(Boolean) : [];
 const report = reviewMissionEvidence({
  workspaceId:claim.workspace_id, missionId:claim.mission_id,
  submittingAgentId:claim.agent_id, reviewerAgentId:INDEPENDENT_REVIEWER_ID,
  expectedTaskIds,
  result:{summary:output.summary,analysis:output.analysis,deliverables:output.deliverables,task_results:output.task_results}
 });
 await db("afe_agent_events",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
  workspace_id:claim.workspace_id,mission_id:claim.mission_id,agent_id:claim.agent_id,
  actor_type:"worker",event_type:"mission.evidence.reviewed",
  payload:{...report,reviewerType:"deterministic_independent_evidence_gate"}
 })});
 // A rejected report is preserved for the COO; it never triggers automatic closure or silent retry.
 return report;
}
async function recordMissionDeliverables(claim:Claim,output:MissionResult){
 await db("afe_agent_events",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
  workspace_id:claim.workspace_id,mission_id:claim.mission_id,agent_id:claim.agent_id,actor_type:"worker",
  event_type:"mission.deliverables.submitted",
  payload:{summary:output.summary,analysis:output.analysis,deliverables:output.deliverables,taskDeliverables:(output.task_results??[]).map(x=>({taskId:x.taskId,status:x.status,deliverable:x.deliverable,summary:x.summary})),risks:output.risks??[],assumptions:output.assumptions??[]}
 })});
}
async function syncCooTaskResults(claim:Claim,mission:any,output:MissionResult):Promise<{complete:boolean;blockedCount:number;reason:string}>{
 const tasks=mission.input_context?.cooTasks;
 if(!Array.isArray(tasks)||tasks.length===0)return{complete:true,blockedCount:0,reason:""};
 const results=Array.isArray(output.task_results)?output.task_results:[];
 const byId=new Map(results.map(x=>[x.taskId,x]));
 if(byId.size!==tasks.length||tasks.some((x:any)=>!byId.has(x.id)))throw new Error("Le résultat de mission ne couvre pas toutes les tâches COO attendues.");
 let blockedCount=0;const incomplete:string[]=[];
 for(const task of tasks){
  const result=byId.get(task.id) as MissionTaskResult;
  if(!["done","in_progress","blocked"].includes(result.status))throw new Error("Statut de tâche invalide : "+task.id);
  const progress=Math.max(0,Math.min(100,Math.trunc(Number(result.progressPercent)||0)));
  if(result.status==="done"&&progress!==100)throw new Error("Une tâche déclarée terminée doit être à 100 % : "+task.id);
  if(result.status==="done"&&(!result.deliverable||result.deliverable.trim().length<20))throw new Error("Une tâche terminée doit fournir un livrable concret : "+task.id);
  if(result.status==="blocked"&&!result.blockedReason.trim())throw new Error("Une tâche bloquée doit avoir un motif : "+task.id);
  if(result.status!=="done"){incomplete.push(task.title);if(result.status==="blocked")blockedCount++;}
  await db("afe_operational_tasks?id=eq."+encodeURIComponent(task.id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id),{
   method:"PATCH",headers:{"Prefer":"return=minimal"},
   body:JSON.stringify({status:result.status,progress_percent:progress,blocked_reason:result.status==="blocked"?result.blockedReason.slice(0,3000):null,completed_at:result.status==="done"?new Date().toISOString():null,updated_at:new Date().toISOString()})
  });
 }
 const progress=Math.round(tasks.reduce((sum:any,task:any)=>sum+Math.max(0,Math.min(100,Math.trunc(Number((byId.get(task.id) as MissionTaskResult).progressPercent)||0))),0)/tasks.length);
 if(incomplete.length){
  const blockedDetails=tasks.map((task:any)=>({task,result:byId.get(task.id) as MissionTaskResult})).filter(x=>x.result.status==="blocked").map(x=>x.task.title+" — "+(x.result.blockedReason.trim()||"motif non précisé"));
  const reason=(blockedDetails.length?"Blocages à traiter : "+blockedDetails.join(" ; "):"Exécution partielle : "+incomplete.length+" tâche(s) restent à terminer.") ;
  await db("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&lease_token=eq."+encodeURIComponent(claim.lease_token),{
   method:"PATCH",headers:{"Prefer":"return=minimal"},
   body:JSON.stringify({status:"paused",progress_percent:progress,blocked_reason:reason.slice(0,3000),result:{...output,execution_state:"partial",blocked_task_count:blockedCount,mission_progress_percent:progress},lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString()})
  });
  await db("afe_agent_events",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({workspace_id:claim.workspace_id,mission_id:claim.mission_id,agent_id:claim.agent_id,actor_type:"worker",event_type:"coo.tasks.incomplete",payload:{blockedCount,incompleteTasks:incomplete,progressPercent:progress,reason}})});
  return{complete:false,blockedCount,reason};
 }
 await db("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&lease_token=eq."+encodeURIComponent(claim.lease_token),{
  method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({progress_percent:100,blocked_reason:null,updated_at:new Date().toISOString()})
 });
 return{complete:true,blockedCount:0,reason:""};
}
async function recordFailure(claim:Claim,error:unknown){const message=(error instanceof Error?error.message:String(error)).slice(0,3500);const terminal=claim.attempt_count>=3;const delay=Math.min(900,15*Math.pow(2,Math.max(0,claim.attempt_count-1)));await db("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&lease_token=eq."+encodeURIComponent(claim.lease_token),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({status:terminal?"failed":"queued",failure_code:"WORKER_EXECUTION_FAILED",failure_message:message,run_after:new Date(Date.now()+delay*1000).toISOString(),lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString()})});await db("afe_agent_events",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({workspace_id:claim.workspace_id,mission_id:claim.mission_id,agent_id:claim.agent_id,actor_type:"worker",event_type:terminal?"mission.failed":"mission.retry_scheduled",payload:{attempt:claim.attempt_count,error:message,next_delay_seconds:terminal?null:delay}})});}
async function recordIncompleteDeliberation(claim:Claim,deliberation:any){
 const delay=15;
 const coverage=deliberation.coverage??{expected:0,completed:0,missing:[]};
 const message="Délibération incomplète : "+coverage.completed+"/"+coverage.expected+" contributions attendues; reprise nécessaire.";
 await db("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&lease_token=eq."+encodeURIComponent(claim.lease_token),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({status:"queued",failure_code:"DELIBERATION_INCOMPLETE",failure_message:message,run_after:new Date(Date.now()+delay*1000).toISOString(),attempt_count:Math.max(0,claim.attempt_count-1),lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString()})});
 await db("afe_agent_events",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({workspace_id:claim.workspace_id,mission_id:claim.mission_id,agent_id:claim.agent_id,actor_type:"worker",event_type:"mission.deliberation_incomplete",payload:{coverage,missing:coverage.missing??[],next_delay_seconds:delay}})});
}
export async function handleAgentWorker(req:any,res:any):Promise<boolean>{const path=new URL(req.url??"/","http://localhost").pathname;if(path!=="/internal/agent-worker")return false;const c=config();const auth=req.headers.authorization??"";const token=auth.startsWith("Bearer ")?auth.slice(7):"";if(!sameSecret(token,c.secret)){res.writeHead(401,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"Unauthorized"}));return true;}if(!["GET","POST"].includes(req.method??"GET")){res.writeHead(405,{"Allow":"GET, POST"});res.end();return true;}try{const dispatched=await db<number>("rpc/dispatch_afe_agent_messages",{method:"POST",body:JSON.stringify({p_limit:10})});const claims=await db<Claim[]>("rpc/claim_afe_agent_mission",{method:"POST",body:JSON.stringify({p_lease_seconds:180})});const claim=claims?.[0];if(!claim){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({claimed:false,dispatchedMessages:dispatched??0}));return true;}try{const [missions,agents]=await Promise.all([db<any[]>("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&limit=1"),db<any[]>("afe_agents?id=eq."+encodeURIComponent(claim.agent_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&limit=1")]);const mission=missions[0],agent=agents[0];if(!mission||!agent||agent.status!=="active")throw new Error("Agent ou mission indisponible.");const provider=agent.model_provider==="gemini"?"gemini":"openai";const model=agent.model_id||(provider==="gemini"?(process.env.GEMINI_MODEL||"gemini-3.8-flash"):(process.env.OPENAI_MODEL||"gpt-4.1-mini"));const output=await callModel<MissionResult>({provider,model,schemaName:"afe_agent_mission_result",system:agent.mandate+"\n\n"+(agent.system_instructions??"")+"\n\nTu es un agent spécialisé AFE-CI. Tu analyses et produis un livrable de qualité. Tu n'exécutes aucune action externe, financière, juridique ou irréversible. Distingue faits, hypothèses et recommandations. Tu dois fournir une synthèse substantielle, une analyse argumentée et au moins un livrable concret décrivant un résultat vérifiable. Si le contexte contient cooTasks, tu dois produire exactement un task_result par taskId, avec un champ deliverable concret pour chaque tâche. Ne marque une tâche done que si son livrable est réellement fourni; sinon indique in_progress ou blocked avec un motif précis. Si aucune cooTasks n'est fournie, retourne task_results vide.",prompt:"MISSION : "+mission.title+"\nOBJECTIF : "+mission.objective+"\nCONTEXTE JSON : "+JSON.stringify(mission.input_context??{}),schema:missionResultSchema});const deliberation=await runMissionDeliberation(mission,agent);if(deliberation){(output as any).deliberation=deliberation;if(deliberation.status==="incomplete"){await recordIncompleteDeliberation(claim,deliberation);res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({claimed:true,completed:false,missionId:claim.mission_id,retryScheduled:true,reason:"DELIBERATION_INCOMPLETE",coverage:deliberation.coverage}));return true;}}validateMissionDeliverables(output);await recordMissionDeliverables(claim,output);const reviewReport=await recordMissionReview(claim,mission,output);const taskSync=await syncCooTaskResults(claim,mission,output);if(!taskSync.complete){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({claimed:true,completed:false,missionId:claim.mission_id,paused:true,blockedTasks:taskSync.blockedCount,reason:taskSync.reason}));return true;}const pendingResult={...output,coo_review:{status:"pending",closureEligible:false,submittedAt:new Date().toISOString()}};const saved=await db<any[]>("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&lease_token=eq."+encodeURIComponent(claim.lease_token),{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:"paused",result:pendingResult,progress_percent:100,blocked_reason:"Livrables soumis — validation indépendante et décision COO requises avant clôture.",lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString()})});if(!saved?.length)throw new Error("Lease périmé : le dossier de revue COO n'a pas été enregistré.");await db("afe_agent_events",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({workspace_id:claim.workspace_id,mission_id:claim.mission_id,agent_id:claim.agent_id,actor_type:"worker",event_type:"mission.awaiting_coo_validation",payload:{reviewStatus:"pending",closureEligible:false,deliverableCount:output.deliverables.length,taskCount:output.task_results.length}})});res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({claimed:true,completed:false,awaitingCooValidation:true,missionId:claim.mission_id,result:pendingResult}));return true;}catch(error){await recordFailure(claim,error);res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({claimed:true,completed:false,missionId:claim.mission_id,retryScheduled:claim.attempt_count<3,error:error instanceof Error?error.message:"Erreur d’exécution"}));return true;}}catch(error){res.writeHead(503,{"Content-Type":"application/json"});res.end(JSON.stringify({error:error instanceof Error?error.message:"Worker unavailable"}));return true;}}


// Authenticated application route calls this directly on the server after checking
// workspace admin membership. It never exposes AGENT_WORKER_SECRET to the browser.
export async function runAgentWorkerForWorkspace(workspaceId:string){
  if(!/^[0-9a-f-]{36}$/i.test(workspaceId))throw new Error("Invalid workspace id.");
  const dispatched=await db<number>("rpc/dispatch_afe_agent_messages_for_workspace",{
    method:"POST",body:JSON.stringify({p_workspace_id:workspaceId,p_limit:5})
  });
  const claims=await db<Claim[]>("rpc/claim_afe_agent_mission_for_workspace",{
    method:"POST",body:JSON.stringify({p_workspace_id:workspaceId,p_lease_seconds:180})
  });
  const claim=claims?.[0];
  if(!claim)return {claimed:false,dispatchedMessages:dispatched??0};
  try{
    const [missions,agents]=await Promise.all([
      db<any[]>("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(workspaceId)+"&limit=1"),
      db<any[]>("afe_agents?id=eq."+encodeURIComponent(claim.agent_id)+"&workspace_id=eq."+encodeURIComponent(workspaceId)+"&limit=1")
    ]);
    const mission=missions[0],agent=agents[0];
    if(!mission||!agent||agent.status!=="active")throw new Error("Agent ou mission indisponible.");
    const provider=agent.model_provider==="gemini"?"gemini":"openai";
    const model=agent.model_id||(provider==="gemini"?(process.env.GEMINI_MODEL||"gemini-3.8-flash"):(process.env.OPENAI_MODEL||"gpt-4.1-mini"));
    const output=await callModel<MissionResult>({
      provider,model,schemaName:"afe_agent_mission_result",
      system:agent.mandate+"\\n\\n"+(agent.system_instructions??"")+"\\n\\nTu es un agent spécialisé AFE-CI. Tu analyses et produis un livrable de qualité. Tu n'exécutes aucune action externe, financière, juridique ou irréversible. Distingue faits, hypothèses et recommandations. Si le contexte contient cooTasks, tu dois produire exactement un task_result par taskId. Ne marque une tâche done que si son livrable est réellement fourni; sinon indique in_progress ou blocked avec un motif précis. Si aucune cooTasks n'est fournie, retourne task_results vide.",
      prompt:"MISSION : "+mission.title+"\\nOBJECTIF : "+mission.objective+"\\nCONTEXTE JSON : "+JSON.stringify(mission.input_context??{}),
      schema:missionResultSchema
    });
    const deliberation=await runMissionDeliberation(mission,agent);if(deliberation){(output as any).deliberation=deliberation;if(deliberation.status==="incomplete"){await recordIncompleteDeliberation(claim,deliberation);return {claimed:true,completed:false,missionId:claim.mission_id,dispatchedMessages:dispatched??0,retryScheduled:true,reason:"DELIBERATION_INCOMPLETE",coverage:deliberation.coverage};}}validateMissionDeliverables(output);await recordMissionDeliverables(claim,output);const reviewReport=await recordMissionReview(claim,mission,output);const taskSync=await syncCooTaskResults(claim,mission,output);if(!taskSync.complete)return {claimed:true,completed:false,missionId:claim.mission_id,dispatchedMessages:dispatched??0,paused:true,blockedTasks:taskSync.blockedCount,reason:taskSync.reason};const pendingResult={...output,coo_review:{status:"pending",closureEligible:false,independentReview:reviewReport,submittedAt:new Date().toISOString()}};const saved=await db<any[]>("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&lease_token=eq."+encodeURIComponent(claim.lease_token),{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify({status:"paused",result:pendingResult,progress_percent:100,blocked_reason:"Livrables soumis — validation indépendante et décision COO requises avant clôture.",lease_token:null,lease_expires_at:null,updated_at:new Date().toISOString()})});if(!saved?.length)throw new Error("Lease périmé : le dossier de revue COO n'a pas été enregistré.");await db("afe_agent_events",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({workspace_id:claim.workspace_id,mission_id:claim.mission_id,agent_id:claim.agent_id,actor_type:"worker",event_type:"mission.awaiting_coo_validation",payload:{reviewStatus:"pending",closureEligible:false,deliverableCount:output.deliverables.length,taskCount:output.task_results.length}})});
    return {claimed:true,completed:false,awaitingCooValidation:true,missionId:claim.mission_id,dispatchedMessages:dispatched??0,result:pendingResult};
  }catch(error){
    await recordFailure(claim,error);
    return {claimed:true,completed:false,missionId:claim.mission_id,dispatchedMessages:dispatched??0,retryScheduled:claim.attempt_count<3,error:error instanceof Error?error.message:"Erreur d’exécution"};
  }
}
