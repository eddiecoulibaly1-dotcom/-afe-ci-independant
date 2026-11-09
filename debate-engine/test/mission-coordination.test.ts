import test from "node:test";
import assert from "node:assert/strict";
import { assertDependencyAddition, evaluateDependencyReadiness } from "../src/mission-coordination.js";
test("dependency graph rejects self-dependencies and cycles",()=>{assert.throws(()=>assertDependencyAddition("a","a",[]),/elle-mÃªme/);const edges=[{missionId:"b",dependsOnMissionId:"a"},{missionId:"c",dependsOnMissionId:"b"}];assert.throws(()=>assertDependencyAddition("a","c",edges),/cycle/);});
test("dependency graph accepts acyclic edges and rejects duplicates",()=>{assert.doesNotThrow(()=>assertDependencyAddition("c","a",[{missionId:"b",dependsOnMissionId:"a"}]));assert.throws(()=>assertDependencyAddition("b","a",[{missionId:"b",dependsOnMissionId:"a"}]),/existe dÃ©jÃ /);});
test("mission is runnable only after all prerequisites complete",()=>{const deps=[{missionId:"target",dependsOnMissionId:"one"},{missionId:"target",dependsOnMissionId:"two"}];const pending=evaluateDependencyReadiness(deps,new Map([["one","completed"],["two","running"]]));assert.equal(pending.ready,false);assert.deepEqual(pending.pending,["two"]);const failed=evaluateDependencyReadiness(deps,new Map([["one","completed"],["two","failed"]]));assert.equal(failed.ready,false);assert.deepEqual(failed.failed,["two"]);assert.equal(evaluateDependencyReadiness(deps,new Map([["one","completed"],["two","completed"]])).ready,true);});

import { readFile } from "node:fs/promises";
const platformUrl = new URL("../src/autonomous-agents/platform.¶»§q«^