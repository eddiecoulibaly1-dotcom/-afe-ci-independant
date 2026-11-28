import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerUrl = new URL("../src/autonomous-agents/worker.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20261128170000_coo_task_incomplete_event_idempotency.sql", import.meta.url);

test("worker failure, incomplete deliberation and COO validation events use retry-safe per-attempt keys", async () => {
  const worker = await readFile(workerUrl, "utf8");
  assert.ok(worker.includes('":attempt:"+attempt+":failure'));
  assert.ok(worker.includes('":attempt:"+attempt+":deliberation-incomplete'));
  assert.ok(worker.includes('":attempt:"+claim.attempt_count+":awaiting-coo-validation'));
  assert.ok((worker.match(/afe_agent_events\?on_conflict=workspace_id,idempotency_key/g) ?? []).length >= 6);
  assert.ok((worker.match(/mission.awaiting_coo_validation/g) ?? []).length >= 2);
  assert.match(worker, /resolution=ignore-duplicates,return=minimal/);
  assert.match(worker, /idempotency_key:idempotencyKey/);
  assert.match(worker, /idempotency_key:validationKey/);
});

test("atomic COO incomplete-task event is keyed by mission attempt and ignores duplicates", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /CREATE OR REPLACE FUNCTION public.apply_coo_task_results_atomic/);
  assert.match(migration, /idempotency_key/);
  assert.match(migration, /mission:'?\s*\|\|p_mission_id::text\|\|/);
  assert.match(migration, /ON CONFLICT \(workspace_id,idempotency_key\) DO NOTHING/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public.apply_coo_task_results_atomic/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public.apply_coo_task_results_atomic.*TO service_role/);
});
