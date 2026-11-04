import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261104120000_afe_ci_debate_duplicate_policy_index_cleanup.sql", import.meta.url);

test("debate cleanup removes only confirmed duplicate legacy policies", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /drop policy if exists debates_select_v09_access on public\.debates/i);
  assert.match(sql, /drop policy if exists debates_update_v09_access on public\.debates/i);
});

test("debate cleanup removes only duplicate legacy indexes and preserves canonical indexes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const name of [
    "debate_events_round_idx",
    "debate_evidence_round_idx",
    "debate_share_links_created_by_idx",
    "debate_shares_shared_by_idx"
  ]) {
    assert.match(sql, new RegExp("drop index if exists public\\." + name, "i"));
  }
  for (const name of [
    "idx_debate_events_round_id",
    "idx_debate_evidence_round_id",
    "idx_debate_share_links_created_by",
    "idx_debate_shares_shared_by"
  ]) {
    assert.doesNotMatch(sql, new RegExp("drop index if exists public\\." + name, "i"));
  }
});

test("debate cleanup is idempotent and does not mutate data or table structure", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /begin\s*;/i);
  assert.match(sql, /commit\s*;/i);
  assert.equal((sql.match(/if exists/gi) ?? []).length, 6);
  assert.doesNotMatch(sql, /\b(delete from|truncate|drop table|alter table)\b/i);
});
