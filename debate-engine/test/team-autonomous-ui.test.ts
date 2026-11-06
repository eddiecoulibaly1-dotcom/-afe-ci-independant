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
