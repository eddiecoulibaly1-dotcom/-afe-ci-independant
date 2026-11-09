import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "./auth.js";
import { callModel } from "./providers.js";
import {
  escalationLevel, isEscalationIncrease, validateProposedRelation,
  type DependencyKind, type DependencyRelation, type EscalationLevel
} from "./coo-dependency-logic.js";

type Role = "owner" | "admin" | "editor" | "viewer";
const rank: Record<Role, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };
const enc = (v: string) => encodeURIComponent(v);
const nowIso = () => new Date().toISOString();
const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Persistance Supabase non configurée.");
  return { url, key };
}
async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = config();
  const response = await fetch(c.url + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
  const raw = await response.text();
  if (!response.ok) throw Object.assign(new Error("Supabase " + response.status + ": " + raw.slice(0, 500)), { status: response.status });
  return raw ? JSON.parse(raw) as T : undefined as T;
}
async function readBody(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 150000) throw fail("Requête trop volumineuse.", 413);
  }
  try { return JSON.parse(raw || "{}"); }
  catch { throw fail("JSON invalide.", 400); }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
}
async function getWorkspace(workspaceId: string) {
  const rows = await db<any[]>("debate_workspaces?id=eq." + enc(workspaceId) + "&limit=1");
  if (!rows[0]) throw fail("Espace de travail introuvable.", 404);
  return rows[0];
}
async function getRole(workspaceId: string, user: AuthUser): Promise<{ role: Role; workspace: any }> {
  const workspace = await getWorkspace(workspaceId);
  if (workspace.owner_id === user.id) return { role: "owner", workspace };
  const rows = await db<any[]>("debate_workspace_members?workspace_id=eq." + enc(workspaceId) + "&user_id=eq." + enc(user.id) + "&limit=1");
  const role = rows[0]?.role as Role | undefined;
  if (!role || !Object.prototype.hasOwnProperty.call(rank, role)) throw fail("Accès refusé à cet espace.", 403);
  return { role, workspace };
}
async function requireRole(workspaceId: string, user: AuthUser, minimum: Role) {
  const access = await getRole(workspaceId, user);
  if (rank[access.role] < rank[minimum]) throw fail("Droit insuffisant pour cette opération.", 403);
  return access;
}
async function notifyUser(userId: string, type: string, title: string, message: string, workspaceId: string) {
  await db("notifications", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, type, title, message, link_type: "workspace", link_id: workspaceId })
  });
}

async function recordEvent(workspaceId: string, actorId: string | null, eventType: string, details: Record<string, unknown>, edgeId: string | null = null, deliverableId: string | null = null) {
  await db("afe_coo_dependency_events", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, actor_id: actorId, event_type: eventType, details, edge_id: edgeId, deliverable_id: deliverableId })
  });
}

const analysisSchema = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" },
    dependencies: {
      type: "array", maxItems: 100,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          dependentKind: { type: "string", enum: ["task", "mission"] },
          dependentId: { type: "string" },
          prerequisiteKind: { type: "string", enum: ["task", "mission", "department"] },
          prerequisiteId: { type: "string" },
          relationType: { type: "string", enum: ["hard_prerequisite", "input_reference", "parallel"] },
          rationale: { type: "string" },
          expectedDeliverable: { type: "string" },
          acceptanceCriteria: { type: "array", items: { type: "string" }, maxItems: 8 },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["dependentKind","dependentId","prerequisiteKind","prerequisiteId","relationType","rationale","expectedDeliverable","acceptanceCriteria","confidence"]
      }
    }
  },
  required: ["summary","dependencies"]
};

