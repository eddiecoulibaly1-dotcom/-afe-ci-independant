import { createHash, randomBytes } from "node:crypto";

function config(){const url=process.env.SUPABASE_URL?.replace(/\/$/,"");const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Supabase persistence is not configured");return{url,key};}
async function rest<T>(path:string,init:RequestInit={}):Promise<T>{const c=config();const r=await fetch(`${c.url}/rest/v1/${path}`,{...init,headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,"Content-Type":"application/json",...(init.headers??{})}});const t=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${t}`);return t?JSON.parse(t) as T:undefined as T;}
async function authUsers(){const c=config();const r=await fetch(`${c.url}/auth/v1/admin/users?page=1&per_page=1000`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`}});const t=await r.text();if(!r.ok)throw new Error(`Supabase Auth ${r.status}: ${t}`);return(JSON.parse(t||"{}").users??[]) as Array<{id:string;email?:string}>;}

export async function inviteWorkspaceUser(workspaceId:string,actorId:string,email:string,role:"admin"|"editor"|"viewer"){
  const users=await authUsers(); const existing=users.find(u=>u.email?.toLowerCase()===email.trim().toLowerCase());
  if(existing){await audit(actorId,"workspace.invite.existing","workspace",workspaceId,{email:email.trim(),role});return {status:"existing",userId:existing.id,email:existing.email,role};}
  const c=config();
  const r=await fetch(`${c.url}/auth/v1/admin/invite`,{method:"POST",headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,"Content-Type":"application/json"},body:JSON.stringify({email:email.trim(),data:{workspace_id:workspaceId,workspace_role:role,invited_by:actorId}})});
  const t=await r.text();if(!r.ok)throw new Error(`Supabase Auth ${r.status}: ${t}`);const user=JSON.parse(t||"{}").user as {id:string;email?:string};
  await audit(actorId,"workspace.invite","workspace",workspaceId,{email:email.trim(),role});
  await createNotification(actorId,"workspace.invite.sent","Invitation envoyée",`Invitation envoyée à ${email.trim()}`,"workspace",workspaceId);
  return {status:"invited",userId:user.id,email:user.email,role};
}

export async function createNotification(userId:string,type:string,title:string,message:string,linkType?:string,linkId?:string){return rest("notifications",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({user_id:userId,type,title,message,link_type:linkType??null,link_id:linkId??null})});}
export async function listNotifications(userId:string){return rest<Array<{id:string;type:string;title:string;message:string;link_type:string|null;link_id:string|null;read_at:string|null;created_at:string}>>(`notifications?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=100`);}
export async function markNotificationRead(userId:string,id:string){const rows=await rest<Array<{id:string}>>(`notifications?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({read_at:new Date().toISOString()})});return rows[0]??null;}
export async function markAllNotificationsRead(userId:string){await rest(`notifications?user_id=eq.${encodeURIComponent(userId)}&read_at=is.null`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({read_at:new Date().toISOString()})});}

export async function audit(actorId:string,action:string,entityType:string,entityId:string,details:Record<string,unknown>={}){await rest("admin_audit_log",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({actor_id:actorId,action,entity_type:entityType,entity_id:entityId,details})});}
export async function listAudit(actorId:string){return rest<Array<{id:string;action:string;entity_type:string;entity_id:string;details:Record<string,unknown>;created_at:string}>>(`admin_audit_log?actor_id=eq.${encodeURIComponent(actorId)}&order=created_at.desc&limit=200`);}

function hash(token:string){return createHash("sha256").update(token).digest("hex");}
export async function createShareLink(debateId:string,userId:string,permission:"viewer"|"editor",expiresInHours?:number){const token=randomBytes(32).toString("base64url");const expires=expiresInHours&&expiresInHours>0?new Date(Date.now()+expiresInHours*3600000).toISOString():null;const rows=await rest<Array<{id:string;expires_at:string|null}>>("debate_share_links",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({debate_id:debateId,token_hash:hash(token),permission,created_by:userId,expires_at:expires})});await audit(userId,"debate.share_link.create","debate",debateId,{permission,expires_at:expires});return{id:rows[0]?.id,token,permission,expiresAt:expires};}
export async function revokeShareLink(debateId:string,userId:string,linkId:string){await rest(`debate_share_links?id=eq.${encodeURIComponent(linkId)}&debate_id=eq.${encodeURIComponent(debateId)}&created_by=eq.${encodeURIComponent(userId)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({revoked_at:new Date().toISOString()})});await audit(userId,"debate.share_link.revoke","debate",debateId,{link_id:linkId});}
export async function resolveShareLink(token:string){const rows=await rest<Array<{id:string;debate_id:string;permission:"viewer"|"editor";expires_at:string|null;revoked_at:string|null}>>(`debate_share_links?token_hash=eq.${encodeURIComponent(hash(token))}&limit=1`);const link=rows[0];if(!link||link.revoked_at||(link.expires_at&&new Date(link.expires_at)<new Date()))return null;await rest(`debate_share_links?id=eq.${encodeURIComponent(link.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({last_accessed_at:new Date().toISOString()})});return link;}

export async function getSharedDebate(debateId:string){
  const rows=await rest<Array<{id:string;user_id:string;workspace_id:string|null;question:string;context:string|null;status:string;config:Record<string,unknown>;final_decision:unknown;created_at:string;debate_rounds:Array<{round_number:number;architect_proposal:unknown;red_team_critique:unknown;judge_decision:unknown;created_at:string}>}>>(`debates?select=id,user_id,workspace_id,question,context,status,config,final_decision,created_at,debate_rounds(*)&id=eq.${encodeURIComponent(debateId)}&limit=1`);
  const d=rows[0];if(!d)return null;
  return{id:d.id,question:d.question,context:d.context,status:d.status,config:d.config,finalDecision:d.final_decision,createdAt:d.created_at,rounds:(d.debate_rounds??[]).sort((a,b)=>a.round_number-b.round_number).map(r=>({round:r.round_number,architect:r.architect_proposal,redTeam:r.red_team_critique,judge:r.judge_decision,createdAt:r.created_at}))};
}
