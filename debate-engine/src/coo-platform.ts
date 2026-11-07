import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "./auth.js";

type Role = "owner" | "admin" | "editor" | "viewer";
const rank: Record<Role, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };
const enc = (v: string) => encodeURIComponent(v);
const nowIso = () => new Date().toISOString();
const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const textOk = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Persistance Supabase non configurée.");
  return { url, key };
}
async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = config();
  const r = await fetch(c.url + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json", ...(init.headers ?? {}) }
  });
  const raw = await r.text();
  if (!r.ok) throw Object.assign(new Error("Supabase " + r.status + ": " + raw.slice(0, 350)), { status: r.status });
  return raw ? JSON.parse(raw) as T : undefined as T;
}
async function readBody(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 250000) throw Object.assign(new Error("Requête trop volumineuse."), { status: 413 });
  }
  try { return JSON.parse(raw || "{}"); }
  catch { throw Object.assign(new Error("JSON invalide."), { status: 400 }); }
}
function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
}
function fail(message: string, status = 400) { return Object.assign(new Error(message), { status }); }

const DEPARTMENTS = [
  { slug: "direction-generale", name: "Direction générale", kind: "executive", reportsTo: null, independent: false, humanOnly: false, mandate: "Définit la stratégie, les priorités, les délégations, les arbitrages de ressources et les décisions de gouvernance. Reçoit les rapports du COO et conserve l'autorité de validation humaine." },
  { slug: "direction-operations", name: "Direction des Opérations (COO)", kind: "operational", reportsTo: "direction-generale", independent: false, humanOnly: false, mandate: "Pilote le portefeuille des missions, les directions opérationnelles, les capacités, les tâches, les délais, les alertes et le reporting. Ne modifie jamais les conclusions techniques et ne dirige pas l'arbitrage indépendant." },
  { slug: "strategie-developpement", name: "Stratégie & Développement", kind: "operational", reportsTo: "direction-generale", independent: false, humanOnly: false, mandate: "Prépare les orientations, plans de développement, analyses stratégiques et objectifs transversaux soumis à la Direction générale." },
  { slug: "finance-investissements", name: "Finance & Investissements", kind: "control", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Analyse les budgets, coûts, investissements, hypothèses financières et risques économiques. Toute décision financière engageante demeure soumise à validation humaine." },
  { slug: "risques-controle", name: "Risques & Contrôle", kind: "control", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Identifie, évalue et suit les risques, contrôle les dispositifs de maîtrise et formule des constats étayés par des preuves." },
  { slug: "gouvernance-conformite", name: "Gouvernance & Conformité", kind: "control", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Contrôle la conformité, les règles de gouvernance, les conflits d'intérêts et la qualité des raisonnements. Conserve son indépendance de jugement technique." },
  { slug: "evidence-intelligence", name: "Evidence Intelligence", kind: "support", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Collecte les sources autorisées, vérifie la provenance, conserve les empreintes et qualifie la relation entre preuves et constats." },
  { slug: "secretariat-general", name: "Secrétariat général des missions", kind: "operational", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Enregistre les mandats, prépare les dossiers, suit les jalons, les affectations, les échéances et la complétude documentaire." },
  { slug: "operations-missions", name: "Opérations de mission", kind: "operational", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Coordonne l'exécution quotidienne des missions autorisées, les tâches, les dépendances et les plans de rattrapage." },
  { slug: "audit-qualite", name: "Audit qualité", kind: "control", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Vérifie la qualité des livrables, la traçabilité, la complétude des contrôles et la conformité aux procédures." },
  { slug: "documentation-reporting", name: "Documentation & Reporting", kind: "support", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Produit les dossiers, rapports, synthèses, exports et archives institutionnelles." },
  { slug: "infrastructure-securite", name: "Infrastructure & Sécurité", kind: "support", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Assure la disponibilité, la sécurité, les habilitations, la journalisation et la protection des environnements." },
  { slug: "arbitrage-independant", name: "Arbitrage indépendant", kind: "independent", reportsTo: null, independent: true, humanOnly: false, mandate: "Statue de manière indépendante sur les constats après contradiction complète. N'est pas placé sous l'autorité opérationnelle du COO." },
  { slug: "validation-humaine", name: "Autorité de validation humaine", kind: "human_authority", reportsTo: null, independent: true, humanOnly: true, mandate: "Approuve, rejette, approuve avec réserves ou demande une reprise. Cette fonction ne peut jamais être simulée par un agent IA." }
] as const;

type WorkspaceAccess = { workspace: any; role: Role };
async function access(workspaceId: string, userId: string): Promise<WorkspaceAccess | null> {
  const ws = await db<any[]>("debate_workspaces?id=eq." + enc(workspaceId) + "&limit=1");
  if (!ws[0]) return null;
  if (ws[0].owner_id === userId) return { workspace: ws[0], role: "owner" };
  const members = await db<any[]>("debate_workspace_members?workspace_id=eq." + enc(workspaceId) + "&user_id=eq." + enc(userId) + "&limit=1");
  const role = members[0]?.role as Role | undefined;
  return role && Object.prototype.hasOwnProperty.call(rank, role) ? { workspace: ws[0], role } : null;
}
async function requireAccess(workspaceId: string, user: AuthUser, min: Role = "viewer") {
  const a = await access(workspaceId, user.id);
  if (!a || rank[a.role] < rank[min]) throw fail("Accès refusé à cet espace.", 403);
  return a;
}
async function settings(workspaceId: string, ownerId?: string) {
  const found = await db<any[]>("afe_coo_settings?workspace_id=eq." + enc(workspaceId) + "&limit=1");
  if (found[0]) return found[0];
  const rows = await db<any[]>("afe_coo_settings?on_conflict=workspace_id", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ workspace_id: workspaceId, dg_user_id: ownerId ?? null, daily_report_enabled: true, report_hour_utc: 8 })
  });
  if (rows[0]) return rows[0];
  const retry = await db<any[]>("afe_coo_settings?workspace_id=eq." + enc(workspaceId) + "&limit=1");
  if (!retry[0]) throw new Error("Impossible d'initialiser les paramètres COO.");
  return retry[0];
}
async function ensureDepartments(workspaceId: string, actorId?: string) {
  const current = await db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&order=created_at.asc");
  const slugs = new Set(current.map(x => x.slug));
  const missing = DEPARTMENTS.filter(x => !slugs.has(x.slug));
  if (missing.length) {
    await db("afe_org_departments?on_conflict=workspace_id%2Cslug", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(missing.map(d => ({
        workspace_id: workspaceId, slug: d.slug, name: d.name, mandate: d.mandate,
        department_kind: d.kind, reports_to_slug: d.reportsTo,
        is_independent: d.independent, human_only: d.humanOnly, created_by: actorId ?? null
      })))
    });
  }
  const all = await db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&order=created_at.asc");
  const agents = await db<any[]>("afe_agents?workspace_id=eq." + enc(workspaceId) + "&select=id,slug,department_id");
  const mapping: Record<string, string> = {
    "strategie": "strategie-developpement",
    "finance-investissements": "finance-investissements",
    "risques-controle": "risques-controle",
    "gouvernance-conformite": "gouvernance-conformite",
    "recherche-prospective": "evidence-intelligence",
    "technologie-ingenierie": "infrastructure-securite"
  };
  for (const agent of agents) {
    const slug = mapping[agent.slug];
    const department = all.find(x => x.slug === slug);
    if (department && agent.department_id !== department.id) {
      await db("afe_agents?id=eq." + enc(agent.id) + "&workspace_id=eq." + enc(workspaceId), {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ department_id: department.id })
      });
    }
  }
  return all;
}
async function audit(workspaceId: string, userId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  await db("debate_workspace_audit", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, actor_id: userId, action, entity_type: entityType, entity_id: entityId, details })
  });
}
async function notify(userId: string, type: string, title: string, message: string, workspaceId: string) {
  await db("notifications", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, type, title, message, link_type: "workspace", link_id: workspaceId })
  });
}
async function canOperate(workspaceId: string, user: AuthUser) {
  const a = await requireAccess(workspaceId, user, "editor");
  const s = await settings(workspaceId, a.workspace.owner_id);
  if (a.role !== "owner" && a.role !== "admin" && s.coo_user_id !== user.id) throw fail("Cette action est réservée au COO désigné ou à la Direction générale.", 403);
  return { access: a, settings: s };
}
async function validateDepartment(workspaceId: string, departmentId: string, allowIndependent = false) {
  const rows = await db<any[]>("afe_org_departments?id=eq." + enc(departmentId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const d = rows[0];
  if (!d || !d.active) throw fail("Direction ou département indisponible.", 404);
  if (!allowIndependent && (d.is_independent || d.human_only)) throw fail("Le COO ne peut pas affecter ni diriger une tâche de l'Arbitrage indépendant ou de la Validation humaine.", 403);
  return d;
}
async function validateAgent(workspaceId: string, agentId: string, departmentId?: string) {
  const rows = await db<any[]>("afe_agents?id=eq." + enc(agentId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const a = rows[0];
  if (!a || a.status !== "active") throw fail("L'agent affecté doit être actif dans cet espace.", 400);
  if (departmentId && a.department_id && a.department_id !== departmentId) throw fail("L'agent n'appartient pas à la direction sélectionnée.", 400);
  return a;
}
async function validateMember(workspaceId: string, userId: string) {
  const member = await access(workspaceId, userId);
  if (!member || rank[member.role] < rank.editor) throw fail("Le responsable doit être membre de cet espace avec un rôle éditeur ou supérieur.", 400);
}

async function upsertAlert(workspaceId: string, alert: { key: string; type: string; severity: string; title: string; description: string; missionId?: string; taskId?: string }) {
  const found = await db<any[]>("afe_coo_alerts?workspace_id=eq." + enc(workspaceId) + "&dedupe_key=eq." + enc(alert.key) + "&limit=1");
  if (!found[0]) {
    await db("afe_coo_alerts?on_conflict=workspace_id%2Cdedupe_key", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        workspace_id: workspaceId, dedupe_key: alert.key, alert_type: alert.type,
        severity: alert.severity, title: alert.title, description: alert.description,
        mission_id: alert.missionId ?? null, task_id: alert.taskId ?? null
      })
    });
  } else if (found[0].status === "resolved") {
    await db("afe_coo_alerts?id=eq." + enc(found[0].id) + "&workspace_id=eq." + enc(workspaceId), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "open", severity: alert.severity, title: alert.title, description: alert.description, acknowledged_by: null, acknowledged_at: null, resolved_by: null, resolved_at: null, updated_at: nowIso() })
    });
  }
}
async function refreshAlerts(workspaceId: string, missions: any[], tasks: any[]) {
  const now = Date.now();
  for (const m of missions) {
    if (m.due_at && new Date(m.due_at).getTime() < now && !["completed", "failed", "cancelled"].includes(m.status)) {
      await upsertAlert(workspaceId, { key: "mission-overdue:" + m.id, type: "mission_overdue", severity: m.priority <= 2 ? "critical" : "warning", title: "Mission en retard : " + m.title, description: "Échéance dépassée. Statut actuel : " + m.status + ". Le COO doit obtenir un plan de rattrapage.", missionId: m.id });
    }
    if (m.status === "failed") {
      await upsertAlert(workspaceId, { key: "mission-failed:" + m.id, type: "mission_failed", severity: "critical", title: "Échec de mission : " + m.title, description: clean(m.failure_message, 1200) || "La mission a échoué. Une revue opérationnelle est requise.", missionId: m.id });
    }
    if (m.status === "waiting_approval" && Date.now() - new Date(m.updated_at ?? m.created_at).getTime() > 86400000) {
      await upsertAlert(workspaceId, { key: "mission-approval:" + m.id, type: "approval_overdue", severity: "warning", title: "Validation en attente depuis plus de 24 h", description: m.title, missionId: m.id });
    }
  }
  for (const t of tasks) {
    if (t.due_at && new Date(t.due_at).getTime() < now && !["done", "cancelled"].includes(t.status)) {
      await upsertAlert(workspaceId, { key: "task-overdue:" + t.id, type: "task_overdue", severity: t.priority <= 2 ? "critical" : "warning", title: "Tâche en retard : " + t.title, description: "Échéance dépassée. Direction : " + (t.department_name ?? "non renseignée"), taskId: t.id, missionId: t.mission_id ?? undefined });
    }
    if (t.status === "blocked") {
      await upsertAlert(workspaceId, { key: "task-blocked:" + t.id, type: "task_blocked", severity: "warning", title: "Tâche bloquée : " + t.title, description: clean(t.blocked_reason, 1200) || "Un blocage doit être qualifié et escaladé.", taskId: t.id, missionId: t.mission_id ?? undefined });
    }
  }
}
async function snapshot(workspaceId: string) {
  const [departments, missions, tasks, agents, alerts, approvals] = await Promise.all([
    db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&order=name.asc"),
    db<any[]>("afe_agent_missions?workspace_id=eq." + enc(workspaceId) + "&order=created_at.desc&limit=500"),
    db<any[]>("afe_operational_tasks?workspace_id=eq." + enc(workspaceId) + "&order=created_at.desc&limit=1000"),
    db<any[]>("afe_agents?workspace_id=eq." + enc(workspaceId) + "&select=id,name,slug,status,department_id,autonomy_level"),
    db<any[]>("afe_coo_alerts?workspace_id=eq." + enc(workspaceId) + "&order=created_at.desc&limit=300"),
    db<any[]>("afe_agent_approvals?workspace_id=eq." + enc(workspaceId) + "&status=eq.pending&select=id,mission_id,action_key,risk_level,created_at")
  ]);
  const deptById = new Map(departments.map(d => [d.id, d]));
  const agentById = new Map(agents.map(a => [a.id, a]));
  const decoratedTasks = tasks.map(t => ({
    ...t,
    department_name: deptById.get(t.department_id)?.name ?? "Direction inconnue",
    assigned_agent_name: t.assigned_agent_id ? agentById.get(t.assigned_agent_id)?.name ?? "Agent inconnu" : null
  }));
  const decoratedMissions = missions.map(m => ({
    ...m,
    department_name: deptById.get(m.department_id)?.name ?? "Non affectée",
    agent_name: agentById.get(m.agent_id)?.name ?? "Agent inconnu"
  }));
  return { departments, missions: decoratedMissions, tasks: decoratedTasks, agents, alerts, approvals };
}
function computeDashboard(data: Awaited<ReturnType<typeof snapshot>>) {
  const activeMissions = data.missions.filter(m => !["completed", "failed", "cancelled"].includes(m.status));
  const overdueMissions = activeMissions.filter(m => m.due_at && new Date(m.due_at).getTime() < Date.now());
  const openTasks = data.tasks.filter(t => !["done", "cancelled"].includes(t.status));
  const overdueTasks = openTasks.filter(t => t.due_at && new Date(t.due_at).getTime() < Date.now());
  const openAlerts = data.alerts.filter(a => a.status !== "resolved");
  const completedMissions = data.missions.filter(m => m.status === "completed").length;
  const failedMissions = data.missions.filter(m => m.status === "failed").length;
  const deptPerformance = data.departments.map(d => {
    const ms = data.missions.filter(m => m.department_id === d.id);
    const ts = data.tasks.filter(t => t.department_id === d.id);
    const done = ts.filter(t => t.status === "done").length;
    const closed = ms.filter(m => ["completed", "failed", "cancelled"].includes(m.status));
    return {
      id: d.id, slug: d.slug, name: d.name, kind: d.department_kind, independent: d.is_independent,
      active: d.active, missionCount: ms.length, runningMissions: ms.filter(m => ["queued", "planning", "running", "waiting_approval"].includes(m.status)).length,
      completedMissions: ms.filter(m => m.status === "completed").length, failedMissions: ms.filter(m => m.status === "failed").length,
      taskCount: ts.length, openTasks: ts.filter(t => !["done", "cancelled"].includes(t.status)).length,
      blockedTasks: ts.filter(t => t.status === "blocked").length, overdueTasks: ts.filter(t => t.due_at && new Date(t.due_at).getTime() < Date.now() && !["done", "cancelled"].includes(t.status)).length,
      taskCompletionRate: ts.length ? Math.round(done / ts.length * 100) : null,
      missionClosureRate: ms.length ? Math.round(closed.length / ms.length * 100) : null
    };
  });
  return {
    generatedAt: nowIso(),
    indicators: {
      totalMissions: data.missions.length, activeMissions: activeMissions.length, completedMissions,
      failedMissions, overdueMissions: overdueMissions.length, totalTasks: data.tasks.length,
      openTasks: openTasks.length, blockedTasks: data.tasks.filter(t => t.status === "blocked").length,
      overdueTasks: overdueTasks.length, activeDepartments: data.departments.filter(d => d.active).length,
      openAlerts: openAlerts.filter(a => a.status === "open").length,
      criticalAlerts: openAlerts.filter(a => a.severity === "critical").length,
      pendingHumanApprovals: data.approvals.length
    },
    departmentPerformance: deptPerformance,
    priorityAlerts: openAlerts.filter(a => a.status === "open").slice(0, 12),
    missionsAtRisk: [...overdueMissions, ...data.missions.filter(m => m.status === "failed")].slice(0, 12),
    recentTasks: data.tasks.slice(0, 12)
  };
}
async function createMission(workspaceId: string, user: AuthUser, input: any) {
  const departmentId = clean(input.departmentId, 64);
  const agentId = clean(input.agentId, 64);
  const title = clean(input.title, 220);
  const objective = clean(input.objective, 20000);
  if (!departmentId || !agentId || title.length < 3 || objective.length < 10) throw fail("Direction, agent, titre et objectif détaillé sont obligatoires.");
  await validateDepartment(workspaceId, departmentId);
  const agent = await validateAgent(workspaceId, agentId, departmentId);
  if (input.operationalOwnerUserId) await validateMember(workspaceId, clean(input.operationalOwnerUserId, 64));
  const idempotencyKey = clean(input.idempotencyKey, 160) || randomUUID();
  const prior = await db<any[]>("afe_agent_missions?workspace_id=eq." + enc(workspaceId) + "&idempotency_key=eq." + enc(idempotencyKey) + "&limit=1");
  if (prior[0]) return prior[0];
  const rows = await db<any[]>("afe_agent_missions?on_conflict=workspace_id%2Cidempotency_key", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      workspace_id: workspaceId, agent_id: agentId, department_id: departmentId,
      operational_owner_user_id: input.operationalOwnerUserId || null,
      created_by: user.id, title, objective,
      input_context: input.context && typeof input.context === "object" ? input.context : {},
      priority: Math.max(1, Math.min(5, Number(input.priority) || 3)),
      autonomy_level: Math.min(agent.autonomy_level, Math.max(1, Math.min(3, Number(input.autonomyLevel) || 1))),
      due_at: input.dueAt || null, progress_percent: 0, idempotency_key: idempotencyKey
    })
  });
  let mission = rows[0];
  if (!mission) {
    const retry = await db<any[]>("afe_agent_missions?workspace_id=eq." + enc(workspaceId) + "&idempotency_key=eq." + enc(idempotencyKey) + "&limit=1");
    mission = retry[0];
  }
  if (!mission) throw new Error("La mission n'a pas été persistée.");
  await db("afe_agent_events", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, mission_id: mission.id, agent_id: agentId, actor_type: "human", actor_id: user.id, event_type: "coo.mission.created", payload: { title, departmentId, dueAt: input.dueAt ?? null } })
  });
  await audit(workspaceId, user.id, "coo.mission.created", "mission", mission.id, { departmentId, agentId });
  return mission;
}
async function createTask(workspaceId: string, user: AuthUser, input: any) {
  const departmentId = clean(input.departmentId, 64);
  const title = clean(input.title, 220);
  if (!departmentId || title.length < 3) throw fail("Direction et titre de tâche obligatoires.");
  await validateDepartment(workspaceId, departmentId);
  const missionId = clean(input.missionId, 64) || null;
  if (missionId) {
    const m = await db<any[]>("afe_agent_missions?id=eq." + enc(missionId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
    if (!m[0]) throw fail("Mission inexistante dans cet espace.", 404);
    if (m[0].department_id && m[0].department_id !== departmentId) throw fail("La tâche doit relever de la même direction que sa mission.", 400);
  }
  const assignedAgentId = clean(input.assignedAgentId, 64) || null;
  if (assignedAgentId) await validateAgent(workspaceId, assignedAgentId, departmentId);
  const assignedUserId = clean(input.assignedUserId, 64) || null;
  if (assignedUserId) await validateMember(workspaceId, assignedUserId);
  const rows = await db<any[]>("afe_operational_tasks", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: workspaceId, mission_id: missionId, department_id: departmentId,
      title, description: clean(input.description, 6000),
      priority: Math.max(1, Math.min(5, Number(input.priority) || 3)),
      assigned_agent_id: assignedAgentId, assigned_user_id: assignedUserId,
      due_at: input.dueAt || null, created_by: user.id
    })
  });
  const task = rows[0];
  await audit(workspaceId, user.id, "coo.task.created", "task", task.id, { departmentId, missionId, assignedAgentId, assignedUserId });
  if (assignedUserId) await notify(assignedUserId, "coo.task.assigned", "Nouvelle tâche attribuée", title, workspaceId);
  return task;
}
async function patchTask(workspaceId: string, user: AuthUser, id: string, input: any) {
  const oldRows = await db<any[]>("afe_operational_tasks?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const old = oldRows[0];
  if (!old) throw fail("Tâche introuvable.", 404);
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (input.status !== undefined) {
    if (!["todo", "in_progress", "blocked", "done", "cancelled"].includes(input.status)) throw fail("Statut de tâche invalide.");
    patch.status = input.status;
    if (input.status === "done") { patch.progress_percent = 100; patch.completed_at = nowIso(); }
    else if (input.status !== "cancelled") patch.completed_at = null;
  }
  if (input.progressPercent !== undefined) {
    const p = Number(input.progressPercent);
    if (!Number.isInteger(p) || p < 0 || p > 100) throw fail("La progression doit être comprise entre 0 et 100.");
    patch.progress_percent = p;
  }
  if (input.blockedReason !== undefined) {
    patch.blocked_reason = clean(input.blockedReason, 3000) || null;
    if (patch.blocked_reason) patch.status = "blocked";
  }
  if (input.dueAt !== undefined) patch.due_at = input.dueAt || null;
  if (input.assignedUserId !== undefined) {
    const uid = clean(input.assignedUserId, 64);
    if (uid) await validateMember(workspaceId, uid);
    patch.assigned_user_id = uid || null;
  }
  if (input.assignedAgentId !== undefined) {
    const aid = clean(input.assignedAgentId, 64);
    if (aid) await validateAgent(workspaceId, aid, old.department_id);
    patch.assigned_agent_id = aid || null;
  }
  const rows = await db<any[]>("afe_operational_tasks?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId), {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch)
  });
  await audit(workspaceId, user.id, "coo.task.updated", "task", id, { fields: Object.keys(patch) });
  return rows[0] ?? { id, ...patch };
}
async function patchMission(workspaceId: string, user: AuthUser, id: string, input: any) {
  const found = await db<any[]>("afe_agent_missions?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  if (!found[0]) throw fail("Mission introuvable.", 404);
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (input.dueAt !== undefined) patch.due_at = input.dueAt || null;
  if (input.progressPercent !== undefined) {
    const p = Number(input.progressPercent);
    if (!Number.isInteger(p) || p < 0 || p > 100) throw fail("La progression doit être comprise entre 0 et 100.");
    patch.progress_percent = p;
  }
  if (input.blockedReason !== undefined) patch.blocked_reason = clean(input.blockedReason, 3000) || null;
  const rows = await db<any[]>("afe_agent_missions?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId), {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch)
  });
  await audit(workspaceId, user.id, "coo.mission.updated", "mission", id, { fields: Object.keys(patch) });
  return rows[0] ?? { id, ...patch };
}
async function handleDashboard(workspaceId: string, user: AuthUser) {
  const a = await requireAccess(workspaceId, user);
  await settings(workspaceId, a.workspace.owner_id);
  await ensureDepartments(workspaceId, user.id);
  const data = await snapshot(workspaceId);
  await refreshAlerts(workspaceId, data.missions, data.tasks);
  const refreshed = await snapshot(workspaceId);
  return { dashboard: computeDashboard(refreshed), departments: refreshed.departments, missions: refreshed.missions, tasks: refreshed.tasks, alerts: refreshed.alerts.filter(x => x.status !== "resolved"), settings: await settings(workspaceId, a.workspace.owner_id) };
}
async function generateReport(workspaceId: string, reportType: "daily" | "weekly" | "ad_hoc", periodStart: string, periodEnd: string, actorId?: string) {
  const initial = await snapshot(workspaceId);
  await refreshAlerts(workspaceId, initial.missions, initial.tasks);
  const data = await snapshot(workspaceId);
  const dashboard = computeDashboard(data);
  const reportContent = {
    title: reportType === "daily" ? "Rapport opérationnel quotidien" : reportType === "weekly" ? "Revue opérationnelle hebdomadaire" : "Rapport opérationnel",
    generatedAt: nowIso(), period: { start: periodStart, end: periodEnd }, indicators: dashboard.indicators,
    departmentPerformance: dashboard.departmentPerformance,
    missionsAtRisk: dashboard.missionsAtRisk,
    priorityAlerts: dashboard.priorityAlerts,
    decisionsRequired: {
      humanApprovals: data.approvals,
      escalations: dashboard.priorityAlerts.filter(x => x.severity === "critical")
    },
    governanceNote: "Ce rapport décrit l'exécution opérationnelle. Il ne modifie aucun constat technique, arbitrage indépendant ou décision soumise à validation humaine."
  };
  const key = reportType + ":" + periodStart.slice(0, 10) + ":" + periodEnd.slice(0, 10);
  const existing = await db<any[]>("afe_coo_reports?workspace_id=eq." + enc(workspaceId) + "&idempotency_key=eq." + enc(key) + "&limit=1");
  let report: any = existing[0] ?? null;
  let created = false;
  if (!report) {
    try {
      const rows = await db<any[]>("afe_coo_reports", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ workspace_id: workspaceId, report_type: reportType, period_start: periodStart, period_end: periodEnd, idempotency_key: key, report_content: reportContent, generated_by: actorId ?? null, status: "generated" })
      });
      report = rows[0];
      created = true;
    } catch (e) {
      const duplicate = await db<any[]>("afe_coo_reports?workspace_id=eq." + enc(workspaceId) + "&idempotency_key=eq." + enc(key) + "&limit=1");
      if (duplicate[0]) report = duplicate[0];
      else throw e;
    }
  }
  const ws = await db<any[]>("debate_workspaces?id=eq." + enc(workspaceId) + "&limit=1");
  const s = await settings(workspaceId, ws[0]?.owner_id);
  const dgId = s.dg_user_id || ws[0]?.owner_id;
  if (dgId && report?.status !== "sent") {
    await notify(dgId, "coo.report.daily", report.report_content?.title || reportContent.title,
      "Le rapport opérationnel est disponible. " + dashboard.indicators.activeMissions + " mission(s) active(s), " + dashboard.indicators.openAlerts + " alerte(s) ouverte(s).", workspaceId);
    await db("afe_coo_reports?id=eq." + enc(report.id) + "&workspace_id=eq." + enc(workspaceId), {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", sent_at: nowIso() })
    });
    report = { ...report, status: "sent" };
  }
  return { report, created };
}
async function listReports(workspaceId: string) {
  return db<any[]>("afe_coo_reports?workspace_id=eq." + enc(workspaceId) + "&order=created_at.desc&limit=100");
}
async function actOnAlert(workspaceId: string, user: AuthUser, id: string, action: string) {
  if (!["acknowledge", "resolve"].includes(action)) throw fail("Action d'alerte invalide.");
  const rows = await db<any[]>("afe_coo_alerts?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  if (!rows[0]) throw fail("Alerte introuvable.", 404);
  const patch = action === "acknowledge"
    ? { status: "acknowledged", acknowledged_by: user.id, acknowledged_at: nowIso(), updated_at: nowIso() }
    : { status: "resolved", resolved_by: user.id, resolved_at: nowIso(), updated_at: nowIso() };
  await db("afe_coo_alerts?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  await audit(workspaceId, user.id, "coo.alert." + action, "alert", id);
  return { id, status: patch.status };
}

export async function handleCooRequest(req: IncomingMessage, res: ServerResponse, path: string, user: AuthUser): Promise<boolean> {
  const p = path.split("/").filter(Boolean);
  if (p.length < 6 || p[0] !== "team" || p[1] !== "api" || p[2] !== "workspaces" || p[4] !== "coo") return false;
  const workspaceId = p[3];
  const resource = p[5];
  const method = req.method ?? "GET";
  try {
    if (resource === "dashboard" && method === "GET") { send(res, 200, await handleDashboard(workspaceId, user)); return true; }
    if (resource === "departments") {
      await requireAccess(workspaceId, user);
      await ensureDepartments(workspaceId, user.id);
      if (method === "GET") { send(res, 200, { departments: await db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&order=name.asc") }); return true; }
      if (p[6] && method === "PATCH") {
        const { access: a } = await canOperate(workspaceId, user);
        const rows = await db<any[]>("afe_org_departments?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
        const old = rows[0]; if (!old) throw fail("Direction introuvable.", 404);
        if (old.is_independent || old.human_only || old.slug === "direction-generale") throw fail("Cette fonction est protégée de la gestion opérationnelle du COO.", 403);
        if (old.slug === "direction-operations" && a.role !== "owner") throw fail("Seule la Direction générale peut modifier le mandat du COO.", 403);
        const i = await readBody(req), patch: Record<string, unknown> = { updated_at: nowIso() };
        if (i.name !== undefined && textOk(i.name, 140)) patch.name = i.name.trim();
        if (i.mandate !== undefined && typeof i.mandate === "string" && i.mandate.length <= 12000) patch.mandate = i.mandate;
        if (i.active !== undefined) {
          if (old.slug === "direction-operations" && !i.active) throw fail("La Direction des Opérations ne peut pas être désactivée par cette interface.", 403);
          patch.active = Boolean(i.active);
        }
        if (i.directorUserId !== undefined) {
          if (old.slug === "direction-operations") throw fail("Le responsable du COO se désigne dans les paramètres de gouvernance.", 403);
          const uid = clean(i.directorUserId, 64);
          if (uid) await validateMember(workspaceId, uid);
          patch.director_user_id = uid || null;
        }
        let directorAgent: any = null;
        if (i.directorAgentId !== undefined) {
          const aid = clean(i.directorAgentId, 64);
          if (aid) directorAgent = await validateAgent(workspaceId, aid, old.id);
          patch.director_agent_id = aid || null;
        }
        const updated = await db<any[]>("afe_org_departments?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
        if (directorAgent && !directorAgent.department_id) {
          await db("afe_agents?id=eq." + enc(directorAgent.id) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ department_id: old.id }) });
        }
        await audit(workspaceId, user.id, "coo.department.updated", "department", p[6], { fields: Object.keys(patch) });
        send(res, 200, { department: updated[0] }); return true;
      }
    }
    if (resource === "missions") {
      if (method === "GET") { await requireAccess(workspaceId, user); await ensureDepartments(workspaceId, user.id); const data = await snapshot(workspaceId); send(res, 200, { missions: data.missions }); return true; }
      if (method === "POST") { await canOperate(workspaceId, user); const mission = await createMission(workspaceId, user, await readBody(req)); send(res, 201, { mission }); return true; }
      if (p[6] && method === "PATCH") { await canOperate(workspaceId, user); send(res, 200, { mission: await patchMission(workspaceId, user, p[6], await readBody(req)) }); return true; }
    }
    if (resource === "tasks") {
      if (method === "GET") { await requireAccess(workspaceId, user); const data = await snapshot(workspaceId); send(res, 200, { tasks: data.tasks }); return true; }
      if (method === "POST") { await canOperate(workspaceId, user); send(res, 201, { task: await createTask(workspaceId, user, await readBody(req)) }); return true; }
      if (p[6] && method === "PATCH") { await canOperate(workspaceId, user); send(res, 200, { task: await patchTask(workspaceId, user, p[6], await readBody(req)) }); return true; }
    }
    if (resource === "alerts") {
      await requireAccess(workspaceId, user);
      if (method === "GET") { const data = await snapshot(workspaceId); await refreshAlerts(workspaceId, data.missions, data.tasks); send(res, 200, { alerts: (await snapshot(workspaceId)).alerts }); return true; }
      if (p[6] && method === "POST") { await canOperate(workspaceId, user); send(res, 200, await actOnAlert(workspaceId, user, p[6], clean((await readBody(req)).action, 32))); return true; }
    }
    if (resource === "reports") {
      await requireAccess(workspaceId, user);
      if (method === "GET") { send(res, 200, { reports: await listReports(workspaceId) }); return true; }
      if (p[6] === "generate" && method === "POST") {
        await canOperate(workspaceId, user);
        const end = new Date(), start = new Date(end.getTime() - 86400000);
        const result = await generateReport(workspaceId, "ad_hoc", start.toISOString(), end.toISOString(), user.id);
        send(res, result.created ? 201 : 200, result); return true;
      }
    }
    if (resource === "settings") {
      const a = await requireAccess(workspaceId, user);
      const s = await settings(workspaceId, a.workspace.owner_id);
      if (method === "GET") { const members = await db<any[]>("debate_workspace_members?workspace_id=eq." + enc(workspaceId) + "&order=created_at.asc"); send(res, 200, { settings: s, members: members.map(x => ({ user_id: x.user_id, role: x.role })) }); return true; }
      if (method === "PATCH") {
        if (a.role !== "owner") throw fail("Seul le propriétaire de l'espace, représentant la Direction générale, peut désigner le COO et modifier le reporting.", 403);
        const i = await readBody(req), patch: Record<string, unknown> = { updated_at: nowIso() };
        if (i.cooUserId !== undefined) {
          const uid = clean(i.cooUserId, 64);
          if (uid) await validateMember(workspaceId, uid);
          patch.coo_user_id = uid || null;
        }
        if (i.dailyReportEnabled !== undefined) patch.daily_report_enabled = Boolean(i.dailyReportEnabled);
        const rows = await db<any[]>("afe_coo_settings?workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
        if (i.cooUserId !== undefined) {
          const cooDept = await db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&slug=eq.direction-operations&limit=1");
          if (cooDept[0]) await db("afe_org_departments?id=eq." + enc(cooDept[0].id) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ director_user_id: i.cooUserId || null, updated_at: nowIso() }) });
        }
        await audit(workspaceId, user.id, "coo.settings.updated", "settings", workspaceId, { fields: Object.keys(patch) });
        send(res, 200, { settings: rows[0] }); return true;
      }
    }
    return false;
  } catch (error) {
    send(res, Number((error as any)?.status) || 500, { error: error instanceof Error ? error.message : "Erreur du système COO." });
    return true;
  }
}

export async function handleCooReportWorker(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path !== "/internal/coo-report-worker") return false;
  if (!["GET", "POST"].includes(req.method ?? "GET")) { res.writeHead(405, { Allow: "GET, POST" }); res.end(); return true; }
  const expected = process.env.COO_REPORT_WORKER_SECRET ?? process.env.CRON_SECRET ?? "";
  const auth = req.headers.authorization ?? "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const validSecret = !!expected && !!supplied && Buffer.byteLength(supplied) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!validSecret) {
    send(res, 401, { error: "Unauthorized" }); return true;
  }
  try {
    const rows = await db<any[]>("afe_coo_settings?daily_report_enabled=eq.true&select=workspace_id");
    const results = [];
    for (const s of rows) {
      const end = new Date(), start = new Date(end.getTime() - 86400000);
      const result = await generateReport(s.workspace_id, "daily", start.toISOString(), end.toISOString());
      results.push({ workspaceId: s.workspace_id, created: result.created, reportId: result.report?.id });
    }
    send(res, 200, { ok: true, processed: results.length, results });
    return true;
  } catch (error) {
    send(res, 503, { error: error instanceof Error ? error.message : "COO report worker unavailable" });
    return true;
  }
}

