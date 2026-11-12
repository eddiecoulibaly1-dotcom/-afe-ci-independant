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
const migrationUrl=new URL("../supabase/migrations/20261109102315_coo_mission_dependencies_and_worker_lease_hardening.sql",import.meta.url);
const recoveryMigrationUrl=new URL("../supabase/migrations/20261109103518_coo_expired_worker_lease_recovery.sql",import.meta.url);
const legacyRecoveryMigrationUrl=new URL("../supabase/migrations/20261109103918_coo_recover_legacy_unleased_missions.sql",import.meta.url);
const searchPathMigrationUrl=new URL("../supabase/migrations/20261109104045_coo_dependency_trigger_search_path.sql",import.meta.url);
const strictClaimMigrationUrl=new URL("../supabase/migrations/20261109104351_coo_strict_dependency_claim_gate.sql",import.meta.url);
const strictWorkspaceClaimMigrationUrl=new URL("../supabase/migrations/20261109104353_coo_strict_dependency_workspace_claim_gate.sql",import.meta.url);
const dependencyIndexMigrationUrl=new URL("../supabase/migrations/20261109104547_coo_dependency_fk_index_alignment.sql",import.meta.url);
const cooPlatformUrl=new URL("../src/coo-platform.ts",import.meta.url);
const workerTickMigrationUrl=new URL("../supabase/migrations/20261109120420_coo_worker_heartbeat_monitoring.sql",import.meta.url);
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

test("COO mission dossier exposes dependency status and controlled add/remove actions",async()=>{
 const source=await readFile(cooPlatformUrl,"utf8");
 assert.match(source,/missions\/\"\+encodeURIComponent\(missionId\)\+\"\/dependencies/);
 assert.match(source,/Coordination des missions/);
 assert.match(source,/data-remove-mission-dependency/);
 assert.match(source,/addMissionDependency/);
});
test("expired worker leases are reaped with bounded retry or terminal failure",async()=>{
 const sql=await readFile(recoveryMigrationUrl,"utf8");
 assert.match(sql,/reap_expired_afe_agent_mission_leases/);
 assert.match(sql,/FOR UPDATE SKIP LOCKED/);
 assert.match(sql,/attempt_count>=m\.max_attempts/);
 assert.match(sql,/mission\.lease_expired_retry_scheduled/);
 assert.match(sql,/mission\.lease_expired_failed/);
});

test("worker reaper also recovers legacy running missions without a lease timestamp",async()=>{
 const sql=await readFile(legacyRecoveryMigrationUrl,"utf8");
 assert.match(sql,/lease_expires_at IS NULL OR m\.lease_expires_at<now\(\)/);
 assert.match(sql,/WORKER_LEASE_EXPIRED/);
});

test("automatic dependency and lease trigger functions have pinned search paths",async()=>{
 const sql=await readFile(searchPathMigrationUrl,"utf8");
 assert.match(sql,/guard_afe_agent_mission_dependency_cycle\(\) SET search_path = public/);
 assert.match(sql,/sync_afe_agent_mission_dependency_gate\(\) SET search_path = public/);
 assert.match(sql,/release_afe_agent_mission_dependents\(\) SET search_path = public/);
});
test("both worker paths check lease ownership before the atomic mission execution commit",async()=>{
 const source=await readFile(workerUrl,"utf8");
 assert.equal((source.match(/await heartbeat\.assertOwned\(\);await recordIncompleteDeliberation/g)||[]).length,2);
 assert.equal((source.match(/await heartbeat\.assertOwned\(\);const committed=await commitMissionExecution/g)||[]).length,2);
 assert.equal((source.match(/await commitMissionExecution\(claim,output,reviewReport\)/g)||[]).length,2);
});

test("global and workspace claim functions require successful prerequisite completion",async()=>{
 const globalSql=await readFile(strictClaimMigrationUrl,"utf8");
 const workspaceSql=await readFile(strictWorkspaceClaimMigrationUrl,"utf8");
 assert.match(globalSql,/p\.status<>''completed''/);
 assert.match(workspaceSql,/p\.status<>''completed''/);
 assert.match(globalSql,/claim_afe_agent_mission\(integer\)/);
 assert.match(workspaceSql,/claim_afe_agent_mission_for_workspace\(uuid,integer\)/);
});

test("mission dependency indexes cover each foreign key without duplicate indexes",async()=>{
 const sql=await readFile(dependencyIndexMigrationUrl,"utf8");
 assert.match(sql,/mission_fk_idx ON public\.afe_agent_mission_dependencies \(mission_id,workspace_id\)/);
 assert.match(sql,/prerequisite_fk_idx ON public\.afe_agent_mission_dependencies \(depends_on_mission_id,workspace_id\)/);
 assert.match(sql,/created_by_idx ON public\.afe_agent_mission_dependencies \(created_by\)/);
 assert.match(sql,/DROP INDEX IF EXISTS public\.afe_agent_mission_dependencies_prerequisite_idx/);
});

test("worker retry paths cannot overwrite a mission paused by dependency control",async()=>{
 const source=await readFile(workerUrl,"utf8");
 assert.ok(source.includes("&status=eq.running&select=attempt_count,max_attempts"));
 assert.ok(source.includes("&status=eq.running&lease_expires_at=gt."));
 assert.match(source,/if\(!saved\.length\)return false/);
});

test("COO supervision exposes workspace-scoped worker and dependency health",async()=>{
 const source=await readFile(cooPlatformUrl,"utf8");
 assert.match(source,/handleSupervision\(workspaceId: string, user: AuthUser\)/);
 assert.match(source,/afe_agent_events\?workspace_id=eq\./);
 assert.match(source,/expiredLeaseMissions/);
 assert.match(source,/pausedMissions/);
 assert.match(source,/data-tab="supervision"/);
 assert.match(source,/async function renderSupervision\(\)/);
});
test("manual worker recovery is Preview-only, owner-only and workspace-bounded",async()=>{
 const source=await readFile(cooPlatformUrl,"utf8");
 assert.match(source,/process\.env\.VERCEL_ENV !== "preview"/);
 assert.match(source,/requireAccess\(workspaceId, user, "owner"\)/);
 assert.match(source,/p_workspace_id:workspaceId,p_batch_size:25/);
});

test("worker heartbeat history is durable, server-only and records idle cron ticks",async()=>{
 const sql=await readFile(workerTickMigrationUrl,"utf8");
 const worker=await readFile(workerUrl,"utf8");
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.afe_coo_worker_ticks/);
 assert.match(sql,/status IN \('running','idle','awaiting_validation','paused','retry_scheduled','failed'\)/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON TABLE public\.afe_coo_worker_ticks FROM PUBLIC, anon, authenticated/);
 assert.match(sql,/GRANT ALL ON TABLE public\.afe_coo_worker_ticks TO service_role/);
 assert.match(worker,/beginWorkerTick\("agent-worker-cron"\)/);
 assert.match(worker,/finishWorkerTick\(tick,"idle"\)/);
 assert.match(worker,/touchWorkerTick\(tickId\)/);
 assert.match(worker,/startLeaseHeartbeat\(claim,tick\.id\)/);
});

