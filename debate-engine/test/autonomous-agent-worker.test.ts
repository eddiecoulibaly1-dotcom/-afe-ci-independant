import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root=new URL("../",import.meta.url);
const migration=await readFile(new URL("supabase/migrations/20261105233000_autonomous_agents_p1_p6_controls.sql",root),"utf8");
const atomicMigration=await readFile(new URL("supabase/migrations/20261112144356_afe_agent_mission_execution_atomic_commit.sql",root),"utf8");
const worker=await readFile(new URL("src/autonomous-agents/worker.ts",root),"utf8");
const config=JSON.parse(await readFile(new URL("vercel.json",root),"utf8"));

test("mission claims are serialized with SKIP LOCKED and expiring leases",()=>{
 assert.match(migration,/FOR UPDATE SKIP LOCKED/);
 assert.match(migration,/lease_expires_at=now\(\)\+make_interval/);
 assert.match(migration,/lease_token=gen_random_uuid\(\)/);
});

test("mission completion is fenced by the current lease token",()=>{
 assert.match(migration,/WHERE id=p_mission_id AND status='running' AND lease_token=p_lease_token/);
 assert.match(worker,/lease_token=eq/);
 assert.equal(worker.includes("finish_afe_agent_mission"),false);
 assert.match(worker,/rpc\/commit_afe_agent_mission_execution/);
});

test("task results, mission transition and audit events commit under one row lock and lease fence",()=>{
 assert.match(atomicMigration,/SELECT m\.\* INTO v_mission[\s\S]*FOR UPDATE/);
 assert.match(atomicMigration,/m\.workspace_id = p_workspace_id/);
 assert.match(atomicMigration,/v_mission\.agent_id <> p_agent_id/);
 assert.match(atomicMigration,/v_mission\.lease_token IS DISTINCT FROM p_lease_token/);
 assert.match(atomicMigration,/v_mission\.lease_expires_at <= v_now/);
 assert.match(atomicMigration,/UPDATE public\.afe_operational_tasks/);
 assert.match(atomicMigration,/UPDATE public\.afe_agent_missions/);
 for(const event of ["mission.deliverables.submitted","mission.evidence.reviewed","coo.tasks.incomplete","mission.awaiting_coo_validation"]) {
  assert.ok(atomicMigration.includes(event),"Missing atomic audit event "+event);
 }
 assert.match(atomicMigration,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
 assert.match(atomicMigration,/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
 assert.doesNotMatch(atomicMigration,/SECURITY DEFINER/i);
});

test("worker no longer writes task rows or review events outside the fenced transaction",()=>{
 assert.equal(worker.includes("syncCooTaskResults"),false);
 assert.equal(worker.includes("afe_operational_tasks?id=eq."),false);
 assert.equal(worker.includes('event_type:"mission.evidence.reviewed"'),false);
 assert.equal(worker.includes('event_type:"mission.deliverables.submitted"'),false);
 assert.match(worker,/async function commitMissionExecution/);
});

test("atomic transaction rejects missing, duplicate, mismatched, cancelled and invalid task results",()=>{
 assert.match(atomicMigration,/TASK_RESULT_COVERAGE_MISMATCH/);
 assert.match(atomicMigration,/DUPLICATE_TASK_RESULT/);
 assert.match(atomicMigration,/TASK_RESULT_ID_SET_MISMATCH/);
 assert.match(atomicMigration,/MISSION_CONTAINS_CANCELLED_TASK/);
 assert.match(atomicMigration,/TASK_RESULT_VALIDATION_FAILED/);
 assert.match(atomicMigration,/TASK_RESULT_WRITE_COUNT_MISMATCH/);
});

test("worker is server authenticated and never trusts browser session identity",()=>{
 assert.match(worker,/timingSafeEqual/);
 assert.match(worker,/Authorization/);
 assert.match(worker,/AGENT_WORKER_SECRET\?\?process\.env\.CRON_SECRET/);
});

test("worker retries are bounded and use increasing delay",()=>{
 assert.match(worker,/attempt>=maxAttempts/);
 assert.match(worker,/select=attempt_count,max_attempts/);
 assert.ok(worker.includes("lease_expires_at=gt."));
 assert.match(worker,/Math\.pow\(2/);
 assert.match(worker,/status:terminal\?"failed":"queued"/);
});

test("Vercel invokes the worker independently of the browser",()=>{
 assert.deepEqual(config.crons,[{path:"/internal/agent-worker",schedule:"* * * * *"},{path:"/internal/coo-report-worker",schedule:"0 8 * * *"},{path:"/internal/coo-dependency-worker",schedule:"*/5 * * * *"}]);
});

test("worker reaps abandoned leases before claiming new work and tolerates one transient renewal failure",()=>{
 assert.ok(worker.includes("rpc/reap_expired_afe_agent_mission_leases"));
 assert.ok(worker.includes("failures>=2"));
});
