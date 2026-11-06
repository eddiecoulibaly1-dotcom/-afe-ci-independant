import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/team-platform.ts", import.meta.url), "utf8");
const agents = await readFile(new URL("../src/autonomous-agents/platform.ts", import.meta.url), "utf8");

test("Team & Governance normalizes API collections before rendering lists", () => {
  assert.match(source, /arr=x=>Array\\.isArray\\(x\\)\\?x:\\[\\]/);
  assert.match(source, /arr\\(d\\.recentActivity\\)\\.map/);
  assert.match(source, /arr\\(a\\.suggestions\\)\\.map/);
});

test("Team & Governance exposes autonomous agent and mission workspaces", () => {
  assert.match(source, /data-tab="agents"/);
  assert.match(source, /data-tab="missions"/);
  assert.match(source, /if\\(tab==="agents"\\)/);
  assert.match(source, /if\\(tab==="missions"\\)/);
});

test("agent UI uses workspace-scoped API contracts for creation and activation", () => {
  assert.match(source, /api\\(p\\+"\\/agents"/);
  assert.match(source, /status:"active"/);
  assert.match(source, /api\\(p\\+"\\/missions"/);
  assert.match(agents, /createMission\\(wid,user,i\\)/);
  assert.match(agents, /if\\(method==="PATCH"\\)/);
});
