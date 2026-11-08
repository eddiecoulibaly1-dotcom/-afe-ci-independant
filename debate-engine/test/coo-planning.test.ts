import test from "node:test";
import assert from "node:assert/strict";
import { consolidateDepartmentWorkstreams } from "../src/coo-planning.js";

test("COO planning consolidates duplicate department workstreams without losing tasks", () => {
  const result = consolidateDepartmentWorkstreams([
    {
      departmentSlug: "risques-controle",
      missionTitle: "Cartographier les risques",
      objective: "Identifier les risques majeurs.",
      priority: 2,
      dueInHours: 72,
      tasks: [{ title: "Inventaire", description: "Recenser les risques.", priority: 2, dueInHours: 24 }]
    },
    {
      departmentSlug: "risques-controle",
      missionTitle: "Tester les contrôles",
      objective: "Évaluer les contrôles existants.",
      priority: 3,
      dueInHours: 48,
      tasks: [{ title: "Tests", description: "Tester les contrôles.", priority: 3, dueInHours: 48 }]
    }
  ]);

  assert.equal(result.workstreams.length, 1);
  assert.deepEqual(result.mergedDepartmentSlugs, ["risques-controle"]);
  assert.equal(result.workstreams[0].tasks.length, 2);
  assert.match(result.workstreams[0].objective, /Identifier les risques majeurs/);
  assert.match(result.workstreams[0].objective, /Évaluer les contrôles existants/);
  assert.equal(result.workstreams[0].dueInHours, 48);
  assert.match(result.workstreams[0].missionTitle, /plan consolidé/);
});

test("COO planning leaves distinct departments separate", () => {
  const result = consolidateDepartmentWorkstreams([
    {
      departmentSlug: "finance",
      missionTitle: "Budget",
      objective: "Préparer le budget.",
      priority: 2,
      dueInHours: 72,
      tasks: [{ title: "Prévisions", description: "Préparer les prévisions.", priority: 2, dueInHours: 24 }]
    },
    {
      departmentSlug: "technology",
      missionTitle: "Architecture",
      objective: "Évaluer l'architecture.",
      priority: 2,
      dueInHours: 96,
      tasks: [{ title: "Audit", description: "Auditer la plateforme.", priority: 2, dueInHours: 48 }]
    }
  ]);

  assert.equal(result.workstreams.length, 2);
  assert.deepEqual(result.mergedDepartmentSlugs, []);
});

test("COO planning consolidates every repeated workstream for a department", () => {
  const make = (n: number) => ({
    departmentSlug: "operations",
    missionTitle: "Volet " + n,
    objective: "Objectif " + n,
    priority: 2,
    dueInHours: 100 - n,
    tasks: [{ title: "Tâche " + n, description: "Description " + n, priority: 2, dueInHours: 24 }]
  });
  const result = consolidateDepartmentWorkstreams([make(1), make(2), make(3)]);

  assert.equal(result.workstreams.length, 1);
  assert.equal(result.workstreams[0].tasks.length, 3);
  assert.equal(result.workstreams[0].dueInHours, 97);
  assert.match(result.workstreams[0].objective, /Objectif 2/);
  assert.match(result.workstreams[0].objective, /Objectif 3/);
});
