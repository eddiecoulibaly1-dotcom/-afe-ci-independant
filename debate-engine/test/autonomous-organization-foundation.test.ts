import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AGENT_DEPARTMENT_TEMPLATES,
  canAgentUseTool,
  requiresHumanApproval,
  type AgentExecutionContext,
  type AgentToolGrant
} from "../src/autonomous-agents/types.js";

const migrationPath = new URL("../supabase/migrations/20261105230000_autonomous_agents_p0_foundation.sql", import.meta.url);

test("P0 migration creates the complete server-managed agent foundation", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of [
    "afe_agents", "afe_agent_tool_grants", "afe_agent_missions", "afe_agent_runs",
    "afe_agent_mission_steps", "afe_agent_events", "afe_agent_messages",
    "afe_agent_memory", "afe_agent_approvals"
  ]) assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS public\\." + table));
});

test("all agent tables are RLS-enabled and inaccessible to browser roles", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM anon, authenticated/);
  assert.match(sql, /GRANT ALL ON TABLE public\.%I TO service_role/);
});

test("the schema enforces workspace-scoped agent and mission relationships", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /UNIQUE \(id, workspace_id\)/);
  assert.match(sql, /FOREIGN KEY \(agent_id, workspace_id\)/);
  assert.match(sql, /FOREIGN KEY \(mission_id, workspace_id\)/);
});

test("department templates provide six bounded specialist mandates", () => {
  assert.equal(AGENT_DEPARTMENT_TEMPLATES.length, 6);
  assert.equal(new Set(AGENT_DEPARTMENT_TEMPLATES.map(x => x.slug)).size, 6);
  for (const agent of AGENT_DEPARTMENT_TEMPLATES) {
    assert.ok(agent.mandate.length >= 80);
    assert.ok(agent.defaultAutonomy >= 1 && agent.defaultAutonomy <= 3);
  }
});

test("high and critical risk actions always require human approval", () => {
  assert.equal(requiresHumanApproval({ risk: "high", toolKey: "workspace.create_draft", autonomyLevel: 3, grantApprovalRequired: false }), true);
  assert.equal(requiresHumanApproval({ risk: "critical", toolKey: "research.web_search", autonomyLevel: 3, grantApprovalRequired: false }), true);
  assert.equal(requiresHumanApproval({ risk: "low", toolKey: "deployment.production.promote", autonomyLevel: 3, grantApprovalRequired: false }), true);
});

test("agent tools are denied unless explicitly enabled and granted in the same execution context", () => {
  const grant: AgentToolGrant = { toolKey: "research.web_search", permission: "read", enabled: true, approvalRequired: false, limits: {} };
  const base: AgentExecutionContext = { workspaceId: "w", agentId: "a", missionId: "m", actorUserId: "u", autonomyLevel: 2, grants: [grant] };
  assert.equal(canAgentUseTool(base, grant, "read"), true);
  assert.equal(canAgentUseTool(base, grant, "write"), false);
  assert.equal(canAgentUseTool({ ...base, grants: [] }, grant, "read"), false);
  assert.equal(canAgentUseTool(base, { ...grant, enabled: false }, "read"), false);
});

test("L2 agents cannot execute external side-effect tools", () => {
  const grant: AgentToolGrant = { toolKey: "workspace.create_draft", permission: "execute", enabled: true, approvalRequired: false, limits: {} };
  const base: AgentExecutionContext = { workspaceId: "w", agentId: "a", missionId: "m", actorUserId: "u", autonomyLevel: 2, grants: [grant] };
  assert.equal(canAgentUseTool(base, grant, "execute"), false);
});
