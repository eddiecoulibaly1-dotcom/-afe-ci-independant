import test from "node:test";
import assert from "node:assert/strict";
import { auditClaimEvidence, auditNovelty, evaluateConvergence, auditStrategicReport } from "../src/compliance-engine.js";

test("evidence is not verified without opened independent sources and institutional corroboration",()=>{
 const findings=auditClaimEvidence([{id:"c1",statement:"Production annuelle",impact:"critical",sources:[
  {id:"s1",url:"https://a.example/source",domain:"a.example",sourceClass:"official",contentRetrieved:true,supportsClaim:true,excerpt:"Donnée publiée"},
  {id:"s2",url:"https://b.example/source",domain:"b.example",sourceClass:"press",contentRetrieved:true,supportsClaim:true,excerpt:"Confirmation indépendante"}
 ]}]);
 assert.equal(findings[0].status,"verified");
 const weak=auditClaimEvidence([{id:"c2",statement:"Affirmation",impact:"critical",sources:[
  {id:"s1",url:"https://a.example",domain:"a.example",sourceClass:"press",contentRetrieved:false}
 ]}]);
 assert.notEqual(weak[0].status,"verified");
});
test("repeated arguments are flagged rather than counted as new contributions",()=>{
 const result=auditNovelty([{id:"old",text:"La variabilité climatique menace la continuité de l'approvisionnement."}],[{id:"new",text:"La variabilité du climat menace la continuité de l'approvisionnement."}]);
 assert.equal(result[0].novel,false);
 assert.equal(result[0].duplicateOf,"old");
});
test("convergence is blocked by critical objections and insufficient evidence",()=>{
 const result=evaluateConvergence({score:96,criticalObjections:1,unsupportedCriticalClaims:0,pendingCriticalClaims:1,roundsWithNovelContribution:3});
 assert.equal(result.eligible,false);
 assert.equal(result.blockers.length,2);
});
test("convergence requires score threshold and novel rounds",()=>{
 assert.equal(evaluateConvergence({score:90,criticalObjections:0,unsupportedCriticalClaims:0,pendingCriticalClaims:0,roundsWithNovelContribution:3}).eligible,true);
 assert.equal(evaluateConvergence({score:84,criticalObjections:0,unsupportedCriticalClaims:0,pendingCriticalClaims:0,roundsWithNovelContribution:3}).eligible,false);
});
test("strategic report audit surfaces missing decision evidence and financial caveats",()=>{
 const result=auditStrategicReport({executiveSummary:"Résumé",decisionRationale:"Motif",optionsCount:2,risksCount:3,evidenceCount:0,financialLimitations:["Données manquantes"]});
 assert.equal(result.complete,false);
 assert.ok(result.missing.some(x=>x.includes("preuve")));
 assert.ok(result.warnings.some(x=>x.includes("financière")));
});
