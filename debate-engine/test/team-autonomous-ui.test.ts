import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/team-platform.ts", import.meta.url), "utf8");
const agents = await readFile(new URL("../src/autonomous-agents/platform.ts", import.meta.url), "utf8");

test("Team & Governance normalizes API collections before rendering lists", () => {
  assert.ok(source.includes("arr=x=>Array.isArray(x)?x:[]"));
  assert.ok(source.includes("arr(d.recentActivity).map"));
  assert.ok(source.includes("arr(a.suggestions).map"));
  assert.ok(source.includes('api(p+"/agent-dashboard")'));
});

test("Team & Governance exposes autonomous agent and mission workspaces", () => {
  assert.ok(source.includes('data-tab="agents"'));
  assert.ok(source.includes('data-tab="missions"'));
  assert.ok(source.includes('if(tab==="agents")'));
  assert.ok(source.includes('if(tab==="missions")'));
});

test("agent UI uses workspace-scoped API contracts for creation and activation", () => {
  assert.ok(source.includes('api(p+"/agents"'));
  assert.ok(source.includes('status:"active"'));
  assert.ok(source.includes('api(p+"/missions"'));
  assert.ok(agents.includes("createMission(wid,user,i)"));
  assert.ok(agents.includes('if(method==="PATCH")'));
  assert.ok(agents.includes('p[4]==="agent-dashboard"'));
  assert.ok(agents.includes('p[4]==="dashboard"') === false);
});

test("COO mission dossier exposes submitted evidence, independent findings and human review decisions", () => {
  assert.ok(source.includes("Contrôle qualité & décision COO"));
  assert.ok(source.includes("mission.evidence.reviewed"));
  assert.ok(source.includes("mission.deliverables.submitted"));
  assert.ok(source.includes("cooAccept"));
  assert.ok(source.includes("cooReturn"));
  assert.ok(source.includes("cooReject"));
  assert.ok(source.includes("/review"));
  assert.ok(source.includes("closureEligible"));
});
test("worker leaves completed deliverables pending COO validation through the atomic transaction", async () => {
  const worker = await readFile(new URL("../src/autonomous-agents/worker.ts", import.meta.url), "utf8");
  const atomic = await readFile(new URL("../supabase/migrations/20261112144356_afe_agent_mission_execution_atomic_commit.sql", import.meta.url), "utf8");
  assert.equal((worker.match(/awaitingCooValidation:true/g) ?? []).length, 2);
  assert.ok(worker.includes("rpc/commit_afe_agent_mission_execution"));
  assert.match(atomic, /mission\.awaiting_coo_validation/);
  assert.match(atomic, /status = 'paused'/);
  assert.match(atomic, /'coo_review'/);
  assert.match(atomic, /validation indépendante et décision COO requises avant clôture/);
  assert.equal(worker.includes("finish_afe_agent_mission"), false);
});

test("COO review endpoint requires admin role and delegates the final decision to the atomic review RPC", async () => {
  const platform = await readFile(new URL("../src/autonomous-agents/platform.ts", import.meta.url), "utf8");
  const reviewMigration = await readFile(new URL("../supabase/migrations/20261112184220_afe_agent_mission_coo_review_atomic_decision.sql", import.meta.url), "utf8");
  assert.match(platform, /p\[6\]==="review"/);
  assert.match(platform, /requireRole\(wid,user,"admin"\)/);
  assert.match(platform, /rpc\/decide_afe_agent_mission_coo_review/);
  assert.doesNotMatch(platform, /mission\.created_by===user\.id/);
  assert.match(reviewMigration, /v_mission\.created_by = p_reviewer_id/);
  assert.match(reviewMigration, /closureEligible', p_decision = 'accept'/);
  assert.match(reviewMigration, /mission\.coo_review\.' \|\| p_decision/);
  assert.match(reviewMigration, /WHEN p_decision = 'return' THEN 'queued'/);
  assert.doesNotMatch(platform, /patch\.status="queued"/);
});


test("Team & Governance manual mission creation and diagnostic mission creation reuse stable keys", () => {
  assert.match(source, /function pendingIntentKey\(storageKey,payload\)/);
  assert.match(source, /afe-team-create-mission:/);
  assert.match(source, /afe-team-delib-mission:/);
  assert.match(source, /idempotencyKey:pendingMissionKey/);
  assert.match(source, /clearPendingIntentKey\(pendingMissionStorageKey,pendingMissionKey\)/);
  assert.match(source, /clearPendingIntentKey\(storageKey,key\)/);
});

test("agent mission API resolves concurrent idempotent inserts and emits the queued event only once", () => {
  assert.match(agents, /afe_agent_missions\?on_conflict=workspace_id%2Cidempotency_key/);
  assert.match(agents, /resolution=ignore-duplicates,return=representation/);
  assert.match(agents, /const inserted=Boolean\(m\)/);
  assert.match(agents, /if\(inserted\)await db\("afe_agent_events"/);
});
