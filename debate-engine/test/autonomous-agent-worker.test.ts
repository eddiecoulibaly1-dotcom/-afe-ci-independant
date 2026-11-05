import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root=new URL("../",import.meta.url);
const migration=await readFile(new URL("supabase/migrations/20261105233000_autonomous_agents_p1_p6_controls.sql",root),"utf8");
const worker=await readFile(new URL("src/autonomous-agents/worker.ts",root),"utf8");
const config=JSON.parse(await readFile(new URL("vercel.json",root),"utf8"));

test("mission claims are serialized with SKIP LOCKED and expiring leases",()=>{
 assert.match(migration,/FOR UPDATE SKIP LOCKED/);
 assert.match(migration,/lease_expires_at=now\(\)\+make_interval/);
 assert.match(migration,/lease_token=gen_random_uuid\(\)/);
});

test("mission completion is fenced by the current lease token",()=>{
 assert.match(migration,/WHERE id=p_mission_id AND status='running' AND lease_token=p_lease_token/);
 assert.match(worker,/p_lease_token:claim\.lease_token/);
});

test("worker is server authenticated and never trusts browser session identity",()=>{
 assert.match(worker,/timingSafeEqual/);
 assert.match(worker,/Authorization/);
 assert.match(worker,/AGENT_WORKER_SECRET\?\?process\.env\.CRON_SECRET/);
});

test("worker retries are bounded and use increasing delay",()=>{
 assert.match(worker,/claim\.attempt_count>=3/);
 assert.match(worker,/Math\.pow\(2/);
 assert.match(worker,/status:terminal\?"failed":"queued"/);
});

test("Vercel invokes the worker independently of the browser",()=>{
 assert.deepEqual(config.crons,[{path:"/internal/agent-worker",schedule:"* * * * *"}]);
});
