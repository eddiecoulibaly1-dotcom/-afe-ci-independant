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
  const atomic = await readFile(new URL("../supabase/migrations/20261112160000_afe_agent_mission_execution_atomic_commit.sql", import.meta.url), "utf8");
  assert.equal((worker.match(/awaitingCooValidation:true/g) ?? []).length, 2);
  assert.ok(worker.includes("rpc/commit_afe_agent_mission_execution"));
  assert.match(atomic, /mission\.awaiting_coo_validation/);
  assert.match(atomic, /status = 'paused'/);
  assert.match(atomic, /'coo_review'/);
  assert.match(atomic, /validation indépendante et décision COO requises avant clôture/);
  assert.equal(worker.includes("finish_afe_agent_mission"), false);
});

test("COO review endpoint requires admin role, distinct requester and explicit decision", async () => {
  const platform = await readFile(new URL("../src/autonomous-agents/platform.ts", import.meta.url), "utf8");
  assert.match(platform, /p\[6\]==="review"/);
  assert.match(platform, /requireRole\(wid,user,"admin"\)/);
  assert.match(platform, /mission\.created_by===user\.id/);
  assert.match(platform, /closureEligible:decision==="accept"/);
  assert.match(platform, /mission\.coo_review\./);
  assert.match(platform, /patch\.status="queued"/);
});
