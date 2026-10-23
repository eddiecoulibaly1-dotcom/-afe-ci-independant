import { randomUUID } from "node:crypto";

function getConfig(){
  const url=process.env.SUPABASE_URL?.replace(/\/$/,"");
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!serviceRoleKey) return null;
  return {url,serviceRoleKey};
}

async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const config=getConfig();
  if(!config) throw new Error("Supabase persistence is not configured");
  const response=await fetch(`${config.url}/rest/v1/${path}`,{
    ...init,
    headers:{apikey:config.serviceRoleKey,Authorization:`Bearer ${config.serviceRoleKey}`,"Content-Type":"application/json",...(init.headers??{})}
  });
  const text=await response.text();
  if(!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text?JSON.parse(text) as T:undefined as T;
}

async function adminUsers(){
  const config=getConfig();
  if(!config) throw new Error("Supabase persistence is not configured");
  const response=await fetch(`${config.url}/auth/v1/admin/users?page=1&per_page=1000`,{headers:{apikey:config.serviceRoleKey,Authorization:`Bearer ${config.serviceRoleKey}`}});
  const text=await response.text();
  if(!response.ok) throw new Error(`Supabase Auth ${response.status}: ${text}`);
  return (JSON.parse(text||"{}").users??[]) as Array<{id:string;email?:string}>;
}

async function findUserByEmail(email:string){
  const wanted=email.trim().toLowerCase();
  if(!wanted) throw new Error("email is required");
  const users=await adminUsers();
  return users.find(u=>u.email?.toLowerCase()===wanted)??null;
}

async function profile(userId:string){
  const rows=await request<Array<{user_id:string;display_name:string|null;phone:string|null}>>(`debate_profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  if(rows[0]) return rows[0];
  await request("debate_profiles",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:userId,display_name:null})});
  const created=await request<Array<{user_id:string;display_name:string|null;phone:string|null}>>(`debate_profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return created[0]??{user_id:userId,display_name:null,phone:null};
}

async function workspaceRole(workspaceId:string,userId:string){
  const workspace=await request<Array<{id:string;name:string;owner_id:string;created_at:string;updated_at:string}>>(`debate_workspaces?id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
  if(!workspace[0]) return null;
  if(workspace[0].owner_id===userId) return {workspace:workspace[0],role:"owner" as const};
  const members=await request<Array<{role:"owner"|"admin"|"editor"|"viewer"}>>(`debate_workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return members[0]?{workspace:workspace[0],role:members[0].role}:null;
}

export async function getMe(userId:string,email?:string){
  const p=await profile(userId);
  const workspaces=await listWorkspaces(userId);
  return {id:userId,email,profile:p,workspaces};
}

export async function updateProfile(userId:string,input:{displayName?:string;phone?:string}){
  const existing=await profile(userId);
  const displayName=input.displayName===undefined?existing.display_name:input.displayName.trim().slice(0,120);
  const phone=input.phone===undefined?existing.phone:input.phone.trim().slice(0,40);
  const rows=await request<Array<{user_id:string;display_name:string|null;phone:string|null}>>(`debate_profiles?user_id=eq.${encodeURIComponent(userId)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({display_name:displayName||null,phone:phone||null,updated_at:new Date().toISOString()})});
  return rows[0]??await profile(userId);
}

export async function listWorkspaces(userId:string){
  const owned=await request<Array<{id:string;name:string;owner_id:string;created_at:string;updated_at:string}>>(`debate_workspaces?owner_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
  const memberships=await request<Array<{workspace_id:string;role:"owner"|"admin"|"editor"|"viewer"}>>(`debate_workspace_members?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
  const ids=[...new Set([...owned.map(x=>x.id),...memberships.map(x=>x.workspace_id)])];
  const all=ids.length?await request<Array<{id:string;name:string;owner_id:string;created_at:string;updated_at:string}>>(`debate_workspaces?id=in.(${ids.join(",")})&order=created_at.desc`):[];
  return all.map(w=>({
    ...w,
    role:w.owner_id===userId?"owner":(memberships.find(m=>m.workspace_id===w.id)?.role??"viewer")
  }));
}

export async function createWorkspace(userId:string,name:string){
  const clean=name.trim().slice(0,120);
  if(clean.length<2) throw new Error("Le nom de l'espace doit contenir au moins 2 caractères");
  const rows=await request<Array<{id:string;name:string;owner_id:string;created_at:string;updated_at:string}>>("debate_workspaces",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({name:clean,owner_id:userId})});
  const workspace=rows[0];
  if(!workspace) throw new Error("Workspace creation failed");
  await request("debate_workspace_members",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:workspace.id,user_id:userId,role:"owner"})});
  return { ...workspace, role:"owner" as const };
}

export async function getWorkspace(workspaceId:string,userId:string){
  const access=await workspaceRole(workspaceId,userId);
  if(!access) return null;
  const members=await request<Array<{user_id:string;role:"owner"|"admin"|"editor"|"viewer";created_at:string}>>(`debate_workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.asc`);
  const ids=members.map(m=>m.user_id);
  const profiles=ids.length?await request<Array<{user_id:string;display_name:string|null;phone:string|null}>>(`debate_profiles?user_id=in.(${ids.join(",")})`):[];
  return {workspace:access.workspace,role:access.role,members:members.map(m=>({...m,profile:profiles.find(p=>p.user_id===m.user_id)??null}))};
}

export async function addWorkspaceMember(workspaceId:string,actorId:string,email:string,role:"admin"|"editor"|"viewer"){
  const access=await workspaceRole(workspaceId,actorId);
  if(!access||!(["owner","admin"] as string[]).includes(access.role)) throw new Error("Droits insuffisants pour gérer cet espace");
  const target=await findUserByEmail(email);
  if(!target) throw new Error("Cet utilisateur n'a pas encore de compte. Il doit d'abord créer son compte AFE-CI Debate Engine.");
  await request("debate_workspace_members?on_conflict=workspace_id%2Cuser_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({workspace_id:workspaceId,user_id:target.id,role})});
  return {userId:target.id,email:target.email,role};
}

export async function updateWorkspaceMember(workspaceId:string,actorId:string,targetId:string,role:"admin"|"editor"|"viewer"){
  const access=await workspaceRole(workspaceId,actorId);
  if(!access||!(["owner","admin"] as string[]).includes(access.role)) throw new Error("Droits insuffisants pour gérer cet espace");
  if(targetId===access.workspace.owner_id) throw new Error("Le propriétaire conserve le rôle owner");
  const target=await request<Array<{user_id:string;role:string}>>(`debate_workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(targetId)}&limit=1`);
  if(!target[0]) throw new Error("Membre introuvable");
  await request(`debate_workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(targetId)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({role})});
}

export async function removeWorkspaceMember(workspaceId:string,actorId:string,targetId:string){
  const access=await workspaceRole(workspaceId,actorId);
  if(!access||!(["owner","admin"] as string[]).includes(access.role)) throw new Error("Droits insuffisants pour gérer cet espace");
  if(targetId===access.workspace.owner_id) throw new Error("Le propriétaire ne peut pas être retiré");
  await request(`debate_workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(targetId)}`,{method:"DELETE"});
}

async function debateRow(debateId:string){
  const rows=await request<Array<{id:string;user_id:string|null;workspace_id:string|null}>>(`debates?id=eq.${encodeURIComponent(debateId)}&limit=1`);
  return rows[0]??null;
}

async function canEditDebate(debateId:string,userId:string){
  const d=await debateRow(debateId);
  if(!d) return false;
  if(d.user_id===userId) return true;
  if(d.workspace_id){const access=await workspaceRole(d.workspace_id,userId);if(access&&["owner","admin","editor"].includes(access.role)) return true;}
  const shares=await request<Array<{permission:string}>>(`debate_shares?debate_id=eq.${encodeURIComponent(debateId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return shares[0]?.permission==="editor";
}

export async function setDebateWorkspace(debateId:string,userId:string,workspaceId:string|null){
  if(!(await canEditDebate(debateId,userId))) throw new Error("Droits insuffisants pour déplacer ce débat");
  if(workspaceId){const access=await workspaceRole(workspaceId,userId);if(!access||!["owner","admin","editor"].includes(access.role)) throw new Error("Tu n'as pas accès à cet espace");}
  await request(`debates?id=eq.${encodeURIComponent(debateId)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:workspaceId})});
}

