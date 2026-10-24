import type { Debate, DebateRound, JudgeDecision } from "./types.js";

function getConfig(){
  const url=process.env.SUPABASE_URL?.replace(/\/$/,"");
  const secretKey=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secretKey)return null;
  return{url,secretKey};
}

async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const config=getConfig();
  if(!config)throw new Error("Supabase persistence is not configured");
  const response=await fetch(`${config.url}/rest/v1/${path}`,{...init,headers:{apikey:config.secretKey,Authorization:`Bearer ${config.secretKey}`,"Content-Type":"application/json",...(init.headers??{})}});
  const text=await response.text();
  if(!response.ok)throw new Error(`Supabase ${response.status}: ${text}`);
  return text?JSON.parse(text) as T:undefined as T;
}

export function supabasePersistenceEnabled(){return Boolean(getConfig());}

export async function saveDebateToSupabase(debate:Debate):Promise<void>{
  if(!debate.userId)throw new Error("Authenticated user is required");
  await request("debates?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:debate.id,user_id:debate.userId,workspace_id:debate.workspaceId??null,question:debate.question,context:debate.context??null,mode:"decision",status:debate.status,config:debate.config??{},final_decision:debate.finalDecision??null})});
  for(const round of debate.rounds){
    const roundRows=await request<Array<{id:string}>>("debate_rounds?on_conflict=debate_id%2Cround_number&select=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({debate_id:debate.id,round_number:round.round,architect_proposal:round.architect,red_team_critique:round.redTeam,judge_decision:round.judge})});
    const roundId=roundRows[0]?.id;
    if(!roundId)throw new Error(`Supabase did not return round id for round ${round.round}`);
    await request("debate_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify([{debate_id:debate.id,round_id:roundId,event_type:"architect_proposal",actor:"architect",payload:round.architect},{debate_id:debate.id,round_id:roundId,event_type:"evidence_audit",actor:"evidence_engine",payload:round.evidenceAudit??{}},{debate_id:debate.id,round_id:roundId,event_type:"red_team_critique",actor:"red_team",payload:round.redTeam},{debate_id:debate.id,round_id:roundId,event_type:"judge_decision",actor:"judge",payload:round.judge}])});
    if(round.evidenceAudit?.records.length){
      const evidenceRows=round.evidenceAudit.records.flatMap(record=>record.evidenceRefs.map(ref=>({debate_id:debate.id,round_id:roundId,kind:"source",title:`${record.claimId} evidence reference`,url:ref.startsWith("http://")||ref.startsWith("https://")?ref:null,excerpt:null,strength:Math.round(record.confidence*100),metadata:{claim_id:record.claimId,classification:record.classification,status:record.status,rationale:record.rationale}})));
      if(evidenceRows.length)await request("debate_evidence",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(evidenceRows)});
    }
    const hypotheses=round.architect.claims.filter(c=>c.type==="hypothesis").map(c=>({debate_id:debate.id,statement:c.statement,status:"open",confidence:c.confidence,source_round:round.round}));
    if(hypotheses.length)await request("debate_hypotheses",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(hypotheses)});
  }
  if(debate.finalDecision)await request("debate_decisions",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({debate_id:debate.id,decision_type:debate.status==="converged"?"final":"unresolved",statement:debate.finalDecision.decision,score:Math.max(debate.finalDecision.architectScore,debate.finalDecision.redTeamScore),rationale:debate.finalDecision.rationale,status:debate.status==="converged"?"accepted":"needs_validation"})});
}

type DebateRow=Omit<Debate,"rounds"|"finalDecision"|"userId"|"workspaceId">&{user_id?:string|null;workspace_id?:string|null;final_decision?:JudgeDecision|null;debate_rounds:Array<{round_number:number;architect_proposal:DebateRound["architect"];red_team_critique:DebateRound["redTeam"];judge_decision:DebateRound["judge"];created_at:string}>};
function normalizeRow(row:DebateRow):Debate{return{id:row.id,userId:row.user_id??undefined,workspaceId:row.workspace_id??null,question:row.question,context:row.context,status:row.status,config:row.config,finalDecision:row.final_decision??undefined,rounds:(row.debate_rounds??[]).sort((a,b)=>a.round_number-b.round_number).map(r=>({round:r.round_number,architect:r.architect_proposal,redTeam:r.red_team_critique,judge:r.judge_decision,createdAt:r.created_at}))};}

async function accessibleIds(userId:string){
  const memberships=await request<Array<{workspace_id:string}>>(`debate_workspace_members?user_id=eq.${encodeURIComponent(userId)}&select=workspace_id`);
  const shares=await request<Array<{debate_id:string}>>(`debate_shares?user_id=eq.${encodeURIComponent(userId)}&select=debate_id`);
  return {workspaceIds:[...new Set(memberships.map(m=>m.workspace_id))],shareIds:[...new Set(shares.map(s=>s.debate_id))]};
}

export async function listDebatesFromSupabase(userId:string){
  const {workspaceIds,shareIds}=await accessibleIds(userId);
  const own=await request<DebateRow[]>(`debates?select=*,debate_rounds(*)&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
  const workspaceRows=workspaceIds.length?await request<DebateRow[]>(`debates?select=*,debate_rounds(*)&workspace_id=in.(${workspaceIds.join(",")})&order=created_at.desc`):[];
  const sharedRows=shareIds.length?await request<DebateRow[]>(`debates?select=*,debate_rounds(*)&id=in.(${shareIds.join(",")})&order=created_at.desc`):[];
  const map=new Map<string,Debate>();
  for(const row of [...own,...workspaceRows,...sharedRows])map.set(row.id,normalizeRow(row));
  return [...map.values()];
}

export async function getDebateFromSupabase(id:string,userId:string){
  const rows=await request<DebateRow[]>(`debates?select=*,debate_rounds(*)&id=eq.${encodeURIComponent(id)}&limit=1`);
  const row=rows[0];
  if(!row)return null;
  if(row.user_id===userId)return normalizeRow(row);
  if(row.workspace_id){const members=await request<Array<{user_id:string}>>(`debate_workspace_members?workspace_id=eq.${encodeURIComponent(row.workspace_id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);if(members[0])return normalizeRow(row);}
  const shares=await request<Array<{user_id:string}>>(`debate_shares?debate_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return shares[0]?normalizeRow(row):null;
}
