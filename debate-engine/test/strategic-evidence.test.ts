import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategicEvidenceSummary } from "../src/strategic-evidence.js";
import type { Debate } from "../src/types.js";

test("le rapport n'affiche pas comme vérifiées les références seulement déclarées",()=>{
 const debate={question:"Test",status:"provisional",rounds:[{round:1,architect:{position:"",claims:[
  {id:"C1",statement:"Donnée de marché",type:"fact",confidence:0.9,evidenceRequired:true,evidenceRefs:["https://example.org/report"]},
  {id:"C2",statement:"Hypothèse de croissance",type:"hypothesis",confidence:0.5,evidenceRequired:true,evidenceRefs:[]}
 ]},redTeam:{verdict:"challenge",attacks:[],unresolvedQuestions:[]},judge:{}}]} as unknown as Debate;
 const result=buildStrategicEvidenceSummary(debate);
 assert.deepEqual(result.verified,[]);
 assert.deepEqual(result.unverified,["Donnée de marché"]);
 assert.deepEqual(result.hypotheses,["Hypothèse de croissance"]);
 assert.equal(result.references[0].status,"pending_verification");
});
