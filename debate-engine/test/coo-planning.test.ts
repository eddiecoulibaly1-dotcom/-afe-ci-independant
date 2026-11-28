import test from "node:test";
import assert from "node:assert/strict";
import { consolidateDepartmentWorkstreams, reconcileCooRun, createCooDecisionRegister, applyCooDecisionRegister, hasPendingRequiredCooDecisions, hasRejectedRequiredCooDecisions, validateCooPlan } from "../src/coo-planning.js";

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

test("E9.2-D5 reconciliation confirms a fully persisted run, mission and stable task keys", () => {
  const run = {
    id: "run-1", status: "dispatched", missions_created: 1,
    plan: {
      workstreams: [{ departmentSlug: "risques-controle", tasks: [{ title: "A" }, { title: "B" }] }],
      dispatched: [{ missionId: "mission-1", departmentSlug: "risques-controle", taskCount: 2 }]
    }
  };
  const missions = [{
    id: "mission-1", department_id: "dept-1",
    input_context: { cooRunId: "run-1", cooTasks: [{ id: "task-1" }, { id: "task-2" }] }
  }];
  const tasks = [
    { id: "task-1", mission_id: "mission-1", coo_task_key: "run-1:risques-controle:task:0" },
    { id: "task-2", mission_id: "mission-1", coo_task_key: "run-1:risques-controle:task:1" }
  ];
  const result = reconcileCooRun(run, missions, tasks, { "dept-1": "risques-controle" });
  assert.equal(result.status, "consistent");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.counts, { plannedWorkstreams: 1, dispatchEntries: 1, linkedMissions: 1, recordedMissionsCreated: 1, expectedTasks: 2, actualTasks: 2 });
});

test("E9.2-D5 reconciliation flags a partial run without treating expected missing work as corruption", () => {
  const run = {
    id: "run-2", status: "partial", missions_created: 1,
    plan: {
      workstreams: [
        { departmentSlug: "finance", tasks: [{ title: "A" }] },
        { departmentSlug: "risques", tasks: [{ title: "B" }] }
      ],
      dispatched: [{ missionId: "mission-2", departmentSlug: "finance", taskCount: 1 }]
    }
  };
  const missions = [{ id: "mission-2", department_id: "d-finance", input_context: { cooRunId: "run-2", cooTasks: [{ id: "task-2" }] } }];
  const tasks = [{ id: "task-2", mission_id: "mission-2", coo_task_key: "run-2:finance:task:0" }];
  const result = reconcileCooRun(run, missions, tasks, { "d-finance": "finance" });
  assert.equal(result.status, "incomplete");
  assert.ok(result.issues.some(issue => issue.code === "missing_dispatch"));
  assert.ok(!result.issues.some(issue => issue.code === "mission_run_mismatch"));
});

test("E9.2-D5 reconciliation detects mission/run drift, missing task rows and count contradictions", () => {
  const run = {
    id: "run-3", status: "dispatched", missions_created: 3,
    plan: {
      workstreams: [{ departmentSlug: "ops", tasks: [{ title: "A" }, { title: "B" }] }],
      dispatched: [{ missionId: "mission-3", departmentSlug: "ops", taskCount: 2 }]
    }
  };
  const missions = [
    { id: "mission-3", department_id: "d-ops", input_context: { cooRunId: "other-run", cooTasks: [{ id: "task-3" }] } },
    { id: "mission-4", department_id: "d-ops", input_context: { cooRunId: "run-3", cooTasks: [] } }
  ];
  const tasks = [{ id: "task-3", mission_id: "mission-3", coo_task_key: "wrong-key" }];
  const result = reconcileCooRun(run, missions, tasks, { "d-ops": "ops" });
  assert.equal(result.status, "inconsistent");
  for (const code of ["mission_run_mismatch", "orphan_mission", "task_count_mismatch", "missing_task_key", "unexpected_task_key", "mission_count_mismatch"]) {
    assert.ok(result.issues.some(issue => issue.code === code), "Expected issue " + code);
  }
});

