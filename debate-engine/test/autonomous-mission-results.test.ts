import test from "node:test";
import assert from "node:assert/strict";
import { buildChildMissionContext, coordinatorSynthesisInstructions } from "../src/autonomous-agents/mission-results.js";

const child=(missionId:string,status:string,extra:Record<string,unknown>={})=>({
 missionId,title:missionId,status,result:status==="completed"?{summary:"Livrable "+missionId}:null,
 failureCode:status==="failed"?"WORKER_FAILED":null,
 failureMessage:status==="failed"?"Échec du worker":null,
 ...extra
});

test("coordinator receives explicit counts and preserves successful, failed and cancelled outcomes",()=>{
 const context=buildChildMissionContext([
  child("a","completed"),child("b","failed"),child("c","cancelled")
 ]);
 assert.equal(context.childMissionOutcomeSummary.total,3);
 assert.equal(context.childMissionOutcomeSummary.completed,1);
 assert.equal(context.childMissionOutcomeSummary.failed,1);
 assert.equal(context.childMissionOutcomeSummary.cancelled,1);
 assert.equal(context.childMissionOutcomeSummary.requiresAttention,true);
 assert.equal(context.childMissionResults[1].failureCode,"WORKER_FAILED");
 assert.equal(context.childMissionResults[0].result && (context.childMissionResults[0].result as any).summary,"Livrable a");
});

test("coordinator refuses synthesis while any child is non-terminal",()=>{
 assert.throws(()=>buildChildMissionContext([child("a","completed"),child("b","running")]),/terminal state/);
 assert.throws(()=>buildChildMissionContext([child("a","queued")]),/terminal state/);
});

test("empty child set is explicit rather than silently treated as completed work",()=>{
 const context=buildChildMissionContext([]);
 assert.equal(context.childMissionOutcomeSummary.total,0);
 assert.equal(context.childMissionOutcomeSummary.empty,true);
 assert.equal(context.childMissionOutcomeSummary.requiresAttention,false);
});

test("coordinator instructions require transparent and integrated synthesis",()=>{
 const instructions=coordinatorSynthesisInstructions();
 assert.match(instructions,/failed ou cancelled/);
 assert.match(instructions,/ne fabrique pas de résultat/);
 assert.match(instructions,/aucune sous-mission/);
});
