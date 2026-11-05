import test from "node:test";
import assert from "node:assert/strict";
import { detectSector } from "../src/sector-adaptation.js";
import { researchForDebate, researchPromptContext, sanitizeResearchFindings } from "../src/research-intelligence.js";

test("détecte un secteur transport et ses indicateurs propres",()=>{
 const profile=detectSector("Faut-il investir dans un réseau BRT plutôt que dans les routes à Abidjan ?");
 assert.equal(profile.sector,"transport");
 assert.ok(profile.indicators.includes("temps de parcours"));
 assert.equal(profile.criteria.reduce((sum,x)=>sum+x.weight,0),100);
 assert.equal(profile.criteria.length,9);
});

test("détecte la transformation agroalimentaire du manioc malgré le mot investissement",()=>{
 const profile=detectSector("Faut-il investir dans une unité semi-industrielle de transformation du manioc en Côte d’Ivoire pour produire et commercialiser de l’attiéké ?");
 assert.equal(profile.sector,"agriculture");
 assert.match(profile.label,/transformation|agroalimentaire/i);
 assert.ok(profile.indicators.some(x=>/capacité de transformation/i.test(x)));
 assert.ok(profile.indicators.some(x=>/coût de revient/i.test(x)));
 assert.equal(profile.criteria.reduce((sum,x)=>sum+x.weight,0),100);
});

test("ne simule aucune recherche lorsque la clé fournisseur manque",async()=>{
 let calls=0;
 const result=await researchForDebate({question:"Mobilité urbaine à Abidjan",role:"architect",profile:detectSector("transport BRT"),env:{},fetcher:async()=>{calls++;throw new Error("ne doit pas être appelé")}});
 assert.equal(result.status,"not_configured");
 assert.equal(result.sources.length,0);
 assert.equal(calls,0);
 assert.match(result.gaps.join(" "),/TAVILY_API_KEY/);
});

test("recherche une source institutionnelle, ouvre la page et conserve sa traçabilité",async()=>{
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
 assert.equal(result.sources[0].sourceClass,"international");
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

test("n'accepte un chiffre extrait que s'il cite une page réellement ouverte",()=>{
 const source={id:"SRC-OPENED",title:"Statistiques",url:"https://ins.ci/rapport",domain:"ins.ci",sourceClass:"official" as const,publishedAt:"2025-01-01",retrievedAt:"2026-11-04T00:00:00.000Z",content:"Population totale 10 millions.",httpStatus:200,contentRetrieved:true,corroborationCount:1,relevance:0.9};
 const findings=sanitizeResearchFindings([
  {metric:"Population",value:10000000,unit:"personnes",currency:null,geography:"Côte d'Ivoire",referencePeriod:"2025",publishedAt:"2025-01-01",sourceIds:["SRC-OPENED"],basis:"source_extracted",methodology:"Recensement",caveat:"À recouper"},
  {metric:"Marché estimé",value:500,unit:"milliards",currency:"XOF",geography:"Côte d'Ivoire",referencePeriod:"2026",publishedAt:null,sourceIds:["SRC-INVENTED"],basis:"source_extracted",methodology:"Inconnue",caveat:"Source absente"}
 ],[source]);
 assert.equal(findings[0].value,10000000);
 assert.deepEqual(findings[0].sourceIds,["SRC-OPENED"]);
 assert.equal(findings[1].value,null);
 assert.equal(findings[1].basis,"unknown");
});
