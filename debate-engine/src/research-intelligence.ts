import { randomUUID } from "node:crypto";
import type { SectorProfile } from "./sector-adaptation.js";

export type ResearchRole = "architect" | "red_team" | "judge";
export interface ResearchSource {
  id:string; title:string; url:string; domain:string; sourceClass:"official"|"international"|"academic"|"professional"|"media"|"unknown";
  publishedAt:string|null; retrievedAt:string; content:string; httpStatus:number|null;
  contentRetrieved:boolean; corroborationCount:number; relevance:number;
}
export interface ResearchBundle {
  status:"ready"|"not_configured"|"partial"|"unavailable";
  provider:"tavily"|"none"; generatedAt:string; sector:string;
  queries:string[]; sources:ResearchSource[]; gaps:string[]; notes:string[];
}
type TavilyResult={title?:string;url?:string;content?:string;score?:number;published_date?:string};
const MAX_RESULTS=8, MAX_PAGE_CHARS=6500, MAX_BODY_BYTES=1_200_000;
const OFFICIAL_SUFFIXES=[".gov",".gouv",".int",".edu"];
const OFFICIAL_DOMAINS=new Set(["gouv.ci","ins.ci","bceao.int","amf-umoa.org","ohada.org","anader.ci","who.int","fao.org","worldbank.org","imf.org","afdb.org","oecd.org","un.org","unesco.org","unicef.org","itu.int","iea.org","irena.org","unctad.org","itf-oecd.org","nist.gov","iso.org","ec.europa.eu","uis.unesco.org"]);
function domainOf(raw:string):string { try{return new URL(raw).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""} }
function isOfficial(domain:string,profile:SectorProfile):boolean {
 return profile.sourceDomains.some(d=>domain===d||domain.endsWith("."+d))||[...OFFICIAL_DOMAINS].some(d=>domain===d||domain.endsWith("."+d))||OFFICIAL_SUFFIXES.some(s=>domain.endsWith(s));
}
function sourceClass(domain:string,profile:SectorProfile):ResearchSource["sourceClass"] {
 if(isOfficial(domain,profile))return "official";
 if(/worldbank|imf|afdb|oecd|un\.|unctad|fao|who|unesco|unicef|itu|iea|irena/.test(domain))return "international";
 if(/edu$|arxiv|sciencedirect|springer|nature\.com|pubmed/.test(domain))return "academic";
 if(/reuters|apnews|bbc|ft\.com|theguardian/.test(domain))return "media";
 if(domain) return "professional";
 return "unknown";
}
function validPublicHttps(raw:string):URL {
 const u=new URL(raw);
 if(u.protocol!=="https:"||u.username||u.password)throw new Error("URL source non autorisée.");
 const h=u.hostname.toLowerCase();
 if(h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h==="0.0.0.0"||h==="127.0.0.1"||h==="::1"||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h))throw new Error("Hôte privé interdit.");
 return u;
}
function htmlText(html:string):string {
 return html.replace(/<(script|style|noscript|svg|nav|footer|header|form)[^>]*>[\s\S]*?<\/\1>/gi," ")
  .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi,"\n")
  .replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim();
}
async function retrievePage(rawUrl:string,fetcher:typeof fetch):Promise<{text:string;status:number|null;publishedAt:string|null}> {
 let current=validPublicHttps(rawUrl);
 for(let redirects=0;redirects<=3;redirects++){
  const response=await fetcher(current,{method:"GET",redirect:"manual",headers:{"Accept":"text/html,application/xhtml+xml,text/plain;q=0.9","User-Agent":"AFE-CI-ResearchBot/1.2 (+source verification)"},signal:AbortSignal.timeout(12000)});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get("location");if(!location||redirects===3)throw new Error("Redirection source non résolue.");
   current=validPublicHttps(new URL(location,current).toString());continue;
  }
  if(!response.ok) return {text:"",status:response.status,publishedAt:null};
  const type=response.headers.get("content-type")??"";
  if(!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type))return {text:"",status:response.status,publishedAt:null};
  const reader=response.body?.getReader();if(!reader)return {text:"",status:response.status,publishedAt:null};
  const chunks:Uint8Array[]=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BODY_BYTES){await reader.cancel();break;}chunks.push(value);}
  const raw=new TextDecoder().decode(Buffer.concat(chunks));
  const meta=(raw.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate)["'][^>]+content=["']([^"']+)/i)?.[1])??null;
  const time=(raw.match(/<time[^>]+datetime=["']([^"']+)/i)?.[1])??meta;
  return {text:htmlText(raw).slice(0,MAX_PAGE_CHARS),status:response.status,publishedAt:time&&Number.isFinite(Date.parse(time))?new Date(time).toISOString():null};
 }
 return {text:"",status:null,publishedAt:null};
}
function querySet(question:string,context:string,role:ResearchRole,profile:SectorProfile):string[] {
 const base=(question+" "+context).replace(/\s+/g," ").trim().slice(0,420);
 const terms=profile.indicators.slice(0,4).join(" ");
 const queries=[base+" données officielles statistiques rapport "+terms];
 if(role!=="architect")queries.push(base+" contre-arguments évaluations résultats limites risques études indépendantes");
 else queries.push(base+" réglementation politique publique données primaires "+profile.label);
 return [...new Set(queries)].filter(Boolean).slice(0,2);
}
function rank(result:TavilyResult,profile:SectorProfile):number {
 const domain=domainOf(result.url??"");const cls=sourceClass(domain);
 const trust=cls==="official"?50:cls==="international"?44:cls==="academic"?38:cls==="professional"?24:cls==="media"?18:5;
 const relevance=Math.max(0,Math.min(1,Number(result.score)||0));
 return trust+relevance*35+(result.published_date?5:0);
}
async function tavilySearch(query:string,apiKey:string,profile:SectorProfile,fetcher:typeof fetch,officialOnly:boolean):Promise<TavilyResult[]> {
 const response=await fetcher("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:apiKey,query,search_depth:"advanced",max_results:MAX_RESULTS,include_answer:false,include_raw_content:false,...(officialOnly?{include_domains:profile.sourceDomains}:{})}),signal:AbortSignal.timeout(18000)});
 if(!response.ok)throw new Error("Recherche documentaire indisponible (HTTP "+response.status+").");
 const payload=await response.json() as {results?:TavilyResult[]};
 return Array.isArray(payload.results)?payload.results:[];
}
export async function researchForDebate(args:{question:string;context?:string;role:ResearchRole;profile:SectorProfile;previous?:ResearchBundle;fetcher?:typeof fetch;env?:Record<string,string|undefined>}):Promise<ResearchBundle>{
 const env=args.env??process.env,fetcher=args.fetcher??fetch,apiKey=env.TAVILY_API_KEY?.trim();
 const previous=args.previous;
 if(!apiKey)return {status:"not_configured",provider:"none",generatedAt:new Date().toISOString(),sector:args.profile.label,queries:[],sources:previous?.sources??[],gaps:["Recherche Internet non activée : la variable serveur TAVILY_API_KEY n'est pas configurée."],notes:["Aucune donnée externe n'a été inventée. Les sources déjà enregistrées sont conservées."]};
 const queries=args.role==="judge"?[]:querySet(args.question,args.context??"",args.role,args.profile);
 const notes:string[]=[],found:TavilyResult[]=[];
 try{for(let i=0;i<queries.length;i++)found.push(...await tavilySearch(queries[i],apiKey,args.profile,fetcher,i===0));}
 catch(error){notes.push(error instanceof Error?error.message:"Échec de la recherche documentaire.");}
 const unique=[...new Map(found.filter(x=>x.url&&x.title).map(x=>[x.url!,x])).values()]
  .sort((a,b)=>rank(b,args.profile)-rank(a,args.profile)).slice(0,MAX_RESULTS);
 const retrieved=await Promise.all(unique.map(async item=>{
  const domain=domainOf(item.url!);let page={text:"",status:null as number|null,publishedAt:null as string|null};
  try{page=await retrievePage(item.url!,fetcher)}catch(error){notes.push("Source inaccessible : "+domain+" ("+(error instanceof Error?error.message:"erreur")+")");}
  return {id:"SRC-"+randomUUID().slice(0,8).toUpperCase(),title:item.title!,url:item.url!,domain,sourceClass:sourceClass(domain,args.profile),publishedAt:page.publishedAt??item.published_date??null,retrievedAt:new Date().toISOString(),content:(page.text||item.content||"").slice(0,MAX_PAGE_CHARS),httpStatus:page.status,contentRetrieved:page.text.length>0,corroborationCount:1,relevance:Math.max(0,Math.min(1,Number(item.score)||0))} satisfies ResearchSource;
 }));
 const merged=[...(previous?.sources??[])];
 for(const item of retrieved){const same=merged.find(s=>s.url===item.url);if(same){same.content=item.content||same.content;same.contentRetrieved=same.contentRetrieved||item.contentRetrieved;same.retrievedAt=item.retrievedAt;}else merged.push(item);}
 const sources=merged.sort((a,b)=>rank({url:b.url,score:b.relevance},args.profile)-rank({url:a.url,score:a.relevance},args.profile)).slice(0,18);
 const gaps:string[]=[];
 if(!sources.length)gaps.push("Aucune source exploitable n'a été récupérée.");
 if(sources.every(s=>s.sourceClass!=="official"&&s.sourceClass!=="international"))gaps.push("Aucune source institutionnelle ou internationale n'a été trouvée dans cette recherche.");
 if(sources.every(s=>!s.contentRetrieved))gaps.push("Les pages des résultats n'ont pas pu être ouvertes ; seuls des extraits de moteur de recherche sont disponibles.");
 return {status:retrieved.length?"ready":sources.length?"partial":"unavailable",provider:"tavily",generatedAt:new Date().toISOString(),sector:args.profile.label,queries,sources,gaps,notes:[...new Set(notes)].slice(0,8)};
}
export function researchPromptContext(bundle?:ResearchBundle):string {
 if(!bundle)return "DOSSIER DOCUMENTAIRE : aucune recherche intégrée à cette étape.";
 const lines=["DOSSIER DOCUMENTAIRE EXTERNE — "+bundle.status,"Secteur : "+bundle.sector,"Recherches : "+bundle.queries.join(" | "),"Sources disponibles :"];
 for(const s of bundle.sources.slice(0,7)){lines.push("["+s.id+"] "+s.title+" | "+s.url+" | domaine="+s.domain+" | classe="+s.sourceClass+" | publication="+(s.publishedAt??"date inconnue")+" | consultée="+s.retrievedAt+" | contenu ouvert="+s.contentRetrieved);if(s.content)lines.push("Extrait consulté : "+s.content.slice(0,1800));}
 lines.push("LACUNES : "+bundle.gaps.join(" | "),"NOTES : "+bundle.notes.join(" | "));
 lines.push("RÈGLES : cite les identifiants [SRC-...] pour les affirmations soutenues. L'ouverture d'une page prouve uniquement que son contenu a été récupéré, pas que toutes ses affirmations sont exactes. Vérifie date, période, géographie, unité et méthodologie. Recherche aussi les preuves contraires. Une seule source ne constitue pas une corroboration indépendante. Ne transforme jamais un extrait en donnée certaine sans contrôle.");
 return lines.join("\n");
}