async function analyzeDependencies(workspaceId: string, user: AuthUser, input: any) {
  const [settings, tasks, missions, departments, agents, existing] = await Promise.all([
    db<any[]>("afe_coo_settings?workspace_id=eq." + enc(workspaceId) + "&limit=1"),
    db<any[]>("afe_operational_tasks?workspace_id=eq." + enc(workspaceId) + "&status=not.in.(done,cancelled)&order=priority.asc,due_at.asc&limit=500"),
    db<any[]>("afe_agent_missions?workspace_id=eq." + enc(workspaceId) + "&status=not.in.(completed,failed,cancelled)&order=priority.asc,due_at.asc&limit=300"),
    db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&active=eq.true&order=name.asc"),
    db<any[]>("afe_agents?workspace_id=eq." + enc(workspaceId) + "&select=id,slug,name,status,model_provider,model_id,mandate,system_instructions,department_id"),
    db<any[]>("afe_coo_dependency_edges?workspace_id=eq." + enc(workspaceId) + "&select=dependent_kind,dependent_task_id,dependent_mission_id,prerequisite_kind,prerequisite_task_id,prerequisite_mission_id,prerequisite_department_id,status,relation_type&limit=2000")
  ]);
  if (settings[0]?.coo_enabled !== true || settings[0]?.coo_kill_switch === true) throw fail("Analyseur COO désactivé ou verrouillé par le kill switch.", 423);
  const requestedIds = Array.isArray(input.taskIds) ? input.taskIds.map((x: unknown) => clean(x, 64)).filter(Boolean).slice(0, 100) : [];
  const taskSet = requestedIds.length ? tasks.filter(t => requestedIds.includes(t.id)) : tasks;
  if (requestedIds.length && taskSet.length !== requestedIds.length) throw fail("Une ou plusieurs tâches sélectionnées sont introuvables dans cet espace.", 404);
  if (!taskSet.length && !missions.length) return { summary: "Aucune tâche ou mission ouverte à analyser.", proposed: [], skipped: 0 };

  const configuredAgentId = settings[0]?.coo_agent_id;
  const coo = agents.find(a => a.id === configuredAgentId && a.status === "active")
    ?? agents.find(a => a.slug === "afe-ci-coo" && a.status === "active");
  if (!coo) throw fail("Le COO IA doit être désigné et actif avant l'analyse automatique des dépendances.", 409);

  const missionById = new Map(missions.map(m => [m.id, m]));
  const deptById = new Map(departments.map(d => [d.id, d]));
  const payload = {
    tasks: taskSet.map(t => ({
      id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority,
      dueAt: t.due_at, missionId: t.mission_id, missionTitle: missionById.get(t.mission_id)?.title ?? null,
      departmentId: t.department_id, department: deptById.get(t.department_id)?.name ?? null
    })),
    missions: missions.map(m => ({
      id: m.id, title: m.title, objective: m.objective, status: m.status, priority: m.priority,
      dueAt: m.due_at, departmentId: m.department_id, department: deptById.get(m.department_id)?.name ?? null
    })),
    departments: departments.map(d => ({ id: d.id, slug: d.slug, name: d.name, mandate: d.mandate, independent: d.is_independent, humanOnly: d.human_only })),
    existingRelations: existing.filter(e => e.status !== "rejected")
  };
  const result = await callModel<{ summary: string; dependencies: Array<any> }>({
    provider: coo.model_provider === "gemini" ? "gemini" : "openai",
    model: coo.model_id || (coo.model_provider === "gemini" ? (process.env.GEMINI_MODEL || "gemini-3.8-flash") : (process.env.OPENAI_MODEL || "gpt-4.1-mini")),
    schemaName: "coo_dependency_analysis",
    schema: analysisSchema,
    system: [
      coo.mandate || "Tu es le COO IA d'AFE-CI.",
      coo.system_instructions || "",
      "Tu analyses les dépendances opérationnelles. Tu ne modifies aucune donnée métier et tu ne valides aucune dépendance.",
      "Ne propose une dépendance dure que si un livrable amont identifié est indispensable à l'exécution ou à l'acceptation du travail aval.",
      "Une dépendance dure doit relier une tâche ou mission consommatrice à une tâche ou mission productrice. La production d'un livrable accepté est le critère de déblocage.",
      "Une direction seule ne peut pas être un prérequis dur. Utilise une direction uniquement comme référence contextuelle, sans blocage.",
      "Ne déduis jamais une dépendance de la seule similarité des titres ou d'un ordre chronologique. Si deux travaux peuvent avancer en parallèle, propose parallel ou ne propose rien.",
      "Ne propose jamais un prérequis dur entre deux tâches de la même mission : le worker exécute actuellement une mission comme une unité. Dans ce cas, utilise input_reference si le lien est utile, ou omets la relation.",
      "N'invente aucun identifiant : utilise uniquement les identifiants exacts fournis. N'inclus pas les directions indépendantes ou les autorités humaines comme directions exécutantes.",
      "Évite les cycles et les dépendances redondantes. Chaque proposition doit expliquer le livrable attendu et des critères d'acceptation vérifiables.",
      "Toutes les propositions seront soumises à la Direction générale et resteront inactives jusqu'à son approbation."
    ].filter(Boolean).join("\n\n"),
    prompt: "Analyse les missions et tâches suivantes et propose les relations strictement nécessaires. Réponds en français. Les relations existantes sont déjà fournies et ne doivent pas être dupliquées.\n\n" + JSON.stringify(payload)
  });

  const taskById = new Map(taskSet.map(t => [t.id, t]));
  const missionMap = new Map(missions.map(m => [m.id, m]));
  const deptMap = new Map(departments.map(d => [d.id, d]));
  const analyzedTaskIds = taskSet.filter(t => {
    const parent = t.mission_id ? missionMap.get(t.mission_id) : null;
    return parent?.status !== "running";
  }).map(t => t.id);
  const existingKeys = new Set(existing.filter(e => e.status !== "rejected").map(e =>
    [e.dependent_kind, e.dependent_task_id ?? e.dependent_mission_id, e.prerequisite_kind, e.prerequisite_task_id ?? e.prerequisite_mission_id ?? e.prerequisite_department_id, e.relation_type].join(":")
  ));
  const proposed: any[] = [];
  let skipped = 0;
  for (const item of result.dependencies ?? []) {
    const dependentKind = item.dependentKind as "task" | "mission";
    const prerequisiteKind = item.prerequisiteKind as DependencyKind;
    const relationType = item.relationType as DependencyRelation;
    const dependentId = clean(item.dependentId, 64);
    const prerequisiteId = clean(item.prerequisiteId, 64);
    try { validateProposedRelation(dependentKind, dependentId, prerequisiteKind, prerequisiteId, relationType); }
    catch { skipped++; continue; }

    const dependent = dependentKind === "task" ? taskById.get(dependentId) : missionMap.get(dependentId);
    const prerequisite = prerequisiteKind === "task" ? taskById.get(prerequisiteId)
      : prerequisiteKind === "mission" ? missionMap.get(prerequisiteId) : deptMap.get(prerequisiteId);
    if (!dependent || !prerequisite) { skipped++; continue; }
    const dependentMission = dependentKind === "task" ? missionMap.get((dependent as any).mission_id) : dependent;
    if (dependentMission?.status === "running") { skipped++; continue; }
    if (dependentKind === "task" && (dependent as any).status === "blocked" && !String((dependent as any).blocked_reason || "").startsWith("COO_DEPENDENCY_BLOCKED:")) { skipped++; continue; }
    if (prerequisiteKind === "department" && (prerequisite as any).is_independent && relationType !== "human_gate") { skipped++; continue; }
    if (prerequisiteKind === "department" && (prerequisite as any).human_only && relationType !== "human_gate") { skipped++; continue; }
    if (dependentKind === "task" && prerequisiteKind === "task" && relationType === "hard_prerequisite" && (dependent as any).mission_id && (dependent as any).mission_id === (prerequisite as any).mission_id) { skipped++; continue; }
    const key = [dependentKind, dependentId, prerequisiteKind, prerequisiteId, relationType].join(":");
    if (existingKeys.has(key)) { skipped++; continue; }
    if (typeof item.rationale !== "string" || item.rationale.trim().length < 12 ||
        typeof item.expectedDeliverable !== "string" || item.expectedDeliverable.trim().length < 3) { skipped++; continue; }

    const row: Record<string, unknown> = {
      workspace_id: workspaceId, dependent_kind: dependentKind,
      dependent_task_id: dependentKind === "task" ? dependentId : null,
      dependent_mission_id: dependentKind === "mission" ? dependentId : null,
      prerequisite_kind: prerequisiteKind,
      prerequisite_task_id: prerequisiteKind === "task" ? prerequisiteId : null,
      prerequisite_mission_id: prerequisiteKind === "mission" ? prerequisiteId : null,
      prerequisite_department_id: prerequisiteKind === "department" ? prerequisiteId : null,
      relation_type: relationType, status: "pending_dg",
      rationale: clean(item.rationale, 4000), expected_deliverable: clean(item.expectedDeliverable, 1000),
      acceptance_criteria: (Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria : []).slice(0, 8).map((criterion: unknown) => ({ criterion: clean(criterion, 500), required: true })),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
      proposal_source: "coo_ai", proposed_by: user.id, proposed_at: nowIso(), updated_at: nowIso()
    };
    try {
      const inserted = await db<any[]>("afe_coo_dependency_edges", {
        method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row)
      });
      if (inserted[0]) {
        proposed.push(inserted[0]);
        existingKeys.add(key);
        // The database AFTER INSERT trigger writes the proposal audit event atomically.
      }
    } catch (error) {
      if ((error as any)?.status === 409) { skipped++; continue; }
      throw error;
    }
  }
  if (proposed.length) {
    const dg = settings[0]?.dg_user_id || (await getWorkspace(workspaceId)).owner_id;
    if (dg) await notifyUser(dg, "coo.dependency.proposed", "Nouvelles dépendances à arbitrer", proposed.length + " proposition(s) du COO attend(ent) votre décision.", workspaceId).catch(() => undefined);
  }
  if (analyzedTaskIds.length) {
    const filter = analyzedTaskIds.map(encodeURIComponent).join(",");
    await db("afe_operational_tasks?id=in.(" + filter + ")&workspace_id=eq." + enc(workspaceId), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ dependency_analysis_status: "analyzed", dependency_analysis_at: nowIso(), dependency_analysis_error: null, updated_at: nowIso() })
    });
  }
  return { summary: clean(result.summary, 3000), proposed, skipped, analyzedTasks: analyzedTaskIds.length, analyzedTaskIds, analyzedMissions: missions.length, requiresDgApproval: true };
}

