import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const coo = await readFile(new URL("../src/coo-platform.ts", import.meta.url), "utf8");
const manual = await readFile(new URL("../docs/AFE_CI_MANUEL_PROCEDURES_UTILISATION_COO.md", import.meta.url), "utf8");

test("COO manual is available as a dedicated navigation tab", () => {
  assert.match(coo, /data-tab="manual">Manuel d’utilisation/);
  assert.match(coo, /else if\(tab==="manual"\)renderManual\(\)/);
  assert.match(coo, /function renderManual\(\)/);
});

test("COO manual exposes searchable content and four download formats", () => {
  for (const id of ["manualSearch", "manualToc", "manualPdf", "manualWord", "manualHtml", "manualMd"]) {
    assert.ok(coo.includes(id), "Missing manual UI element: " + id);
  }
  assert.match(coo, /Télécharger PDF/);
  assert.match(coo, /Télécharger Word/);
  assert.match(coo, /Télécharger HTML/);
  assert.match(coo, /Télécharger Markdown/);
});

test("COO procedure manual covers every primary tab and mission control dossier", () => {
  for (const section of [
    "Vue centrale", "Portefeuille des missions", "Directions", "Tâches & affectations",
    "Alertes", "Reporting à la Direction générale", "Paramètres COO",
    "Dossier de contrôle d’une mission", "Sécurité, confidentialité et conservation",
    "Agents IA", "Délégations", "Approbations IA", "Notifications", "Membres",
    "Débats", "Validations", "Documents", "Audit", "Assistant IA", "Paramètres du workspace"
  ]) assert.ok(manual.includes(section), "Manual is missing section: " + section);
  assert.ok(manual.length > 25000, "Manual should remain a detailed operating procedure, not a short help note");
});