test("E9.2-D5 approval-required runs do not report intentionally undispatched workstreams as missing", () => {
  const run = {
    id: "run-4", status: "approval_required", missions_created: 0,
    plan: { workstreams: [{ departmentSlug: "finance", tasks: [{ title: "A" }] }], dispatched: [] }
  };
  const result = reconcileCooRun(run, [], []);
  assert.equal(result.status, "consistent");
  assert.deepEqual(result.issues, []);
});

test("E9.2-D6 creates stable DG decision registers with required sensitive approvals and non-blocking follow-ups", () => {
  const register = createCooDecisionRegister("run-d6", ["Revoir la politique de contrôle.", "Approbation humaine obligatoire : plan sensible."], ["Signer un contrat fournisseur"]);
  assert.equal(register.length, 2);
  assert.equal(register[0].id, "run-d6:dg:0");
  assert.equal(register[0].required, false);
  assert.equal(register[0].status, "pending");
  assert.equal(register[1].id, "run-d6:dg:sensitive");
  assert.equal(register[1].required, true);
  assert.match(register[1].detail, /Signer un contrat fournisseur/);
  assert.equal(hasPendingRequiredCooDecisions(register), true);
});

test("E9.2-D6 approving the last required DG decision clears the gate; rejection remains terminal", () => {
  const register = createCooDecisionRegister("run-d6b", ["Suivi DG"], ["Publier un contenu"]);
  const approved = applyCooDecisionRegister(register, "run-d6b:dg:sensitive", "approve", "Autorisation accordée après revue.", "dg-user", "2026-11-26T20:00:00Z");
  assert.equal(approved.changed, true);
  assert.equal(approved.target?.status, "approved");
  assert.equal(hasPendingRequiredCooDecisions(approved.entries), false);
  assert.equal(hasRejectedRequiredCooDecisions(approved.entries), false);
  const rejected = applyCooDecisionRegister(register, "run-d6b:dg:sensitive", "reject", "Action refusée après examen.", "dg-user", "2026-11-26T20:00:00Z");
  assert.equal(rejected.target?.status, "rejected");
  assert.equal(hasRejectedRequiredCooDecisions(rejected.entries), true);
  assert.throws(() => applyCooDecisionRegister(rejected.entries, "run-d6b:dg:sensitive", "approve", "Tentative de renversement.", "dg-user", "2026-11-26T20:01:00Z"), /ne peut pas être inversée/);
});

test("E9.2-D6 decision replay is idempotent and cannot alter a recorded decision", () => {
  const register = createCooDecisionRegister("run-d6c", ["Validation à suivre"], []);
  const first = applyCooDecisionRegister(register, "run-d6c:dg:0", "approve", "Validation documentée.", "dg", "2026-11-26T20:00:00Z");
  const replay = applyCooDecisionRegister(first.entries, "run-d6c:dg:0", "approve", "Autre note ignorée.", "dg", "2026-11-26T20:01:00Z");
  assert.equal(replay.changed, false);
  assert.equal(replay.target?.note, "Validation documentée.");
  assert.throws(() => applyCooDecisionRegister(first.entries, "run-d6c:dg:0", "reject", "Décision différente.", "dg", "2026-11-26T20:01:00Z"), /ne peut pas être inversée/);
});

test("E9.2-D7 accepts a bounded plan with eligible departments and actionable task fields", () => {
  const plan = {
    summary: "Plan de contrôle opérationnel",
    priority: 3,
    workstreams: [{
      departmentSlug: "finance-investissements",
      missionTitle: "Diagnostic financier",
      objective: "Analyser les hypothèses financières et documenter les constats vérifiables.",
      priority: 3,
      dueInHours: 24,
      tasks: [{
        title: "Collecter données financières",
        description: "Rassembler les sources financières et documenter leur provenance.",
        priority: 3,
        dueInHours: 24
      }]
    }],
    decisionsRequired: [],
    assumptions: []
  };
  assert.deepEqual(validateCooPlan(plan, { maxWorkstreams: 2, maxTasksPerWorkstream: 2, maxTasksPerRun: 3 }, ["finance-investissements"]), []);
});

