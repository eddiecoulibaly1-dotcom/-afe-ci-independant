import { timingSafeEqual } from "node:crypto";
import { callModel, callModelExact } from "../providers.js";
import type { Provider } from "../types.js";
import { runMissionDeliberation } from "./orchestration.js";
import { reviewMissionEvidence } from "./review.js";
import { reviewMissionSemantics } from "./semantic-review.js";

type Claim={mission_id:string;workspace_id:string;agent_id:string;lease_token:string;attempt_count:number};
type LeaseHeartbeat={stop:()=>void;assertOwned:()=>Promise<void>};
function startLeaseHeartbeat(claim:Claim):LeaseHeartbeat {
 let stopped=false,lost=false,busy=false;
 const timer=setInterval(async()=>{
  if(stopped||busy||lost)return;
  busy=true;
  try {
   const renewed=await db<boolean>("rpc/renew_afe_agent_mission_lease",{method:"POST",body:JSON.stringify({p_mission_id:claim.mission_id,p_workspace_id:claim.workspace_id,p_lease_token:claim.lease_token,p_lease_seconds:180})});
   if(renewed!==true)lost=true;
  } catch { lost=true; } finally { busy=false; }
 },45000);
 timer.unref?.();
 return {
  stop:()=>{stopped=true;clearInterval(timer);},
  assertOwned:async()=>{
   if(lost)throw new Error("Lease perdu : le worker ne peut plus publier ce rÃ©sultat.");
   const rows=await db<any[]>("afe_agent_missions?id=eq."+encodeURIComponent(claim.mission_id)+"&workspace_id=eq."+encodeURIComponent(claim.workspace_id)+"&lease_token=eq."+encodeURIComponent(claim.lease_token)+"&status=eq.running&lease_expires_at=gt."+encodeURIComponent(new Date().toISOStr¶»§q«^