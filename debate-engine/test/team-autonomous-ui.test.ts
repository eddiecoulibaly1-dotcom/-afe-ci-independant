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
  assert.ok(source.includes('data-agent-action="active"'));
  assert.ok(source.includes('data-agent-action="paused"'));
  assert.ok(source.includes('data-agent-action="archived"'));
  assert.ok(source.includes('data-agent-action="draft"'));
  assert.ok(source.includes('api(p+"/missions"'));
  assert.ok(agents.includes("createMission(wid,user,i)"));
  assert.ok(agents.includes('if(method==="PATCH")'));
  assert.ok(agents.includes('p[4]==="agent-dashboard"'));
  assert.ok(agents.includes('p[4]==="dashboard"') === false);
});


test("agent lifecycle protects permanent deletion behind Preview and explicit confirmation", () => {
  assert.ok(agents.includes('method==="DELETE"'));
  assert.ok(agents.includes('process.env.VERCEL_ENV!=="preview"'));
  assert.ok(agents.includes('process.env.AGENT_HARD_DELETE_ENABLED!=="true"'));
  assert.ok(agents.includes('old.status!=="archived"'));
  assert.ok(agents.includes('i.confirmName!==old.name||i.confirmPermanent!==true'));
  assert.ok(agents.includes('historyPreserved:true'));
  assert.ok(source.includes('data.hardDeleteEnabled'));
});

test("agent deletion migration changes historical foreign keys to RESTRICT", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261107000100_agent_lifecycle_restrict_history.sql", import.meta.url), "utf8");
  assert.ok(migration.includes("on delete restrict"));
  assert.ok(migration.includes("afe_agent_missions_agent_id_workspace_id_fkey"));
  assert.ok(migration.includes("afe_deliberation_contributions_agent_id_workspace_id_fkey"));
});
