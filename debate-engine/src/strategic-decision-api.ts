import type {IncomingMessage,ServerResponse} from "node:http";
import {buildDecisionPack,scoreAlternatives,compareDecisionScenarios} from "./strategic-decision-intelligence.js";
import {transitionDecision,buildIntegratedPlan,buildE10BridgeProposals,evaluateDecisionOutcome} from "./strategic-governance.js";
type User={id:string};
const enc=(s:string)=>encodeURIComponent(s);
const cfg=()=>{const url=process.env.SUPABASE_URL?.replace(/\/$/,""),key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Supabase persistence not configured");return{url,key};};
async function db<T>(path:string,init:RequestInit={}):Promise<T>{const c=cfg(),r=await fetch(c.url+"/rest/v1/"+path,{...init,headers:{apikey:c.key,Authorization:"Bearer "+c.key,"Content-Type":"application/json",...(init.headers??{})}});const raw=await r.text();if(!r.ok)throw Object.assign(Error("Supabase "+r.status+": "+raw.slice(0,300)),{status:r.status});return raw?JSON.parse(raw) as T:undefined as T;}
function send(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(data));}
async function body(req:IncomingMessage){let raw="";for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>50000)throw Object.assign(Error("Payload too large"),{status:413});}try{return JSON.parse(raw||"{}");}catch{throw Object.assign(Error("Invalid JSON"),{status:400});}}
async function access(w:string,u:User){const ws=await db<any[]>("debate_workspaces?id=eq."+enc(w)+"&limit=1");if(!ws[0])return null;if(ws[0].owner_id===u.id)return{role:"owner"};const m=await db<any[]>("debate_workspace_members?workspace_id=eq."+enc(w)+"&user_id=eq."+enc(u.id)+"&limit=1");return m[0]?{role:m[0].role}:null;}
export async function handleStrategicDecisionRequest(req:IncomingMessage,res:ServerResponse,path:string,user:User):Promise<boolean>{
 const p=path.split("/"...[truncated]