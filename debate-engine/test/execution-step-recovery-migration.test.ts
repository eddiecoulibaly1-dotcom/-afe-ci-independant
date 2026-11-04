import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20261103231000_afe_ci_debate_execution_step_recovery_limit.sql",
  import.meta.url
);

test("execution step recovery limit is aligned to eight attempts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /s\.attempt_count\s*<\s*8/i);
  assert.doesNotMatch(sql, /s\.attempt_count\s*<\s*3/i);
  assert.match(sql, /lease_expires_at\s*<\s*now\(\)/i);
  assert.match(sql, /revoke all on function public\.claim_debate_execution_step/i);
  assert.match(sql, /grant execute on function public\.claim_debate_execution_step[\s\S]*to service_role/i);
});
