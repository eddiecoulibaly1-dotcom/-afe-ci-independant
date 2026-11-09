import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerUrl = new URL("../src/autonomous-agents/worker.ts", import.meta.url);

test("mission worker requires a substantive summary, analysis and concrete deliverables before completion", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /function validateMissionDeliverables/);
  assert.match(source, /synthÃ¨se opÃ©rationnelle vÃ©rifiable est obligatoire/);
  assert.match(source, /Analyse insuffisante/);
  assert.match(source, /Livrable absent ou trop sommaire/);
  assert.equal((source.match(/validateMissionDeliverables\(output\)/g) ?? []).length, 2);
});

test("a completed operational task must provide a concrete task-level deliverable", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /deliverable:\s*string/);
  assert.match(source, /deliverable:\{type:"string"\}/);
  assert.match(source, /Chaque tÃ¢che terminÃ©e doit fournir un livrable concret/);
  assert.match(source, /Chaque tÃ¢che terminÃ©e doit fournir un livrable concret : /);
});

test("worker records deliverable evidence before task synchronization and COO review", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /async function recordMissionDeliverables/);
  assert.match(source, /event_type:"mission\.deliverables\.submitted"/);
  assert.match(source, /taskDeliverables:/);
  asser¶»§q«^