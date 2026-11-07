import test from "node:test";
import assert from "node:assert/strict";
import { validateMissionGraph, aggregateChildMissionStatus, canStartMission, type MissionNode } from "../src/autonomous-agents/mission-graph.js";
const n=(id:string,parentMissionId:string|null=null,depth=0,status:MissionNode["status"]="queued"):MissionNode=>({id,parentMissionId,depth,status});

test("validates hierarchical mission parent links and depth",()=>{
 const graph=validateMissionGraph([n("root"),n("child","root",1),n("grandchild","child",2)],[]);
 assert.equal(graph.nodeCount,3);assert.deepEqual(graph.readyMissionIds,["root","child","grandchild"]);
});
test("rejects missing parents, self-parenting, cycles and inconsistent depth",()=>{
 assert.throws(()=>validateMissionGraph([n("a","missing",1)],[]),/outside this graph/);
 assert.throws(()=>validateMissionGraph([n("a","a",1)],[]),/own parent/);
 assert.throws(()=>validateMissionGraph([n("a","b",2),n("b","a",1)],[]),/cycle/);
 assert.throws(()=>validateMissionGraph([n("a"),n("b","a",0)],[]),/inconsistent/);
});
test("rejects dependency cycles and cross-graph references",()=>{
 const nodes=[n("a"),n("b"),n("c")];
 assert.throws(()=>validateMissionGraph(nodes,[{missionId:"a",dependsOnMissionId:"b"},{missionId:"b",dependsOnMissionId:"a"}]),/cycle/);
 assert.throws(()=>validateMissionGraph(nodes,[{missionId:"a",dependsOnMissionId:"other"}]),/boundary/);
});
test("only starts dependent missions after all prerequisites complete",()=>{
 const nodes=[n("a",null,0,"completed"),n("b"),n("c")],deps=[{missionId:"c",dependsOnMissionId:"a"},{missionId:"c",dependsOnMissionId:"b"}];
 assert.equal(canStartMission(nodes[2],deps,nodes),false);
 nodes[1].status="completed";assert.equal(canStartMission(nodes[2],deps,nodes),true);
 assert.deepEqual(validateMissionGraph(nodes,deps).readyMissionIds,["c"]);
});
test("aggregates child status without hiding failures or approvals",()=>{
 assert.equal(aggregateChildMissionStatus([n("a",null,0,"completed"),n("b",null,0,"completed")]),"completed");
 assert.equal(aggregateChildMissionStatus([n("a",null,0,"completed"),n("b",null,0,"failed")]),"attention_required");
 assert.equal(aggregateChildMissionStatus([n("a",null,0,"running"),n("b",null,0,"waiting_approval")]),"waiting_approval");
});
