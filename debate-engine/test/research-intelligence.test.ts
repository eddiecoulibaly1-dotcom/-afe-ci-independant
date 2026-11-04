import test from "node:test";
import assert from "node:assert/strict";
import { detectSector } from "../src/sector-adaptation.js";
import { researchForDebate, researchPromptContext } from "../src/research-intelligence.js";

test("détecte un secteur transport et ses indicateurs propres",()=>{
 const profile=detectSector("Faut-il investir dans un réseau BRT plutôt que dans les routes à Abidjan ?");
 assert.equal(profile.sector,"transport");
 assert.ok(profile.indicators.includes("temps de parcours"));
 assert.equal(profile.criteria.reduce((sum,x)=>sum+x.weight,0),100);
 assert.equal(profile.criteria.length,9);
});

test("ne simule aucune recherche lorsque la clé fournisseur manque",async()=>{
 let calls=0;
 const result=await researchForDebate({question:"Mobilité urbaine à Abidjan",role:"architect",profile:detectSector("transport BRT"),env:{},fetcher:async()=>{calls++;throw new Error("ne doit pas être appelé")}});
 assert.equal(result.status,"not_configured");
 assert.equal(result.sources.length,0);
 assert.equal(calls,0);
 assert.match(result.gaps.join(" "),/TAVILY_API_KEY/);
});

test("recherche des sources officielles, ouvre la page et conserve sa traçabilité",async()=>{
 const calls:Array<{url:string;init?:RequestInit}>=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input);calls.push({url,init});
  if(url==="https://api.tavily.com/search"){
   const body=JSON.parse(String(init?.body));
   return new Response(JSON.stringify({results:[{title:"Rapport mobilité Côte d’Ivoire",url:"https://www.worldbank.org/en/country/cotedivoire",content:"Extrait de recherche",score:0.92,published_date:"2025-06-01"}]}),{status:200,headers:{"content-type":"application/json"}});
  }
  return new Response('<html><head><meta property="article:published_time" content="2025-06-01"></head><body><h1>Rapport mobilité</h1><p>Données sur les transports collectifs et les déplacements urbains.</p></body></html>',{status:200,headers:{"content-type":"text/html; charset=utf-8"}});
 };
 const result=await researchForDebate({question:"Investir dans les transports collectifs à Abidjan",role:"architect",profile:detectSector("transport BRT"),env:{TAVILY_API_KEY:"test-key"},fetcher});
 assert.ok(result.sources.length>0);
 assert.equal(result.sources[0].sourceClass,"official");
 assert.equal(result.sources[0].contentRetrieved,true);
 assert.match(result.sources[0].content,/transports collectifs/);
 assert.equal(result.sources[0].url,"https://www.worldbank.org/en/country/cotedivoire");
 assert.ok(calls.some(x=>x.url==="https://api.tavily.com/search"));
 assert.ok(calls.some(x=>x.url==="https://www.worldbank.org/en/country/cotedivoire"));
 assert.match(researchPromptContext(result),/L'ouverture d'une page prouve uniquement/);
});

test("les instructions de recherche distinguent consultation et validation factuelle",()=>{
 const context=researchPromptContext({status:"ready",provider:"tavily",generatedAt:"2026-11-04T00:00:00.000Z",sector:"Transport",queries:["mobilité"],sources:[],gaps:[],notes:[]});
 assert.match(context,/Une seule source ne constitue pas une corroboration indépendante/);
});
