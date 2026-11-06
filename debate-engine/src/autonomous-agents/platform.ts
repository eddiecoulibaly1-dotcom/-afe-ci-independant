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
async function seedAgents(wid:string,user:AuthUser){await requireRole(wid,user,"admin");const existing=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&select=slug");const slugs=new Set(existing.map(x=>x.slug));const missing=AGENT_DEPARTMENT_TEMPLATES.filter(t=>!slugs.has(t.slug));if(missing.length){const rows=missing.map(t=>({workspace_id:wid,slug:t.slug,name:t.name,specialty:t.specialty,mandate:t.mandate,autonomy_level:t.defaultAutonomy,status:"draft",created_by:user.id}));await db("afe_agents",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)});}const all=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&order=created_at.asc");return all;}
async function createMission(wid:string,user:AuthUser,input:any){await requireRole(wid,user,"editor");const agentId=clean(input.agentId,64),title=clean(input.title,240),objective=clean(input.objective,20000);if(!agentId||title.length<3||objective.length<10)throw fail("Agent, titre et objectif (10 caractères minimum) sont requis.");const a=await agent(wid,agentId);if(!a||a.status!=="active")throw fail("Agent introuvable ou non actif.",404);const key=clean(input.idempotencyKey,160)||randomUUID();const prior=await db<any[]>("afe_agent_missions?workspace_id=eq."+enc(wid)+"&idempotency_key=eq."+enc(key)+"&limit=1");if(prior[0])return prior[0];const rows=await db<any[]>("afe_agent_missions",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:wid,agent_id:agentId,created_by:user.id,title,objective,input_context:input.context&&typeof input.context==="object"?input.context:{},priority:Math.max(1,Math.min(5,Number(input.priority)||3)),autonomy_level:Math.min(a.autonomy_level,Math.max(1,Math.min(3,Number(input.autonomyLevel)||1))),idempotency_key:key})});const m=rows[0];if(!m)throw new Error("La mission n'a pas été persistée.");await db("afe_agent_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:wid,mission_id:m.id,agent_id:agentId,actor_type:"human",actor_id:user.id,event_type:"mission.queued",payload:{title}})});return m;}
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
 if(method==="GET"){await requireRole(wid,user);const rows=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&order=created_at.asc");send(res,200,{agents:rows,templates:AGENT_DEPARTMENT_TEMPLATES});return true;}
 if(method==="POST"){await requireRole(wid,user,"admin");const i=await body(req);if(i.action==="seed"){send(res,200,{agents:await seedAgents(wid,user)});return true;}const slug=clean(i.slug,64).toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))throw fail("Identifiant d'agent invalide.");const rows=await db<any[]>("afe_agents",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:wid,slug,name:clean(i.name,120),specialty:clean(i.specialty,160),mandate:clean(i.mandate,12000),system_instructions:clean(i.instructions,30000),autonomy_level:Math.max(1,Math.min(3,Number(i.autonomyLevel)||1)),status:"draft",created_by:user.id})});send(res,201,{agent:rows[0]});return true;}
}
if(p[4]==="agents"&&p[5]){
 const id=p[5];if(method==="PATCH"){await requireRole(wid,user,"admin");const old=await agent(wid,id);if(!old)throw fail("Agent introuvable.",404);const i=await body(req);const patch:any={updated_at:new Date().toISOString()};for(const [k,col,max] of [["name","name",120],["specialty","specialty",160],["mandate","mandate",12000],["instructions","system_instructions",30000]] as const)if(i[k]!==undefined)patch[col]=clean(i[k],max);if(i.autonomyLevel!==undefined)patch.autonomy_level=Math.max(1,Math.min(3,Number(i.autonomyLevel)||1));if(i.status!==undefined){if(!["draft","active","paused","archived"].includes(i.status))throw fail("Statut invalide.");patch.status=i.status;}const rows=await db<any[]>("afe_agents?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});await audit(wid,user,"agent.updated",id,{fields:Object.keys(patch)});send(res,200,{agent:rows[0]});return true;}
 if(method==="GET"){await requireRole(wid,user);const a=await agent(wid,id);if(!a)throw fail("Agent introuvable.",404);const grants=await db<any[]>("afe_agent_tool_grants?agent_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid));send(res,200,{agent:a,grants});return true;}
}
if(p[4]==="deliberations"&&p.length===5){
 if(method==="POST"){
  await requireRole(wid,user,"editor");const i=await body(req);
  const missionId=clean(i.missionId,64);const ids: string[]=Array.isArray(i.participantAgentIds)?Array.from(new Set<string>(i.participantAgentIds.filter((x:unknown):x is string=>typeof x==="string").map((x)=>clean(x,64)))).slice(0,4):[];
  if(!missionId||ids.length<2)throw fail("Une mission et au moins deux agents participants sont requis.");
  const missions=await db<any[]>("afe_agent_missions?id=eq."+enc(missionId)+"&workspace_id=eq."+enc(wid)+"&limit=1");const mission=missions[0];if(!mission)throw fail("Mission introuvable dans cet espace.",404);
  const participants=await db<any[]>("afe_agents?workspace_id=eq."+enc(wid)+"&id=in.("+ids.map((id)=>enc(id)).join(",")+")&status=eq.active");
  if(participants.length!==ids.length)throw fail("Tous les agents participants doivent être actifs dans cet espace.",403);
  const prior=await db<any[]>("afe_deliberations?mission_id=eq."+enc(missionId)+"&workspace_id=eq."+enc(wid)+"&limit=1");if(prior[0])throw fail("Une délibération existe déjà pour cette mission.",409);
  const maxRounds=Math.max(1,Math.min(5,Number(i.maxRounds)||3));
  const evidenceRequests=Array.isArray(i.evidenceRequests)?i.evidenceRequests.slice(0,12).map((x:any)=>({repository:clean(x.repository,200),ref:clean(x.ref,120),commitSha:clean(x.commitSha,40),path:clean(x.path,500),startLine:Number.isInteger(x.startLine)?x.startLine:undefined,endLine:Number.isInteger(x.endLine)?x.endLine:undefined})): [];
  const rows=await db<any[]>("afe_deliberations",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:wid,mission_id:missionId,max_rounds:maxRounds,max_contributions:Math.min(24,ids.length*maxRounds)})});
  const deliberation=rows[0];if(!deliberation)throw new Error("Impossible de créer la délibération.");
  const context={...(mission.input_context&&typeof mission.input_context==="object"?mission.input_context:{}),deliberation:{enabled:true,participantAgentIds:ids,maxRounds,evidenceRequests}};
  await db("afe_agent_missions?id=eq."+enc(missionId)+"&workspace_id=eq."+enc(wid),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({input_context:context,updated_at:new Date().toISOString()})});
  await audit(wid,user,"deliberation.created",deliberation.id,{missionId,participantCount:ids.length});
  send(res,201,{deliberation,participants:participants.map(x=>({id:x.id,name:x.name})),execution:"queued_with_mission"});return true;
 }
 if(method==="GET"){await requireRole(wid,user);const rows=await db<any[]>("afe_deliberations?workspace_id=eq."+enc(wid)+"&order=created_at.desc&limit=100");send(res,200,{deliberations:rows});return true;}
}
if(p[4]==="deliberations"&&p[5]&&method==="GET"){
 await requireRole(wid,user);const id=p[5];const rows=await db<any[]>("afe_deliberations?id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&limit=1");const d=rows[0];if(!d)throw fail("Délibération introuvable.",404);
 const [contributions,evidence,arbitrations]=await Promise.all([
  db<any[]>("afe_deliberation_contributions?deliberation_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&order=round_no.asc,created_at.asc"),
  db<any[]>("afe_evidence_artifacts?deliberation_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&order=collected_at.asc"),
  db<any[]>("afe_arbitration_reports?deliberation_id=eq."+enc(id)+"&workspace_id=eq."+enc(wid)+"&order=created_at.desc")
 ]);
 send(res,200,{deliberation:d,contributions,evidence,arbitrations});return true;
}
if(p[4]==="missions"&&p.length===5){
 if(method==="POST"){const i=await body(req);send(res,202,{mission:await createMission(wid,user,i),execution:"queued_server_side"});return true;}
 if(method==="GET"){await requireRole(wid,user);const rows=await db<any[]>("afe_agent_missions?workspace_id=eq."+enc(wid)+"&order=created_at.desc&limit=100");send(res,200,{missions:rows});return true;}
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