export const COO_HTML = String.raw`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#10243a"><title>AFE-CI · Direction des Opérations</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#172338;background:#f3f6fa}*{box-sizing:border-box}body{margin:0}header{background:#10243a;color:#fff;padding:22px max(18px,calc((100vw - 1180px)/2));display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}header h1{font-size:22px;margin:0}header p{margin:5px 0 0;color:#c8d5e4;font-size:13px}.wrap{max-width:1180px;margin:auto;padding:18px}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.field,button,select,textarea{font:inherit}.field,select,textarea{width:100%;padding:10px 12px;border:1px solid #d4dce7;border-radius:9px;background:white;color:#172338}.bar select{max-width:360px}.btn{border:1px solid #cbd5e1;background:#fff;color:#17314b;padding:9px 13px;border-radius:9px;cursor:pointer;font-weight:650}.btn.primary{background:#176b52;color:white;border-color:#176b52}.btn.danger{color:#a42b2b}.btn:disabled{opacity:.45;cursor:not-allowed}.tabs{display:flex;gap:7px;overflow:auto;padding:4px 0 12px}.tabs button{white-space:nowrap}.tabs button.active{background:#173b58;color:#fff;border-color:#173b58}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px}.card{background:white;border:1px solid #e0e6ee;border-radius:13px;padding:16px;margin:0 0 13px;box-shadow:0 2px 8px #17233808}.card h2{font-size:17px;margin:0 0 12px}.card h3{font-size:14px;margin:0 0 8px}.metric{padding:14px;border:1px solid #e3e9f0;border-radius:10px}.metric b{display:block;font-size:25px}.muted,.small{color:#64748b;font-size:12px}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #edf1f5}.row:first-of-type{border-top:0}.row strong{display:block}.tag{font-size:11px;border-radius:30px;padding:4px 8px;background:#edf2f7;color:#30465c;white-space:nowrap}.tag.critical{background:#fee2e2;color:#991b1b}.tag.warning{background:#fff0ce;color:#895400}.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.form label{display:block;font-size:12px;color:#526176;margin-bottom:5px}.form .wide{grid-column:1/-1}.notice{padding:12px;border-radius:9px;background:#eef5f3;color:#245441;margin:8px 0}.error{background:#fff0f0;color:#a12424}.empty{padding:20px;text-align:center;color:#64748b}.actions{display:flex;gap:7px;flex-wrap:wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f8fb;padding:12px;border-radius:9px;font-size:12px}a{color:#176b52}@media(max-width:600px){header{padding:18px}.wrap{padding:12px}.row{align-items:flex-start;flex-direction:column}}
</style></head><body>
<header><div><h1>AFE-CI · Direction des Opérations</h1><p>Poste de commandement du COO · Portefeuille · Directions · Exécution · Performance</p></div><div class="actions"><a href="/team" style="color:white">Équipe & Gouvernance ↗</a><button class="btn" id="refresh">Actualiser</button></div></header>
<main class="wrap"><div id="message" class="notice">Chargement de l'espace de travail…</div><div class="bar"><label for="spaces" class="small">Espace de travail</label><select id="spaces" class="field"></select><span id="role" class="small"></span></div>
<nav class="tabs" id="tabs"><button class="btn active" data-tab="overview">Vue centrale</button><button class="btn" data-tab="missions">Portefeuille des missions</button><button class="btn" data-tab="departments">Directions</button><button class="btn" data-tab="tasks">Tâches & affectations</button><button class="btn" data-tab="alerts">Alertes</button><button class="btn" data-tab="reports">Reporting DG</button><button class="btn" data-tab="settings">Paramètres COO</button></nav><section id="view"></section></main>
<script>
const $=id=>document.getElementById(id),arr=x=>Array.isArray(x)?x:[],esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function session(){try{return JSON.parse(localStorage.getItem("afe-v09-session")||"null")}catch{return null}}
let wid="",role="viewer",tab="overview",cache={};
function message(t,error){$("message").textContent=t;$("message").className=error?"notice error":"notice"}
async function api(path,options){const s=session();if(!s?.access_token)throw Error("Session absente. Connectez-vous depuis Équipe & Gouvernance.");const r=await fetch(path,{...(options||{}),headers:{Authorization:"Bearer "+s.access_token,"Content-Type":"application/json",...((options&&options.headers)||{})}});const raw=await r.text();let d={};try{d=JSON.parse(raw||"{}")}catch{}if(!r.ok)throw Error(d.error||"Erreur serveur "+r.status);return d}
const base=()=>"/team/api/workspaces/"+encodeURIComponent(wid)+"/coo/";
const metric=(label,value)=>'<div class="metric"><b>'+esc(value??"—")+'</b><span class="small">'+esc(label)+'</span></div>';
const date=v=>v?new Date(v).toLocaleString("fr-FR"):"—";
const statusLabel=s=>({queued:"En attente",planning:"Planification",running:"En cours",waiting_approval:"Validation requise",paused:"Suspendue",completed:"Terminée",failed:"Échec",cancelled:"Annulée",todo:"À faire",in_progress:"En cours",blocked:"Bloquée",done:"Terminée",open:"Ouverte",acknowledged:"Prise en charge",resolved:"Résolue"}[s]||s||"—");
async function loadWorkspaceList(){const data=await api("/team/api/workspaces");const spaces=arr(data);$("spaces").innerHTML=spaces.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+' · '+esc(x.role)+'</option>').join("")||'<option value="">Aucun espace</option>';if(!wid&&spaces.length)wid=spaces[0].id;if(wid)$("spaces").value=wid;if(!wid){message("Aucun espace disponible. Créez-en un depuis Équipe & Gouvernance.",true);return}await render()}
async function loadCommon(){const [dash,agents,members]=await Promise.all([api(base()+"dashboard"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members")]);cache={...dash,agents:arr(agents.agents),members:arr(members)};return cache}
function renderOverview(d){
 const x=d.dashboard.indicators,alerts=arr(d.dashboard.priorityAlerts),risks=arr(d.dashboard.missionsAtRisk);
 return '<section class="card"><h2>Situation opérationnelle</h2><div class="grid">'+metric("Missions actives",x.activeMissions)+metric("Missions terminées",x.completedMissions)+metric("Missions en retard",x.overdueMissions)+metric("Tâches ouvertes",x.openTasks)+metric("Tâches bloquées",x.blockedTasks)+metric("Tâches en retard",x.overdueTasks)+metric("Alertes ouvertes",x.openAlerts)+metric("Alertes critiques",x.criticalAlerts)+metric("Validations humaines en attente",x.pendingHumanApprovals)+'</div><p class="small">Actualisé : '+date(d.dashboard.generatedAt)+'</p></section><section class="card"><h2>Performance par direction</h2>'+arr(d.dashboard.departmentPerformance).map(q=>'<div class="row"><div><strong>'+esc(q.name)+'</strong><span class="small">'+q.missionCount+' mission(s) · '+q.openTasks+' tâche(s) ouverte(s) · '+q.blockedTasks+' bloquée(s)</span></div><span class="tag">'+(q.taskCompletionRate===null?"Pas encore de données":q.taskCompletionRate+" % tâches terminées")+'</span></div>').join("")+'</section><section class="card"><h2>Alertes prioritaires</h2>'+(alerts.length?alerts.map(a=>'<div class="row"><div><strong>'+esc(a.title)+'</strong><span class="small">'+esc(a.description)+' · '+date(a.created_at)+'</span></div><span class="tag '+esc(a.severity)+'">'+esc(a.severity)+'</span></div>').join(""):'<div class="empty">Aucune alerte prioritaire.</div>')+'</section><section class="card"><h2>Missions à risque</h2>'+(risks.length?risks.map(m=>'<div class="row"><div><strong>'+esc(m.title)+'</strong><span class="small">'+esc(m.department_name)+' · '+esc(statusLabel(m.status))+' · échéance '+date(m.due_at)+'</span></div><span class="tag">'+esc(m.priority)+'</span></div>').join(""):'<div class="empty">Aucune mission à risque.</div>')+'</section>';
}
async function renderMissions(){
 const [m,agents,dep,members]=await Promise.all([api(base()+"missions"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents"),api(base()+"departments"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members")]);
 const missions=arr(m.missions),activeAgents=arr(agents.agents).filter(a=>a.status==="active"),departments=arr(dep.departments).filter(d=>d.active&&!d.is_independent&&!d.human_only);
 $("view").innerHTML='<section class="card"><h2>Enregistrer une mission dans le portefeuille</h2><div class="form"><div><label>Direction responsable</label><select class="field" id="missionDepartment">'+departments.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>').join("")+'</select></div><div><label>Agent responsable</label><select class="field" id="missionAgent"></select></div><div><label>Responsable opérationnel</label><select class="field" id="missionOwner"><option value="">Non désigné</option>'+arr(members).filter(x=>["owner","admin","editor"].includes(x.role)).map(x=>'<option value="'+esc(x.user_id)+'">'+esc(x.profile?.full_name||x.profile?.email||x.user_id)+'</option>').join("")+'</select></div><div><label>Priorité (1 = très haute)</label><select class="field" id="missionPriority"><option value="1">1 · Critique</option><option value="2">2 · Haute</option><option value="3" selected>3 · Normale</option><option value="4">4 · Basse</option><option value="5">5 · Très basse</option></select></div><div class="wide"><label>Intitulé</label><input class="field" id="missionTitle" maxlength="220" placeholder="Ex. Diagnostic global des risques opérationnels"></div><div class="wide"><label>Objectif et livrables attendus</label><textarea class="field" id="missionObjective" rows="3" placeholder="Définir le résultat, le périmètre, les critères de réussite et les livrables."></textarea></div><div><label>Échéance</label><input class="field" id="missionDue" type="datetime-local"></div></div><p><button class="btn primary" id="missionCreate" '+(activeAgents.length?"":"disabled") +'>Créer la mission</button></p><p class="small">La mission est enregistrée dans la file durable existante. Son exécution dépend du worker et de l’activation de l’agent. Le COO ne peut pas créer de mission d’arbitrage ni de validation humaine.</p></section><section class="card"><h2>Portefeuille ('+missions.length+')</h2>'+(missions.length?missions.map(m=>'<div class="row"><div style="flex:1"><strong>'+esc(m.title)+'</strong><span class="small">'+esc(m.department_name)+' · '+esc(m.agent_name)+' · '+esc(statusLabel(m.status))+' · '+date(m.due_at)+'</span><div class="small">Progression : '+esc(m.progress_percent||0)+' %</div></div><div class="actions"><input class="field" type="number" min="0" max="100" style="width:82px" data-mission-progress="'+esc(m.id)+'" value="'+esc(m.progress_percent||0)+'"><button class="btn" data-save-mission="'+esc(m.id)+'">Maj %</button><span class="tag '+(m.status==="failed"?"critical":"")+'">P'+esc(m.priority)+'</span></div></div>').join(""):'<div class="empty">Aucune mission enregistrée.</div>')+'</section>';
 function updateAgents(){const dept=$("missionDepartment").value;const choices=activeAgents.filter(a=>!a.department_id||a.department_id===dept);$("missionAgent").innerHTML=choices.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join("");$("missionCreate").disabled=choices.length===0}
 $("missionDepartment").onchange=updateAgents;updateAgents();
 $("missionCreate").onclick=async()=>{try{const d=await api(base()+"missions",{method:"POST",body:JSON.stringify({departmentId:$("missionDepartment").value,agentId:$("missionAgent").value,operationalOwnerUserId:$("missionOwner").value||null,title:$("missionTitle").value,objective:$("missionObjective").value,priority:Number($("missionPriority").value),dueAt:$("missionDue").value?new Date($("missionDue").value).toISOString():null})});message("Mission créée dans le portefeuille : "+d.mission.id);await render()}catch(e){message(e.message,true)}};
 $("view").querySelectorAll("[data-save-mission]").forEach(b=>b.onclick=async()=>{try{const id=b.dataset.saveMission,p=$("view").querySelector('[data-mission-progress="'+id+'"]').value;await api(base()+"missions/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({progressPercent:Number(p)})});message("Progression de mission mise à jour.");await render()}catch(e){message(e.message,true)}});
}
async function renderDepartments(){
 const [d,a,m,st]=await Promise.all([api(base()+"departments"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members"),api(base()+"settings")]);
 const items=arr(d.departments),agents=arr(a.agents).filter(x=>x.status==="active"),members=arr(m).filter(x=>["owner","admin","editor"].includes(x.role));
 const userName=id=>{const x=members.find(q=>q.user_id===id);return x?.profile?.display_name||x?.profile?.full_name||x?.profile?.email||id||"Non désigné"};
 const agentName=id=>agents.find(q=>q.id===id)?.name||id||"Non désigné";
 $("view").innerHTML='<section class="card"><h2>Organigramme opérationnel</h2><p class="small">La Direction générale supervise le COO. L’Arbitrage indépendant et l’Autorité de validation humaine restent hors de la chaîne de commandement opérationnelle. Les fonctions protégées ne sont ni désactivables ni affectables par le COO.</p>'+items.map(x=>{
  const protectedDept=x.is_independent||x.human_only||x.slug==="direction-generale";
  const ownerOnly=x.slug==="direction-operations";
  const editable=!protectedDept&&(!ownerOnly||role==="owner");
  const directors=(x.slug==="direction-generale"?"Direction générale · propriétaire de l’espace":x.slug==="direction-operations"?(st.settings.coo_user_id?userName(st.settings.coo_user_id):"COO non désigné"):[x.director_user_id?userName(x.director_user_id):null,x.director_agent_id?agentName(x.director_agent_id):null].filter(Boolean).join(" · ")||"Non désigné");
  const userOptions=members.map(q=>'<option value="'+esc(q.user_id)+'" '+(x.director_user_id===q.user_id?"selected":"")+'>'+esc(q.profile?.display_name||q.profile?.full_name||q.profile?.email||q.user_id)+'</option>').join("");
  const agentOptions=agents.filter(q=>!q.department_id||q.department_id===x.id).map(q=>'<option value="'+esc(q.id)+'" '+(x.director_agent_id===q.id?"selected":"")+'>'+esc(q.name)+'</option>').join("");
  return '<div class="row"><div style="flex:1"><strong>'+esc(x.name)+'</strong><span class="small">'+esc(x.department_kind)+' · rattachement : '+esc(x.reports_to_slug||"indépendant / Direction générale")+' · '+(x.is_independent?"fonction indépendante":"fonction opérationnelle")+'</span><p class="small">Responsable : '+esc(directors)+'</p>'+(editable?'<textarea class="field" rows="2" data-mandate="'+esc(x.id)+'">'+esc(x.mandate)+'</textarea>'+(ownerOnly?'':'<div class="form"><div><label>Responsable humain</label><select class="field" data-director-user="'+esc(x.id)+'"><option value="">Non désigné</option>'+userOptions+'</select></div><div><label>Agent directeur</label><select class="field" data-director-agent="'+esc(x.id)+'"><option value="">Non désigné</option>'+agentOptions+'</select></div></div>'):'<p class="small">'+esc(x.mandate)+'</p>')+'</div><div class="actions"><span class="tag">'+(x.active?"Active":"Inactive")+'</span>'+(editable?'<button class="btn" data-save-dept="'+esc(x.id)+'">Enregistrer</button><button class="btn" data-toggle-dept="'+esc(x.id)+'">'+(x.active?"Désactiver":"Activer")+'</button>':ownerOnly&&role!=="owner"?'<span class="small">Gérée par la Direction générale</span>':'<span class="small">Protégée</span>')+'</div></div>';
 }).join("")+'</section>';
 $("view").querySelectorAll("[data-save-dept]").forEach(b=>b.onclick=async()=>{try{const id=b.dataset.saveDept,payload={mandate:$("view").querySelector('[data-mandate="'+id+'"]').value};const du=$("view").querySelector('[data-director-user="'+id+'"]'),da=$("view").querySelector('[data-director-agent="'+id+'"]');if(du)payload.directorUserId=du.value||null;if(da)payload.directorAgentId=da.value||null;await api(base()+"departments/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(payload)});message("Direction et responsables mis à jour.");await render()}catch(e){message(e.message,true)}});
 $("view").querySelectorAll("[data-toggle-dept]").forEach(b=>b.onclick=async()=>{try{const d=items.find(x=>x.id===b.dataset.toggleDept);await api(base()+"departments/"+encodeURIComponent(d.id),{method:"PATCH",body:JSON.stringify({active:!d.active})});await render()}catch(e){message(e.message,true)}});
}
async function renderTasks(){const [t,m,a,d,mem]=await Promise.all([api(base()+"tasks"),api(base()+"missions"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents"),api(base()+"departments"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members")]);const departments=arr(d.departments).filter(x=>x.active&&!x.is_independent&&!x.human_only),agents=arr(a.agents).filter(x=>x.status==="active");$("view").innerHTML='<section class="card"><h2>Nouvelle tâche et attribution</h2><div class="form"><div><label>Direction</label><select class="field" id="taskDepartment">'+departments.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("")+'</select></div><div><label>Mission associée</label><select class="field" id="taskMission"><option value="">Aucune</option>'+arr(m.missions).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+'</option>').join("")+'</select></div><div><label>Agent responsable</label><select class="field" id="taskAgent"><option value="">Non affecté</option>'+agents.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("")+'</select></div><div><label>Collaborateur responsable</label><select class="field" id="taskUser"><option value="">Non affecté</option>'+arr(mem).filter(x=>["owner","admin","editor"].includes(x.role)).map(x=>'<option value="'+esc(x.user_id)+'">'+esc(x.profile?.full_name||x.profile?.email||x.user_id)+'</option>').join("")+'</select></div><div class="wide"><label>Intitulé</label><input class="field" id="taskTitle" placeholder="Travail à réaliser"></div><div class="wide"><label>Description / critères de réalisation</label><textarea class="field" id="taskDescription" rows="2"></textarea></div><div><label>Priorité</label><select class="field" id="taskPriority"><option value="1">1 · Critique</option><option value="2">2 · Haute</option><option value="3" selected>3 · Normale</option><option value="4">4 · Basse</option><option value="5">5 · Très basse</option></select></div><div><label>Échéance</label><input class="field" id="taskDue" type="datetime-local"></div></div><p><button class="btn primary" id="taskCreate">Attribuer la tâche</button></p></section><section class="card"><h2>Suivi des tâches</h2>'+arr(t.tasks).map(x=>'<div class="row"><div><strong>'+esc(x.title)+'</strong><span class="small">'+esc(x.department_name)+' · '+esc(x.assigned_agent_name||"Sans agent")+' · '+esc(statusLabel(x.status))+' · '+esc(x.progress_percent)+' % · '+date(x.due_at)+'</span></div><select class="field" style="max-width:150px" data-task="'+esc(x.id)+'"><option value="todo" '+(x.status==="todo"?"selected":"")+'>À faire</option><option value="in_progress" '+(x.status==="in_progress"?"selected":"")+'>En cours</option><option value="blocked" '+(x.status==="blocked"?"selected":"")+'>Bloquée</option><option value="done" '+(x.status==="done"?"selected":"")+'>Terminée</option><option value="cancelled" '+(x.status==="cancelled"?"selected":"")+'>Annulée</option></select></div>').join("")||'<div class="empty">Aucune tâche.</div>'+'</section>';function updateTaskChoices(){const departmentId=$("taskDepartment").value;const validAgents=agents.filter(x=>!x.department_id||x.department_id===departmentId);$("taskAgent").innerHTML='<option value="">Non affecté</option>'+validAgents.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");const validMissions=arr(m.missions).filter(x=>x.department_id===departmentId);$("taskMission").innerHTML='<option value="">Aucune</option>'+validMissions.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+'</option>').join("")}
$("taskDepartment").onchange=updateTaskChoices;updateTaskChoices();
$("taskCreate").onclick=async()=>{try{await api(base()+"tasks",{method:"POST",body:JSON.stringify({departmentId:$("taskDepartment").value,missionId:$("taskMission").value||null,assignedAgentId:$("taskAgent").value||null,assignedUserId:$("taskUser").value||null,title:$("taskTitle").value,description:$("taskDescription").value,priority:Number($("taskPriority").value),dueAt:$("taskDue").value?new Date($("taskDue").value).toISOString():null})});message("Tâche attribuée et journalisée.");await render()}catch(e){message(e.message,true)}};$("view").querySelectorAll("[data-task]").forEach(el=>el.onchange=async()=>{try{await api(base()+"tasks/"+encodeURIComponent(el.dataset.task),{method:"PATCH",body:JSON.stringify({status:el.value})});message("Statut de tâche mis à jour.");await render()}catch(e){message(e.message,true)}})}
async function renderAlerts(){const d=await api(base()+"alerts");$("view").innerHTML='<section class="card"><h2>Centre d’alertes</h2>'+arr(d.alerts).filter(x=>x.status!=="resolved").map(x=>'<div class="row"><div><strong>'+esc(x.title)+'</strong><span class="small">'+esc(x.description)+' · '+date(x.created_at)+'</span></div><div class="actions"><span class="tag '+esc(x.severity)+'">'+esc(x.severity)+'</span><button class="btn" data-ack="'+esc(x.id)+'">Prendre en charge</button><button class="btn danger" data-resolve="'+esc(x.id)+'">Résoudre</button></div></div>').join("")||'<div class="empty">Aucune alerte active.</div>'+'</section>';$("view").querySelectorAll("[data-ack],[data-resolve]").forEach(b=>b.onclick=async()=>{try{await api(base()+"alerts/"+encodeURIComponent(b.dataset.ack||b.dataset.resolve),{method:"POST",body:JSON.stringify({action:b.dataset.ack?"acknowledge":"resolve"})});await render()}catch(e){message(e.message,true)}})}
async function renderReports(){const d=await api(base()+"reports");$("view").innerHTML='<section class="card"><h2>Reporting à la Direction générale</h2><p class="small">Un rapport automatique quotidien est prévu à l’heure UTC configurée. Le bouton ci-dessous permet de produire immédiatement une revue ponctuelle.</p><button class="btn primary" id="reportNow">Générer un rapport maintenant</button></section><section class="card"><h2>Rapports archivés</h2>'+arr(d.reports).map(x=>'<div class="row"><div><strong>'+esc(x.report_content?.title||x.report_type)+'</strong><span class="small">'+date(x.period_start)+' → '+date(x.period_end)+' · '+esc(x.status)+'</span></div><button class="btn" data-report="'+esc(x.id)+'">Consulter</button></div>').join("")||'<div class="empty">Aucun rapport généré.</div>'+'</section>';$("reportNow").onclick=async()=>{try{const r=await api(base()+"reports/generate",{method:"POST",body:"{}"});message(r.created?"Rapport généré et transmis à la Direction générale.":"Un rapport identique existe déjà.");await render()}catch(e){message(e.message,true)}};$("view").querySelectorAll("[data-report]").forEach(b=>b.onclick=()=>{const r=arr(d.reports).find(x=>x.id===b.dataset.report);if(r){$("view").insertAdjacentHTML("beforeend",'<section class="card"><h2>'+esc(r.report_content?.title||"Rapport")+'</h2><pre>'+esc(JSON.stringify(r.report_content,null,2))+'</pre></section>')}})}
async function renderSettings(){
 const [s,m]=await Promise.all([api(base()+"settings"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members")]),cfg=s.settings;
 $("view").innerHTML='<section class="card"><h2>Désignation et reporting</h2><p class="small">Le propriétaire de l’espace représente la Direction générale. Seul ce dernier peut désigner le COO ou activer/désactiver le rapport quotidien. Le rapport est programmé chaque jour à 08:00 UTC (heure d’Abidjan).</p><div class="form"><div><label>Directeur des Opérations (COO)</label><select class="field" id="cooUser"><option value="">Non désigné</option>'+arr(m).filter(x=>["owner","admin","editor"].includes(x.role)).map(x=>'<option value="'+esc(x.user_id)+'" '+(cfg.coo_user_id===x.user_id?"selected":"")+'>'+esc(x.profile?.display_name||x.profile?.full_name||x.profile?.email||x.user_id)+'</option>').join("")+'</select></div><div><label>Rapport automatique quotidien</label><select class="field" id="dailyEnabled"><option value="true" '+(cfg.daily_report_enabled?"selected":"")+'>Activé</option><option value="false" '+(!cfg.daily_report_enabled?"selected":"")+'>Désactivé</option></select></div></div><p><button class="btn primary" id="saveSettings" '+(role==="owner"?"":"disabled") +'>Enregistrer les paramètres</button></p></section>';
 $("saveSettings").onclick=async()=>{try{await api(base()+"settings",{method:"PATCH",body:JSON.stringify({cooUserId:$("cooUser").value||null,dailyReportEnabled:$("dailyEnabled").value==="true"})});message("Paramètres COO enregistrés.");await render()}catch(e){message(e.message,true)}};
}
async function render(){if(!wid)return;try{$("role").textContent="Rôle : "+role;const w=await api("/team/api/workspaces/"+encodeURIComponent(wid));role=w.role||role;$("role").textContent="Rôle : "+role;const v=$("view");v.innerHTML='<section class="card">Chargement…</section>';if(tab==="overview"){const d=await loadCommon();v.innerHTML=renderOverview(d)}else if(tab==="missions")await renderMissions();else if(tab==="departments")await renderDepartments();else if(tab==="tasks")await renderTasks();else if(tab==="alerts")await renderAlerts();else if(tab==="reports")await renderReports();else if(tab==="settings")await renderSettings()}catch(e){message(e.message,true);$("view").innerHTML='<section class="card error">'+esc(e.message)+'</section>'}}
$("tabs").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(!b)return;tab=b.dataset.tab;$("tabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));render()});
$("spaces").onchange=()=>{wid=$("spaces").value;render()};$("refresh").onclick=()=>render();if(!session()?.access_token)message("Connectez-vous dans Équipe & Gouvernance, puis revenez sur cette page.",true);else loadWorkspaceList().catch(e=>message(e.message,true));
</script></body></html>`;
