import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const firstUrl = new URL("../supabase/migrations/20261102120000_market_price_ledger.sql", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20261102150000_market_price_security_and_chicks.sql", import.meta.url);

test("ledger base migration creates append-only observations and blocks bulk truncation", async () => {
  const sql = await readFile(firstUrl, "utf8");
  assert.match(sql, /before update or delete on public\.market_price_observations/i);
  assert.match(sql, /revoke truncate on public\.market_price_observations from anon, authenticated, service_role/i);
  assert.match(sql, /security_invoker = true/i);
});

test("ledger hardening scopes duplicate fingerprints to each owner", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /unique index if not exists market_price_observations_owner_fingerprint_uidx\s+on public\.market_price_observations \(created_by, fingerprint\)/i);
  assert.doesNotMatch(sql, /unique\s*\(fingerprint\)/i);
});

test("ledger hardening enforces one correction per observation, including concurrent writes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /unique index if not exists market_price_observations_one_correction_uidx\s+on public\.market_price_observations \(supersedes_id\)\s+where supersedes_id is not null/i);
});

test("ledger hardening enforces batch ownership and keeps client writes unavailable", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /foreign key \(batch_id, created_by\)\s+references public\.market_price_import_batches \(id, created_by\)/i);
  assert.match(sql, /grant select, insert, update on public\.market_price_import_batches to service_role/i);
  assert.doesNotMatch(sql, /grant\s+(all|insert|update|delete).*to authenticated/i);
});

test("chick quotation fields and every commercial attribute are preserved by corrections", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const field of ["product_category", "strain", "vaccination_status", "minimum_quantity", "pack_size", "delivery_fee", "availability_date"]) {
    assert.match(sql, new RegExp("add column if not exists " + field, "i"));
    assert.match(sql, new RegExp("original\\." + field + " is distinct from new\\." + field, "i"));
  }
  assert.match(sql, /delivery_fee is null or delivery_fee >= 0/i);
});

test("metadata constraints validate SHA-256 and observation validity dates", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /file_sha256 ~ '\^\[0-9a-fA-F\]\{64\}\$'/i);
  assert.match(sql, /valid_until >= observed_at/i);
});

test("the batch-owner unique key and foreign key can be safely recreated", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create unique index if not exists market_price_import_batches_id_owner_uidx/i);
  assert.match(sql, /drop constraint if exists market_price_observations_batch_owner_fkey/i);
});
