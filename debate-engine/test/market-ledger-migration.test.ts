import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261102150000_market_price_security_and_chicks.sql", import.meta.url);

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

test("chick quotation fields are stored and validated by database constraints", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const field of ["product_category", "strain", "vaccination_status", "minimum_quantity", "pack_size", "delivery_fee", "availability_date"]) {
    assert.match(sql, new RegExp("add column if not exists " + field, "i"));
  }
  assert.match(sql, /delivery_fee is null or delivery_fee >= 0/i);
});