test("worker task and final mission writes are fenced atomically by an unexpired running lease",async()=>{
 const worker=await readFile(workerUrl,"utf8");
 const atomic=await readFile(new URL("../supabase/migrations/20261112144356_afe_agent_mission_execution_atomic_commit.sql",import.meta.url),"utf8");
 assert.match(worker,/rpc\/commit_afe_agent_mission_execution/);
 assert.equal(worker.includes("afe_operational_tasks?id=eq."),false);
 assert.match(atomic,/FOR UPDATE/);
 assert.match(atomic,/v_mission\.lease_token IS DISTINCT FROM p_lease_token/);
 assert.match(atomic,/v_mission\.lease_expires_at <= v_now/);
 assert.match(atomic,/UPDATE public\.afe_operational_tasks/);
 assert.match(atomic,/UPDATE public\.afe_agent_missions/);
 assert.match(worker,/validateMissionDeliverables\(output\);await heartbeat\.assertOwned\(\);const reviewReport/);
 assert.match(worker,/await heartbeat\.assertOwned\(\);const committed=await commitMissionExecution/);
});

test("COO supervision uses real worker heartbeats and distinguishes failed cross-direction prerequisites",async()=>{
 const source=await readFile(cooPlatformUrl,"utf8");
 assert.match(source,/afe_coo_worker_ticks\?environment=eq\./);
 assert.match(source,/lastHeartbeatAt:lastWorkerTick\?\.heartbeat_at/);
 assert.match(source,/crossDepartmentDependencies:dependencyRows\.filter/);
 assert.match(source,/state = prerequisiteStatus==="completed" \? "satisfied" : \["failed","cancelled","missing"\]/);
 assert.match(source,/heartbeat provient des ticks réels du worker/);
});

test("COO supervision consumes durable worker ticks returned by its sixth query",async()=>{
 const platform=await readFile(cooPlatformUrl,"utf8");
 assert.match(platform,/workerEvents, workerTicks\] = await Promise\.all/);
 assert.match(platform,/afe_coo_worker_ticks\?environment=eq\./);
 assert.match(platform,/const lastWorkerTick = workerTicks\[0\]/);
});
