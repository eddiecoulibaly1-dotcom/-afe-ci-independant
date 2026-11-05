import test from "node:test";
import assert from "node:assert/strict";
import { applyConvergencePolicy } from "../src/engine.js";
import { ARCHITECT_SYSTEM, RED_TEAM_SYSTEM, JUDGE_SYSTEM, architectPrompt, redTeamPrompt, judgePrompt } from "../src/prompts.js";
import { detectSector } from "../src/sector-adaptation.js";
import type { DebateRound, JudgeDecision, Scorecard } from "../src/types.js";

const scorecard = (value:number):Scorecard => ({
 buyerValue:value,sellerValue:value,coteDIvoireFit:value,marketplaceLiquidity:value,
 differentiation:value,trustFraud:value,technicalFeasibility:value,acquisition:value,monetization:value
});
const judge = (overrides:Partial<JudgeDecision> = {}):JudgeDecision => ({
 status:"revise",winner:"red_team",architectScore:99,redTeamScore:20,
 architectScorecard:scorecard(99),redTeamScorecard:scorecard(20),
 acceptedClaims:[],rejectedClaims:[],criticalDisagreements:[],
 decision:"Retenir l'alternative de la Red Team après examen indépendant.",
 rationale:["La proposition initiale comporte une lacune déterminante."],
 confidence:"moderate", ...overrides
});
const round = (n:number):DebateRound => ({
 round:n,
 architect:{position:"Proposition du tour "+n,claims:[],assumptions:[],risks:[],alternatives:[],scoreExpected:70,nextTests:["Test suivant"]},
 redTeam:{verdict:"challenge",attacks:[],unresolvedQuestions:[]},
 judge:judge(),createdAt:new Date(0).toISOString()
});

test("BR-DEC-001: l'Arbitre conserve son choix même si l'autre option a un score supérieur",()=>{
 const result=applyConvergencePolicy(judge(),0,0,true);
 assert.equal(result.winner,"red_team");
 assert.notEqual(result.winner,"architect");
});

test("BR-DEC-001: une preuve critique non étayée suspend le gagnant malgré un score favorable",()=>{
 const evidenceAudit={records:[],unsupportedCriticalClaims:["approvisionnement-garanti"],unsupportedHighImpactClaims:[],pendingVerificationClaims:[],confidence:0,blocking:true,nextTests:["Auditer les volumes réellement contractualisables."]};
 const result=applyConvergencePolicy(judge({winner:"architect",architectScore:99,redTeamScore:20}),0,0,true);
 const blocked=applyConvergencePolicy({...judge({winner:"architect",architectScore:99,redTeamScore:20}),evidenceAudit},0,0,true);
 assert.equal(result.winner,"architect");
 assert.equal(blocked.winner,"neither");
 assert.equal(blocked.status,"unresolved");
 assert.match(blocked.decision,/suspendue/i);
});

test("BR-DEC-001: les trois agents reçoivent la règle obligatoire",()=>{
 for(const system of [ARCHITECT_SYSTEM,RED_TEAM_SYSTEM,JUDGE_SYSTEM]) assert.match(system,/BR-DEC-001/);
});

test("BR-DEC-001: les prompts de trois tours transportent l'historique et les obligations de progression",()=>{
 const history=[round(1),round(2)];
 const ap=architectPrompt("Faut-il investir dans une unité d'attiéké ?", "Zone et capacité à vérifier",history,"Répondre aux objections d'approvisionnement.");
 assert.match(ap,/TOURS PRÉCÉDENTS/);
 assert.match(ap,/apporte un élément réellement nouveau/);
 const current=round(3);
 current.redTeam.attacks=[{severity:"high",argument:"Risque de rupture d'approvisionnement",evidenceNeeded:["Contrats producteurs"],confidence:0.8}];
 assert.match(redTeamPrompt("Question",undefined,current),/ne répète pas les attaques antérieures/);
 assert.match(judgePrompt("Question",undefined,current,85),/ne choisis pas mécaniquement le score le plus élevé/);
});

test("BR-DEC-001: les consignes restent actives dans plusieurs secteurs",()=>{
 const cases=[
  ["Unité de transformation du manioc et commercialisation de l'attiéké","agriculture"],
  ["Faut-il développer un réseau BRT à Abidjan ?","transport"],
  ["Lancer un service de microfinance en Côte d'Ivoire","finance"],
  ["Déployer une plateforme de télémédecine","health"],
  ["Investir dans une centrale solaire et son stockage","energy"],
  ["Créer une application éducative pour les lycéens","education"],
  ["Déployer une plateforme numérique de gestion commerciale","technology"],
  ["Ouvrir un réseau de magasins de distribution","commerce"]
 ] as const;
 for(const [question,expected] of cases) assert.equal(detectSector(question).sector,expected,question);
 assert.match(JUDGE_SYSTEM,/scores sont auxiliaires/);
});
