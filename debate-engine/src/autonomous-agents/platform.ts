import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "../auth.js";
import { AGENT_DEPARTMENT_TEMPLATES } from "./types.js";
import { runAgentWorkerForWorkspace } from "./worker.js";
import { assertDependencyAddition, evaluateDependencyReadiness } from "../mission-coordination.js";

type Role="owner"|"admin"|"editor"|"viewer";
const rank:Record<Role,number>={owner:4,admin:3,editor:2,viewer:1};
const enc=(v:string)=>encodeURIComponent(v);
function cfg(){const url=process.env.SUPABASE_URL?.replace(/\/$/,"");const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Persistance Supabase non configurÃ©e.");return{url,key};}
async function db<T>(path:string,init:RequestInit={}):Promise<T>{const c=cfg();const r=await fetch(c.url+"/rest/v1/"+path,{...init,headers:{apikey:c.key,Authorization:"Bearer "+c.key,"Content-Type":"application/json",...(init.headers??{})}});const t=await r.text();if(!r.ok)throw new Error("Supabase "+r.status+": "+t.slice(0,350));return t?JSON.parse(t) as T:undefined as T;}
async function body(req:IncomingMessage){let s="";for await(const c of req){s+=c;if(Buffer.byteLength(s)>250000)throw Object.assign(new Error("RequÃªte trop volumineuse."),{status:413});}try{return JSON.parse(s||"{}")}catch{throw Object.assign(new Error("JSON invalide."),{status:400});}}
function send(res:ServerResponse,status:number,data:unknown){res.writ¶»§q«^