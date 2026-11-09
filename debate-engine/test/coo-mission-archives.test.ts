import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const migrationUrl = new URL("../supabase/migrations/20261109064541_afe_ci_coo_mission_archives.sql", import.meta.url);
const indexesUrl = new URL("../supabase/migrations/20261109070000_afe_ci_coo_mission_archive_indexes.sql", import.meta.url);
const platformUrl = new URL("../src/coo-platform.ts", import.meta.url);
test("COO mission archives are workspace-scoped and preserve immutable mission/task snapshots", async () => {
 const sql = await readFile(migrationUrl, "utf8");
 assert.match(sql, /create table if not exists public\.afe_coo_mission_archives/i);
 assert.match(sql, /unique \(workspace_id, mission_id\)/i);
 assert.match(sql, /mission_snapshot jsonb not null/); assert.match(sql, /tasks_snapshot jsonb not null/);
 assert.match(sql, /on delete restrict/i); assert.match(sql, /enable row level security/i);
 assert.match(sql, /using \(false\) with check \(false\)/i); assert.doesNotMatch(sql, /security definer/i);
});
test("completed missions are archived automatically and existing completed missions are backfilled", async () => {
 const sql = await readFile(migrationUrl, "utf8");
 assert.match(sql, /create trigger afe_coo_archive_completed_mission_trigger/i);
 assert.match(sql, /after insert or update of status/i);
 assert.match(sql, /if new\.status <> 'completed' then return new/);
 assert.match(sql, /where m\.status='completed'/);
 assert.match(sql, /on conflict \(workspace_id, mission_id\) do nothing/);
});
test("archive document foreign keys are indexed", async () => {
 const sql = await readFile(indexesUrl, "utf8");
 for (const name of ["afe_coo_mission_archives_mission_id_idx","afe_coo_mission_archive_documents_archive_workspace_idx","afe_coo_mission_archive_documents_source_document_idx","afe_coo_mission_archive_documents_uploaded_by_idx","afe_coo_mission_archive_documents_linked_by_idx"]) assert.ok(sql.includes(name));
});
test("archive documents are independent storage copies with source provenance", async () => {
 const sql = await readFile(migrationUrl, "utf8"), source = await readFile(platformUrl, "utf8");
 assert.match(sql, /source_storage_path text not null/);
 assert.match(source, /\/storage\/v1\/object\/copy/);
 assert.match(source, /source_storage_path: source\.storage_path/);
 assert.match(source, /afe_coo_mission_archive_documents/);
});
test("archive upload endpoints validate and verify private storage before registering a document", async () => {
 const source = await readFile(platformUrl, "utf8");
 assert.match(source, /p\[7\] === "upload-url"/);
 assert.match(source, /p\[7\] === "upload-complete"/);
 assert.match(source, /sizeBytes > 50000000/);
 assert.match(source, /Le fichier n’a pas été confirmé dans le stockage privé/);
 assert.match(source, /uploadArchiveFiles/);
});
test("COO archive API enforces workspace access and signed downloads", async () => {
 const source = await readFile(platformUrl, "utf8");
 assert.match(source, /resource === "archives" && method === "GET"/);
 assert.match(source, /requireAccess\(workspaceId, user, "editor"\)/);
 assert.match(source, /resource === "archives".*signed-url/s);
 assert.match(source, /storage\/v1\/object\/sign\/afe-ci-team-documents/);
});
test("COO navigation exposes archive search and mission dossier details", async () => {
 const source = await readFile(platformUrl, "utf8");
 assert.match(source, /data-tab="archives">Archives des missions/);
 assert.match(source, /function renderArchives\(\)/);
 assert.match(source, /archiveSearch/);
 assert.match(source, /Photographie des tâches à la clôture/);
 assert.match(source, /Documents et rapports associés/);
});
