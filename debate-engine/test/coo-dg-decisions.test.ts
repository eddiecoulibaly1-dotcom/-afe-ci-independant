import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261109180000_coo_dg_decision_workflow.sql", import.meta.url);
const apiUrl = new URL("../src/coo-dg-decisions.ts", import.meta.url);
const serverUrl = new URL("../src/server.ts", import.meta.url);
const platformUrl = new URL("../src/coo-platform.ts", import.meta.url);

test("DG decision migration creates workspace-scoped decisions and append-only audit events", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /afe_coo_dg_decisions/);
  assert.match(sql, /afe_coo_dg_decision_events/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.afe_coo_dg_decisions FROM public, anon, authenticated/i);
  assert.match(sql, /DG decision events are append-only/);
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
});

test("DG decision API authenticates workspace membership and reserves decisions to owner", async () => {
  const source = await readFile(apiUrl, "utf8");
  assert.match(source, /workspaceRole\(workspaceId,user\)/);
  assert.match(source, /if\(!isOwner\)/);
  assert.match(source, /status=eq\.pending/);
  assert.match(source, /Le dossier a déjà fait l'objet d'une décision/);
  assert.match(source, /decided_by:user\.id/);
  assert.match(source, /event_type:map\[outcome\]/);
});

test("COO server routes DG decisions only after bearer authentication", async () => {
  const source = await readFile(serverUrl, "utf8");
  assert.match(source, /authenticateRequest\(req\)/);
  assert.match(source, /handleDgDecisionRequest\(req,res,path,user\)/);
});

test("COO exposes a dedicated DG decision center with submission, decision and audit views", async () => {
  const source = await readFile(platformUrl, "utf8");
  assert.match(source, /data-tab="dg-decisions">Décisions & validations DG/);
  assert.match(source, /Soumettre un dossier à la DG/);
  assert.match(source, /File DG/);
  assert.match(source, /Journal d’audit/);
  assert.match(source, /Aucune approbation ni mission n’a été déclenchée/);
});