async function listDependencies(workspaceId: string) {
  const [edges, deliverables, escalations, policyRows, tasks, missions, departments] = await Promise.all([
    db<any[]>("afe_coo_dependency_edges?workspace_id=eq." + enc(workspaceId) + "&order=proposed_at.desc&limit=1500"),
    db<any[]>("afe_coo_deliverables?workspace_id=eq." + enc(workspaceId) + "&order=submitted_at.desc&limit=1000"),
    db<any[]>("afe_coo_escalations?workspace_id=eq." + enc(workspaceId) + "&order=updated_at.desc&limit=500"),
    db<any[]>("afe_coo_escalation_policies?workspace_id=eq." + enc(workspaceId) + "&limit=1"),
    db<any[]>("afe_operational_tasks?workspace_id=eq." + enc(workspaceId) + "&select=id,title,status,mission_id,department_id,blocked_reason,due_at,priority,progress_percent,dependency_analysis_status,dependency_analysis_at&limit=1000"),
    db<any[]>("afe_agent_missions?workspace_id=eq." + enc(workspaceId) + "&select=id,title,status,department_id,agent_id,blocked_reason,due_at,priority&limit=500"),
    db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&select=id,name,slug,is_independent,human_only,director_user_id&limit=100")
  ]);
  const taskMap = new Map(tasks.map(x => [x.id, x]));
  const missionMap = new Map(missions.map(x => [x.id, x]));
  const departmentMap = new Map(departments.map(x => [x.id, x]));
  const node = (kind: string, id: string | null) => {
    if (!id) return null;
    if (kind === "task") return taskMap.get(id) ?? null;
    if (kind === "mission") return missionMap.get(id) ?? null;
    return departmentMap.get(id) ?? null;
  };
  const enriched = edges.map(edge => {
    const dependentId = edge.dependent_task_id ?? edge.dependent_mission_id;
    const prerequisiteId = edge.prerequisite_task_id ?? edge.prerequisite_mission_id ?? edge.prerequisite_department_id;
    const dependent = node(edge.dependent_kind, dependentId);
    const prerequisite = node(edge.prerequisite_kind, prerequisiteId);
    const dependentDepartmentId = edge.dependent_kind === "task"
      ? (dependent as any)?.department_id : (dependent as any)?.department_id;
    const prerequisiteDepartmentId = edge.prerequisite_kind === "task" || edge.prerequisite_kind === "mission"
      ? (prerequisite as any)?.department_id : prerequisiteId;
    return {
      ...edge,
      dependent_title: (dependent as any)?.title ?? "Élément dépendant introuvable",
      dependent_status: (dependent as any)?.status ?? "missing",
      dependent_department: departmentMap.get(dependentDepartmentId)?.name ?? "Direction non renseignée",
      prerequisite_title: (prerequisite as any)?.title ?? (prerequisite as any)?.name ?? "Prérequis introuvable",
      prerequisite_status: (prerequisite as any)?.status ?? "reference",
      prerequisite_department: departmentMap.get(prerequisiteDepartmentId)?.name ?? "Direction non renseignée",
      cross_department: Boolean(dependentDepartmentId && prerequisiteDepartmentId && dependentDepartmentId !== prerequisiteDepartmentId)
    };
  });
  const graphEdges = edges.filter(x => x.status === "active" && x.relation_type === "hard_prerequisite");
  const graphNodes = new Map<string, any>();
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const levelByNode = new Map<string, number>();
  const nodeFor = (kind: string, id: string) => {
    const key = kind + ":" + id;
    if (!graphNodes.has(key)) {
      const value = node(kind, id);
      const departmentId = kind === "department" ? id : (value as any)?.department_id;
      graphNodes.set(key, {
        key, kind, id, title: (value as any)?.title ?? (value as any)?.name ?? "Élément introuvable",
        status: (value as any)?.status ?? "reference", priority: Number((value as any)?.priority ?? 3),
        department: departmentMap.get(departmentId)?.name ?? "Direction non renseignée",
        departmentId, blockedReason: (value as any)?.blocked_reason ?? null
      });
      indegree.set(key, 0);
      adjacency.set(key, []);
    }
    return key;
  };
  for (const edge of graphEdges) {
    const dependentId = edge.dependent_task_id ?? edge.dependent_mission_id;
    const prerequisiteId = edge.prerequisite_task_id ?? edge.prerequisite_mission_id;
    if (!dependentId || !prerequisiteId) continue;
    const dependentKey = nodeFor(edge.dependent_kind, dependentId);
    const prerequisiteKey = nodeFor(edge.prerequisite_kind, prerequisiteId);
    adjacency.get(prerequisiteKey)!.push(dependentKey);
    indegree.set(dependentKey, (indegree.get(dependentKey) ?? 0) + 1);
  }
  const ready = [...graphNodes.keys()].filter(key => (indegree.get(key) ?? 0) === 0);
  const ordered: any[] = [];
  while (ready.length) {
    ready.sort((a,b) => graphNodes.get(a).priority - graphNodes.get(b).priority || graphNodes.get(a).title.localeCompare(graphNodes.get(b).title, "fr"));
    const key = ready.shift()!;
    const current = graphNodes.get(key);
    current.stage = levelByNode.get(key) ?? 0;
    ordered.push(current);
    for (const next of adjacency.get(key) ?? []) {
      levelByNode.set(next, Math.max(levelByNode.get(next) ?? 0, current.stage + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  const executionStages = [...new Set(ordered.map(x => x.stage))].sort((a,b) => a-b).map(stage => {
    const items = ordered.filter(x => x.stage === stage);
    return { stage: Number(stage) + 1, directions: [...new Set(items.map(x => x.department))], items };
  });
  const graphCycleDetected = ordered.length !== graphNodes.size;
  return {
    edges: enriched, deliverables, escalations, policy: policyRows[0] ?? null,
    departments, executionStages, graphCycleDetected,
    analysisQueue: tasks.filter(x => !["done","cancelled"].includes(x.status) &&
      (x.dependency_analysis_status === "pending" ||
       (x.dependency_analysis_status === "failed" && Date.parse(x.dependency_analysis_at || "1970-01-01") < Date.now() - 30 * 60 * 1000)))
      .filter(x => !x.mission_id || missionMap.get(x.mission_id)?.status !== "running")
      .map(x => x.id),
    summary: {
      proposalsPendingDg: edges.filter(x => x.status === "pending_dg").length,
      activeHardDependencies: edges.filter(x => x.status === "active" && x.relation_type === "hard_prerequisite").length,
      satisfiedDependencies: edges.filter(x => x.status === "satisfied").length,
      rejectedDependencies: edges.filter(x => x.status === "rejected").length,
      deliverablesAwaitingReview: deliverables.filter(x => x.status === "submitted").length,
      openEscalations: escalations.filter(x => x.status !== "resolved").length,
      crossDepartmentDependencies: enriched.filter(x => x.cross_department).length,
      pendingTaskAnalysis: tasks.filter(x => !["done","cancelled"].includes(x.status) && x.dependency_analysis_status === "pending").length,
      failedTaskAnalysis: tasks.filter(x => !["done","cancelled"].includes(x.status) && x.dependency_analysis_status === "failed").length
    }
  };
}

async function decideDependency(workspaceId: string, user: AuthUser, edgeId: string, input: any) {
  await requireRole(workspaceId, user, "owner");
  const decision = clean(input.decision, 16);
  const note = clean(input.note, 3000);
  if (!["approve","reject"].includes(decision)) throw fail("Décision DG invalide.");
  if (decision === "reject" && note.length < 8) throw fail("Un motif d'au moins 8 caractères est requis pour rejeter une dépendance.");
  const rows = await db<any[]>("afe_coo_dependency_edges?id=eq." + enc(edgeId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const edge = rows[0];
  if (!edge) throw fail("Proposition de dépendance introuvable.", 404);
  if (edge.status !== "pending_dg") throw fail("Cette proposition a déjà été examinée.", 409);
  if (decision === "approve") {
    let dependentMission: any = null;
    if (edge.dependent_kind === "mission") {
      dependentMission = (await db<any[]>("afe_agent_missions?id=eq." + enc(edge.dependent_mission_id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1"))[0];
    } else {
      const task = (await db<any[]>("afe_operational_tasks?id=eq." + enc(edge.dependent_task_id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1"))[0];
      if (!task) throw fail("Tâche dépendante introuvable.", 404);
      if (task.mission_id) dependentMission = (await db<any[]>("afe_agent_missions?id=eq." + enc(task.mission_id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1"))[0];
    }
    if (dependentMission?.status === "running") throw fail("La mission consommatrice doit être suspendue avant l'activation du prérequis.", 409);
  }
  const patch: Record<string, unknown> = {
    status: decision === "approve" ? "active" : "rejected",
    reviewed_by: user.id, reviewed_at: nowIso(), decision_note: note || (decision === "approve" ? "Approuvée par la Direction générale." : null),
    updated_at: nowIso()
  };
  if (decision === "approve") patch.activated_at = nowIso();
  const updated = await db<any[]>("afe_coo_dependency_edges?id=eq." + enc(edgeId) + "&workspace_id=eq." + enc(workspaceId), {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch)
  });
  return updated[0] ?? { ...edge, ...patch };
}

async function revokeDependency(workspaceId: string, user: AuthUser, edgeId: string, input: any) {
  await requireRole(workspaceId, user, "owner");
  const note = clean(input.note, 3000);
  if (note.length < 8) throw fail("Un motif d'au moins 8 caractères est requis pour révoquer une dépendance.");
  const rows = await db<any[]>("afe_coo_dependency_edges?id=eq." + enc(edgeId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const edge = rows[0];
  if (!edge) throw fail("Dépendance introuvable.", 404);
  if (edge.status !== "active") throw fail("Seule une dépendance active peut être révoquée.", 409);
  if (edge.relation_type === "hard_prerequisite") {
    throw fail("Une dépendance bloquante exige une procédure de levée de blocage dédiée.", 409);
  }
  const timestamp = nowIso();
  const patch = {
    status: "revoked",
    reviewed_by: user.id,
    reviewed_at: timestamp,
    decision_note: note,
    updated_at: timestamp
  };
  const updated = await db<any[]>("afe_coo_dependency_edges?id=eq." + enc(edgeId) + "&workspace_id=eq." + enc(workspaceId) + "&status=eq.active", {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch)
  });
  if (!updated[0]) throw fail("La dépendance a changé entre-temps. Actualisez la page avant de réessayer.", 409);
  // The database AFTER UPDATE trigger records this status transition atomically.
  return updated[0];
}

async function decideDeliverable(workspaceId: string, user: AuthUser, deliverableId: string, input: any) {
  await requireRole(workspaceId, user, "owner");
  const decision = clean(input.decision, 16), note = clean(input.note, 4000);
  if (!["accept","reject"].includes(decision)) throw fail("Décision de livrable invalide.");
  if (decision === "reject" && note.length < 8) throw fail("Un motif d'au moins 8 caractères est requis pour rejeter le livrable.");
  const rows = await db<any[]>("afe_coo_deliverables?id=eq." + enc(deliverableId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const deliverable = rows[0];
  if (!deliverable) throw fail("Livrable introuvable.", 404);
  if (deliverable.status !== "submitted") throw fail("Ce livrable n'attend pas de décision.", 409);
  const patch = decision === "accept"
    ? { status: "accepted", accepted_by: user.id, accepted_at: nowIso(), verification_notes: note || "Accepté par la Direction générale.", updated_at: nowIso() }
    : { status: "rejected", accepted_by: null, accepted_at: null, verification_notes: note, updated_at: nowIso() };
  const updated = await db<any[]>("afe_coo_deliverables?id=eq." + enc(deliverableId) + "&workspace_id=eq." + enc(workspaceId), {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch)
  });
  // The database AFTER UPDATE trigger records the DG decision in the same transaction.
  return updated[0] ?? { ...deliverable, ...patch };
}

async function updatePolicy(workspaceId: string, user: AuthUser, input: any) {
  await requireRole(workspaceId, user, "owner");
  const fields = ["warningAfterMinutes","directorAfterMinutes","dgAfterMinutes","criticalAfterMinutes","pendingReviewAfterMinutes"] as const;
  const defaults = [60,180,360,720,120];
  const values = fields.map((key, index) => input[key] === undefined ? defaults[index] : Number(input[key]));
  if (values.some(v => !Number.isInteger(v) || v < 5 || v > 86400) ||
      !(values[0] < values[1] && values[1] < values[2] && values[2] < values[3])) {
    throw fail("Seuils invalides : ils doivent être entiers, positifs et strictement croissants.");
  }
  const patch = {
    workspace_id: workspaceId, enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    warning_after_minutes: values[0], director_after_minutes: values[1], dg_after_minutes: values[2],
    critical_after_minutes: values[3], pending_review_after_minutes: values[4],
    updated_by: user.id, updated_at: nowIso()
  };
  const rows = await db<any[]>("afe_coo_escalation_policies?on_conflict=workspace_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(patch)
  });
  await recordEvent(workspaceId, user.id, "escalation_policy.updated", patch);
  return rows[0] ?? patch;
}

export async function handleCooDependencyRequest(req: IncomingMessage, res: ServerResponse, path: string, user: AuthUser): Promise<boolean> {
  const p = path.split("/").filter(Boolean);
  if (p.length < 6 || p[0] !== "team" || p[1] !== "api" || p[2] !== "workspaces" || p[4] !== "coo") return false;
  const workspaceId = p[3], resource = p[5], method = req.method ?? "GET";
  try {
    if (resource === "dependencies" && method === "GET" && p.length === 6) {
      await requireRole(workspaceId, user, "viewer");
      send(res, 200, await listDependencies(workspaceId)); return true;
    }
    if (resource === "dependency-proposals" && p[6] === "analyze" && method === "POST" && p.length === 7) {
      await requireRole(workspaceId, user, "editor");
      const input = await readBody(req);
      send(res, 200, await analyzeDependencies(workspaceId, user, input)); return true;
    }
    if (resource === "dependencies" && p[6] && p[7] === "decision" && method === "POST" && p.length === 8) {
      const input = await readBody(req);
      send(res, 200, { edge: await decideDependency(workspaceId, user, p[6], input) }); return true;
    }
    if (resource === "dependencies" && p[6] && p[7] === "revoke" && method === "POST" && p.length === 8) {
      const input = await readBody(req);
      send(res, 200, { edge: await revokeDependency(workspaceId, user, p[6], input) }); return true;
    }
    if (resource === "deliverables" && p[6] && p[7] === "decision" && method === "POST" && p.length === 8) {
      const input = await readBody(req);
      send(res, 200, { deliverable: await decideDeliverable(workspaceId, user, p[6], input) }); return true;
    }
    if (resource === "escalation-policy" && method === "PATCH" && p.length === 6) {
      const input = await readBody(req);
      send(res, 200, { policy: await updatePolicy(workspaceId, user, input) }); return true;
    }
    return false;
  } catch (error) {
    send(res, Number((error as any)?.status) || 500, { error: error instanceof Error ? error.message : "Erreur du moteur de dépendances COO." });
    return true;
  }
}

async function upsertEscalationAlert(workspaceId: string, edge: any, level: EscalationLevel, responsibleDepartment: string, elapsed: number) {
  const key = "dependency-escalation:" + edge.id + ":" + level;
  const existing = await db<any[]>("afe_coo_alerts?workspace_id=eq." + enc(workspaceId) + "&dedupe_key=eq." + enc(key) + "&limit=1");
  if (existing[0]) return false;
  const title = level === "critical" ? "Blocage critique de dépendance"
    : level === "dg" ? "Arbitrage DG requis sur une dépendance"
    : level === "director" ? "Retard de livrable à la direction responsable"
    : "Retard sur un prérequis opérationnel";
  const severity = level === "critical" || level === "dg" ? "critical" : "warning";
  const dependentId = edge.dependent_task_id ?? edge.dependent_mission_id;
  const prerequisiteId = edge.prerequisite_task_id ?? edge.prerequisite_mission_id ?? edge.prerequisite_department_id;
  await db("afe_coo_alerts", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      workspace_id: workspaceId, dedupe_key: key, alert_type: "dependency_escalation",
      severity, status: "open", title,
      description: "Dépendance " + edge.id + " bloquée depuis " + elapsed + " minute(s). Direction productrice responsable : " + responsibleDepartment + ". Niveau d'escalade : " + level + ". Prérequis : " + prerequisiteId + ". Élément en attente : " + dependentId + ".",
      mission_id: edge.dependent_mission_id ?? null, task_id: edge.dependent_task_id ?? null
    })
  });
  return true;
}

export async function handleCooDependencyWorker(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path !== "/internal/coo-dependency-worker") return false;
  if (!["GET","POST"].includes(req.method ?? "GET")) { res.writeHead(405, { Allow: "GET, POST" }); res.end(); return true; }
  const expected = process.env.COO_DEPENDENCY_WORKER_SECRET ?? process.env.CRON_SECRET ?? "";
  const auth = req.headers.authorization ?? "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const valid = !!expected && !!supplied && Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid) { send(res, 401, { error: "Unauthorized" }); return true; }
  try {
    const policies = await db<any[]>("afe_coo_escalation_policies?enabled=eq.true");
    let escalated = 0, resolved = 0, checked = 0;
    for (const policy of policies) {
      const workspaceId = policy.workspace_id;
      const [edges, settings, workspace, existing] = await Promise.all([
        db<any[]>("afe_coo_dependency_edges?workspace_id=eq." + enc(workspaceId) + "&status=in.(pending_dg,active)&order=proposed_at.asc&limit=1500"),
        db<any[]>("afe_coo_settings?workspace_id=eq." + enc(workspaceId) + "&limit=1"),
        getWorkspace(workspaceId),
        db<any[]>("afe_coo_escalations?workspace_id=eq." + enc(workspaceId) + "&status=neq.resolved&limit=1000")
      ]);
      const tasks = await db<any[]>("afe_operational_tasks?workspace_id=eq." + enc(workspaceId) + "&select=id,title,status,department_id,mission_id,blocked_reason,dependency_analysis_status&limit=1000");
      const missions = await db<any[]>("afe_agent_missions?workspace_id=eq." + enc(workspaceId) + "&select=id,title,status,department_id,agent_id&limit=500");
      const departments = await db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&select=id,name,director_user_id&limit=100");
      const taskMap = new Map(tasks.map(x => [x.id, x]));
      const missionMap = new Map(missions.map(x => [x.id, x]));
      const deptMap = new Map(departments.map(x => [x.id, x]));
      const priorMap = new Map(existing.map(x => [x.edge_id, x]));
      const settingsRow = settings[0] ?? {};
      const dgUserId = settingsRow.dg_user_id || workspace.owner_id || null;
      const missionStatus = new Map(missions.map(x => [x.id, x.status]));
      const autoAnalysisTasks = settingsRow.coo_enabled === true && settingsRow.coo_kill_switch !== true ? tasks.filter(t =>
        (t.dependency_analysis_status === "pending" ||
          (t.dependency_analysis_status === "failed" && Date.parse(t.dependency_analysis_at || "1970-01-01") < Date.now() - 30 * 60 * 1000)) &&
        !["done","cancelled"].includes(t.status) &&
        (!t.mission_id || missionStatus.get(t.mission_id) !== "running")
      ).slice(0, 5) : [];
      if (autoAnalysisTasks.length && workspace.owner_id) {
        try {
          await analyzeDependencies(workspaceId, { id: workspace.owner_id } as AuthUser, { taskIds: autoAnalysisTasks.map(t => t.id) });
        } catch (analysisError) {
          const ids = autoAnalysisTasks.map(t => encodeURIComponent(t.id)).join(",");
          await db("afe_operational_tasks?id=in.(" + ids + ")&workspace_id=eq." + enc(workspaceId), {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ dependency_analysis_status: "failed", dependency_analysis_at: nowIso(), dependency_analysis_error: (analysisError instanceof Error ? analysisError.message : String(analysisError)).slice(0, 2000), updated_at: nowIso() })
          });
          await recordEvent(workspaceId, null, "dependency.analysis.failed", {
            taskIds: autoAnalysisTasks.map(t => t.id),
            error: (analysisError instanceof Error ? analysisError.message : String(analysisError)).slice(0, 1000)
          });
        }
      }
      const now = Date.now();
      for (const edge of edges) {
        checked++;
        const pending = edge.status === "pending_dg";
        const start = Date.parse(pending ? edge.proposed_at : (edge.activated_at || edge.updated_at || edge.created_at));
        const elapsed = Math.max(0, Math.floor((now - (Number.isFinite(start) ? start : now)) / 60000));
        const level = escalationLevel(elapsed, policy, pending);
        if (level === "none") continue;
        const prerequisite = edge.prerequisite_kind === "task" ? taskMap.get(edge.prerequisite_task_id)
          : edge.prerequisite_kind === "mission" ? missionMap.get(edge.prerequisite_mission_id)
          : deptMap.get(edge.prerequisite_department_id);
        if (!pending && edge.relation_type !== "hard_prerequisite") continue;
        let previous = priorMap.get(edge.id);
        if (!pending && previous && edge.activated_at && Date.parse(edge.activated_at) > Date.parse(previous.blocked_since)) {
          await db("afe_coo_escalations?id=eq." + enc(previous.id) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "resolved", updated_at: nowIso() }) });
          previous = null;
        }
        const responsibleDepartmentId = pending ? null : edge.prerequisite_kind === "department"
          ? edge.prerequisite_department_id : (prerequisite as any)?.department_id ?? null;
        const department = deptMap.get(responsibleDepartmentId);
        const responsibleName = pending ? "Direction générale (revue en attente)" : department?.name ?? "Direction productrice non identifiée";
        const responsibleOwner = pending ? null : department?.director_user_id ?? null;
        const threshold = pending ? policy.pending_review_after_minutes
          : level === "critical" ? policy.critical_after_minutes
          : level === "dg" ? policy.dg_after_minutes
          : level === "director" ? policy.director_after_minutes : policy.warning_after_minutes;
        const escalationRow = {
          workspace_id: workspaceId, edge_id: edge.id, responsible_department_id: responsibleDepartmentId,
          responsible_owner_user_id: responsibleOwner, dg_user_id: dgUserId, escalation_level: level,
          status: "open", blocked_since: new Date(now - elapsed * 60000).toISOString(),
          elapsed_minutes: elapsed, threshold_minutes: threshold,
          reason: pending
            ? "La Direction générale n'a pas encore statué sur la proposition de dépendance."
            : "Le livrable prérequis n'a pas été remis et accepté dans le délai attendu."
        };
        await db("afe_coo_escalations?on_conflict=workspace_id%2Cedge_id", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(escalationRow)
        });
        if (isEscalationIncrease(previous?.escalation_level ?? null, level)) {
          await upsertEscalationAlert(workspaceId, edge, level, responsibleName, elapsed);
          await recordEvent(workspaceId, null, "dependency.escalated", {
            edgeId: edge.id, level, elapsedMinutes: elapsed, responsibleDepartmentId,
            responsibleDepartment: responsibleName, responsibleOwnerUserId: responsibleOwner, dgUserId
          }, edge.id);
          if (level === "director" && responsibleOwner) await notifyUser(responsibleOwner, "coo.dependency.director_escalation", "Livrable en retard dans votre direction", responsibleName + " : un prérequis est en retard depuis " + elapsed + " minutes.", workspaceId).catch(() => undefined);
          if ((level === "dg" || level === "critical") && dgUserId) await notifyUser(dgUserId, "coo.dependency.dg_escalation", level === "critical" ? "Blocage critique à arbitrer" : "Arbitrage DG requis", "Une dépendance opérationnelle exige votre intervention. Direction productrice : " + responsibleName + ". Retard : " + elapsed + " minutes.", workspaceId).catch(() => undefined);
          escalated++;
        }
      }
      const openEdgeIds = new Set(edges.map(x => x.id));
      for (const escalation of existing) {
        if (!openEdgeIds.has(escalation.edge_id)) {
          await db("afe_coo_escalations?id=eq." + enc(escalation.id) + "&workspace_id=eq." + enc(workspaceId), {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ status: "resolved", updated_at: nowIso() })
          });
          resolved++;
        }
      }
    }
    send(res, 200, { ok: true, checked, escalated, resolved });
    return true;
  } catch (error) {
    send(res, 503, { error: error instanceof Error ? error.message : "COO dependency worker unavailable" });
    return true;
  }
}
