import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root=new URL("../",import.meta.url);
const migration=await readFile(new URL("supabase/migrations/20261106010000_autonomous_agents_p8_p9_orchestration.sql",root),"utf8");
const migration2=await readFile(new URL("supabase/migrations/20261106020000_autonomous_agents_p8_p9_approval_requests.sql",root),"utf8");
const worker=await readFile(new URL("src/autonomous-agents/worker.ts",root),"utf8");
const platform=await readFile(new URL("src/autonomous-agents/platform.ts",root),"utf8");

test("P8 blocks claims while a human approval is pending",()=>{
 assert.match(migration,/NOT EXISTS \(SELECT 1 FROM public\.afe_agent_approvals ap WHERE ap\.mission_id=m\.id AND ap\.status='pending'\)/);
 assert.match(migration2,/request_afe_agent_approval/);
 assert.match(migration2,/status='waiting_approval'/);
 assert.ok(platform.includes("rpc/request_afe_agent_approval"));
});

test("P8 decisions are atomic, workspace-scoped and server-only",()=>{
 assert.match(migration,/decide_afe_agent_approval/);
 assert.match(migration,/workspace_id=p_workspace_id/);
 assert.match(migration,/FOR UPDATE/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.decide_afe_agent_approval/);
 assert.match(platform,/rpc\/decide_afe_agent_approval/);
 assert.match(platform,/requireRole\(wid,user,"admin"\)/);
});

test("P9 handoffs create idempotent recipient missions",()=>{
 assert.match(migration,/UNIQUE INDEX IF NOT EXISTS afe_agent_missions_source_message_uidx/);
 assert.match(migration,/ON CONFLICT \(source_message_id\)/);
 assert.match(migration,/agent\.handoff\.dispatched/);
 assert.match(migration2,/message_type IN/);
 assert.match(worker,/rpc\/dispatch_afe_agent_messages/);
});

test("P9 dispatch is bounded and uses row locks",()=>{
 assert.match(migration2,/p_limit<1 OR p_limit>50/);
 assert.match(migration2,/FOR UPDATE SKIP LOCKED/);
});
