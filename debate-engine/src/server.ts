import "node:process";
import { createServer } from "node:http";
import { runDebate } from "./engine.js";
import { getDebate, listDebates, saveDebate } from "./store.js";
import { LAB_HTML, LAB_MANIFEST, LAB_SW, LAB_ICON } from "./lab.js";
import { authenticateRequest, publicAuthConfig } from "./auth.js";
import type { DebateConfig, Provider } from "./types.js";

const VERSION="0.8.0";
const port=Number(process.env.PORT??8787);
const json=(value:unknown)=>JSON.stringify(value,null,2);
function config():DebateConfig{const provider=(v:string|undefined,f:Provider):Provider=>v==="gemini"?"gemini":v==="openai"?"openai":f;return{maxRounds:Number(process.env.MAX_ROUNDS??6),convergenceScore:Number(process.env.CONVERGENCE_SCORE??85),architect:{provider:provider(process.env.ARCHITECT_PROVIDER,"openai"),model:process.env.OPENAI_MODEL??"gpt-5.5"},redTeam:{provider:provider(process.env.RED_TEAM_PROVIDER,"gemini"),model:process.env.GEMINI_MODEL??"gemini-3.8-flash"},judge:{provider:provider(process.env.JUDGE_PROVIDER,"openai"),model:process.env.JUDGE_MODEL??"gpt-5.5"}};}
function send(res:import("node:http").ServerResponse,status:number,value:unknown){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(json(value));}
async function body(req:import("node:http").IncomingMessage){let text="";for await(const chunk of req) text+=chunk;return JSON.parse(text||"{}");}

const server=createServer(async(req,res)=>{try{
  const pathname=req.url?.split("?")[0];
  if(req.method==="GET"&&(pathname==="/"||pathname==="/lab"||pathname==="/lab/")){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});res.end(LAB_HTML);return;}
  if(req.method==="GET"&&pathname==="/lab/manifest.webmanifest"){res.writeHead(200,{"Content-Type":"application/manifest+json; charset=utf-8","Cache-Control":"public,max-age=3600"});res.end(LAB_MANIFEST);return;}
  if(req.method==="GET"&&pathname==="/lab/sw.js"){res.writeHead(200,{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-cache"});res.end(LAB_SW);return;}
  if(req.method==="GET"&&pathname==="/lab/icon.svg"){res.writeHead(200,{"Content-Type":"image/svg+xml; charset=utf-8","Cache-Control":"public,max-age=86400"});res.end(LAB_ICON);return;}
  if(req.method==="GET"&&pathname==="/health"){send(res,200,{ok:true,service:"afe-ci-debate-engine",version:VERSION,evidenceEngine:true,mobileLab:true,pwa:true,auth:true,privateHistory:true,deployment:"ready"});return;}
  if(req.method==="GET"&&pathname==="/auth/config"){const auth=publicAuthConfig();if(!auth){send(res,503,{error:"Supabase public auth is not configured"});return;}send(res,200,auth);return;}

  const user=await authenticateRequest(req); if(!user){send(res,401,{error:"Authentication required"});return;}
  if(req.method==="GET"&&pathname==="/me"){send(res,200,user);return;}
  if(req.method==="GET"&&pathname==="/debates"){send(res,200,await listDebates(user.id));return;}
  if(req.method==="GET"&&pathname?.startsWith("/debates/")){const id=decodeURIComponent(pathname.slice("/debates/".length));const debate=await getDebate(id,user.id);if(!debate){send(res,404,{error:"Debate not found"});return;}send(res,200,debate);return;}
  if(req.method!=="POST"||(pathname!=="/debates/run"&&pathname!=="/api/debates/run")){send(res,404,{error:"Not found"});return;}
  const input=await body(req) as {question?:string;context?:string}; if(!input.question?.trim()) throw new Error("question is required");
  const result=await runDebate(input.question.trim(),input.context,config()); result.userId=user.id; await saveDebate(result); send(res,200,result);
}catch(error){send(res,error instanceof Error&&error.message==="Authentication required"?401:400,{error:error instanceof Error?error.message:"Unknown error"});}});
server.listen(port,()=>console.log(`AFE-CI Debate Engine v${VERSION} listening on port ${port}`));
