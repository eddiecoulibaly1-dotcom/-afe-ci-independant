import test from "node:test";
import assert from "node:assert/strict";
import { runDebate } from "../src/engine.js";
import { callModel } from "../src/providers.js";
import type { DebateConfig, Scorecard } from "../src/types.js";

const card:Scorecard={buyerValue:70,sellerValue:65,coteDIvoireFit:75,marketplaceLiquidity:60,differentiation:70,trustFraud:65,technicalFeasibility:70,acquisition:60,monetization:55};
const config:DebateConfig={
 maxRounds:3,convergenceScore:85,
 architect:{provider:"openai",model:"test"},
 redTeam:{provider:"openai",model:"test"},
 judge:{provider:"openai",model:"test"}
};

test("intégration trois tours : l'historique et les objections antérieures atteignent les trois agents",async()=>{
 const prompts:Array<{schema:string;prompt:string;round:number}>=[];
 let currentRound=0;
 const fake=async <T>(args:Parameters<typeof callModel>[0]):Promise<T>=>{
  if(args.schemaName==="architect_proposal") currentRound++;
  const round=currentRound;
  prompts.push({schema:args.schemaName,prompt:args.prompt,round});
  if(args.schemaName==="architect_proposal") return {
   position:["Tour 1 : sécuriser les bassins de collecte et mesurer les volumes accessibles.","Tour 2 : comparer les contrats d'approvisionnement et les rendements matière du pilote.","Tour 3 : conditionner la montée en capacité aux résultats commerciaux et au coût de revient."][round-1],
   claims:[],assumptions:["Donnée terrain à confirmer"],risks:["Risque documenté à tester"],alternatives:["Option alternative"],scoreExpected:65,nextTests:["Mesure du prochain jalon"]
  } as T;
  if(args.schemaName==="red_team_critique") return {
   verdict:"challenge",attacks:[{severity:"high",argument:["Attaque du tour 1 : disponibilité locale non démontrée.","Attaque du tour 2 : contrats et rendements restent à valider.","Attaque du tour 3 : débouchés et marge unitaire doivent être prouvés."][round-1],evidenceNeeded:["Données terrain"],confidence:0.8}],
   strongestAlternative:"Pilote progressif avec coopératives",unresolvedQuestions:["Quelle preuve tranche le point critique ?"]
  } as T;
  return {
   status:"provisional",winner:"neither",architectScore:90,redTeamScore:55,architectScorecard:card,redTeamScorecard:card,
   acceptedClaims:[],rejectedClaims:[],criticalDisagreements:["Approvisionnement non contractualisé"],
   decision:["Décision d'étape 1 : vérifier la disponibilité locale.","Décision d'étape 2 : mesurer les rendements et les contrats.","Décision d'étape 3 : ne monter en capacité qu'après validation du débouché."][round-1],
   rationale:["Arbitrage provisoire fondé sur les données disponibles."],confidence:"low",risks:["Risque d'approvisionnement"],tests:["Test terrain"],reversalConditions:["Réviser après résultats."]
  } as T;
 };
 const debate=await runDebate(
  "Faut-il investir dans une unité semi-industrielle de transformation du manioc en Côte d'Ivoire pour produire et commercialiser de l'attiéké ?",
  "Test d'intégration simulé sans appel à un fournisseur de modèle.",
  config,
  fake as typeof callModel
 );
 assert.equal(debate.rounds.length,3);
 assert.deepEqual(debate.rounds.map(x=>x.round),[1,2,3]);
 assert.equal(new Set(debate.rounds.map(x=>x.architect.position)).size,3);
 assert.equal(new Set(debate.rounds.map(x=>x.redTeam.attacks[0]?.argument)).size,3);
 assert.equal(new Set(debate.rounds.map(x=>x.judge.decision)).size,3);
 const red2=prompts.find(x=>x.schema==="red_team_critique"&&x.round===2)?.prompt??"";
 const judge2=prompts.find(x=>x.schema==="judge_decision"&&x.round===2)?.prompt??"";
 const red3=prompts.find(x=>x.schema==="red_team_critique"&&x.round===3)?.prompt??"";
 const judge3=prompts.find(x=>x.schema==="judge_decision"&&x.round===3)?.prompt??"";
 assert.match(red2,/Attaque du tour 1/);
 assert.match(judge2,/Décision d'étape 1/);
 assert.match(red3,/Attaque du tour 1/);
 assert.match(red3,/Attaque du tour 2/);
 assert.match(judge3,/Décision d'étape 1/);
 assert.match(judge3,/Décision d'étape 2/);
});
