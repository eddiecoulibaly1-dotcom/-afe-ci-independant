import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20261112184220_afe_agent_mission_coo_review_atomic_decision.sql", root), "utf8");
const platform = await readFile(new URL("src/autonomous-agents/platform.ts", root), "utf8");

test("COO mission review decisions lock the mission and reject stale or duplicate decisions", () => {
  assert.match(migration, /SELECT m\.\* INTO v_mission[\s\S]*FOR UPDATE/);
  assert.match(migration, /v_mission\.status <> 'paused'/);
  assert.match(migration, /coo_review' ->> 'status' IS DISTINCT FROM 'pending'/);
  assert.match(migration, /MISSION_REVIEW_NOT_PENDING/);
});

test("human acceptance requires accepted deterministic and semantic independent reviews", () => {
  assert.match(migration, /v_independent_review ->> 'verdict' IS DISTINCT FROM 'accepted'/);
  assert.match(migration, /v_semantic_review ->> 'verdict' IS DISTINCT FROM 'accepted'/);
  assert.match(migration, /citationsVerified' IS DISTINCT FROM 'true'/);
  assert.match(migration, /reviewerAgentId' = v_mission\.agent_id::text/);
  assert.match(migration, /closureEligible', p_decision = 'accept'/);
});

test("mission decision and append-only event are persisted in the same database transaction", () => {
  const updateAt = migration.indexOf("UPDATE public.afe_agent_missions");
  const eventAt = migration.indexOf("INSERT INTO public.afe_agent_events");
  assert.ok(updateAt > 0 && eventAt > updateAt, "mission transition must precede event insert inside the same function");
  assert.match(migration, /mission\.coo_review\.' \|\| p_decision/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
});

test("review API delegates the decision to the atomic RPC instead of separate PATCH and event writes", () => {
  const start = platform.indexOf('if(p[4]==="missions"&&p[5]&&p[6]==="review"');
  const end = platform.indexOf('if(p[4]==="missions"&&p.length===5)', start);
  assert.ok(start >= 0 && end > start, "mission review route must exist");
  const route = platform.slice(start, end);
  assert.match(route, /rpc\/decide_afe_agent_mission_coo_review/);
  assert.match(route, /requireRole\(wid,user,"admin"\)/);
  assert.doesNotMatch(route, /method:"PATCH"/);
  assert.doesNotMatch(route, /afe_agent_events/);
  assert.doesNotMatch(route, /await audit\(/);
});

test("requester cannot approve their own mission and final acceptance remains a distinct human decision", () => {
  assert.match(migration, /v_mission\.created_by = p_reviewer_id/);
  assert.match(migration, /MISSION_REQUESTER_CANNOT_REVIEW_OWN_MISSION/);
  assert.match(migration, /actor_type,[\s\S]*'human'/);
  assert.match(platform, /await requireRole\(wid,user,"admin"\)/);
});
