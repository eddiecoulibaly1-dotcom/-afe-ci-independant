import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20261104130000_afe_ci_workspace_admin_membership_alignment.sql",
  import.meta.url
);

test("workspace admin membership policy alignment does not grant client table privileges", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /debate_workspace_members_admin_insert/i);
  assert.match(sql, /debate_workspace_members_admin_update/i);
  assert.match(sql, /debate_workspace_members_admin_delete/i);
  assert.match(sql, /me\.role in \('owner', 'admin'\)/i);
  assert.doesNotMatch(sql, /grant\s+(all|insert|update|delete).*to authenticated/i);
});
