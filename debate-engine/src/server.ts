import "node:process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { runDebateAgentStep } from "./engine.js";
import { assessMarketEvidence } from "./market-intelligence.js";
import { CHICK_PRICE_SUPPLIERS, CHICK_QUOTATION_FIELDS } from "./chick-market-catalog.js";
import { fetchConfiguredMarketFeed } from "./market-sources.js";
import { correctMarketPrice, getMarketPriceHistory, importMarketCsv, listMarketPrices, marketPriceStorageEnabled } from "./market-price-store.js";
import { getDebate, listDebates, saveDebate } from "./store.js";
import { assertSupabaseSchemaReady, supabasePersistenceEnabled, claimDebateExecutionStep, completeDebateExecutionStep, failDebateExecutionStep, listDebateExecutionSteps } from "./supabase-store.js";
import { LAB_HTML, LAB_MANIFEST, LAB_SW, LAB_ICON } from "./lab-v106.js";
import { authenticateRequest, publicAuthConfig } from "./auth.js";
import { addWorkspaceMember, createWorkspace, getMe, getWorkspace, listDebateShares, listWorkspaces, removeDebateShare, removeWorkspaceMember, setDebateWorkspace, shareDebate, updateProfile, updateWorkspaceMember } from "./workspace-store.js";
import { inviteWorkspaceUser, createNotification, listNotifications, markNotificationRead, markAllNotificationsRead, listAudit, createShareLink, listShareLinks, revokeShareLink, resolveShareLink, getSharedDebate } from "./v1-store.js";
import type { DebateConfig, Provider } from "./types.js";
const VERSION="1.1.2",port=Number(process.env.PORT??8787);
const json=(v:unknown)=>JSON.stringify(v,null,2);
const esc=(v:unknown)=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m] ?? ""));
function boundedNumber(raw:string|undefined,fallback:number,min:number,max:number):number{const value=Number(raw);return Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;}
function config():DebateConfig{const p=(v:string|undefined,f:Provider):Provider=>v==="gemini"?"gemini":v==="openai"?"openai":f;const model=(provider:Provider,override?:string)=>override?.trim()||(provider==="gemini"?(process.env.GEMINI_MODEL?.trim()||"gemini-3.8-flash"):(process.env.OPENAI_MODEL?.trim()||"gpt-4.1-mini"));const architectProvider=p(process.env.ARCHITECT_PROVIDER,"openai"),redTeamProvider=p(process.env.RED_TEAM_PROVIDER,"gemini"),judgeProvider=p(process.env.JUDGE_PROVIDER,"openai");return{maxRounds:Math.round(boundedNumber(process.env.MAX_ROUNDS,3,1,6)),convergenceScore:boundedNumber(process.env.CONVERGENCE_SCORE,85,0,100),architect:{provider:architectProvider,model:model(architectProvider,process.env.ARCHITECT_MODEL)},redTeam:{provider:redTeamProvider,model:model(redTeamProvider,process.env.RED_TEAM_MODEL)},judge:{provider:judgeProvider,model:model(judgeProvider,process.env.JUDGE_MODEL)}};}
function send(res:import("node:http").ServerResponse,s:number,v:unknown){res.writeHead(s,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});res.end(json(v));}
function html(res:import("node:http").ServerResponse,s:number,v:string){const auth=publicAuthConfig();const authOrigin=auth?.url??"";const wsOrigin=authOrigin.replace(/^https:/,"wss:").replace(/^http:/,"ws:");const connectSrc=["'self'",authOrigin,wsOrigin].filter(Boolean).join(" ");const csp="default-src 'none'; connect-src "+connectSrc+"; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; base-uri 'none'; form-action 'none'";res.writeHead(s,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":csp});res.end(v);}
async function body(req:import("node:http").IncomingMessage){
  let t="";
  for await(const chunk of req){
    t+=chunk;
    if(Buffer.byteLength(t,"utf8")>1_000_000)throw new Error("Request body too large");
  }
  try{return JSON.parse(t||"{}");}
  catch{throw new Error("JSON invalide dans le corps de la requête.");}
}
function sharePage(permission:"viewer"|"editor",expiresAt:string|null,debate:any){const expired=expiresAt&&new Date(expiresAt)<=new Date();if(!debate)return `<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lien indisponible</title><style>body{margin:0;background:#f5f7fb;font-family:system-ui,-apple-system,sans-serif;color:#172033;display:grid;min-height:100vh;place-items:center;padding:20px}.card{max-width:520px;background:#fff;border:1px solid #e4e8f0;border-radius:22px;padding:28px;box-shadow:0 10px 30px #0001}h1{font-size:24px;margin:0 0 10px}.muted{color:#667085;line-height:1.55}</style><div class="card"><h1>Lien indisponible</h1><p class="muted">Ce lien de partage est expiré, révoqué ou le débat n’existe plus.</p></div></html>`;
const status=expired?"Expiré":(debate.status??"Disponible");const decision=debate.finalDecision;const decisionText=typeof decision==="string"?decision:(decision?.decision??decision?.summary??decision?.recommendation??"");const rounds=(debate.rounds??[]).map((r:any)=>`<details><summary>Tour ${esc(r.round)}</summary><div class="block"><b>Architecte</b><pre>${esc(JSON.stringify(r.architect,null,2))}</pre></div><div class="block"><b>Red Team</b><pre>${esc(JSON.stringify(r.redTeam,null,2))}</pre></div><div class="block"><b>Arbitre</b><pre>${esc(JSON.stringify(r.judge,null,2))}</pre></div></details>`).join("");
return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b1220"><title>Décision partagée · AFE-CI</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#172033;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:760px;margin:auto;padding:18px 14px 40px}.top{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:14px}.brand{font-weight:800;letter-spacing:.2px}.badge{border-radius:999px;padding:7px 10px;background:#e8eefc;font-size:12px;font-weight:700}.card{background:#fff;border:1px solid #e2e7ef;border-radius:20px;padding:18px;margin:12px 0;box-shadow:0 6px 22px #1822300d}h1{font-size:25px;line-height:1.15;margin:0 0 10px}.muted{color:#667085}.decision{font-size:18px;line-height:1.55;white-space:pre-wrap}.meta{font-size:12px;color:#667085}.context{white-space:pre-wrap;line-height:1.5}.rounds{margin-top:10px}details{border:1px solid #e2e7ef;border-radius:14px;padding:12px;margin:8px 0;background:#fbfcfe}summary{font-weight:700;cursor:pointer}.block{margin-top:12px}.block b{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#667085}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fb;border-radius:10px;padding:10px;margin:7px 0 0}.pill{display:inline-block;padding:5px 9px;border-radius:999px;background:#f1f3f7;font-size:12px}.footer{text-align:center;color:#98a2b3;font-size:12px;margin-top:20px}</style></head><body><main class="wrap"><div class="top"><div class="brand">AFE-CI · Décision</div><span class="badge">${esc(permission)}</span></div><section class="card"><div class="meta">Lien sécurisé · ${esc(status)}${expiresAt?` · expire le ${esc(new Date(expiresAt).toLocaleString("fr-FR"))}`:" · sans expiration"}</div><h1>${esc(debate.question)}</h1>${debate.context?`<div class="context muted">${esc(debate.context)}</div>`:""}</section><section class="card"><div class="pill">Décision finale</div><div class="decision" style="margin-top:10px">${esc(decisionText||"Aucune décision finale disponible.")}</div></section><section class="card"><div class="pill">Déroulé du débat</div><div class="rounds">${rounds||`<p class="muted">Aucun tour disponible.</p>`}</div></section><div class="footer">Partagé via AFE-CI · Les secrets et clés internes ne sont pas exposés.</div></main></body></html>`;}
async function handler(req:import("node:http").IncomingMessage,res:import("node:http").ServerResponse){try{const url=new URL(req.url??"/","http://localhost"),path=url.pathname;
if(req.method==="GET"&&path==="/share"){const token=url.searchParams.get("token")?.trim();if(!token){html(res,400,sharePage("viewer",null,null));return;}const link=await resolveShareLink(token);if(!link){html(res,410,sharePage("viewer",null,null));return;}const debate=await getSharedDebate(link.debate_id);if(!debate){html(res,404,sharePage(link.permission,link.expires_at,null));return;}html(res,200,sharePage(link.permission,link.expires_at,debate));return;}
if(req.method==="GET"&&path==="/api/share"){const token=url.searchParams.get("token")?.trim();if(!token){send(res,400,{error:"token is required"});return;}const link=await resolveShareLink(token);if(!link){send(res,410,{error:"Share link expired or revoked"});return;}const debate=await getSharedDebate(link.debate_id);if(!debate){send(res,404,{error:"Debate not found"});return;}send(res,200,{permission:link.permission,expiresAt:link.expires_at,debate});return;}
if(req.method==="GET"&&(path==="/"||path==="/lab"||path==="/lab/")){html(res,200,LAB_HTML);return;}
if(req.method==="GET"&&path==="/lab/manifest.webmanifest"){res.writeHead(200,{"Content-Type":"application/manifest+json; charset=utf-8"});res.end(LAB_MANIFEST);return;}if(req.method==="GET"&&path==="/lab/sw.js"){res.writeHead(200,{"Content-Type":"application/javascript; charset=utf-8"});res.end(LAB_SW);return;}if(req.method==="GET"&&path==="/lab/icon.svg"){res.writeHead(200,{"Content-Type":"image/svg+xml; charset=utf-8"});res.end(LAB_ICON);return;}
if(req.method==="GET"&&path==="/ready"){try{await assertSupabaseSchemaReady();send(res,200,{ok:true,service:"afe-ci-debate-engine",version:VERSION,database:"ready"});}catch(e){send(res,503,{ok:false,service:"afe-ci-debate-engine",version:VERSION,database:"not_ready",error:e instanceof Error?e.message:"Database readiness check failed"});}return;}
if(req.method==="GET"&&path==="/health"){send(res,200,{ok:true,service:"afe-ci-debate-engine",version:VERSION,evidenceEngine:true,mobileLab:true,pwa:true,auth:true,privateHistory:true,workspaces:true,roles:true,controlledSharing:true,v1_0_3:true,v1_0_5:true,v1_0_6:true,v1_0_7:true,notifications:true,audit:true,secureShareLinks:true,publicShareViewer:true,visualShareViewer:true,shareCenter:true,serverBackedShareLinks:true,invitations:true,realtime:true,deployment:"healthy"});return;}
if(req.method==="GET"&&path==="/auth/config"){const a=publicAuthConfig();if(!a){send(res,503,{error:"Supabase public auth is not configured"});return;}send(res,200,a);return;}
if(req.method==="POST"&&path==="/auth/session"){
const a=publicAuthConfig();if(!a){send(res,503,{error:"Supabase public auth is not configured"});return;}
const input=await body(req) as {action?:"signin"|"signup"|"refresh"|"logout";email?:string;password?:string;refresh_token?:string;access_token?:string};
let endpoint="",payload:Record<string,string>={},headers:Record<string,string>={apikey:a.publishableKey,"Content-Type":"application/json"};
if(input.action==="signin"){if(!input.email||!input.password){send(res,400,{error:"Email et mot de passe requis."});return;}endpoint="/auth/v1/token?grant_type=password";payload={email:input.email,password:input.password};}
else if(input.action==="signup"){if(!input.email||!input.password){send(res,400,{error:"Email et mot de passe requis."});return;}endpoint="/auth/v1/signup";payload={email:input.email,password:input.password};}
else if(input.action==="refresh"){if(!input.refresh_token){send(res,400,{error:"Jeton de renouvellement requis."});return;}endpoint="/auth/v1/token?grant_type=refresh_token";payload={refresh_token:input.refresh_token};}
else if(input.action==="logout"){if(!input.access_token){send(res,400,{error:"Session requise."});return;}endpoint="/auth/v1/logout";headers.Authorization="Bearer "+input.access_token;}
else{send(res,400,{error:"Action d'authentification invalide."});return;}
try{const upstream=await fetch(a.url+endpoint,{method:"POST",headers,body:input.action==="logout"?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});const raw=await upstream.text();let result:unknown={};try{result=JSON.parse(raw||"{}")}catch{result={error:"Réponse Auth Supabase illisible."}}send(res,upstream.status,result);}
catch(e){console.error("[afe-ci-auth-proxy] Supabase Auth request failed",e);send(res,502,{error:"Le serveur AFE-CI n'arrive pas à joindre le service Auth Supabase."});}
return;
}
const user=await authenticateRequest(req);if(!user){send(res,401,{error:"Authentication required"});return;}
if(req.method==="GET"&&path==="/market-prices/chick-catalog"){
send(res,200,{category:"chick",currency:"XOF",unit:"FCFA/sujet",suppliers:CHICK_PRICE_SUPPLIERS,quotationFields:CHICK_QUOTATION_FIELDS,priceStatus:"No current supplier tariff is assumed; only dated, sourced quotations are displayed."});return;
}
if(req.method==="POST"&&path==="/market-prices/import"){
if(!marketPriceStorageEnabled()){send(res,503,{error:"Le stockage durable des prix n'est pas configuré. Appliquer d'abord la migration SQL approuvée et configurer Supabase côté serveur."});return;}
const input=await body(req) as {csv?:string;fileName?:string};
if(typeof input.csv!=="string"||!input.csv.trim()){send(res,400,{error:"Le champ csv (texte CSV UTF-8) est obligatoire."});return;}
const result=await importMarketCsv(user.id,input.csv,input.fileName);
send(res,201,{mode:"persistent_import",persisted:true,...result});return;
}
const historyMatch=path.match(/^\/market-prices\/([^/]+)\/history$/);
if(req.method==="GET"&&historyMatch){
if(!marketPriceStorageEnabled()){send(res,503,{error:"Stockage durable non configuré."});return;}
const history=await getMarketPriceHistory(user.id,decodeURIComponent(historyMatch[1]));
if(!history){send(res,404,{error:"Cotation introuvable."});return;}
send(res,200,history);return;
}
const correctionMatch=path.match(/^\/market-prices\/([^/]+)\/corrections$/);
if(req.method==="POST"&&correctionMatch){
if(!marketPriceStorageEnabled()){send(res,503,{error:"Stockage durable non configuré."});return;}
const input=await body(req) as {value?:number;reason?:string;publishedAt?:string;observedAt?:string;retrievedAt?:string;validUntil?:string;notes?:string};
if(!input||typeof input.value!=="number"||!Number.isFinite(input.value)||typeof input.reason!=="string"||input.reason.trim().length<8){
send(res,400,{error:"Une valeur numérique valide et un motif d'au moins 8 caractères sont obligatoires."});return;
}
const correction=await correctMarketPrice(user.id,{...input,value:input.value,reason:input.reason,id:decodeURIComponent(correctionMatch[1])});
send(res,201,{persisted:true,correction});return;
}
if(req.method==="GET"&&path==="/market-prices"){
if(!marketPriceStorageEnabled()){send(res,503,{error:"Stockage durable non configuré."});return;}
const filters:Record<string,string|undefined>={normalized_product:url.searchParams.get("product")??undefined,kind:url.searchParams.get("kind")??undefined,country:url.searchParams.get("country")??undefined,region:url.searchParams.get("region")??undefined,city:url.searchParams.get("city")??undefined,currency:url.searchParams.get("currency")??undefined,unit:url.searchParams.get("unit")??undefined};
const observations=await listMarketPrices(user.id,filters);
send(res,200,{persisted:true,count:observations.length,observations});return;
}
if(req.method==="GET"&&path==="/me"){send(res,200,await getMe(user.id,user.email));return;}if(req.method==="PATCH"&&path==="/me"){send(res,200,{profile:await updateProfile(user.id,await body(req) as {displayName?:string;phone?:string})});return;}
if(req.method==="GET"&&path==="/notifications"){send(res,200,await listNotifications(user.id));return;}const nm=path.match(/^\/notifications\/([^/]+)$/);if(nm&&req.method==="PATCH"){await markNotificationRead(user.id,decodeURIComponent(nm[1]));send(res,200,{ok:true});return;}if(req.method==="POST"&&path==="/notifications/read-all"){await markAllNotificationsRead(user.id);send(res,200,{ok:true});return;}if(req.method==="GET"&&path==="/audit"){send(res,200,await listAudit(user.id));return;}
if(req.method==="GET"&&path==="/workspaces"){send(res,200,await listWorkspaces(user.id));return;}if(req.method==="POST"&&path==="/workspaces"){const i=await body(req) as {name?:string};if(!i.name?.trim())throw new Error("workspace name is required");send(res,201,await createWorkspace(user.id,i.name));return;}
const wi=path.match(/^\/workspaces\/([^/]+)\/invitations$/);if(wi&&req.method==="POST"){const wid=decodeURIComponent(wi[1]),w=await getWorkspace(wid,user.id);if(!w||!["owner","admin"].includes(w.role))throw new Error("Droits insuffisants pour inviter dans cet espace");const i=await body(req) as {email?:string;role?:"admin"|"editor"|"viewer"};if(!i.email?.trim())throw new Error("email is required");const invited=await inviteWorkspaceUser(wid,user.id,i.email,i.role??"viewer");if(invited.status==="existing"){await addWorkspaceMember(wid,user.id,i.email,i.role??"viewer");await createNotification(invited.userId,"workspace.added","Ajout à un espace",`Tu as été ajouté à un espace avec le rôle ${i.role??"viewer"}`,"workspace",wid);}send(res,201,invited);return;}
const wm=path.match(/^\/workspaces\/([^/]+)(?:\/members(?:\/([^/]+))?)?$/);if(wm){const wid=decodeURIComponent(wm[1]),tid=wm[2]?decodeURIComponent(wm[2]):null;if(req.method==="GET"&&!tid){const w=await getWorkspace(wid,user.id);if(!w){send(res,404,{error:"Workspace not found"});return;}send(res,200,w);return;}if(req.method==="POST"&&!tid){const i=await body(req) as {email?:string;role?:"admin"|"editor"|"viewer"};send(res,201,await addWorkspaceMember(wid,user.id,i.email??"",i.role??"viewer"));return;}if(req.method==="PATCH"&&tid){const i=await body(req) as {role?:"admin"|"editor"|"viewer"};await updateWorkspaceMember(wid,user.id,tid,i.role??"viewer");send(res,200,{ok:true});return;}if(req.method==="DELETE"&&tid){await removeWorkspaceMember(wid,user.id,tid);send(res,200,{ok:true});return;}}
const ds=path.match(/^\/debates\/([^/]+)\/shares(?:\/([^/]+))?$/);if(ds){const id=decodeURIComponent(ds[1]),tid=ds[2]?decodeURIComponent(ds[2]):null;if(req.method==="GET"&&!tid){send(res,200,await listDebateShares(id,user.id));return;}if(req.method==="POST"&&!tid){const i=await body(req) as {email?:string;permission?:"viewer"|"editor"};send(res,201,await shareDebate(id,user.id,i.email??"",i.permission??"viewer"));return;}if(req.method==="DELETE"&&tid){await removeDebateShare(id,user.id,tid);send(res,200,{ok:true});return;}}
const sl=path.match(/^\/debates\/([^/]+)\/share-links$/);if(sl){const id=decodeURIComponent(sl[1]);if(!await getDebate(id,user.id))throw new Error("Débat introuvable ou accès refusé");if(req.method==="GET"){send(res,200,await listShareLinks(id,user.id));return;}if(req.method==="POST"){const i=await body(req) as {permission?:"viewer"|"editor";expiresInHours?:number};send(res,201,await createShareLink(id,user.id,i.permission??"viewer",i.expiresInHours));return;}}
const slr=path.match(/^\/debates\/([^/]+)\/share-links\/([^/]+)$/);if(slr&&req.method==="DELETE"){const id=decodeURIComponent(slr[1]);if(!await getDebate(id,user.id))throw new Error("Débat introuvable ou accès refusé");await revokeShareLink(id,user.id,decodeURIComponent(slr[2]));send(res,200,{ok:true});return;}
const dw=path.match(/^\/debates\/([^/]+)\/workspace$/);if(dw&&req.method==="POST"){const id=decodeURIComponent(dw[1]),i=await body(req) as {workspaceId?:string|null};await setDebateWorkspace(id,user.id,i.workspaceId??null);send(res,200,await getDebate(id,user.id));return;}
if(req.method==="GET"&&path==="/debates"){send(res,200,await listDebates(user.id));return;}if(req.method==="GET"&&/^\/debates\/[^/]+$/.test(path)){const id=decodeURIComponent(path.slice(9)),d=await getDebate(id,user.id);if(!d){send(res,404,{error:"Debate not found"});return;}send(res,200,d);return;}
const advanceMatch=path.match(/^\/debates\/([^/]+)\/advance$/);
const progressMatch=path.match(/^\/debates\/([^/]+)\/progress$/);
if(progressMatch&&req.method==="GET"){
 const id=decodeURIComponent(progressMatch[1]),debate=await getDebate(id,user.id);
 if(!debate){send(res,404,{error:"Débat introuvable"});return;}
 const steps=supabasePersistenceEnabled()?await listDebateExecutionSteps(id):[];
 send(res,200,{debate,steps,complete:debate.status!=="running"});
 return;
}
if(advanceMatch&&req.method==="POST"){
 if(!supabasePersistenceEnabled()){send(res,503,{error:"L’orchestration durable exige le stockage Supabase configuré."});return;}
 const id=decodeURIComponent(advanceMatch[1]),debate=await getDebate(id,user.id);
 if(!debate){send(res,404,{error:"Débat introuvable"});return;}
 if(debate.status!=="running"){send(res,200,{debate,complete:true,steps:await listDebateExecutionSteps(id)});return;}
 const steps=await listDebateExecutionSteps(id);
 // Recover a completed step's snapshot if the process stopped after journal commit but before debate save.
 const recovered=steps.filter(s=>s.status==="completed"&&s.output_payload&&typeof s.output_payload.debate==="object").sort((a,b)=>a.round_number-b.round_number)[0];
 let state=debate;
 for(const s of steps){const snap=s.output_payload?.debate;if(s.status==="completed"&&snap&&typeof snap==="object")state=snap as typeof debate;}
 const roles=["architect","red_team","judge"] as const;
 let round=1,role:typeof roles[number]="architect";
 outer: for(let r=1;r<=(state.config?.maxRounds??3);r++){
   for(const candidate of roles){
     const found=steps.find(s=>s.round_number===r&&s.agent_role===candidate&&s.status==="completed");
     if(!found){round=r;role=candidate;break outer;}
   }
 }
 if(state.status!=="running"){send(res,200,{debate:state,complete:true,steps});return;}
 const claimed=await claimDebateExecutionStep({debateId:id,roundNumber:round,agentRole:role,inputSnapshot:{question:state.question,round,role},leaseSeconds:120});
 if(!claimed){send(res,202,{debate:state,complete:false,busy:true,steps:await listDebateExecutionSteps(id)});return;}
 try{
   const next=await runDebateAgentStep(state,role,round);
   const ok=await completeDebateExecutionStep(claimed.id,claimed.claim_token!,{debate:next as unknown as Record<string,unknown>});
   if(!ok){send(res,409,{error:"La réservation de cette étape a expiré. Relance la progression pour reprendre sans écraser un autre traitement."});return;}
   await saveDebate({...next,userId:user.id,workspaceId:state.workspaceId??null});
   const latest=await listDebateExecutionSteps(id);
   send(res,200,{debate:next,complete:next.status!=="running",steps:latest});
 }catch(error){
   const message=error instanceof Error?error.message:String(error);
   await failDebateExecutionStep(claimed.id,claimed.claim_token!,/timeout|temporar|429|503/i.test(message)?"TRANSIENT_AGENT_ERROR":"AGENT_STEP_FAILED",message.slice(0,1000));
   send(res,503,{error:"Cette étape n’a pas abouti. Le journal a conservé l’échec ; une nouvelle tentative pourra reprendre à cette étape.",code:"AGENT_STEP_FAILED",step:{round,role}});
 }
 return;
}
if(req.method!=="POST"||(path!=="/debates/run"&&path!=="/api/debates/run")){send(res,404,{error:"Not found"});return;}
const input=await body(req) as {question?:string;context?:string;workspaceId?:string|null;config?:Partial<DebateConfig>};if(!input.question?.trim()){send(res,400,{error:"question is required"});return;}if(!supabasePersistenceEnabled()){send(res,503,{error:"Le lancement progressif nécessite Supabase durablement configuré."});return;}await assertSupabaseSchemaReady();if(input.workspaceId){const workspace=await getWorkspace(input.workspaceId,user.id);if(!workspace||!["owner","admin","editor"].includes(workspace.role)){send(res,403,{error:"Tu ne disposes pas des droits nécessaires dans cet espace de travail."});return;}}const base=config();const cfg:DebateConfig={...base,...(input.config??{}),architect:{...base.architect,...(input.config?.architect??{})},redTeam:{...base.redTeam,...(input.config?.redTeam??{})},judge:{...base.judge,...(input.config?.judge??{})}};const created={id:randomUUID(),userId:user.id,workspaceId:input.workspaceId??null,question:input.question.trim(),context:input.context?.trim()??"",status:"running" as const,rounds:[],config:cfg};await saveDebate(created);send(res,202,{debate:created,complete:false,accepted:true});
}catch(e){const msg=e instanceof Error?e.message:String(e);console.error("[afe-ci-debate-engine] request failed",e);const providerUnavailable=/DEBATE_PROVIDER_CHAIN_FAILED|_AGENT_FAILED|OPENAI_CONFIG_ERROR|GEMINI_CONFIG_ERROR|_AUTH_ERROR|_PROVIDER_ERROR|_EMPTY_RESPONSE/i.test(msg);const status=/too large/i.test(msg)?413:providerUnavailable?503:/required|invalid|insufficient|refus|not found|introuvable/i.test(msg)?400:500;send(res,status,{error:status===503?"Le service d’intelligence artificielle est indisponible : aucun agent n’a pu terminer son analyse. Réessaie après vérification des fournisseurs configurés.":status===500?"Erreur interne du serveur. Consultez les journaux du déploiement.":msg,code:status===503?"AI_PROVIDER_UNAVAILABLE":undefined});}}

export default handler;

// Vercel invokes the exported handler. Keep the same entry point runnable locally.
if (process.env.VERCEL !== "1") createServer(handler).listen(port);