export async function listDebateShares(debateId:string,userId:string){
  if(!(await canEditDebate(debateId,userId))) throw new Error("Droits insuffisants pour gérer le partage");
  const shares=await request<Array<{user_id:string;permission:"viewer"|"editor";shared_by:string;created_at:string}>>(`debate_shares?debate_id=eq.${encodeURIComponent(debateId)}&order=created_at.asc`);
  const ids=shares.map(s=>s.user_id);
  const profiles=ids.length?await request<Array<{user_id:string;display_name:string|null}>>(`debate_profiles?user_id=in.(${ids.join(",")})`):[];
  return shares.map(s=>({...s,profile:profiles.find(p=>p.user_id===s.user_id)??null}));
}

export async function shareDebate(debateId:string,userId:string,email:string,permission:"viewer"|"editor"){
  if(!(await canEditDebate(debateId,userId))) throw new Error("Droits insuffisants pour partager ce débat");
  const target=await findUserByEmail(email);
  if(!target) throw new Error("Cet utilisateur n'a pas encore de compte. Il doit d'abord créer son compte.");
  const debate=await debateRow(debateId);
  if(!debate) throw new Error("Débat introuvable");
  if(target.id===debate.user_id) throw new Error("Le propriétaire possède déjà ce débat");
  await request("debate_shares?on_conflict=debate_id%2Cuser_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({debate_id:debateId,user_id:target.id,permission,shared_by:userId})});
  return {userId:target.id,email:target.email,permission};
}

export async function removeDebateShare(debateId:string,actorId:string,targetId:string){
  if(!(await canEditDebate(debateId,actorId))) throw new Error("Droits insuffisants pour gérer le partage");
  await request(`debate_shares?debate_id=eq.${encodeURIComponent(debateId)}&user_id=eq.${encodeURIComponent(targetId)}`,{method:"DELETE"});
}

export function workspaceStoreEnabled(){return Boolean(getConfig());}
export const newWorkspaceId=()=>randomUUID();
