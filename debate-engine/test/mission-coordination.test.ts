import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertDependencyAddition, evaluateDependencyReadiness } from "../src/mission-coordination.js";
test("dependency graph rejects self-dependencies and cycles",()=>{
 assert.throws(()=>assertDependencyAddition("a","a",[]),/elle-même/);
 const edges=[{missionId:"b",dependsOnMissionId:"a"},{missionId:"c",dependsOnMissionId:"b"}];
 assert.throws(()=>assertDependencyAddition("a","c",edges),/cycle/);
});
test("dependency graph accepts acyclic edges and rejects duplicates",()=>{
 assert.doesNotThrow(()=>assertDependencyAddition("c","a",[{missionId:"b",dependsOnMissionId:"a"}]));
 assert.throws(()=>assertDependencyAddition("b","a",[{missionId:"b",dependsOnMissionId:"a"}]),/existe déjà/);
});
test("mission is runnable only after all prerequisites complete",()=>{
 const deps=[{missionId:"target",dependsOnMissionId:"one"},{missionId:"target",dependsOnMissionId:"two"}];
 const pending=evaluateDependencyReadiness(deps,new Map([["one","completed"],["two","running"]]));
 assert.equal(pending.ready,false);assert.deepEqual(pending.pending,["two"]);
 const failed=evaluateDependencyReadiness(deps,new Map([["one","completed"],["two","failed"]]));
 assert.equal(failed.ready,false);assert.deepEqual(failed.failed,["two"]);
 assert.equal(evaluateDependencyReadiness(deps,new Map([["one","completed"],["two","completed"]])).ready,true);
});
const platformUrl=new URL("../src/autonomous-agents/platform.ts",import.meta.url);
const workerUrl=new URL("../src/autonomous-agents/worker.ts",import.meta.url);
const migrationUrl=new URL("../supabase/migrations/20261109102000_coo_mission_dependencies_and_worker_lease_hardening.sql",import.meta.url);
test("mission dependency API is workspace-scoped, auditable and restricted to non-running missions",async()=>{
 const source=await readFile(platformUrl,"utf8");
 assert.match(source,/p\[6\]==="dependencies"/);
 assert.match(source,/requireRole\(wid,user,"editor"\)/);
 assert.match(source,/Les dépendances ne peuvent être modifiées que lorsque la mission est en attente ou suspendue/);
 assert.match(source,/mission\.dependency\.added/);assert.match(source,/mission\.dependency\.removed/);
});
test("database dependency gate prevents cycles and releases dependants only after success",async()=>{
 const sql=await readFile(migrationUrl,"utf8");
 assert.match(sql,/guard_afe_agent_mission_dependency_cycle/);assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/Mission dependency cycle detected/);assert.match(sql,/DEPENDENCY_BLOCKED:/);
 assert.match(sql,/p\.status<>''completed''/);
});
test("worker heartbeat renews the lease and prevents stale worker writes",async()=>{
 const source=await readFile(workerUrl,"utf8");
 assert.match(source,/renew_afe_agent_mission_lease/);assert.match(source,/},45000\)/);
 assert.match(source,/await heartbeat\.assertOwned\(\)/);assert.ok(source.includes("heartbeat.stop()"));
 assert.match(source,/attempt>=maxAttempts/);
});
