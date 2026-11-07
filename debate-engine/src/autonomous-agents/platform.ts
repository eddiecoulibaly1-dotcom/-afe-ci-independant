import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "../auth.js";
import { AGENT_DEPARTMENT_TEMPLATES } from "./types.js";
import { runAgentWorkerForWorkspace } from "./worker.js";

type Role="owner"|"admin"|"editor"|"viewer";
const rank:Record<Role,number>={owner:4,admin:3,editor:2,viewer:1};
const enc=(v:string)=>encodeURIComponent(v);
function cfg(){const url=process.env.SUPABASE_URL?.replace(/\/$/,"");const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Persistance Supabase non configurée.");return{url,key};}
async function db<T>(path:string,init:RequestInit={}):Promise<T>{const c=cfg();const r=await fetch(c.url+"/rest/v1/"+path,{...init,headers:{apikey:c.key,Authorization:"Bearer "+c.key,"Content-Type":"application/json",...(init.headers??{})}});const t=await r.text();if(!r.ok)throw new Error("Supabase "+r.status+": "+t.slice(0,350));return t?JSON.parse(t) as T:undefined as T;}
async function body(req:IncomingMessage){let s="";for await(const c of req){s+=c;if(Buffer.byteLength(s)>250000)throw Object.assign(new Error("Requête trop volumineuse."),{status:413});}try{return JSON.parse(s||"{}")}catch{throw Object.assign(new Error("JSON invalide."),{status:400});}}
function send(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(data));}
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const clean=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
async function access(wid:string,uid:string){const w=await db<any[]>("debate_workspaces?id=eq."+enc(wid)+"&limit=1");if(!w[0])return null;if(w[0].owner_id===uid)return{workspace:w[0],role:"owner" as Role};const m=await db<any[]>("debate_workspace_members?workspace_id=eq."+enc(wid)+"&user_id=eq."+enc(uid)+"&limit=1");return m[0]&&rank[m[0].role as Role]?{workspace:w[0],role:m[0].role as Role}:null;}
async function requireRole(wid:string,user:AuthUser,min:Role="viewer"){const a=await access(wid,user.id);if(!a||rank[a.role]<rank[min])throw fail("Accès refusé à cet espace.",403);return a;}
async function audit(wid:string,user:AuthUser,type:string,id:string,payload:Record<string,unknown>={}){await db("afe_agent_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:wid,actor_type:"human",actor_id:user.id,event_type:type,payload:{entity_id:id,...payload}})});}
async function agent(wid:string,id:string){const rows=await db<any[]>("afe_agents?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&limit=1");return rows[0]??null;}
async function transitionAgent(wid:string,user:AuthUser,id:string,action:"activate"|"pause"|"archive"|"restore"){const result=await db<{agent:any;event_id:number}>("rpc/afe_transition_agent_lifecycle",{method:"POST",body:JSON.stringify({p_workspace_id:wid,p_agent_id:id,p_actor_id:user.id,p_action:action})});if(!result?.agent||!result.event_id)throw new Error("La transition de l’agent n’a pas été confirmée par la base de données.");return result;}
async function seedAgents(wid:string,user:AuthUser){await requireRole(wid,user,"admin");const existing=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&select=slug");const slugs=new Set(existing.map(x=>x.slug));const missing=AGENT_DEPARTMENT_TEMPLATES.filter(t=>!slugs.has(t.slug));if(missing.length){const rows=missing.map(t=>({workspace_id:wid,slug:t.slug,name:t.name,specialty:t.specialty,mandate:t.mandate,autonomy_level:t.defaultAutonomy,status:"draft",created_by:user.id}));await db("afe_agents",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)});}const all=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&order=created_at.asc");return all;}
async function createMission(wid:string,user:AuthUser,input:any){
 await requireRole(wid,user,"editor");
 const agentId=clean(input.agentId,64),title=clean(input.title,240),objective=clean(input.objective,20000);
 if(!agentId||title.length<3||objective.length<10)throw fail("Agent, titre et objectif (10 caractères minimum) sont requis.");
 const a=await agent(wid,agentId);if(!a||a.status!=="active")throw fail("Agent introuvable ou non actif.",404);
 const parentId=clean(input.parentMissionId,64)||null;let parent:any=null;
 if(parentId){const parents=await db<any[]>("afe_agent_missions?id=eq."+enc(parentId)+"&workspace_id=eq."+enc(wid)+"&limit=1");parent=parents[0];if(!parent)throw fail("Mission parente introuvable dans cet espace.",404);if(parent.orchestration_mode!=="coordinator")throw fail("La mission parente doit être coordinatrice.",409);if(["completed","failed","cancelled"].includes(parent.status))throw fail("La mission parente est déjà terminée.",409);if(Number(parent.orchestration_depth)>=5)throw fail("Profondeur maximale de sous-missions atteinte.",409);}
 const key=clean(input.idempotencyKey,160)||randomUUID();
 const prior=await db<any[]>("afe_agent_missions?workspace_id=eq."+enc(wid)+"&idempotency_key=eq."+enc(key)+"&limit=1");if(prior[0])return prior[0];
 const dependencies=Array.isArray(input.dependsOnMissionIds)?[...new Set<string>(input.dependsOnMissionIds.filter((x:unknown):x is string=>typeof x==="string").map((x:string)=>clean(x,64)))].slice(0,20):[];
 if(dependencies.includes(parentId??""))throw fail("Une mission enfant ne peut pas dépendre de sa propre mission parente.",400);
 for(const dependencyId of dependencies){const dep=await db<any[]>("afe_agent_missions?id=eq."+enc(dependencyId)+"&workspace_id=eq."+enc(wid)+"&limit=1");if(!dep[0])throw fail("Une dépendance est absente ou appartient à un autre espace.",403);}
 const rows=await db<any[]>("afe_agent_missions",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:wid,agent_id:agentId,created_by:user.id,title,objective,input_context:input.context&&typeof input.context==="object"?input.context:{},priority:Math.max(1,Math.min(5,Number(input.priority)||3)),autonomy_level:Math.min(a.autonomy_level,Math.max(1,Math.min(3,Number(input.autonomyLevel)||1))),idempotency_key:key,parent_mission_id:parentId,orchestration_mode:parentId?"leaf":input.orchestrationMode==="coordinator"?"coordinator":"leaf"})});
 const m=rows[0];if(!m)throw new Error("Mission non persistée.");
 try{for(const dependencyId of dependencies)await db("rpc/afe_add_mission_dependency",{method:"POST",body:JSON.stringify({p_workspace_id:wid,p_mission_id:m.id,p_dependency_id:dependencyId,p_actor_id:user.id})});await db("afe_agent_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:wid,mission_id:m.id,agent_id:agentId,actor_type:"human",actor_id:user.id,event_type:parentId?"mission.child_queued":"mission.queued",payload:{title,parentMissionId:parentId,dependencies}})});}
 catch(error){await db("afe_agent_missions?id=eq."+enc(m.id)+"&workspace_id=eq."+enc(wid),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"cancelled",failure_code:"MISSION_GRAPH_SETUP_FAILED",failure_message:"Configuration de la hiérarchie ou des dépendances incomplète.",updated_at:new Date().toISOString()})});throw error;}
 return m;
}
export async function handleAutonomousAgentsRequest(req:IncomingMessage,res:ServerResponse,path:string,user:AuthUser):Promise<boolean>{try{
const url=new URL(req.url??"/","http://localhost"),p=path.split("/").filter(Boolean),method=req.method??"GET";
if(p.length<4||p[0]!=="team"||p[1]!=="api"||p[2]!=="workspaces")return false;
const wid=p[3];if(!wid)return false;
// Manual worker trigger is Preview-only and restricted to workspace admins.
if(p[4]==="agent-worker"&&p.length===5&&method==="POST"){
 if(process.env.VERCEL_ENV!=="preview")throw fail("Le déclenchement manuel est réservé à l'environnement Preview.",404);
 await requireRole(wid,user,"admin");
 const result=await runAgentWorkerForWorkspace(wid);
 send(res,200,{ok:true,environment:"preview",workspaceId:wid,...result});
 return true;
}
if(p[4]==="agents"&&p.length===5){
 if(method==="GET"){await requireRole(wid,user);const rows=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&order=created_at.asc");send(res,200,{agents:rows,templates:AGENT_DEPARTMENT_TEMPLATES,hardDeleteEnabled:process.env.VERCEL_ENV==="preview"&&process.env.AGENT_HARD_DELETE_ENABLED==="true"});return true;}
 if(method==="POST"){await requireRole(wid,user,"admin");const i=await body(req);if(i.action==="seed"){send(res,200,{agents:await seedAgents(wid,user)});return true;}const slug=clean(i.slug,64).toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))throw fail("Identifiant d'agent invalide.");const rows=await db<any[]>("afe_agents",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:wid,slug,name:clean(i.name,120),specialty:clean(i.specialty,160),mandate:clean(i.mandate,12000),system_instructions:clean(i.instructions,30000),autonomy_level:Math.max(1,Math.min(3,Number(i.autonomyLevel)||1)),status:"draft",created_by:user.id})});send(res,201,{agent:rows[0]});return true;}
}
if(p[4]==="agents"&&p[5]){
 const id=p[5];if(method==="PATCH"){await requireRole(wid,user,"admin");const old=await agent(wid,id);if(!old)throw fail("Agent introuvable.",404);const i=await body(req);if(i.status!==undefined){const actionByStatus:Record<string,"activate"|"pause"|"archive"|"restore">={active:"activate",paused:"pause",archived:"archive",draft:"restore"};const action=typeof i.status==="string"?actionByStatus[i.status]:undefined;if(!action)throw fail("Statut invalide.");const hasOtherChanges=["name","specialty","mandate","instructions","autonomyLevel"].some(k=>i[k]!==undefined);if(hasOtherChanges)throw fail("Séparez la transition de statut de la modification des informations de l’agent.",400);const result=await transitionAgent(wid,user,id,action);send(res,200,{agent:result.agent,eventId:result.event_id});return true;}const patch:any={updated_at:new Date().toISOString()};for(const [k,col,max] of [["name","name",120],["specialty","specialty",160],["mandate","mandate",12000],["instructions","system_instructions",30000]] as const)if(i[k]!==undefined)patch[col]=clean(i[k],max);if(i.autonomyLevel!==undefined)patch.autonomy_level=Math.max(1,Math.min(3,Number(i.autonomyLevel)||1));const rows=await db<any[]>("afe_agents?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});await audit(wid,user,"agent.updated",id,{fields:Object.keys(patch).filter(k=>k!=="updated_at")});send(res,200,{agent:rows[0]});return true;}
 
 if(method==="DELETE"){
  await requireRole(wid,user,"admin");
  if(process.env.VERCEL_ENV!=="preview"||process.env.AGENT_HARD_DELETE_ENABLED!=="true")throw fail("La suppression définitive est désactivée. Utilisez l’archivage; l’activation exige une migration de sécurité validée en Preview.",403);
  const old=await agent(wid,id);if(!old)throw fail("Agent introuvable.",404);
  if(old.status!=="archived")throw fail("Archivez d’abord l’agent avant toute suppression définitive.",409);
  const i=await body(req);
  if(i.confirmName!==old.name||i.confirmPermanent!==true)throw fail("Confirmation invalide : saisissez exactement le nom de l’agent et confirmez la suppression définitive.",400);
  try{
   await audit(wid,user,"agent.delete_attempted",id,{name:old.name,slug:old.slug,previousStatus:old.status});
   const deleted=await db<any[]>("afe_agents?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&status=eq.archived",{method:"DELETE",headers:{Prefer:"return=representation"}});
   if(!deleted.length)throw fail("L’agent a changé d’état ou n’existe plus. Rechargez la liste.",409);
   await audit(wid,user,"agent.deleted",id,{name:old.name,slug:old.slug,previousStatus:old.status});
   send(res,200,{ok:true,deletedAgentId:id,historyPreserved:true});
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   if(/23503|foreign key|violates.*constraint/i.test(message))throw fail("Suppression bloquée : cet agent possède encore des missions, événements, messages, mémoires, exécutions ou contributions liés. Son historique est protégé; conservez-le archivé.",409);
   throw error;
  }
  return true;
 }
 if(method==="GET"){await requireRole(wid,user);const a=await agent(wid,id);if(!a)throw fail("Agent introuvable.",404);const grants=await db<any[]>("afe_agent_tool_grants?agent_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid));send(res,200,{agent:a,grants});return true;}
}
if(p[4]==="deliberations"&&p.length===5){
 if(method==="POST"){
  await requireRole(wid,user,"editor");const i=await body(req);
  const missionId=clean(i.missionId,64);const ids: string[]=Array.isArray(i.participantAgentIds)?Array.from(new Set<string>(i.participantAgentIds.filter((x:unknown):x is string=>typeof x==="string").map((x:string)=>clean(x,64)))).slice(0,4):[];
  if(!missionId||ids.length<2)throw fail("Une mission et au moins deux agents participants sont requis.");
  const missions=await db<any[]>("afe_agent_missions?id=eq."+enc(missionId)+"&workspace_id=eq."+enc(wid)+"&limit=1");const mission=missions[0];if(!mission)throw fail("Mission introuvable dans cet espace.",404);
  const participants=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&id=in.("+ids.map((id)=>enc(id)).join(",")+")&status=eq.active");
  if(participants.length!==ids.length)throw fail("Tous les agents participants doivent être actifs dans cet espace.",403);
  const arbitratorAgentId=clean(i.arbitratorAgentId,64);
  if(!arbitratorAgentId||ids.includes(arbitratorAgentId))throw fail("Désignez un arbitre indépendant distinct des participants.");
  const arbitrators=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&id=eq."+enc(arbitratorAgentId)+"&status=eq.active&limit=1");
  if(!arbitrators[0])throw fail("L’arbitre indépendant doit être actif dans cet espace.",403);
  const prior=await db<any[]>("afe_deliberations?mission_id=eq."+enc(missionId)+"&workspace_id=eq."+enc(wid)+"&limit=1");if(prior[0])throw fail("Une délibération existe déjà pour cette mission.",409);
  const maxRounds=Math.max(1,Math.min(5,Number(i.maxRounds)||3));
  const evidenceRequests=Array.isArray(i.evidenceRequests)?i.evidenceRequests.slice(0,12).map((x:any)=>({repository:clean(x.repository,200),ref:clean(x.ref,120),commitSha:clean(x.commitSha,40),path:clean(x.path,500),startLine:Number.isInteger(x.startLine)?x.startLine:undefined,endLine:Number.isInteger(x.endLine)?x.endLine:undefined})): [];
  const rows=await db<any[]>("afe_deliberations",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:wid,mission_id:missionId,max_rounds:maxRounds,max_contributions:Math.min(24,ids.length*maxRounds)})});
  const deliberation=rows[0];if(!deliberation)throw new Error("Impossible de créer la délibération.");
  const context={...(mission.input_context&&typeof mission.input_context==="object"?mission.input_context:{}),deliberation:{enabled:true,participantAgentIds:ids,arbitratorAgentId,maxRounds,evidenceRequests}};
  await db("afe_agent_missions?id=eq."+enc(missionId)+"&workspace_id=eq."+enc(wid),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({input_context:context,updated_at:new Date().toISOString()})});
  await audit(wid,user,"deliberation.created",deliberation.id,{missionId,participantCount:ids.length,arbitratorAgentId});
  send(res,201,{deliberation,participants:participants.map(x=>({id:x.id,name:x.name})),execution:"queued_with_mission"});return true;
 }
 if(method==="GET"){await requireRole(wid,user);const rows=await db<any[]>("afe_deliberations?workspace_id=eq."+enc(wid)+"&order=created_at.desc&limit=100");send(res,200,{deliberations:rows});return true;}
}
if(p[4]==="deliberations"&&p[5]&&method==="GET"){
 await requireRole(wid,user);const id=p[5];const rows=await db<any[]>("afe_deliberations?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&limit=1");const d=rows[0];if(!d)throw fail("Délibération introuvable.",404);
 const [contributions,arbitrations,missions]=await Promise.all([
  db<any[]>("afe_deliberation_contributions?deliberation_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&order=round_no.asc,created_at.asc"),
  db<any[]>("afe_arbitration_reports?deliberation_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&order=created_at.desc"),
  db<any[]>("afe_agent_missions?id=eq."+enc(d.mission_id)+"&workspace_id=eq."+enc(wid)+"&select=id,status,failure_code,failure_message,updated_at&limit=1")
 ]);
 const mission=missions[0]??null;
 const linkedEvidenceIds=new Set<string>();
 for(const contribution of contributions)for(const evidenceId of contribution.evidence_ids??[])linkedEvidenceIds.add(String(evidenceId));
 for(const report of arbitrations)for(const decision of report.decisions??[]){for(const evidenceId of decision.evidenceIds??[])linkedEvidenceIds.add(String(evidenceId));for(const evidenceId of decision.finding?.evidenceIds??[])linkedEvidenceIds.add(String(evidenceId));}
 const [directEvidence,linkedEvidence]=await Promise.all([
  db<any[]>("afe_evidence_artifacts?deliberation_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&order=collected_at.asc"),
  linkedEvidenceIds.size?db<any[]>("afe_evidence_artifacts?workspace_id=eq."+enc(wid)+"&id=in.("+[...linkedEvidenceIds].map(enc).join(",")+")"):Promise.resolve([])
 ]);
 const evidence=[...new Map([...directEvidence,...linkedEvidence].map(item=>[item.id,item])).values()];
 send(res,200,{deliberation:d,mission,contributions,evidence,arbitrations});return true;
}
if(p[4]==="deliberations"&&p[5]&&p[6]==="approval"&&p.length===7&&method==="POST"){
 await requireRole(wid,user,"admin");
 const id=p[5],input=await body(req);
 if(!["approved","rejected"].includes(input.decision))throw fail("La décision doit être approved ou rejected.");
 const deliberations=await db<any[]>("afe_deliberations?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&limit=1");
 const deliberation=deliberations[0];if(!deliberation)throw fail("Délibération introuvable.",404);
 if(deliberation.created_by&&deliberation.created_by===user.id)throw fail("Séparation des tâches : le créateur de la délibération ne peut pas approuver son propre arbitrage.",403);
 const reports=await db<any[]>("afe_arbitration_reports?deliberation_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&status=eq.human_review_required&limit=1");
 const report=reports[0];if(!report)throw fail("Aucun arbitrage en attente de validation humaine.",409);
 const approved=input.decision==="approved";
 const updated=await db<any[]>("afe_arbitration_reports?id=eq."+enc(report.id)+"&workspace_id=eq."+enc(wid)+"&status=eq.human_review_required",{
  method:"PATCH",headers:{Prefer:"return=representation"},
  body:JSON.stringify({status:approved?"approved":"rejected",approved_by:approved?user.id:null,approved_at:approved?new Date().toISOString():null})
 });
 if(!updated[0])throw fail("L'arbitrage a été modifié par un autre opérateur; rechargez avant de réessayer.",409);
 await audit(wid,user,"arbitration."+input.decision,id,{reportId:report.id,note:clean(input.note,4000)});
 send(res,200,{report:updated[0],decision:input.decision,approvedBy:approved?user.id:null});return true;
}
if(p[4]==="missions"&&p.length===5){
 if(method==="POST"){const i=await body(req);send(res,202,{mission:await createMission(wid,user,i),execution:"queued_server_side"});return true;}
 if(method==="GET"){await requireRole(wid,user);const rows=await db<any[]>("afe_agent_missions?workspace_id=eq."+enc(wid)+"&order=created_at.desc&limit=100");send(res,200,{missions:rows});return true;}
}
if(p[4]==="missions"&&p[5]&&p[6]==="children"&&p.length===7){
 const parentId=p[5];
 if(method==="POST"){await requireRole(wid,user,"editor");const parentRows=await db<any[]>("afe_agent_missions?id=eq."+enc(parentId)+"&workspace_id=eq."+enc(wid)+"&limit=1");const parent=parentRows[0];if(!parent)throw fail("Mission parente introuvable.",404);if(parent.orchestration_mode!=="coordinator")throw fail("Cette mission n’est pas coordinatrice.",409);const input=await body(req);input.parentMissionId=parentId;const child=await createMission(wid,user,input);send(res,201,{mission:child,parentMissionId:parentId,execution:"queued_after_dependencies"});return true;}
 if(method==="GET"){await requireRole(wid,user);const [children,dependencies]=await Promise.all([db<any[]>("afe_agent_missions?workspace_id=eq."+enc(wid)+"&parent_mission_id=eq."+enc(parentId)+"&order=created_at.asc"),db<any[]>("afe_agent_mission_dependencies?workspace_id=eq."+enc(wid)+"&select=id,mission_id,depends_on_mission_id,created_at")]);send(res,200,{children,dependencies:dependencies.filter(d=>children.some(c=>c.id===d.mission_id))});return true;}
}
if(p[4]==="missions"&&p[5]){
 const id=p[5];await requireRole(wid,user);const rows=await db<any[]>("afe_agent_missions?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&limit=1");const m=rows[0];if(!m)throw fail("Mission introuvable.",404);
 if(method==="GET"){const [steps,events,approvals]=await Promise.all([db<any[]>("afe_agent_mission_steps?mission_id=eq."+enc(id)+"&order=sequence_no.asc"),db<any[]>("afe_agent_events?mission_id=eq."+enc(id)+"&order=created_at.asc"),db<any[]>("afe_agent_approvals?mission_id=eq."+enc(id)+"&order=created_at.desc")]);send(res,200,{mission:m,steps,events,approvals});return true;}
 if(method==="POST"){await requireRole(wid,user,"admin");const i=await body(req);if(i.action==="cancel"||i.action==="pause"){if(!["queued","planning","running","paused"].includes(m.status))throw fail("Cette mission est déjà terminée.",409);await db("afe_agent_missions?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid),{method:"PATCH",body:JSON.stringify({status:i.action==="cancel"?"cancelled":"paused",updated_at:new Date().toISOString()})});await audit(wid,user,"mission."+i.action,id);send(res,200,{ok:true,status:i.action==="cancel"?"cancelled":"paused"});return true;}}
}
if(p[4]==="memory"&&p.length===5){
 if(method==="GET"){await requireRole(wid,user);const status=url.searchParams.get("status")??"validated";const rows=await db<any[]>("afe_agent_memory?workspace_id=eq."+enc(wid)+"&status=eq."+enc(status)+"&order=created_at.desc&limit=100");send(res,200,{memories:rows});return true;}
 if(method==="POST"){await requireRole(wid,user,"editor");const i=await body(req),a=await agent(wid,clean(i.agentId,64));if(!a)throw fail("Agent introuvable.",404);const rows=await db<any[]>("afe_agent_memory",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:wid,agent_id:a.id,memory_type:["fact","procedure","preference","lesson","decision","warning"].includes(i.type)?i.type:"lesson",title:clean(i.title,240),content:i.content&&typeof i.content==="object"?i.content:{text:clean(i.content,12000)},confidence:Math.max(0,Math.min(1,Number(i.confidence)||0.5)),status:"proposed",visibility:i.visibility==="workspace_shared"?"workspace_shared":"agent_private"})});send(res,201,{memory:rows[0]});return true;}
}
if(p[4]==="memory"&&p[5]&&method==="POST"){await requireRole(wid,user,"admin");const id=p[5],i=await body(req);if(!["validated","rejected","superseded"].includes(i.status))throw fail("Décision mémoire invalide.");const rows=await db<any[]>("afe_agent_memory?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&status=eq.proposed",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:i.status,visibility:i.status==="validated"&&i.visibility==="workspace_shared"?"workspace_shared":"agent_private",validated_by:user.id,validated_at:new Date().toISOString(),updated_at:new Date().toISOString()})});if(!rows[0])throw fail("Mémoire en attente introuvable.",404);await audit(wid,user,"memory."+i.status,id);send(res,200,{memory:rows[0]});return true;}
if(p[4]==="messages"&&p.length===5){
 if(method==="GET"){await requireRole(wid,user);const rows=await db<any[]>("afe_agent_messages?workspace_id=eq."+enc(wid)+"&order=created_at.desc&limit=100");send(res,200,{messages:rows});return true;}
 if(method==="POST"){await requireRole(wid,user,"editor");const i=await body(req),from=await agent(wid,clean(i.fromAgentId,64)),to=await agent(wid,clean(i.toAgentId,64));if(!from||!to||from.id===to.id||from.status!=="active"||to.status!=="active")throw fail("Les deux agents doivent être distincts et actifs.");const rows=await db<any[]>("afe_agent_messages",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:wid,mission_id:i.missionId??null,from_agent_id:from.id,to_agent_id:to.id,message_type:["task","question","response","review","alert","handoff"].includes(i.type)?i.type:"task",subject:clean(i.subject,240),body:i.body&&typeof i.body==="object"?i.body:{text:clean(i.body,12000)}})});await audit(wid,user,"agent.message.created",rows[0].id,{from:from.id,to:to.id});send(res,202,{message:rows[0]});return true;}
}
if(p[4]==="approvals"&&p.length===5){
 if(method==="GET"){await requireRole(wid,user);const rows=await db<any[]>("afe_agent_approvals?workspace_id=eq."+enc(wid)+"&status=eq.pending&order=created_at.asc");send(res,200,{approvals:rows});return true;}
 if(method==="POST"){await requireRole(wid,user,"admin");const i=await body(req);if(i.action==="request"){await requireRole(wid,user,"editor");const missionId=clean(i.missionId,64),actionKey=clean(i.actionKey,160);if(!missionId||actionKey.length<2)throw fail("Mission et action à valider requises.");const result=await db<any>("rpc/request_afe_agent_approval",{method:"POST",body:JSON.stringify({p_mission_id:missionId,p_workspace_id:wid,p_requester_id:user.id,p_action_key:actionKey,p_action_payload:i.payload&&typeof i.payload==="object"?i.payload:{},p_risk_level:["low","medium","high","critical"].includes(i.riskLevel)?i.riskLevel:"high"})});await audit(wid,user,"approval.requested",String(result.approval_id),{missionId,actionKey});send(res,201,{approval:result,missionSuspended:true});return true;}const id=clean(i.id,64);if(!["approved","rejected"].includes(i.decision))throw fail("Décision invalide.");let result:any;try{result=await db<any>("rpc/decide_afe_agent_approval",{method:"POST",body:JSON.stringify({p_approval_id:id,p_workspace_id:wid,p_approver_id:user.id,p_decision:i.decision,p_note:clean(i.note,4000)})});}catch(e){throw fail(e instanceof Error?e.message:"Décision impossible.",409);}await audit(wid,user,"approval."+i.decision,id);send(res,200,{approval:result,missionResumed:i.decision==="approved"});return true;}
}
if(p[4]==="agent-dashboard"&&method==="GET"){await requireRole(wid,user);const [agents,missions,approvals,messages,memories]=await Promise.all([db<any[]>("afe_agents?workspace_id=eq."+enc(wid)),db<any[]>("afe_agent_missions?workspace_id=eq."+enc(wid)),db<any[]>("afe_agent_approvals?workspace_id=eq."+enc(wid)+"&status=eq.pending"),db<any[]>("afe_agent_messages?workspace_id=eq."+enc(wid)+"&status=eq.queued"),db<any[]>("afe_agent_memory?workspace_id=eq."+enc(wid)+"&status=eq.proposed")]);const count=(xs:any[],s:string)=>xs.filter(x=>x.status===s).length;send(res,200,{agents:{total:agents.length,active:count(agents,"active"),paused:count(agents,"paused")},missions:{total:missions.length,queued:count(missions,"queued"),running:count(missions,"running"),waitingApproval:count(missions,"waiting_approval"),completed:count(missions,"completed"),failed:count(missions,"failed")},pendingApprovals:approvals.length,pendingMessages:messages.length,proposedMemories:memories.length});return true;}
return false;
}catch(e){const status=Number((e as any)?.status)||500;send(res,status,{error:e instanceof Error?e.message:"Erreur interne du module agents."});return true;}}
