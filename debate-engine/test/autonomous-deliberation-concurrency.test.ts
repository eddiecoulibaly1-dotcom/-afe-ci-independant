import test from "node:test";
import assert from "node:assert/strict";
import {createDeliberation,addContribution,advanceRound,beginArbitration} from "../src/autonomous-agents/deliberation.js";
import {EvidenceRegistry,validateFinding} from "../src/autonomous-agents/evidence.js";
import {assessDeliberationCoverage} from "../src/autonomous-agents/orchestration.js";
test("deliberation enforces round and contribution budgets",()=>{
 let d=createDeliberation({workspaceId:"w",missionId:"m",maxRounds:2,maxContributions:2});
 d=addContribution(d,{agentId:"a",kind:"position",body:"Analyse initiale suffisamment détaillée."});
 d=advanceRound(d);
 d=addContribution(d,{agentId:"b",kind:"objection",body:"Objection motivée et vérifiable."});
 d=advanceRound(d);
 assert.equal(d.status,"arbitrating");
 assert.throws(()=>addContribution(d,{agentId:"a",kind:"rebuttal",body:"Trop tard pour contribuer."}));
});
test("evidence registry is idempotent and workspace isolated",()=>{
 const r=new EvidenceRegistry();
 const item:any={id:"e1",workspaceId:"w1",contentSha256:"hash",metadata:{}};
 r.add(item);r.add(item);
 assert.equal(r.list("w1").length,1);
 assert.equal(r.get("e1","w2"),undefined);
});
test("verified findings require resolvable evidence",()=>{
 const f:any={id:"f",title:"Finding",statement:"Statement",severity:"high",likelihood:3,impact:4,rationale:"Reason",evidenceIds:[],verification:"verified",limitations:[],counterArguments:[],recommendation:"Fix",closureCriteria:[]};
 assert.throws(()=>validateFinding(f,new Map()));
});
test("concurrent attempts to advance same immutable snapshot do not mutate original",async()=>{
 const initial=createDeliberation({workspaceId:"w",missionId:"m"});
 const populated=addContribution(initial,{agentId:"a",kind:"position",body:"Position initiale suffisamment argumentée."});
 const results=await Promise.all([Promise.resolve(advanceRound(populated)),Promise.resolve(advanceRound(populated))]);
 assert.equal(populated.round,1);
 assert.equal(results[0].round,2);assert.equal(results[1].round,2);
});
test("arbitration cannot start without explicit arbitration transition",()=>{
 const d=createDeliberation({workspaceId:"w",missionId:"m"});
 assert.equal(beginArbitration(d).status,"arbitrating");
});

test("coverage requires every selected agent in every configured round",()=>{
 const agents=["a","b","c"];
 const partial=assessDeliberationCoverage(agents,2,[
  {agentId:"a",round:1},{agentId:"b",round:1},{agentId:"c",round:1},
  {agentId:"a",round:2},{agentId:"b",round:2}
 ]);
 assert.equal(partial.expected,6);
 assert.equal(partial.completed,5);
 assert.equal(partial.complete,false);
 assert.deepEqual(partial.missing,[{agentId:"c",round:2}]);
});
test("coverage is complete only when all agent-round pairs are present",()=>{
 const result=assessDeliberationCoverage(["a","b"],3,[
  {agentId:"a",round:1},{agentId:"b",round:1},
  {agentId:"a",round:2},{agentId:"b",round:2},
  {agentId:"a",round:3},{agentId:"b",round:3}
 ]);
 assert.equal(result.complete,true);
 assert.equal(result.completed,result.expected);
 assert.equal(result.missing.length,0);
});