test("E9.2-D7 rejects invalid department, duplicate workstream/task, priorities, deadlines and limits", () => {
  const plan = {
    summary: "Plan",
    priority: 6,
    workstreams: [
      { departmentSlug: "not-eligible", missionTitle: "Bad", objective: "Too short", priority: 0, dueInHours: 0, tasks: [
        { title: "Task", description: "Short", priority: 6, dueInHours: 0 },
        { title: "Task", description: "Short", priority: 2, dueInHours: 10 }
      ] },
      { departmentSlug: "not-eligible", missionTitle: "Duplicate title", objective: "An objective long enough to pass the objective length check.", priority: 2, dueInHours: 10, tasks: [
        { title: "Another task", description: "A task description long enough for validation.", priority: 2, dueInHours: 10 }
      ] }
    ],
    decisionsRequired: ["x".repeat(1201)],
    assumptions: ["x".repeat(1201)]
  };
  const issues = validateCooPlan(plan, { maxWorkstreams: 3, maxTasksPerWorkstream: 2, maxTasksPerRun: 1 }, ["finance-investissements"]);
  const codes = new Set(issues.map(issue => issue.code));
  for (const code of ["summary_invalid","priority_invalid","department_not_eligible","department_duplicate","mission_title_invalid","objective_invalid","workstream_priority_invalid","workstream_deadline_invalid","task_title_invalid","task_description_invalid","task_priority_invalid","task_deadline_invalid","task_title_duplicate","total_task_limit","decisions_invalid","assumptions_invalid"]) assert.ok(codes.has(code), "Expected validation code " + code);
  const oversized = { ...plan, workstreams: [{ ...plan.workstreams[0], tasks: [{title:"Task One",description:"Description long enough.",priority:2,dueInHours:5},{title:"Task Two",description:"Description long enough.",priority:2,dueInHours:5},{title:"Task Three",description:"Description long enough.",priority:2,dueInHours:5}] }] };
  assert.ok(validateCooPlan(oversized, { maxWorkstreams: 2, maxTasksPerWorkstream: 2, maxTasksPerRun: 3 }, ["finance-investissements"]).some(issue => issue.code === "task_count_limit"));
  const tooManyStreams = { ...plan, workstreams: [...plan.workstreams, ...plan.workstreams, ...plan.workstreams] };
  assert.ok(validateCooPlan(tooManyStreams, { maxWorkstreams: 3, maxTasksPerWorkstream: 2, maxTasksPerRun: 5 }, ["finance-investissements"]).some(issue => issue.code === "workstreams_limit"));
});

test("E9.2-D7 rejects task-level and mission-level malformed shapes instead of clamping them", () => {
  const plan = {
    summary: "Plan de contrôle valide",
    priority: 2,
    workstreams: [{
      departmentSlug: "finance-investissements",
      missionTitle: "Diagnostic financier",
      objective: "Analyser et documenter des éléments financiers vérifiables.",
      priority: 2,
      dueInHours: 24,
      tasks: [{ title: "Collecter données", description: "Collecter et tracer les données de référence.", priority: 2, dueInHours: 24 }]
    }],
    decisionsRequired: [],
    assumptions: []
  };
  plan.workstreams[0].tasks[0].dueInHours = 721;
  plan.workstreams[0].tasks[0].priority = 0;
  const codes = new Set(validateCooPlan(plan, { maxWorkstreams: 2, maxTasksPerWorkstream: 2, maxTasksPerRun: 2 }, ["finance-investissements"]).map(issue => issue.code));
  assert.ok(codes.has("task_deadline_invalid"));
  assert.ok(codes.has("task_priority_invalid"));
});
