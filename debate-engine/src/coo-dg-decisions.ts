import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "./auth.js";

const enc=(v:string)=>encodeURIComponent(v);
const clean=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
function config(){const url=process.env.SUPABASE_URL?.replace(/\/$/,"");const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Persistance Supabase non configurée.");return{url,key};}
async function db<T>(path:string,init:RequestInit={}):Promise<T>{const c=config();const r=await fetch(c.url+"/rest/v1/"+path,{...init,headers:{apikey:c.key,Authorization:"Bearer "+c.key,"Content-Type":"application/json",...(init.headers??{})}});const raw=await r.text();if(!r.ok)throw Object.assign(new Error("Supabase "+r.status+": "+raw.slice(0,300)),{status:r.status});return raw?JSON.parse(raw) as T:undefined as T;}
function send(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(data));}
async function readBody(req:IncomingMessage){let raw="";for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>30000)throw Object.assign(new Error("Requête trop volumineuse."),{status:413});}try{return JSON.parse(raw||"{}") as Record<string,unknown>;}catch{throw Object.assign(new Error("JSON invalide."),{status:400});}}
async function workspaceRole(workspaceId:string,user:AuthUser){const rows=await db<any[]>("debate_workspaces?id=eq."+enc(workspaceId)+"&select=id,owner_id&limit=1");const ws=rows[0];if(!ws)return null;if(ws.owner_id===user.id)return{workspace:ws,role:"owner"};const members=await db<any[]>("debate_workspace_members?workspace_id=eq."+enc(workspaceId)+"&user_id=eq."+enc(user.id)+"&select=role&limit=1");return members[0]?.role?{workspace:ws,role:members[0].role}:null;}
function fail(res:ServerResponse,status:number,message:string){send(res,status,{error:message});}
export async function handleDgDecisionRequest(req:IncomingMessage,res:ServerResponse,path:string,user:AuthUser):Promise<boolean>{
 if(!path.startsWith("/team/api/dg-decisions"))return false;
 try{
  const url=new URL(req.url??"/","http://localhost");const workspaceId=clean(url.searchParams.get("workspaceId"),80);
  if(!workspaceId){fail(res,400,"workspaceId requis.");return true;}
  const access=await workspaceRole(workspaceId,user);if(!access){fail(res,403,"Accès refusé à cet espace.");return true;}
  const isOwner=access.role==="owner";
  const suffix=path.slice("/team/api/dg-decisions".length);
  if(req.method==="GET"&&suffix===""){
   const rows=await db<any[]>("afe_coo_dg_decisions?workspace_id=eq."+enc(workspaceId)+"&select=*&order=submitted_at.desc&limit=100");
   const events=await db<any[]>("afe_coo_dg_decision_events?workspace_id=eq."+enc(workspaceId)+"&select=id,decision_id,event_type,actor_id,note,created_at&order=created_at.desc&limit=250");
   send(res,200,{decisions:rows,events,canDecide:isOwner});return true;
  }
  if(req.method==="POST"&&suffix===""){
   const input=await readBody(req);const title=clean(input.title,240),summary=clean(input.summary,12000),rationale=clean(input.rationale,12000),decisionType=clean(input.decisionType,30)||"governance",requestedOutcome=clean(input.requestedOutcome,40)||"approve";
   if(title.length<8||summary.length<20||rationale.length<10){fail(res,400,"Le titre (8 caractères), la synthèse (20) et la justification (10) sont obligatoires.");return true;}
   if(!["governance","strategy","budget","organization","risk","other"].includes(decisionType)){fail(res,400,"Type de décision invalide.");return true;}
   if(!["approve","approve_with_conditions","reject","return_for_revision","acknowledge"].includes(requestedOutcome)){fail(res,400,"Résultat attendu invalide.");return true;}
   const inserted=await db<any[]>("afe_coo_dg_decisions?select=*",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:workspaceId,title,summary,rationale,decision_type:decisionType,requested_outcome:requestedOutcome,requested_by:user.id})});
   const decision=inserted[0];if(!decision)throw new Error("La décision n'a pas été enregistrée.");
   send(res,201,{decision});return true;
  }
  const match=suffix.match(/^\/([0-9a-f-]{36})\/decision$/i);
  if(req.method==="POST"&&match){
   if(!isOwner){fail(res,403,"Seul le propriétaire habilité (DG) peut statuer.");return true;}
   const input=await readBody(req);const outcome=clean(input.outcome,40),note=clean(input.note,4000);
   const map:Record<string,string>={approve:"approved",approve_with_conditions:"approved_with_conditions",reject:"rejected",return_for_revision:"returned_for_revision"};
   if(!map[outcome]){fail(res,400,"Décision DG invalide.");return true;}
   if(note.length<8){fail(res,400,"Un motif de décision d'au moins 8 caractères est obligatoire.");return true;}
   const current=await db<any[]>("afe_coo_dg_decisions?id=eq."+enc(match[1])+"&workspace_id=eq."+enc(workspaceId)+"&select=*&limit=1");
   if(!current[0]){fail(res,404,"Dossier DG introuvable.");return true;}
   if(current[0].status!=="pending"){fail(res,409,"Ce dossier a déjà fait l'objet d'une décision. Son historique est conservé.");return true;}
   const updated=await db<any[]>("afe_coo_dg_decisions?id=eq."+enc(match[1])+"&workspace_id=eq."+enc(workspaceId)+"&status=eq.pending&select=*",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:map[outcome],decided_by:user.id,decided_at:new Date().toISOString(),decision_note:note,updated_at:new Date().toISOString(),version:Number(current[0].version||1)+1})});
   if(!updated[0]){fail(res,409,"Le dossier a été modifié simultanément. Actualise la file DG.");return true;}
   send(res,200,{decision:updated[0]});return true;
  }
  fail(res,405,"Méthode ou route non autorisée.");return true;
 }catch(error){send(res,(error as any)?.status??500,{error:error instanceof Error?error.message:"Erreur du circuit DG."});return true;}
}
