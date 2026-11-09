import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  dependencyNodeKey, escalationLevel, isEscalationIncrease, validateProposedRelation
} from "../src/coo-dependency-logic.js";

const migrationUrl = new URL("../supabase/migrations/20261109150000_coo_dependency_intelligence_p1.sql", import.meta.url);
const guardMigrationUrl = new URL("../supabase/migrations/20261109153000_coo_dependency_execution_guard_and_auto_analysis.sql", import.meta.url);
const refinementMigrationUrl = new URL("../supabase/migrations/20261109160000_coo_dependency_guard_refinements.sql", import.meta.url);
const engineUrl = new URL("../src/coo-dependency-engine.ts", import.meta.url);
const cooUrl = new URL("../src/coo-platform.ts", import.meta.url);
const vercelUrl = new URL("../vercel.json", import.meta.url);

const thresholds = {
  warning_after_minutes: 60,
  director_after_minutes: 180,
  dg_after_minutes: 360,
  critical_after_minutes: 720,
  pending_review_after_minutes: 120
};

test("dependency node keys are typed and cannot be empty", () => {
  assert.equal(dependencyNodeKey("task", "abc"), "task:abc");
  assert.throws(() => dependencyNodeKey("task", ""), /invalide/);
});

test("hard prerequisites cannot be attached to a department-only node", () => {
  assert.throws(
    () => validateProposedRelation("task", "t1", "department", "d1", "hard_prerequisite"),
    /prérequis dur/
  );
  assert.doesNotThrow(
    () => validateProposedRelation("task", "t1", "department", "d1", "input_reference")
  );
  assert.throws(
    () => validateProposedRelation("mission", "m1", "mission", "m1", "hard_prerequisite"),
    /lui-même/
  );
});

test("escalation levels progress through configurable thresholds", () => {
  assert.equal(escalationLevel(30, thresholds), "none");
  assert.equal(escalationLevel(60, thresholds), "warning");
  assert.equal(escalationLevel(180, thresholds), "director");
  assert.equal(escalationLevel(360, thresholds), "dg");
  assert.equal(escalationLevel(720, thresholds), "critical");
  assert.equal(escalationLevel(119, thresholds, true), "none");
  assert.equal(escalationLevel(120, thresholds, true), "dg");
  assert.equal(isEscalationIncrease("warning", "director"), true);
  assert.equal(isEscalationIncrease("dg", "warning"), false);
});

test("dependency migration creates workspace-scoped deliverables, graph, DG review and escalation tables", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /afe_coo_deliverables/);
  assert.match(sql, /afe_coo_dependency_edges/);
  assert.match(sql, /pending_dg/);
  assert.match(sql, /guard_afe_coo_dependency_edge/);
  assert.match(sql, /COO dependency cycle detected/);
  assert.match(sql, /capture_afe_coo_mission_deliverables/);
  assert.match(sql, /afe_coo_escalation_policies/);
  assert.match(sql, /afe_coo_escalations/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
});

test("execution gates prevent direct task or mission status changes from bypassing active hard dependencies", async () => {
  const sql = await readFile(guardMigrationUrl, "utf8");
  assert.match(sql, /guard_afe_coo_task_dependency_execution/);
  assert.match(sql, /guard_afe_coo_mission_dependency_execution/);
  assert.match(sql, /dependency_analysis_status/);
  assert.match(sql, /COO_DEPENDENCY_BLOCKED:/);
});

test("task deliverables are uniquely versioned per task and same-mission hard edges cannot deadlock batch execution", async () => {
  const sql = await readFile(refinementMigrationUrl, "utf8");
  assert.match(sql, /task-output-' \|\| v_task_id::text/);
  assert.match(sql, /Hard task dependencies inside the same mission are not supported/);
});

test("dependency API keeps proposals pending DG approval and acceptance is explicit", async () => {
  const source = await readFile(engineUrl, "utf8");
  assert.match(source, /status: "pending_dg"/);
  assert.match(source, /requireRole\(workspaceId, user, "owner"\)/);
  assert.match(source, /decision === "approve" \? "active" : "rejected"/);
  assert.match(source, /status: "accepted"/);
  assert.match(source, /handleCooDependencyWorker/);
  assert.match(source, /analyzeDependencies\(workspaceId, \{ id: workspace\.owner_id \} as AuthUser/);
});

test("COO console exposes the dependency and deliverables governance center", async () => {
  const source = await readFile(cooUrl, "utf8");
  assert.match(source, /data-tab="dependencies">Dépendances & livrables/);
  assert.match(source, /async function renderDependencies\(\)/);
  assert.match(source, /Ordre de travail calculé par le COO/);
  assert.match(source, /executionStages/);
  assert.match(source, /Analyser les tâches ouvertes/);
  assert.match(source, /Approuver et activer/);
  assert.match(source, /Accepter le livrable/);
});

test("dependency escalation worker is scheduled every five minutes", async () => {
  const config = JSON.parse(await readFile(vercelUrl, "utf8"));
  assert.ok(config.crons.some((cron: any) => cron.path === "/internal/coo-dependency-worker" && cron.schedule === "*/5 * * * *"));
});
