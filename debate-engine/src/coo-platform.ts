import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "./auth.js";
import { callModel } from "./providers.js";
import { runAgentWorkerForWorkspace } from "./autonomous-agents/worker.js";
import { buildCooDataQuality, resolveTaskDepartmentId } from "./coo-reporting.js";
import { consolidateDepartmentWorkstreams } from "./coo-planning.js";

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
  { slug: "direction-generale", name: "Direction générale", kind: "executive", reportsTo: null, independent: false, humanOnly: true, mandate: "Autorité humaine de gouvernance. Définit la stratégie, les priorités, les délégations, les arbitrages de ressources et les décisions réservées. Reçoit les rapports du COO." },
  { slug: "direction-operations", name: "Direction des Opérations (COO)", kind: "operational", reportsTo: "direction-generale", independent: false, humanOnly: false, mandate: "COO IA rattaché à la DG. Orchestre les directions opérationnelles, missions, ressources, tâches, délais, alertes et reporting. N'altère pas les conclusions techniques, l'audit indépendant, l'arbitrage ou la validation humaine." },
  { slug: "strategie-developpement", name: "Stratégie & Développement", kind: "operational", reportsTo: "direction-generale", independent: false, humanOnly: false, mandate: "Prépare les orientations, plans de développement, analyses stratégiques et objectifs transversaux soumis à la Direction générale." },
  { slug: "finance-investissements", name: "Finance & Investissements", kind: "control", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Analyse les budgets, coûts, investissements, hypothèses financières et risques économiques. Tout engagement financier reste soumis à validation humaine." },
  { slug: "risques-controle", name: "Risques & Contrôle", kind: "control", reportsTo: "direction-generale", independent: false, humanOnly: false, mandate: "Identifie et évalue les risques, surveille les contrôles et KRI. Dispose d'un droit d'escalade directe à la DG et conserve son indépendance de jugement." },
  { slug: "gouvernance-conformite", name: "Gouvernance & Conformité", kind: "control", reportsTo: "direction-generale", independent: false, humanOnly: false, mandate: "Contrôle les délégations, la conformité, les conflits d'intérêts et la séparation des fonctions. Dispose d'un droit d'escalade directe à la DG." },
  { slug: "evidence-intelligence", name: "Evidence Intelligence", kind: "support", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Collecte les sources autorisées, vérifie la provenance, conserve les empreintes et qualifie la relation entre preuves et constats." },
  { slug: "secretariat-general", name: "Secrétariat général des missions", kind: "operational", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Enregistre les mandats, prépare les dossiers, suit les jalons, les affectations, les échéances et la complétude documentaire." },
  { slug: "operations-missions", name: "Opérations de mission", kind: "operational", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Coordonne l'exécution quotidienne des missions autorisées, les tâches, les dépendances et les plans de rattrapage." },
  { slug: "audit-qualite", name: "Audit qualité", kind: "control", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Vérifie la qualité des livrables, la traçabilité, la complétude des contrôles et la conformité aux procédures, sans se substituer à l'audit interne." },
  { slug: "documentation-reporting", name: "Documentation & Reporting", kind: "support", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Produit les dossiers, rapports, synthèses, exports et archives institutionnelles." },
  { slug: "infrastructure-securite", name: "Infrastructure & Sécurité", kind: "support", reportsTo: "direction-operations", independent: false, humanOnly: false, mandate: "Assure l'architecture, la disponibilité, la sécurité, les habilitations et la séparation des environnements." },
  { slug: "audit-interne", name: "Audit interne indépendant", kind: "independent", reportsTo: null, independent: true, humanOnly: false, mandate: "Évalue de manière indépendante la gouvernance, les risques et les contrôles. Dispose d'un accès direct à la DG et ne relève pas du COO." },
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
    body: JSON.stringify({ workspace_id: workspaceId, dg_user_id: ownerId ?? null, daily_report_enabled: true })
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
    "afe-ci-coo": "direction-operations",
    "afe-ci-strategie": "strategie-developpement",
    "afe-ci-finance-investissements": "finance-investissements",
    "directeur-risques-controle": "risques-controle",
    "directeur-gouvernance-conformite": "gouvernance-conformite",
    "directeur-evidence-intelligence": "evidence-intelligence",
    "directeur-secretariat-general": "secretariat-general",
    "directeur-operations-missions": "operations-missions",
    "directeur-audit-qualite": "audit-qualite",
    "directeur-documentation-reporting": "documentation-reporting",
    "directeur-technologie-innovation": "infrastructure-securite",
    "directeur-audit-interne": "audit-interne",
    "arbitre-independant-afe-ci": "arbitrage-independant"
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
  const cfgRows = await db<any[]>("afe_coo_settings?workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const cooAgentId = cfgRows[0]?.coo_agent_id ?? null;
  const operations = all.find(x => x.slug === "direction-operations");
  if (operations && (operations.director_agent_id !== cooAgentId || operations.director_user_id !== null)) {
    await db("afe_org_departments?id=eq." + enc(operations.id) + "&workspace_id=eq." + enc(workspaceId), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ director_user_id: null, director_agent_id: cooAgentId, updated_at: nowIso() })
    });
    operations.director_user_id = null;
    operations.director_agent_id = cooAgentId;
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
    if (m.blocked_reason || m.status === "paused") {
      await upsertAlert(workspaceId, { key: "mission-blocked:" + m.id, type: "mission_blocked", severity: "warning", title: "Mission bloquée : " + m.title, description: clean(m.blocked_reason, 1200) || "La mission est suspendue et nécessite une décision opérationnelle.", missionId: m.id });
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
  const missionById = new Map(missions.map(m => [m.id, m]));
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const existing = await db<any[]>("afe_coo_alerts?workspace_id=eq." + enc(workspaceId) + "&status=in.(open,acknowledged)&limit=500");
  for (const alert of existing) {
    let known = false, active = true;
    if (alert.alert_type?.startsWith("task_") && alert.task_id && taskById.has(alert.task_id)) {
      known = true;
      const t = taskById.get(alert.task_id)!;
      if (alert.alert_type === "task_overdue") active = Boolean(t.due_at && new Date(t.due_at).getTime() < now && !["done", "cancelled"].includes(t.status));
      else if (alert.alert_type === "task_blocked") active = t.status === "blocked";
      else known = false;
    } else if (alert.mission_id && missionById.has(alert.mission_id)) {
      known = true;
      const m = missionById.get(alert.mission_id)!;
      if (alert.alert_type === "mission_overdue") active = Boolean(m.due_at && new Date(m.due_at).getTime() < now && !["completed", "failed", "cancelled"].includes(m.status));
      else if (alert.alert_type === "mission_failed") active = m.status === "failed";
      else if (alert.alert_type === "mission_blocked") active = Boolean(m.blocked_reason) || m.status === "paused";
      else if (alert.alert_type === "approval_overdue") active = m.status === "waiting_approval" && now - new Date(m.updated_at ?? m.created_at).getTime() > 86400000;
      else known = false;
    }
    if (known && !active) {
      await db("afe_coo_alerts?id=eq." + enc(alert.id) + "&workspace_id=eq." + enc(workspaceId), {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "resolved", resolved_by: null, resolved_at: nowIso(), updated_at: nowIso() })
      });
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
  const missionById = new Map(missions.map(m => [m.id, m]));
  // Resolve legacy null department IDs for reporting without mutating source records.
  const resolveMissionDepartment = (mission: any, agent: any) => {
    if (mission.department_id && deptById.has(mission.department_id)) return { id: mission.department_id, source: "explicit" };
    if (agent?.department_id && deptById.has(agent.department_id)) return { id: agent.department_id, source: "inferred_from_agent" };
    // Legacy/test agents sometimes predate department_id. Infer only from an exact
    // department-slug token in the agent slug; never guess from a display name.
    const agentSlug = typeof agent?.slug === "string" ? agent.slug.toLowerCase() : "";
    const agentTokens = agentSlug.split(/[-_]/);
    const matched = departments.find(d => {
      const departmentTokens = d.slug.split("-");
      return departmentTokens.length > 0 && agentTokens.some((_token: string, index: number) =>
        agentTokens.slice(index, index + departmentTokens.length).join("-") === d.slug);
    });
    return matched ? { id: matched.id, source: "inferred_from_agent_slug" } : { id: null, source: "unassigned" };
  };
  const decoratedMissions = missions.map(m => {
    const agent = agentById.get(m.agent_id);
    const resolution = resolveMissionDepartment(m, agent);
    const effectiveDepartmentId = resolution.id;
    return { ...m, effective_department_id: effectiveDepartmentId,
      department_name: deptById.get(effectiveDepartmentId)?.name ?? "Non affectée",
      agent_name: agent?.name ?? "Agent inconnu",
      department_resolution: resolution.source };
  });
  const decoratedMissionById = new Map(decoratedMissions.map(m => [m.id, m]));
  const decoratedTasks = tasks.map(t => {
    const mission = t.mission_id ? decoratedMissionById.get(t.mission_id) : null;
    const effectiveDepartmentId = resolveTaskDepartmentId(t, mission, t.assigned_agent_id ? agentById.get(t.assigned_agent_id) : null);
    return { ...t, effective_department_id: effectiveDepartmentId,
      department_name: deptById.get(effectiveDepartmentId)?.name ?? "Direction inconnue",
      assigned_agent_name: t.assigned_agent_id ? agentById.get(t.assigned_agent_id)?.name ?? "Agent inconnu" : null };
  });
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
    const ms = data.missions.filter(m => m.effective_department_id === d.id);
    const ts = data.tasks.filter(t => t.effective_department_id === d.id);
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
      failedMissions, overdueMissions: overdueMissions.length,
      unassignedMissions: data.missions.filter(m => !m.effective_department_id).length,
      blockedMissions: data.missions.filter(m => Boolean(m.blocked_reason) || m.status === "paused").length,
      totalTasks: data.tasks.length, openTasks: openTasks.length,
      blockedTasks: data.tasks.filter(t => t.status === "blocked").length,
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
    if (input.status === "done") {
      patch.progress_percent = 100;
      patch.completed_at = nowIso();
      patch.blocked_reason = null;
    } else if (input.status === "blocked") {
      patch.completed_at = null;
    } else if (input.status === "todo" || input.status === "in_progress") {
      patch.completed_at = null;
      patch.blocked_reason = null;
    } else if (input.status === "cancelled") {
      patch.completed_at = null;
      patch.blocked_reason = null;
    }
  }
  if (input.progressPercent !== undefined) {
    const p = Number(input.progressPercent);
    if (!Number.isInteger(p) || p < 0 || p > 100) throw fail("La progression doit être comprise entre 0 et 100.");
    patch.progress_percent = p;
  }
  if (input.blockedReason !== undefined) {
    patch.blocked_reason = clean(input.blockedReason, 3000) || null;
    if (patch.blocked_reason) {
      patch.status = "blocked";
      patch.completed_at = null;
    }
  }
  // Status invariants always win over a stale percentage sent by the UI.
  if (patch.status === "done") { patch.progress_percent = 100; patch.completed_at = patch.completed_at ?? nowIso(); patch.blocked_reason = null; }
  if (patch.status === "blocked") patch.completed_at = null;
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
  const startMs = Date.parse(periodStart), endMs = Date.parse(periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw fail("Période de rapport invalide : dates ISO requises et début antérieur à la fin.");
  }
  const initial = await snapshot(workspaceId);
  await refreshAlerts(workspaceId, initial.missions, initial.tasks);
  const fullData = await snapshot(workspaceId);
  // A report must describe its declared period, not the entire lifetime of the workspace.
  const inPeriod = (value: unknown) => {
    const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
    return Number.isFinite(timestamp) && timestamp >= startMs && timestamp <= endMs;
  };
  const missions = fullData.missions.filter(m => inPeriod(m.created_at));
  const periodMissionIds = new Set(missions.map(m => m.id));
  const tasks = fullData.tasks.filter(t => inPeriod(t.created_at) || (t.mission_id && periodMissionIds.has(t.mission_id)));
  const data = { ...fullData, missions, tasks };
  const dashboard = computeDashboard(data);
  const dataQuality = buildCooDataQuality(missions, tasks, dashboard.departmentPerformance);
  const { completedVerifiedMissionCount, completedWithoutTasks, completedWithIncompleteTasks } = dataQuality;
  const reportContent = {
    title: reportType === "daily" ? "Rapport opérationnel quotidien" : reportType === "weekly" ? "Revue opérationnelle hebdomadaire" : "Rapport opérationnel",
    generatedAt: nowIso(), period: { start: periodStart, end: periodEnd }, indicators: {
      ...dashboard.indicators,
      completedVerifiedMissions: completedVerifiedMissionCount,
      completedUnverifiedMissions: completedWithoutTasks.length + completedWithIncompleteTasks.length
    },
    departmentPerformance: dashboard.departmentPerformance, missionsAtRisk: dashboard.missionsAtRisk, priorityAlerts: dashboard.priorityAlerts,
    dataQuality: { ...dataQuality },
    decisionsRequired: { humanApprovals: data.approvals, escalations: dashboard.priorityAlerts.filter(x => x.severity === "critical") },
    governanceNote: "Ce rapport décrit l'exécution opérationnelle. Une mission terminée sans tâches opérationnelles toutes achevées est signalée comme non vérifiée. Il ne modifie aucun constat technique, arbitrage indépendant ou décision soumise à validation humaine."
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
  } else {
    // Rebuild an existing period report with the corrected reconciliation logic.
    const rows = await db<any[]>("afe_coo_reports?id=eq." + enc(report.id) + "&workspace_id=eq." + enc(workspaceId), {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ report_content: reportContent, period_start: periodStart, period_end: periodEnd, generated_by: actorId ?? report.generated_by })
    });
    report = rows[0] ?? { ...report, report_content: reportContent };
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
  return { report, created, reconciliation: { periodMissionCount: missions.length, assignedMissionCount: dataQuality.assignedMissionCount, unassignedMissionCount: dataQuality.unassignedMissionCount, completedVerifiedMissionCount: completedVerifiedMissionCount, completedUnverifiedMissionCount: completedWithoutTasks.length + completedWithIncompleteTasks.length, taskCount: dataQuality.taskCount, assignedTaskCount: dataQuality.assignedTaskCount, unassignedTaskCount: dataQuality.unassignedTaskCount } };
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


type CooPlan = {
  summary: string;
  priority: number;
  workstreams: Array<{
    departmentSlug: string;
    missionTitle: string;
    objective: string;
    priority: number;
    dueInHours: number;
    tasks: Array<{ title: string; description: string; priority: number; dueInHours: number }>;
  }>;
  decisionsRequired: string[];
  assumptions: string[];
};

type CooCapability = "coo.organization.read" | "coo.workload.read" | "coo.missions.create" | "coo.tasks.create";
async function requireCooCapability(workspaceId: string, agentId: string, toolKey: CooCapability, permission: "read" | "write") {
  const rows = await db<any[]>(
    "afe_agent_tool_grants?workspace_id=eq." + enc(workspaceId) +
    "&agent_id=eq." + enc(agentId) + "&tool_key=eq." + enc(toolKey) +
    "&enabled=eq.true&limit=1"
  );
  const grant = rows[0];
  if (!grant || grant.permission !== permission || grant.approval_required !== false) {
    throw fail("Capacité COO non autorisée ou suspendue : " + toolKey, 403);
  }
  if (grant.limits?.workspace_scoped !== true || grant.limits?.reversible_only !== true) {
    throw fail("La capacité COO ne respecte pas le périmètre de sécurité requis : " + toolKey, 403);
  }
  return grant;
}

async function orchestrateCooInstruction(workspaceId: string, user: AuthUser, input: any) {
  const instruction = clean(input.instruction, 12000);
  if (instruction.length < 10) throw fail("L'instruction à transmettre au COO doit contenir au moins 10 caractères.");
  const a = await requireAccess(workspaceId, user, "owner");
  const cfg = await settings(workspaceId, a.workspace.owner_id);
  if (!cfg.coo_enabled || cfg.coo_kill_switch) throw fail("Le COO IA est désactivé ou son arrêt d'urgence est activé.", 423);
  if (Number(cfg.coo_autonomy_level) !== 2) throw fail("Le moteur de délégation est réservé au niveau d'autonomie 2.", 409);
  const cooId = clean(cfg.coo_agent_id, 64);
  if (!cooId) throw fail("Aucun agent COO IA n'est désigné.", 409);
  const cooRows = await db<any[]>("afe_agents?id=eq." + enc(cooId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const coo = cooRows[0];
  if (!coo || coo.slug !== "afe-ci-coo" || coo.status !== "active" || Number(coo.autonomy_level) < 2) {
    throw fail("L'agent COO doit être actif, désigné et configuré au niveau 2.", 409);
  }
  const capabilityGrants = await Promise.all([
    requireCooCapability(workspaceId, coo.id, "coo.organization.read", "read"),
    requireCooCapability(workspaceId, coo.id, "coo.workload.read", "read"),
    requireCooCapability(workspaceId, coo.id, "coo.missions.create", "write"),
    requireCooCapability(workspaceId, coo.id, "coo.tasks.create", "write")
  ]);
  const maxTasksPerRun = Math.max(1, Math.min(30, Number(capabilityGrants[3].limits?.max_per_run) || 30));
  const idempotencyKey = clean(input.idempotencyKey, 160) || randomUUID();
  const prior = await db<any[]>("afe_coo_runs?workspace_id=eq." + enc(workspaceId) + "&idempotency_key=eq." + enc(idempotencyKey) + "&limit=1");
  if (prior[0]) return { run: prior[0], replayed: true };
  const dayStart = new Date(Date.now() - 86400000).toISOString();
  const recentRuns = await db<any[]>("afe_coo_runs?workspace_id=eq." + enc(workspaceId) + "&created_at=gte." + enc(dayStart) + "&select=id&limit=10");
  if (recentRuns.length >= 10) throw fail("Plafond de sécurité atteint : maximum 10 orchestrations COO par 24 heures dans cet espace.", 429);
  const runRows = await db<any[]>("afe_coo_runs", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ workspace_id: workspaceId, coo_agent_id: coo.id, initiated_by: user.id, instruction, idempotency_key: idempotencyKey, status: "planning" })
  });
  const run = runRows[0];
  if (!run) throw new Error("Impossible d'enregistrer l'exécution du COO.");
  let generatedPlan: CooPlan | null = null;
  const createdMissions: Array<{missionId:string;departmentSlug:string;departmentName:string;directorAgent:string;taskCount:number}> = [];
  try {
    const [departments, agents] = await Promise.all([
      db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&active=eq.true&order=name.asc"),
      db<any[]>("afe_agents?workspace_id=eq." + enc(workspaceId) + "&status=eq.active&select=id,slug,name,status,mandate,specialty,system_instructions,model_provider,model_id,autonomy_level,department_id")
    ]);
    const [activeMissions, openTasks] = await Promise.all([
      db<any[]>("afe_agent_missions?workspace_id=eq." + enc(workspaceId) + "&status=in.(queued,planning,running,waiting_approval,paused)&select=id,agent_id,department_id"),
      db<any[]>("afe_operational_tasks?workspace_id=eq." + enc(workspaceId) + "&status=not.in.(done,cancelled)&select=id,assigned_agent_id,department_id")
    ]);
    const agentById = new Map(agents.map(x => [x.id, x]));
    const workloadByAgent = new Map<string, {activeMissions:number;openTasks:number}>();
    for (const agent of agents) workloadByAgent.set(agent.id, {
      activeMissions: activeMissions.filter(m => m.agent_id === agent.id).length,
      openTasks: openTasks.filter(t => t.assigned_agent_id === agent.id).length
    });
    const eligible = departments
      .filter(d => !d.is_independent && !d.human_only && !["direction-generale","direction-operations"].includes(d.slug) && d.director_agent_id)
      .map(d => ({ slug: d.slug, name: d.name, mandate: d.mandate, director: agentById.get(d.director_agent_id), workload: workloadByAgent.get(d.director_agent_id) ?? {activeMissions:0,openTasks:0} }))
      .filter(x => x.director && x.director.status === "active" && x.director.department_id === departments.find(d => d.slug === x.slug)?.id && x.workload.activeMissions < 2 && x.workload.openTasks < 10);
    if (!eligible.length) throw fail("Aucune direction opérationnelle ne dispose d'un directeur IA actif.", 409);
    const maxWorkstreams = Math.max(1, Math.min(8, Number(cfg.coo_max_workstreams) || 6, Number(capabilityGrants[2].limits?.max_per_run) || 6));
    const maxTasks = Math.max(1, Math.min(8, Number(cfg.coo_max_tasks_per_workstream) || 5));
    const provider = coo.model_provider === "gemini" ? "gemini" : "openai";
    const model = coo.model_id || (provider === "gemini" ? (process.env.GEMINI_MODEL || "gemini-3.8-flash") : (process.env.OPENAI_MODEL || "gpt-4.1-mini"));
    const plan = generatedPlan = await callModel<CooPlan>({
      provider, model, schemaName: "afe_ci_coo_orchestration_plan",
      system: coo.mandate + "\n\n" + (coo.system_instructions ?? "") + "\n\nTu es le COO IA. Tu transformes une instruction de la Direction générale en plan de travail réaliste, distribué et vérifiable. Tu ne changes pas le mandat. Tu ne délègues jamais à la Direction générale, à l'Audit interne indépendant, à l'Arbitrage indépendant ou à l'Autorité de validation humaine. Tu ne demandes aucune action financière, publication, déploiement, changement d'accès ou action irréversible. Les directions et responsables disponibles ci-dessous sont la seule liste autorisée. Chaque chantier doit avoir un objectif mesurable et au moins une tâche exploitable. N'invente pas les capacités ni les délais; formule les hypothèses. Respecte strictement le schéma JSON.",
      prompt: "INSTRUCTION DE LA DG :\n" + instruction + "\n\nDIRECTIONS ET RESPONSABLES AUTORISÉS (JSON) :\n" + JSON.stringify(eligible.map(x => ({ departmentSlug: x.slug, department: x.name, mandate: x.mandate, directorAgentSlug: x.director.slug, directorAgentName: x.director.name, directorMandate: x.director.mandate, specialty: x.director.specialty, activeMissions: x.workload.activeMissions, openTasks: x.workload.openTasks }))) + "\n\nLimites: maximum " + maxWorkstreams + " chantiers; maximum " + maxTasks + " tâches par chantier et " + maxTasksPerRun + " tâches au total; délai relatif de 1 à 720 heures; priorité 1 à 5. Chaque directeur ne doit pas recevoir plus d'un nouveau chantier dans cette exécution. La charge existante doit être prise en compte. Ne propose que les chantiers nécessaires.",
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "string" },
          priority: { type: "integer", minimum: 1, maximum: 5 },
          workstreams: { type: "array", minItems: 1, maxItems: maxWorkstreams, items: {
            type: "object", additionalProperties: false,
            properties: {
              departmentSlug: { type: "string" }, missionTitle: { type: "string" },
              objective: { type: "string" }, priority: { type: "integer", minimum: 1, maximum: 5 },
              dueInHours: { type: "integer", minimum: 1, maximum: 720 },
              tasks: { type: "array", minItems: 1, maxItems: maxTasks, items: {
                type: "object", additionalProperties: false,
                properties: { title: { type: "string" }, description: { type: "string" }, priority: { type: "integer", minimum: 1, maximum: 5 }, dueInHours: { type: "integer", minimum: 1, maximum: 720 } },
                required: ["title","description","priority","dueInHours"]
              } }
            },
            required: ["departmentSlug","missionTitle","objective","priority","dueInHours","tasks"]
          } },
          decisionsRequired: { type: "array", items: { type: "string" } },
          assumptions: { type: "array", items: { type: "string" } }
        },
        required: ["summary","priority","workstreams","decisionsRequired","assumptions"]
      }
    });
    const originalWorkstreamCount = plan.workstreams.length;
    const consolidation = consolidateDepartmentWorkstreams(plan.workstreams);
    if (consolidation.mergedDepartmentSlugs.length > 0) {
      plan.workstreams = consolidation.workstreams;
      plan.assumptions = [...(plan.assumptions ?? []), "Chantiers regroupés par direction pour garantir une seule mission par directeur : " + consolidation.mergedDepartmentSlugs.join(", ") + ". Les tâches et objectifs complémentaires ont été conservés."];
      await audit(workspaceId, user.id, "coo.plan.consolidated", "coo_run", run.id, {
        mergedDepartmentSlugs: consolidation.mergedDepartmentSlugs,
        originalWorkstreamCount,
        consolidatedWorkstreamCount: consolidation.workstreams.length
      });
    }
    if (!Array.isArray(plan.workstreams) || plan.workstreams.length < 1 || plan.workstreams.length > maxWorkstreams) throw new Error("Le plan du COO dépasse les limites de délégation.");
    const plannedTaskCount = plan.workstreams.reduce((total, stream) => total + (Array.isArray(stream.tasks) ? stream.tasks.length : 0), 0);
    if (plannedTaskCount > maxTasksPerRun) throw new Error("Le plan dépasse le plafond de tâches autorisé par les capacités COO.");
    const sensitiveAction = /\b(?:payer|autoriser un paiement|effectuer un paiement|initier un virement|transférer des fonds|engager une dépense|signer un contrat|conclure un contrat|publier un contenu|déployer en production|mettre en production|lancer une migration|modifier les accès|changer les habilitations|supprimer définitivement|effacer définitivement)\b/i;
    const sensitiveItems = plan.workstreams.flatMap(stream => [stream.missionTitle, stream.objective, ...stream.tasks.flatMap(task => [task.title, task.description])]).filter(value => sensitiveAction.test(value));
    if (sensitiveItems.length) {
      plan.decisionsRequired = [...new Set([...(plan.decisionsRequired ?? []), "Approbation humaine obligatoire : le plan contient une action potentiellement sensible ou irréversible."])];
    }
    // Routine DG decisions are recorded for follow-up; only explicitly sensitive actions block dispatch.
    if (sensitiveItems.length > 0) {
      const updated = await db<any[]>("afe_coo_runs?id=eq." + enc(run.id) + "&workspace_id=eq." + enc(workspaceId), {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "approval_required", plan, missions_created: 0, completed_at: nowIso() })
      });
      await audit(workspaceId, user.id, "coo.orchestration.approval_required", "coo_run", run.id, { cooAgentId: coo.id, decisionsRequired: plan.decisionsRequired });
      return { run: updated[0] ?? { ...run, status: "approval_required", plan }, plan, dispatched: [] };
    }
    const prevalidated = new Set<string>();
    for (const stream of plan.workstreams) {
      const department = departments.find(d => d.slug === stream.departmentSlug && d.active && !d.is_independent && !d.human_only);
      if (!department || ["direction-generale","direction-operations","audit-interne","arbitrage-independant","validation-humaine"].includes(department.slug)) throw new Error("Direction non délégable dans le plan : " + stream.departmentSlug);
      if (prevalidated.has(stream.departmentSlug)) throw new Error("Le plan contient plusieurs chantiers pour la même direction : " + stream.departmentSlug);
      prevalidated.add(stream.departmentSlug);
      const director = agentById.get(department.director_agent_id);
      if (!director || director.status !== "active" || director.department_id !== department.id) throw new Error("Responsable IA indisponible pour " + department.name);
      if (!textOk(stream.missionTitle, 220) || !textOk(stream.objective, 12000) || !Array.isArray(stream.tasks) || stream.tasks.length < 1 || stream.tasks.length > maxTasks) throw new Error("Chantier COO incomplet ou hors limites pour " + department.name);
      for (const task of stream.tasks) if (!textOk(task.title, 220) || !textOk(task.description, 6000)) throw new Error("Tâche COO invalide dans " + department.name);
    }
    const used = new Set<string>();
    for (const stream of plan.workstreams) {
      const department = departments.find(d => d.slug === stream.departmentSlug && d.active && !d.is_independent && !d.human_only);
      if (!department || ["direction-generale","direction-operations","audit-interne","arbitrage-independant","validation-humaine"].includes(department.slug)) {
        throw new Error("Le COO a proposé une direction non délégable : " + stream.departmentSlug);
      }
      if (used.has(stream.departmentSlug)) throw new Error("Le COO a proposé plusieurs chantiers pour la même direction; fusion requise.");
      used.add(stream.departmentSlug);
      const director = agentById.get(department.director_agent_id);
      if (!director || director.status !== "active" || director.department_id !== department.id) throw new Error("Responsable IA indisponible pour " + department.name);
      if (!textOk(stream.missionTitle, 220) || !textOk(stream.objective, 12000) || !Array.isArray(stream.tasks) || stream.tasks.length < 1 || stream.tasks.length > maxTasks) throw new Error("Chantier COO incomplet ou hors limites.");
      const missionKey = run.id + ":" + department.slug;
      const missionRows = await db<any[]>("afe_agent_missions?on_conflict=workspace_id%2Cidempotency_key", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({
          workspace_id: workspaceId, agent_id: director.id, department_id: department.id,
          created_by: user.id, title: clean(stream.missionTitle, 220), objective: clean(stream.objective, 12000),
          input_context: { cooRunId: run.id, cooAgentId: coo.id, instruction, cooSummary: plan.summary, assumptions: plan.assumptions, decisionsRequired: plan.decisionsRequired },
          priority: Math.max(1, Math.min(5, Number(stream.priority) || plan.priority || 3)),
          autonomy_level: Math.max(1, Math.min(2, Number(director.autonomy_level) || 1)),
          due_at: new Date(Date.now() + Math.max(1, Math.min(720, Number(stream.dueInHours) || 24)) * 3600000).toISOString(),
          progress_percent: 0, idempotency_key: missionKey, orchestration_mode: "leaf", orchestration_summary: { cooRunId: run.id }
        })
      });
      let mission = missionRows[0];
      if (!mission) {
        const priorMission = await db<any[]>("afe_agent_missions?workspace_id=eq." + enc(workspaceId) + "&idempotency_key=eq." + enc(missionKey) + "&limit=1");
        mission = priorMission[0];
      }
      if (!mission) throw new Error("Échec de création du chantier pour " + department.name);
      const dispatchRecord = { missionId: mission.id, departmentSlug: department.slug, departmentName: department.name, directorAgent: director.name, taskCount: 0 };
      createdMissions.push(dispatchRecord);
      const createdTasks: Array<{id:string;title:string;description:string}> = [];
      for (const task of stream.tasks) {
        if (!textOk(task.title, 220) || !textOk(task.description, 6000)) throw new Error("Tâche COO invalide dans " + department.name);
        const taskRows = await db<any[]>("afe_operational_tasks", {
          method: "POST", headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            workspace_id: workspaceId, mission_id: mission.id, department_id: department.id,
            title: clean(task.title, 220), description: clean(task.description, 6000),
            priority: Math.max(1, Math.min(5, Number(task.priority) || 3)),
            assigned_agent_id: director.id,
            due_at: new Date(Date.now() + Math.max(1, Math.min(720, Number(task.dueInHours) || Number(stream.dueInHours) || 24)) * 3600000).toISOString(),
            created_by: user.id
          })
        });
        if (!taskRows[0]?.id) throw new Error("La tâche n'a pas été persistée pour " + department.name);
        createdTasks.push({ id: taskRows[0].id, title: clean(task.title, 220), description: clean(task.description, 6000) });
        dispatchRecord.taskCount = createdTasks.length;
      }
      await db("afe_agent_missions?id=eq." + enc(mission.id) + "&workspace_id=eq." + enc(workspaceId), {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ input_context: { ...(mission.input_context ?? {}), cooTasks: createdTasks }, updated_at: nowIso() })
      });
      await db("afe_agent_events", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ workspace_id: workspaceId, mission_id: mission.id, agent_id: coo.id, actor_type: "agent", actor_id: coo.id, event_type: "coo.delegation.dispatched", payload: { cooRunId: run.id, departmentSlug: department.slug, taskCount: stream.tasks.length } })
      });
    }
    const status = "dispatched"; // Non-blocking DG decisions remain recorded in the plan; sensitive actions were gated above.
    const updated = await db<any[]>("afe_coo_runs?id=eq." + enc(run.id) + "&workspace_id=eq." + enc(workspaceId), {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status, plan: { ...plan, dispatched: createdMissions }, missions_created: createdMissions.length, completed_at: nowIso() })
    });
    await db("afe_agent_events", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ workspace_id: workspaceId, agent_id: coo.id, actor_type: "agent", actor_id: coo.id, event_type: "coo.orchestration.completed", payload: { cooRunId: run.id, missionsCreated: createdMissions.length, decisionsRequired: plan.decisionsRequired.length } })
    });
    await audit(workspaceId, user.id, "coo.orchestration.dispatched", "coo_run", run.id, { cooAgentId: coo.id, missionsCreated: createdMissions.length });
    return { run: updated[0] ?? { ...run, status, plan, missions_created: createdMissions.length }, plan, dispatched: createdMissions };
  } catch (error) {
    const partial = createdMissions.length > 0;
    await db("afe_coo_runs?id=eq." + enc(run.id) + "&workspace_id=eq." + enc(workspaceId), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: partial ? "partial" : "failed",
        plan: generatedPlan ? { ...generatedPlan, dispatched: createdMissions } : {},
        missions_created: createdMissions.length,
        error_message: (error instanceof Error ? error.message : String(error)).slice(0, 3000),
        completed_at: nowIso()
      })
    });
    await audit(workspaceId, user.id, partial ? "coo.orchestration.partial_failure" : "coo.orchestration.failed", "coo_run", run.id, {
      cooAgentId: coo.id, missionsCreated: createdMissions.length,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000)
    });
    throw error;
  }
}

export async function handleCooRequest(req: IncomingMessage, res: ServerResponse, path: string, user: AuthUser): Promise<boolean> {
  const p = path.split("/").filter(Boolean);
  if (p.length < 6 || p[0] !== "team" || p[1] !== "api" || p[2] !== "workspaces" || p[4] !== "coo") return false;
  const workspaceId = p[3];
  const resource = p[5];
  const method = req.method ?? "GET";
  try {
    if (resource === "execute-next" && method === "POST") {
      if (process.env.VERCEL_ENV !== "preview") throw fail("Le déclenchement manuel est réservé à l'environnement Preview.", 404);
      await requireAccess(workspaceId, user, "owner");
      const cfg = await settings(workspaceId);
      if (!cfg.coo_enabled || cfg.coo_kill_switch) throw fail("Le COO IA est désactivé ou son arrêt d'urgence est activé.", 423);
      const result = await runAgentWorkerForWorkspace(workspaceId);
      await audit(workspaceId, user.id, "coo.execution.worker_triggered", "workspace", workspaceId, {
        claimed: Boolean((result as any).claimed), missionId: (result as any).missionId ?? null,
        completed: Boolean((result as any).completed), paused: Boolean((result as any).paused)
      });
      send(res, 200, { ok: true, environment: "preview", workspaceId, ...result }); return true;
    }
    if (resource === "dashboard" && method === "GET") { send(res, 200, await handleDashboard(workspaceId, user)); return true; }
    if (resource === "orchestrate" && method === "POST") {
      const result = await orchestrateCooInstruction(workspaceId, user, await readBody(req));
      send(res, 201, result); return true;
    }
    if (resource === "orchestrations" && method === "GET") {
      await requireAccess(workspaceId, user);
      const runs = await db<any[]>("afe_coo_runs?workspace_id=eq." + enc(workspaceId) + "&order=created_at.desc&limit=50");
      send(res, 200, { runs }); return true;
    }
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
      if (p[6] && p[7] === "review" && ["GET", "POST"].includes(method)) {
        const access = await requireAccess(workspaceId, user, method === "POST" ? "owner" : "viewer");
        const missionId = p[6];
        const found = await db<any[]>("afe_agent_missions?id=eq." + enc(missionId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
        const mission = found[0];
        if (!mission) throw fail("Mission introuvable dans cet espace.", 404);
        if (method === "GET") {
          const [events, tasks, approvals] = await Promise.all([
            db<any[]>("afe_agent_events?workspace_id=eq." + enc(workspaceId) + "&mission_id=eq." + enc(missionId) + "&order=created_at.asc&limit=300"),
            db<any[]>("afe_operational_tasks?workspace_id=eq." + enc(workspaceId) + "&mission_id=eq." + enc(missionId) + "&order=created_at.asc&limit=500"),
            db<any[]>("afe_agent_approvals?workspace_id=eq." + enc(workspaceId) + "&mission_id=eq." + enc(missionId) + "&order=created_at.desc&limit=100")
          ]);
          const reviewEvents = events.filter(e => ["mission.evidence.reviewed", "mission.evidence.review.invalidated", "mission.awaiting_coo_validation", "mission.deliverables.submitted", "coo.mission.revision_requested", "coo.mission.human_decision"].includes(e.event_type));
          const latestReviewEvent = [...reviewEvents].reverse().find(e => ["mission.evidence.reviewed", "mission.evidence.review.invalidated"].includes(e.event_type));
          const latestReview = latestReviewEvent?.payload ?? null;
          send(res, 200, { mission, tasks, events: reviewEvents, approvals, independentReview: latestReview, humanDecision: [...reviewEvents].reverse().find(e => e.event_type === "coo.mission.human_decision")?.payload ?? null, canValidate: access.role === "owner" }); return true;
        }
        const input = await readBody(req), action = clean(input.action, 40), note = clean(input.note, 3000);
        const events = await db<any[]>("afe_agent_events?workspace_id=eq." + enc(workspaceId) + "&mission_id=eq." + enc(missionId) + "&event_type=in.(mission.evidence.reviewed,mission.evidence.review.invalidated)&order=created_at.desc&limit=1");
        const independentReview = events[0]?.payload ?? null;
        if (action === "request_revision") {
          if (note.length < 8) throw fail("Le motif de reprise doit contenir au moins 8 caractères.");
          const context = { ...(mission.input_context ?? {}), cooRevisionRequest: { note, requestedBy: user.id, requestedAt: nowIso() } };
          const priorResult = mission.result ?? {};
          const revisionResult = { ...priorResult, coo_review: { ...(priorResult.coo_review ?? {}), status: "revision_required", closureEligible: false, revisionNote: note, revisionRequestedAt: nowIso(), previousReviewVerdict: independentReview?.verdict ?? "not_available" } };
          await db("afe_agent_missions?id=eq." + enc(missionId) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "queued", blocked_reason: note, input_context: context, result: revisionResult, updated_at: nowIso() }) });
          await db("afe_agent_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ workspace_id: workspaceId, mission_id: missionId, agent_id: mission.agent_id, actor_type: "human", actor_id: user.id, event_type: "coo.mission.revision_requested", payload: { note, previousReview: independentReview?.verdict ?? "not_available" } }) });
          await db("afe_agent_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ workspace_id: workspaceId, mission_id: missionId, agent_id: mission.agent_id, actor_type: "human", actor_id: user.id, event_type: "mission.evidence.review.invalidated", payload: { verdict: "revision_required", reason: note, invalidatesPreviousReview: true } }) });
          await audit(workspaceId, user.id, "coo.mission.revision_requested", "mission", missionId, { note });
          send(res, 200, { ok: true, action, status: "queued" }); return true;
        }
        if (action === "accept_closure") {
          if (independentReview?.verdict !== "accepted") throw fail("Clôture refusée : le contrôle indépendant n'a pas rendu un verdict accepted.", 409);
          const result = mission.result ?? {};
          const taskResults = Array.isArray(result.task_results) ? result.task_results : [];
          const operationalTasks = await db<any[]>("afe_operational_tasks?workspace_id=eq." + enc(workspaceId) + "&mission_id=eq." + enc(missionId) + "&select=id,status");
          if (operationalTasks.some((task: any) => task.status !== "done")) throw fail("Clôture refusée : une ou plusieurs tâches opérationnelles ne sont pas au statut terminé.", 409);
          const expected = Array.isArray(mission.input_context?.cooTasks) ? mission.input_context.cooTasks : [];
          const expectedIds = new Set(expected.map((t: any) => String(t.id)));
          const completed = taskResults.filter((t: any) => t.status === "done" && Number(t.progressPercent) === 100 && clean(t.deliverable, 4000).length >= 20);
          if (expectedIds.size !== completed.length || [...expectedIds].some(id => !completed.some((t: any) => String(t.taskId) === id))) throw fail("Clôture refusée : toutes les tâches attendues doivent être terminées à 100 % avec un livrable concret.", 409);
          if (!Array.isArray(result.deliverables) || result.deliverables.length < 1) throw fail("Clôture refusée : aucun livrable de mission n'est enregistré.", 409);
          const decision = { status: "accepted", decidedBy: user.id, decidedAt: nowIso(), reviewerVerdict: independentReview.verdict, closureEligible: true, note };
          await db("afe_agent_missions?id=eq." + enc(missionId) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "completed", progress_percent: 100, blocked_reason: null, result: { ...result, coo_review: decision }, updated_at: nowIso() }) });
          await db("afe_agent_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ workspace_id: workspaceId, mission_id: missionId, agent_id: mission.agent_id, actor_type: "human", actor_id: user.id, event_type: "coo.mission.human_decision", payload: decision }) });
          await audit(workspaceId, user.id, "coo.mission.accepted", "mission", missionId, { reviewerVerdict: independentReview.verdict });
          send(res, 200, { ok: true, action, status: "completed", decision }); return true;
        }
        throw fail("Action de contrôle inconnue.", 400);
      }
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
      await ensureDepartments(workspaceId, user.id);
      const s = await settings(workspaceId, a.workspace.owner_id);
      if (method === "GET") { const members = await db<any[]>("debate_workspace_members?workspace_id=eq." + enc(workspaceId) + "&order=created_at.asc"); send(res, 200, { settings: s, members: members.map(x => ({ user_id: x.user_id, role: x.role })) }); return true; }
      if (method === "PATCH") {
        if (a.role !== "owner") throw fail("Seul le propriétaire de l'espace, représentant la Direction générale, peut désigner le COO et modifier le reporting.", 403);
        const i = await readBody(req), patch: Record<string, unknown> = { updated_at: nowIso() };
        if (i.cooAgentId !== undefined) {
          const aid = clean(i.cooAgentId, 64);
          let selected: any = null;
          if (aid) {
            const found = await db<any[]>("afe_agents?id=eq." + enc(aid) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
            selected = found[0];
            if (!selected || selected.slug !== "afe-ci-coo" || selected.status !== "active") throw fail("Seul l'agent COO dédié et actif peut être désigné.", 400);
            patch.coo_agent_id = aid;
            patch.coo_user_id = null;
          } else {
            patch.coo_agent_id = null;
            patch.coo_enabled = false;
          }
        }
        if (i.cooEnabled !== undefined) {
          if (Boolean(i.cooEnabled) && !clean(i.cooAgentId, 64) && !s.coo_agent_id) throw fail("Désignez d'abord l'agent COO IA.", 400);
          patch.coo_enabled = Boolean(i.cooEnabled);
        }
        if (i.cooAutonomyLevel !== undefined) {
          const level = Number(i.cooAutonomyLevel);
          if (level !== 1 && level !== 2) throw fail("Le niveau 3 reste verrouillé jusqu'à validation de la recette de sécurité.", 400);
          patch.coo_autonomy_level = level;
        }
        if (i.cooKillSwitch !== undefined) patch.coo_kill_switch = Boolean(i.cooKillSwitch);
        if (i.dailyReportEnabled !== undefined) patch.daily_report_enabled = Boolean(i.dailyReportEnabled);
        const rows = await db<any[]>("afe_coo_settings?workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
        if (i.cooAgentId !== undefined) {
          const cooDept = await db<any[]>("afe_org_departments?workspace_id=eq." + enc(workspaceId) + "&slug=eq.direction-operations&limit=1");
          if (cooDept[0]) await db("afe_org_departments?id=eq." + enc(cooDept[0].id) + "&workspace_id=eq." + enc(workspaceId), {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ director_user_id: null, director_agent_id: i.cooAgentId || null, updated_at: nowIso() })
          });
          if (i.cooAgentId) await db("afe_agents?id=eq." + enc(i.cooAgentId) + "&workspace_id=eq." + enc(workspaceId), {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ autonomy_level: Number(i.cooAutonomyLevel ?? s.coo_autonomy_level ?? 1), department_id: cooDept[0]?.id ?? null, updated_at: nowIso() })
          });
        }
        if (i.cooAutonomyLevel === 2 && s.coo_agent_id) await db("afe_agents?id=eq." + enc(s.coo_agent_id) + "&workspace_id=eq." + enc(workspaceId), {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ autonomy_level: 2, updated_at: nowIso() })
        });
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
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script><script src="https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"></script>
<script>
const $=id=>document.getElementById(id),arr=x=>Array.isArray(x)?x:[],esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function session(){try{return JSON.parse(localStorage.getItem("afe-v09-session")||"null")}catch{return null}}
let wid="",role="viewer",tab="overview",cache={};
function message(t,error){$("message").textContent=t;$("message").className=error?"notice error":"notice"}
function loginPrompt(text){message(text,true);$("message").innerHTML='Authentification requise. <a href="/team?return=%2Fcoo" style="font-weight:700">Se connecter à AFE-CI puis revenir au COO ↗</a>';}
async function api(path,options){const s=session();if(!s?.access_token){loginPrompt("Authentification requise.");throw Error("Connectez-vous depuis Équipe & Gouvernance.");}const r=await fetch(path,{...(options||{}),headers:{Authorization:"Bearer "+s.access_token,"Content-Type":"application/json",...((options&&options.headers)||{})}});const raw=await r.text();let d={};try{d=JSON.parse(raw||"{}")}catch{}if(r.status===401){localStorage.removeItem("afe-v09-session");loginPrompt("Session expirée.");}if(!r.ok)throw Error(d.error||"Erreur serveur "+r.status);return d}
const base=()=>"/team/api/workspaces/"+encodeURIComponent(wid)+"/coo/";
const metric=(label,value)=>'<div class="metric"><b>'+esc(value??"—")+'</b><span class="small">'+esc(label)+'</span></div>';
const date=v=>v?new Date(v).toLocaleString("fr-FR"):"—";
const statusLabel=s=>({queued:"En attente",planning:"Planification",running:"En cours",waiting_approval:"Validation requise",paused:"Suspendue",completed:"Terminée",failed:"Échec",cancelled:"Annulée",todo:"À faire",in_progress:"En cours",blocked:"Bloquée",done:"Terminée",open:"Ouverte",acknowledged:"Prise en charge",resolved:"Résolue"}[s]||s||"—");
async function loadWorkspaceList(){const data=await api("/team/api/workspaces");const spaces=arr(data);$("spaces").innerHTML=spaces.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+' · '+esc(x.role)+'</option>').join("")||'<option value="">Aucun espace</option>';if(!wid&&spaces.length)wid=spaces[0].id;if(wid)$("spaces").value=wid;if(!wid){message("Aucun espace disponible. Créez-en un depuis Équipe & Gouvernance.",true);return}await render()}
async function loadCommon(){const [dash,agents,members]=await Promise.all([api(base()+"dashboard"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members")]);cache={...dash,agents:arr(agents.agents),members:arr(members)};return cache}
function renderOverview(d){
 const x=d.dashboard.indicators,alerts=arr(d.dashboard.priorityAlerts),risks=arr(d.dashboard.missionsAtRisk);
 return '<section class="card"><h2>Situation opérationnelle</h2><div class="grid">'+metric("Missions actives",x.activeMissions)+metric("Missions terminées",x.completedMissions)+metric("Missions en retard",x.overdueMissions)+metric("Missions bloquées",x.blockedMissions)+metric("Tâches ouvertes",x.openTasks)+metric("Tâches bloquées",x.blockedTasks)+metric("Tâches en retard",x.overdueTasks)+metric("Alertes ouvertes",x.openAlerts)+metric("Alertes critiques",x.criticalAlerts)+metric("Validations humaines en attente",x.pendingHumanApprovals)+'</div><p class="small">Actualisé : '+date(d.dashboard.generatedAt)+'</p></section><section class="card"><h2>Performance par direction</h2>'+arr(d.dashboard.departmentPerformance).map(q=>'<div class="row"><div><strong>'+esc(q.name)+'</strong><span class="small">'+q.missionCount+' mission(s) · '+q.openTasks+' tâche(s) ouverte(s) · '+q.blockedTasks+' bloquée(s)</span></div><span class="tag">'+(q.taskCompletionRate===null?"Pas encore de données":q.taskCompletionRate+" % tâches terminées")+'</span></div>').join("")+'</section><section class="card"><h2>Alertes prioritaires</h2>'+(alerts.length?alerts.map(a=>'<div class="row"><div><strong>'+esc(a.title)+'</strong><span class="small">'+esc(a.description)+' · '+date(a.created_at)+'</span></div><span class="tag '+esc(a.severity)+'">'+esc(a.severity)+'</span></div>').join(""):'<div class="empty">Aucune alerte prioritaire.</div>')+'</section><section class="card"><h2>Missions à risque</h2>'+(risks.length?risks.map(m=>'<div class="row"><div><strong>'+esc(m.title)+'</strong><span class="small">'+esc(m.department_name)+' · '+esc(statusLabel(m.status))+' · échéance '+date(m.due_at)+'</span></div><span class="tag">'+esc(m.priority)+'</span></div>').join(""):'<div class="empty">Aucune mission à risque.</div>')+'</section>';
}
async function renderMissionReview(missionId){
 const d=await api(base()+"missions/"+encodeURIComponent(missionId)+"/review"),m=d.mission||{},result=m.result||{},review=d.independentReview||{},findings=arr(review.findings),tasks=arr(d.tasks),events=arr(d.events),approvals=arr(d.approvals),canValidate=Boolean(d.canValidate);
 const reviewLabel=review.verdict==="accepted"?"Contrôle indépendant accepté":review.verdict==="revision_required"?"Corrections requises":review.verdict==="rejected"?"Contrôle rejeté":"Aucun rapport de revue";
 const qualityCards=arr(review.qualityChecks).map(q=>'<div class="row"><div><strong>'+esc(q.criterion)+'</strong><span class="small">'+esc(q.detail)+'</span></div><span class="tag '+(q.passed?"":"warning")+'">'+(q.passed?"Conforme":"À corriger")+'</span></div>').join("")||'<div class="empty">Aucune évaluation qualitative archivée.</div>';
 const taskCards=tasks.map(t=>'<div class="row"><div><strong>'+esc(t.title)+'</strong><span class="small">'+esc(statusLabel(t.status))+' · '+esc(t.progress_percent??0)+' %</span>'+(t.blocked_reason?'<p class="small">'+esc(t.blocked_reason)+'</p>':'')+'</div><span class="tag">'+esc(t.priority??"—")+'</span></div>').join("")||'<div class="empty">Aucune tâche opérationnelle liée.</div>';
 const findingCards=findings.map(f=>'<div class="row"><div><strong>'+esc(f.code||"Constat")+'</strong><span class="small">'+esc(f.message||f.description||"Anomalie signalée par le contrôle indépendant.")+'</span></div><span class="tag '+(f.severity==="blocking"?"critical":"warning")+'">'+esc(f.severity||"constat")+'</span></div>').join("")||'<div class="notice">Aucune anomalie structurelle signalée. Cela ne vaut pas validation humaine.</div>';
 const eventCards=events.slice().reverse().map(e=>'<div class="row"><div><strong>'+esc(e.event_type)+'</strong><span class="small">'+date(e.created_at)+' · '+esc(e.actor_type||"système")+'</span><pre>'+esc(JSON.stringify(e.payload||{},null,2))+'</pre></div></div>').join("")||'<div class="empty">Aucun événement de contrôle archivé.</div>';
 const deliverables=arr(result.deliverables),taskResults=arr(result.task_results);
 $("view").innerHTML='<section class="card"><div class="actions" style="justify-content:space-between"><div><h2>'+esc(m.title||"Dossier de mission")+'</h2><span class="small">'+esc(m.department_name||"Direction non renseignée")+' · '+esc(m.agent_name||"Agent non renseigné")+' · '+esc(statusLabel(m.status))+'</span></div><button class="btn" id="backToMissions">← Retour au portefeuille</button></div><div class="grid" style="margin-top:12px">'+metric("Progression",String(m.progress_percent??0)+" %")+metric("État opérationnel",statusLabel(m.status))+metric("État du contrôle",reviewLabel)+metric("Validations en attente",approvals.filter(a=>a.status==="pending").length)+'</div>'+(m.blocked_reason?'<div class="notice error">'+esc(m.blocked_reason)+'</div>':'')+'</section><section class="card"><h2>1. Soumission de l’agent</h2><h3>Synthèse</h3><p>'+esc(result.summary||"Aucune synthèse enregistrée.")+'</p><h3>Analyse</h3><pre>'+esc(result.analysis||"Aucune analyse enregistrée.")+'</pre><h3>Livrables de mission</h3>'+(deliverables.length?deliverables.map((x,i)=>'<div class="row"><strong>Livrable '+(i+1)+'</strong><pre>'+esc(x)+'</pre></div>').join(""):'<div class="empty">Aucun livrable de mission.</div>')+'<h3>Résultats par tâche</h3>'+taskResults.map(t=>'<div class="row"><div><strong>'+esc(t.taskId||"Tâche")+' · '+esc(statusLabel(t.status))+'</strong><span class="small">'+esc(t.progressPercent??0)+' %</span><pre>'+esc(t.deliverable||t.summary||"Aucun livrable de tâche.")+'</pre></div></div>').join("")+'</section><section class="card"><h2>2. Revue indépendante</h2><div class="notice '+(review.verdict==="rejected"?"error":"")+'"><strong>'+esc(reviewLabel)+'</strong><p class="small">Contrôleur : '+esc(review.reviewerType||review.reviewerAgentId||"Non renseigné")+' · Le contrôleur ne décide jamais de la clôture.</p></div>'+'<div class="grid">'+metric("Score qualité",review.qualityScore===undefined?"—":review.qualityScore+" / 100")+metric("Contrôles qualité",arr(review.qualityChecks).filter(q=>q.passed).length+" / "+arr(review.qualityChecks).length)+'</div><h3>Grille de qualité</h3>'+qualityCards+'<h3>Anomalies et demandes de correction</h3>'+findingCards+'</section><section class="card"><h2>3. Tâches opérationnelles</h2>'+taskCards+'</section><section class="card"><h2>4. Historique de contrôle et validations</h2>'+eventCards+(approvals.length?approvals.map(a=>'<div class="row"><div><strong>Validation '+esc(a.action_key||a.id)+'</strong><span class="small">'+esc(a.status)+' · '+date(a.created_at)+'</span></div><span class="tag">'+esc(a.risk_level||"—")+'</span></div>').join(""):'')+'</section>'+(canValidate&&m.status!=="completed"?'<section class="card"><h2>5. Décision de la Direction générale</h2><p class="small">La clôture est réservée au propriétaire de l’espace. Elle exige un verdict indépendant accepté et toutes les tâches attendues terminées à 100 % avec leurs livrables.</p><label for="reviewNote">Motif ou instruction de reprise</label><textarea class="field" id="reviewNote" rows="3" placeholder="Décrire précisément les corrections attendues si nécessaire."></textarea><div class="actions"><button class="btn danger" id="requestRevision">Demander une correction et relancer</button><button class="btn primary" id="acceptClosure" '+(review.verdict==="accepted"?"":"disabled")+'>Valider et clôturer la mission</button></div></section>':'');
 $("backToMissions").onclick=()=>renderMissions();
 const revision=$("requestRevision");if(revision)revision.onclick=async()=>{const note=$("reviewNote").value.trim();if(note.length<8){message("Précisez les corrections attendues (8 caractères minimum).",true);return;}revision.disabled=true;try{await api(base()+"missions/"+encodeURIComponent(missionId)+"/review",{method:"POST",body:JSON.stringify({action:"request_revision",note})});message("Demande de correction enregistrée ; mission remise en file d’exécution.");await renderMissions()}catch(e){message(e.message,true)}finally{revision.disabled=false}};
 const accept=$("acceptClosure");if(accept)accept.onclick=async()=>{accept.disabled=true;try{await api(base()+"missions/"+encodeURIComponent(missionId)+"/review",{method:"POST",body:JSON.stringify({action:"accept_closure",note:$("reviewNote").value.trim()})});message("Mission validée et clôturée après contrôle indépendant.");await renderMissions()}catch(e){message(e.message,true);accept.disabled=false}};
}
async function renderMissions(){
 const [m,agents,dep,members]=await Promise.all([api(base()+"missions"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents"),api(base()+"departments"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members")]);
 const missions=arr(m.missions),activeAgents=arr(agents.agents).filter(a=>a.status==="active"),departments=arr(dep.departments).filter(d=>d.active&&!d.is_independent&&!d.human_only),reviewPending=missions.filter(x=>x.result?.coo_review?.status==="pending"),revisionRequired=missions.filter(x=>x.result?.coo_review?.status==="revision_required"),independentAccepted=missions.filter(x=>x.result?.coo_review?.independentReview?.verdict==="accepted"),reviewFindings=missions.reduce((n,x)=>n+arr(x.result?.coo_review?.independentReview?.findings).length,0);
 $("view").innerHTML='<section class="card"><h2>Instruction directe au COO IA</h2><p class="small">La Direction générale transmet un objectif. Le COO consulte les directeurs IA disponibles, prépare les chantiers et crée les missions et tâches dans la file durable. Les demandes nécessitant une décision réservée restent en attente d’approbation humaine.</p><textarea class="field" id="cooInstruction" rows="4" maxlength="12000" placeholder="Ex. COO, organise un diagnostic transversal de la gouvernance et des risques, fais intervenir les directions concernées et présente-moi un rapport consolidé."></textarea><p><button class="btn primary" id="cooRun">Transmettre l’instruction au COO IA</button></p><div id="cooRunResult" class="small"></div></section><section class="card"><h2>Enregistrer une mission manuellement</h2><div class="form"><div><label>Direction responsable</label><select class="field" id="missionDepartment">'+departments.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>').join("")+'</select></div><div><label>Agent responsable</label><select class="field" id="missionAgent"></select></div><div><label>Responsable opérationnel</label><select class="field" id="missionOwner"><option value="">Non désigné</option>'+arr(members).filter(x=>["owner","admin","editor"].includes(x.role)).map(x=>'<option value="'+esc(x.user_id)+'">'+esc(x.profile?.full_name||x.profile?.email||x.user_id)+'</option>').join("")+'</select></div><div><label>Priorité (1 = très haute)</label><select class="field" id="missionPriority"><option value="1">1 · Critique</option><option value="2">2 · Haute</option><option value="3" selected>3 · Normale</option><option value="4">4 · Basse</option><option value="5">5 · Très basse</option></select></div><div class="wide"><label>Intitulé</label><input class="field" id="missionTitle" maxlength="220" placeholder="Ex. Diagnostic global des risques opérationnels"></div><div class="wide"><label>Objectif et livrables attendus</label><textarea class="field" id="missionObjective" rows="3" placeholder="Définir le résultat, le périmètre, les critères de réussite et les livrables."></textarea></div><div><label>Échéance</label><input class="field" id="missionDue" type="datetime-local"></div></div><p><button class="btn primary" id="missionCreate" '+(activeAgents.length?"":"disabled") +'>Créer la mission</button></p><p class="small">La mission est enregistrée dans la file durable existante. Son exécution dépend du worker et de l’activation de l’agent. Le COO ne peut pas créer de mission d’arbitrage ni de validation humaine.</p></section><section class="card"><div class="row" style="align-items:center;justify-content:space-between;gap:12px"><h2 style="margin:0">Portefeuille ('+missions.length+')</h2><button class="btn" type="button" id="copyCooPortfolio" aria-label="Copier tous les résultats du portefeuille" title="Copier tous les résultats du portefeuille">⧉ <span>Copier</span></button></div><div class="grid" style="margin:12px 0">'+metric("Soumises à validation",reviewPending.length)+metric("Corrections demandées",revisionRequired.length)+metric("Revues acceptées",independentAccepted.length)+metric("Anomalies relevées",reviewFindings)+'</div><p class="small">Lancement contrôlé du worker : une mission par appel, avec suivi du résultat et arrêt automatique lorsqu’aucune mission n’est éligible. Une mission soumise reste suspendue jusqu’à la décision de contrôle. Réservé à la Preview et à la Direction générale.</p><p><button class="btn primary" id="cooExecute" '+(missions.some(m=>m.status==="queued"||m.status==="planning"||m.status==="running")?"":"disabled") +'>Démarrer l’exécution des missions en attente</button></p><div id="cooExecutionResult" class="small"></div>'+(missions.length?missions.map(m=>'<div class="row"><div style="flex:1"><strong>'+esc(m.title)+'</strong><span class="small">'+esc(m.department_name)+' · '+esc(m.agent_name)+' · '+esc(m.result?.coo_review?.status==="pending"?"Livrables soumis — validation COO requise":statusLabel(m.status))+' · '+date(m.due_at)+'</span><div class="small">Progression : '+esc(m.progress_percent||0)+' %</div>'+(m.result?.summary?'<div class="small" style="margin-top:7px"><strong>Compte rendu de l’agent :</strong> '+esc(m.result.summary)+'</div>':'')+(Array.isArray(m.result?.deliverables)&&m.result.deliverables.length?'<div class="small">Livrables : '+esc(m.result.deliverables.join(" · "))+'</div>':'')+(m.result?.coo_review?.independentReview?'<div class="small">Revue indépendante : '+esc(m.result.coo_review.independentReview.verdict)+' · '+arr(m.result.coo_review.independentReview.findings).length+' anomalie(s) · clôture : '+(m.result.coo_review.closureEligible?"autorisée":"non autorisée")+'</div>':'')+(m.result?.coo_review?.status==="revision_required"?'<div class="small" style="color:#d97706">Correction demandée : '+esc(m.result.coo_review.revisionNote||m.blocked_reason||"Voir le dossier de contrôle")+'</div>':'')+(m.blocked_reason?'<div class="small" style="color:#a33">Blocage : '+esc(m.blocked_reason)+'</div>':'')+'</div><div class="actions"><button class="btn" data-review-mission="'+esc(m.id)+'">Dossier de contrôle</button><input class="field" type="number" min="0" max="100" style="width:82px" data-mission-progress="'+esc(m.id)+'" value="'+esc(m.progress_percent||0)+'"><button class="btn" data-save-mission="'+esc(m.id)+'">Maj %</button><span class="tag '+(m.status==="failed"?"critical":"")+'">P'+esc(m.priority)+'</span></div></div>').join(""):'<div class="empty">Aucune mission enregistrée.</div>')+'</section>';
 $("copyCooPortfolio").onclick=async()=>{const button=$("copyCooPortfolio");const lines=["AFE-CI — PORTEFEUILLE DES MISSIONS","Nombre de missions : "+missions.length,"Date d'export : "+new Date().toLocaleString("fr-FR"),""];missions.forEach((m,index)=>{lines.push("MISSION "+(index+1)+" — "+String(m.title||"Sans titre"),"Direction : "+String(m.department_name||"Non renseignée"),"Agent responsable : "+String(m.agent_name||"Non affecté"),"Statut : "+String(statusLabel(m.status)||"Non renseigné"),"Priorité : P"+String(m.priority??"—"),"Progression : "+String(m.progress_percent??0)+" %","Échéance : "+String(date(m.due_at)||"Non renseignée"));if(m.objective)lines.push("Objectif : "+String(m.objective));if(m.result?.summary)lines.push("Compte rendu de l'agent : "+String(m.result.summary));if(Array.isArray(m.result?.deliverables)&&m.result.deliverables.length)lines.push("Livrables : "+m.result.deliverables.join(" · "));if(m.blocked_reason)lines.push("Blocage : "+String(m.blocked_reason));lines.push("","—".repeat(48),"");});const textValue=lines.join("\n");button.disabled=true;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(textValue);}else{const ta=document.createElement("textarea");ta.value=textValue;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();if(!ok)throw Error("Copie indisponible sur cet appareil.");}button.innerHTML="✓ <span>Copié</span>";message("Les "+missions.length+" mission(s) et leurs résultats ont été copiés intégralement.");}catch(e){message("Impossible de copier le portefeuille : "+e.message,true);}finally{button.disabled=false;setTimeout(()=>{if(button.isConnected)button.innerHTML="⧉ <span>Copier</span>";},2200);}};
 $("cooExecute").onclick=async()=>{const b=$("cooExecute"),out=$("cooExecutionResult");b.disabled=true;b.textContent="Exécution en cours…";out.textContent="Le worker prend en charge les missions éligibles. Cette opération peut prendre plusieurs minutes.";const results=[];try{for(let i=0;i<5;i++){const r=await api(base()+"execute-next",{method:"POST",body:"{}"});results.push(r);if(!r.claimed)break;if(r.completed===false&&r.paused)continue;if(r.completed===false&&r.retryScheduled)continue;}const completed=results.filter(x=>x.completed).length,claimed=results.filter(x=>x.claimed).length,paused=results.filter(x=>x.paused).length;out.textContent=claimed+" mission(s) prise(s) en charge · "+completed+" terminée(s) avec résultat · "+paused+" suspendue(s) pour tâches incomplètes. "+(claimed<5?"Aucune autre mission éligible détectée ou limite de traitement atteinte.":"Limite de sécurité de 5 missions par vague atteinte.");message("Vague d’exécution terminée. Consultez les résultats mission par mission.");await render()}catch(e){out.textContent="Exécution interrompue : "+e.message;message(e.message,true)}finally{b.disabled=false;b.textContent="Démarrer l’exécution des missions en attente"}};
 $("cooRun").onclick=async()=>{const instruction=$("cooInstruction").value.trim();if(instruction.length<10){message("Décris un objectif suffisamment précis.",true);return}const b=$("cooRun");b.disabled=true;b.textContent="Le COO analyse et planifie…";try{const r=await api(base()+"orchestrate",{method:"POST",body:JSON.stringify({instruction})});const dispatched=arr(r.dispatched);$("cooRunResult").textContent=r.run?.status==="approval_required"?"Plan soumis à décision humaine : "+arr(r.plan?.decisionsRequired).join(" · "):"Plan créé : "+dispatched.length+" mission(s), "+dispatched.reduce((n,x)=>n+Number(x.taskCount||0),0)+" tâche(s) distribuée(s).";message("Instruction traitée par le COO IA.");await render()}catch(e){message(e.message,true)}finally{b.disabled=false;b.textContent="Transmettre l’instruction au COO IA"}};
 function updateAgents(){const dept=$("missionDepartment").value;const choices=activeAgents.filter(a=>!a.department_id||a.department_id===dept);$("missionAgent").innerHTML=choices.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join("");$("missionCreate").disabled=choices.length===0}
 $("missionDepartment").onchange=updateAgents;updateAgents();
 $("missionCreate").onclick=async()=>{try{const d=await api(base()+"missions",{method:"POST",body:JSON.stringify({departmentId:$("missionDepartment").value,agentId:$("missionAgent").value,operationalOwnerUserId:$("missionOwner").value||null,title:$("missionTitle").value,objective:$("missionObjective").value,priority:Number($("missionPriority").value),dueAt:$("missionDue").value?new Date($("missionDue").value).toISOString():null})});message("Mission créée dans le portefeuille : "+d.mission.id);await render()}catch(e){message(e.message,true)}};
 $("view").querySelectorAll("[data-review-mission]").forEach(b=>b.onclick=()=>renderMissionReview(b.dataset.reviewMission).catch(e=>message(e.message,true)));
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
  const directors=(x.slug==="direction-generale"?"Direction générale · propriétaire de l’espace":x.slug==="direction-operations"?(st.settings.coo_agent_id?agentName(st.settings.coo_agent_id):"COO IA non désigné"):[x.director_user_id?userName(x.director_user_id):null,x.director_agent_id?agentName(x.director_agent_id):null].filter(Boolean).join(" · ")||"Non désigné");
  const userOptions=members.map(q=>'<option value="'+esc(q.user_id)+'" '+(x.director_user_id===q.user_id?"selected":"")+'>'+esc(q.profile?.display_name||q.profile?.full_name||q.profile?.email||q.user_id)+'</option>').join("");
  const agentOptions=agents.filter(q=>!q.department_id||q.department_id===x.id).map(q=>'<option value="'+esc(q.id)+'" '+(x.director_agent_id===q.id?"selected":"")+'>'+esc(q.name)+'</option>').join("");
  return '<div class="row"><div style="flex:1"><strong>'+esc(x.name)+'</strong><span class="small">'+esc(x.department_kind)+' · rattachement : '+esc(x.reports_to_slug||"indépendant / Direction générale")+' · '+(x.is_independent?"fonction indépendante":"fonction opérationnelle")+'</span><p class="small">Responsable : '+esc(directors)+'</p>'+(editable?'<textarea class="field" rows="2" data-mandate="'+esc(x.id)+'">'+esc(x.mandate)+'</textarea>'+(ownerOnly?'':'<div class="form"><div><label>Responsable humain</label><select class="field" data-director-user="'+esc(x.id)+'"><option value="">Non désigné</option>'+userOptions+'</select></div><div><label>Agent directeur</label><select class="field" data-director-agent="'+esc(x.id)+'"><option value="">Non désigné</option>'+agentOptions+'</select></div></div>'):'<p class="small">'+esc(x.mandate)+'</p>')+'</div><div class="actions"><span class="tag">'+(x.active?"Active":"Inactive")+'</span>'+(editable?'<button class="btn" data-save-dept="'+esc(x.id)+'">Enregistrer</button>'+(ownerOnly?'':'<button class="btn" data-toggle-dept="'+esc(x.id)+'">'+(x.active?"Désactiver":"Activer")+'</button>') :ownerOnly&&role!=="owner"?'<span class="small">Gérée par la Direction générale</span>':'<span class="small">Protégée</span>')+'</div></div>';
 }).join("")+'</section>';
 $("view").querySelectorAll("[data-save-dept]").forEach(b=>b.onclick=async()=>{try{const id=b.dataset.saveDept,payload={mandate:$("view").querySelector('[data-mandate="'+id+'"]').value};const du=$("view").querySelector('[data-director-user="'+id+'"]'),da=$("view").querySelector('[data-director-agent="'+id+'"]');if(du)payload.directorUserId=du.value||null;if(da)payload.directorAgentId=da.value||null;await api(base()+"departments/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(payload)});message("Direction et responsables mis à jour.");await render()}catch(e){message(e.message,true)}});
 $("view").querySelectorAll("[data-toggle-dept]").forEach(b=>b.onclick=async()=>{try{const d=items.find(x=>x.id===b.dataset.toggleDept);await api(base()+"departments/"+encodeURIComponent(d.id),{method:"PATCH",body:JSON.stringify({active:!d.active})});await render()}catch(e){message(e.message,true)}});
}
async function renderTasks(){const [t,m,a,d,mem]=await Promise.all([api(base()+"tasks"),api(base()+"missions"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents"),api(base()+"departments"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members")]);const departments=arr(d.departments).filter(x=>x.active&&!x.is_independent&&!x.human_only),agents=arr(a.agents).filter(x=>x.status==="active");$("view").innerHTML='<section class="card"><h2>Nouvelle tâche et attribution</h2><div class="form"><div><label>Direction</label><select class="field" id="taskDepartment">'+departments.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("")+'</select></div><div><label>Mission associée</label><select class="field" id="taskMission"><option value="">Aucune</option>'+arr(m.missions).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+'</option>').join("")+'</select></div><div><label>Agent responsable</label><select class="field" id="taskAgent"><option value="">Non affecté</option>'+agents.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("")+'</select></div><div><label>Collaborateur responsable</label><select class="field" id="taskUser"><option value="">Non affecté</option>'+arr(mem).filter(x=>["owner","admin","editor"].includes(x.role)).map(x=>'<option value="'+esc(x.user_id)+'">'+esc(x.profile?.full_name||x.profile?.email||x.user_id)+'</option>').join("")+'</select></div><div class="wide"><label>Intitulé</label><input class="field" id="taskTitle" placeholder="Travail à réaliser"></div><div class="wide"><label>Description / critères de réalisation</label><textarea class="field" id="taskDescription" rows="2"></textarea></div><div><label>Priorité</label><select class="field" id="taskPriority"><option value="1">1 · Critique</option><option value="2">2 · Haute</option><option value="3" selected>3 · Normale</option><option value="4">4 · Basse</option><option value="5">5 · Très basse</option></select></div><div><label>Échéance</label><input class="field" id="taskDue" type="datetime-local"></div></div><p><button class="btn primary" id="taskCreate">Attribuer la tâche</button></p></section><section class="card"><h2>Suivi des tâches</h2>'+arr(t.tasks).map(x=>'<div class="row"><div><strong>'+esc(x.title)+'</strong><span class="small">'+esc(x.department_name)+' · '+esc(x.assigned_agent_name||"Sans agent")+' · '+esc(statusLabel(x.status))+' · '+esc(x.progress_percent)+' % · '+date(x.due_at)+'</span></div><select class="field" style="max-width:150px" data-task="'+esc(x.id)+'"><option value="todo" '+(x.status==="todo"?"selected":"")+'>À faire</option><option value="in_progress" '+(x.status==="in_progress"?"selected":"")+'>En cours</option><option value="blocked" '+(x.status==="blocked"?"selected":"")+'>Bloquée</option><option value="done" '+(x.status==="done"?"selected":"")+'>Terminée</option><option value="cancelled" '+(x.status==="cancelled"?"selected":"")+'>Annulée</option></select></div>').join("")||'<div class="empty">Aucune tâche.</div>'+'</section>';function updateTaskChoices(){const departmentId=$("taskDepartment").value;const validAgents=agents.filter(x=>!x.department_id||x.department_id===departmentId);$("taskAgent").innerHTML='<option value="">Non affecté</option>'+validAgents.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");const validMissions=arr(m.missions).filter(x=>x.department_id===departmentId);$("taskMission").innerHTML='<option value="">Aucune</option>'+validMissions.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+'</option>').join("")}
$("taskDepartment").onchange=updateTaskChoices;updateTaskChoices();
$("taskCreate").onclick=async()=>{try{await api(base()+"tasks",{method:"POST",body:JSON.stringify({departmentId:$("taskDepartment").value,missionId:$("taskMission").value||null,assignedAgentId:$("taskAgent").value||null,assignedUserId:$("taskUser").value||null,title:$("taskTitle").value,description:$("taskDescription").value,priority:Number($("taskPriority").value),dueAt:$("taskDue").value?new Date($("taskDue").value).toISOString():null})});message("Tâche attribuée et journalisée.");await render()}catch(e){message(e.message,true)}};$("view").querySelectorAll("[data-task]").forEach(el=>el.onchange=async()=>{try{await api(base()+"tasks/"+encodeURIComponent(el.dataset.task),{method:"PATCH",body:JSON.stringify({status:el.value})});message("Statut de tâche mis à jour.");await render()}catch(e){message(e.message,true)}})}
async function renderAlerts(){const d=await api(base()+"alerts");$("view").innerHTML='<section class="card"><h2>Centre d’alertes</h2>'+arr(d.alerts).filter(x=>x.status!=="resolved").map(x=>'<div class="row"><div><strong>'+esc(x.title)+'</strong><span class="small">'+esc(x.description)+' · '+date(x.created_at)+'</span></div><div class="actions"><span class="tag '+esc(x.severity)+'">'+esc(x.severity)+'</span><button class="btn" data-ack="'+esc(x.id)+'">Prendre en charge</button><button class="btn danger" data-resolve="'+esc(x.id)+'">Résoudre</button></div></div>').join("")||'<div class="empty">Aucune alerte active.</div>'+'</section>';$("view").querySelectorAll("[data-ack],[data-resolve]").forEach(b=>b.onclick=async()=>{try{await api(base()+"alerts/"+encodeURIComponent(b.dataset.ack||b.dataset.resolve),{method:"POST",body:JSON.stringify({action:b.dataset.ack?"acknowledge":"resolve"})});await render()}catch(e){message(e.message,true)}})}
function reportText(report){
 const c=report.report_content||{},i=c.indicators||{},fmt=v=>v==null?"Non renseigné":String(v),pct=v=>v==null?"Non calculable":v+" %";
 const lines=[c.title||report.report_type||"Rapport opérationnel","Période : "+date(c.period?.start||report.period_start)+" → "+date(c.period?.end||report.period_end),"Généré le : "+date(c.generatedAt||report.created_at),"","1. SYNTHÈSE EXÉCUTIVE","Missions : "+fmt(i.totalMissions)+" au total, dont "+fmt(i.activeMissions)+" actives, "+fmt(i.completedMissions)+" terminées, "+fmt(i.failedMissions)+" en échec.","Tâches : "+fmt(i.totalTasks)+" au total, "+fmt(i.openTasks)+" ouvertes, "+fmt(i.blockedTasks)+" bloquées, "+fmt(i.overdueTasks)+" en retard.","Directions actives : "+fmt(i.activeDepartments)+". Alertes ouvertes : "+fmt(i.openAlerts)+", dont "+fmt(i.criticalAlerts)+" critiques.","Validations humaines en attente : "+fmt(i.pendingHumanApprovals),"","2. PERFORMANCE PAR DIRECTION"];
 const depts=arr(c.departmentPerformance);if(!depts.length)lines.push("Aucune donnée de performance par direction n'est disponible.");else depts.forEach(d=>lines.push("- "+d.name+": "+fmt(d.missionCount)+" mission(s), "+fmt(d.completedMissions)+" terminée(s), "+fmt(d.runningMissions)+" en cours; "+fmt(d.taskCount)+" tâche(s), "+fmt(d.openTasks)+" ouverte(s), "+fmt(d.blockedTasks)+" bloquée(s); taux de clôture des missions : "+pct(d.missionClosureRate)+", taux d'achèvement des tâches : "+pct(d.taskCompletionRate)+"."));
 lines.push("","3. MISSIONS À RISQUE");const risks=arr(c.missionsAtRisk);if(!risks.length)lines.push("Aucune mission à risque recensée dans les données du rapport.");else risks.forEach(m=>lines.push("- "+m.title+" — "+statusLabel(m.status)+"; direction : "+(m.department_name||"non renseignée")+"; échéance : "+date(m.due_at)));
 lines.push("","4. ALERTES PRIORITAIRES");const alerts=arr(c.priorityAlerts);if(!alerts.length)lines.push("Aucune alerte prioritaire recensée.");else alerts.forEach(a=>lines.push("- ["+String(a.severity||"information").toUpperCase()+"] "+a.title+" : "+(a.description||"")));
 const decisions=c.decisionsRequired||{};lines.push("","5. DÉCISIONS ET ESCALADES");const approvals=arr(decisions.humanApprovals),escalations=arr(decisions.escalations);lines.push("Approbations humaines : "+approvals.length,"Escalades : "+escalations.length);approvals.forEach(a=>lines.push("- Approbation requise : "+(a.action_key||a.mission_id||a.id)));escalations.forEach(a=>lines.push("- Escalade : "+(a.title||a.description||a.id)));
 lines.push("Missions terminées vérifiées : "+fmt(i.completedVerifiedMissions)+", non vérifiées : "+fmt(i.completedUnverifiedMissions));
 const missionCount=Number(i.totalMissions||0),departmentMissionCount=depts.reduce((n,d)=>n+Number(d.missionCount||0),0),findings=[];
 const quality=c.dataQuality||{};
 if(arr(quality.completedWithoutTasks).length)findings.push(arr(quality.completedWithoutTasks).length+" mission(s) terminée(s) sans tâche opérationnelle associée : exécution non démontrée.");
 if(arr(quality.completedWithIncompleteTasks).length)findings.push(arr(quality.completedWithIncompleteTasks).length+" mission(s) terminée(s) avec des tâches non achevées : clôture incohérente.");
 if(Number(quality.unassignedMissionCount||0)>0)findings.push(Number(quality.unassignedMissionCount)+" mission(s) sans direction identifiable après rapprochement avec le responsable IA.");
 arr(quality.findings).filter((x:string)=>!findings.includes(x)).forEach((x:string)=>findings.push(x));
 if(Number(i.completedMissions||0)>0&&Number(i.totalTasks||0)===0)findings.push("Des missions sont déclarées terminées alors qu'aucune tâche n'est recensée. Leur exécution ne peut pas être confirmée par les données de tâches.");
 if(missionCount!==departmentMissionCount+Number(quality.unassignedMissionCount||0))findings.push("Le total des missions ("+missionCount+") ne se réconcilie pas avec les missions ventilées ("+departmentMissionCount+") et non affectées ("+Number(quality.unassignedMissionCount||0)+").");
 if(depts.some(d=>d.taskCompletionRate==null||d.missionClosureRate==null))findings.push("Certaines directions n'ont pas de volume d'activité permettant de calculer un taux de performance. Une valeur non calculable ne doit pas être interprétée comme 0 %.");
 lines.push("","6. QUALITÉ ET LIMITES DES DONNÉES");if(findings.length)findings.forEach(x=>lines.push("POINT DE VIGILANCE — "+x));else lines.push("Aucune incohérence évidente détectée dans les contrôles automatiques disponibles. Cela ne constitue pas une validation indépendante.");
 lines.push("","7. NOTE DE GOUVERNANCE",c.governanceNote||"Ce rapport décrit l'exécution opérationnelle et ne remplace aucune décision humaine, aucun arbitrage indépendant ni aucun constat technique.","","Fin du rapport.");return lines.join("\n");
}
function reportHtml(report){
 const c=report.report_content||{},i=c.indicators||{},depts=arr(c.departmentPerformance),text=reportText(report);
 const metricCards=[["Missions",i.totalMissions],["Terminées",i.completedMissions],["Actives",i.activeMissions],["Tâches",i.totalTasks],["Tâches ouvertes",i.openTasks],["Alertes",i.openAlerts],["Alertes critiques",i.criticalAlerts],["Validations humaines",i.pendingHumanApprovals]];
 const missionCount=Number(i.totalMissions||0),byDept=depts.reduce((n,d)=>n+Number(d.missionCount||0),0),warnings=[];
 const quality=c.dataQuality||{};
 if(arr(quality.completedWithoutTasks).length)warnings.push(arr(quality.completedWithoutTasks).length+" mission(s) terminée(s) sans tâche associée : exécution non démontrée.");
 if(Number(quality.unassignedMissionCount||0)>0)warnings.push(Number(quality.unassignedMissionCount)+" mission(s) sans direction identifiable.");
 arr(quality.findings).filter((x:string)=>!warnings.includes(x)).forEach((x:string)=>warnings.push(x));
 if(Number(i.completedMissions||0)>0&&Number(i.totalTasks||0)===0)warnings.push("Des missions sont déclarées terminées alors qu'aucune tâche n'est recensée : leur exécution n'est pas démontrée par le suivi des tâches.");
 if(missionCount!==byDept+Number(quality.unassignedMissionCount||0))warnings.push("Ventilation incomplète : "+missionCount+" mission(s) au total contre "+byDept+" affectée(s) et "+Number(quality.unassignedMissionCount||0)+" non affectée(s).");
 if(depts.some(d=>d.taskCompletionRate==null||d.missionClosureRate==null))warnings.push("Certaines directions ne disposent pas d'un volume suffisant pour calculer leurs taux. « Non calculable » ne signifie pas 0 %.");
 return '<section class="card" id="reportDetail"><div class="actions" style="justify-content:space-between"><div><h2 style="margin:0">'+esc(c.title||"Rapport opérationnel")+'</h2><span class="small">Période : '+date(c.period?.start||report.period_start)+' → '+date(c.period?.end||report.period_end)+' · Généré le '+date(c.generatedAt||report.created_at)+'</span></div><div class="actions"><button class="btn" id="copyReport" title="Copier le rapport intégral" aria-label="Copier le rapport intégral">▢ Copier</button><button class="btn" id="downloadPdf" title="Télécharger en PDF" aria-label="Télécharger en PDF">↓ PDF</button><button class="btn" id="downloadWord" title="Télécharger en Word" aria-label="Télécharger en Word">↓ Word</button></div></div><h3 style="margin-top:18px">Synthèse exécutive</h3><div class="grid">'+metricCards.map(x=>metric(x[0],x[1]??"—")).join("")+'</div>'+(warnings.length?'<div class="notice error" style="margin-top:14px"><strong>Points de vigilance sur la qualité des données</strong><ul>'+warnings.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>':'<div class="notice" style="margin-top:14px">Aucune incohérence évidente détectée par les contrôles automatiques.</div>')+'<h3>Performance par direction</h3><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:8px">Direction</th><th>Missions</th><th>Terminées</th><th>Tâches</th><th>Ouvertes</th><th>Clôture</th><th>Achèvement tâches</th></tr></thead><tbody>'+depts.map(d=>'<tr><td style="padding:8px;border-top:1px solid #e5eaf0">'+esc(d.name)+'</td><td>'+esc(d.missionCount)+'</td><td>'+esc(d.completedMissions)+'</td><td>'+esc(d.taskCount)+'</td><td>'+esc(d.openTasks)+'</td><td>'+esc(d.missionClosureRate==null?"N/C":d.missionClosureRate+" %")+'</td><td>'+esc(d.taskCompletionRate==null?"N/C":d.taskCompletionRate+" %")+'</td></tr>').join("")+'</tbody></table></div><h3>Contenu intégral du rapport</h3><pre id="reportReadable" style="white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 system-ui;background:#f8fafc;border:1px solid #e2e8f0;color:#172338;padding:16px;border-radius:10px">'+esc(text)+'</pre></section>';
}
async function renderReports(){
 const d=await api(base()+"reports");
 $("view").innerHTML='<section class="card"><h2>Reporting à la Direction générale</h2><p class="small">Les rapports sont présentés sous forme de synthèse lisible et peuvent être copiés ou exportés en PDF et Word.</p><button class="btn primary" id="reportNow">Générer un rapport maintenant</button></section><section class="card"><h2>Rapports archivés ('+arr(d.reports).length+')</h2>'+arr(d.reports).map(x=>'<div class="row"><div><strong>'+esc(x.report_content?.title||x.report_type)+'</strong><span class="small">'+date(x.period_start)+' → '+date(x.period_end)+' · '+esc(x.status)+'</span></div><button class="btn" data-report="'+esc(x.id)+'">Consulter</button></div>').join("")||'<div class="empty">Aucun rapport généré.</div>'+'</section>';
 $("reportNow").onclick=async()=>{const b=$("reportNow");b.disabled=true;try{const r=await api(base()+"reports/generate",{method:"POST",body:"{}"});message(r.created?"Rapport généré et transmis à la Direction générale.":"Un rapport identique existe déjà.");await render()}catch(e){message(e.message,true)}finally{b.disabled=false}};
 $("view").querySelectorAll("[data-report]").forEach(b=>b.onclick=()=>{const r=arr(d.reports).find(x=>x.id===b.dataset.report);if(!r)return;const previous=$("reportDetail");if(previous)previous.remove();$("view").insertAdjacentHTML("beforeend",reportHtml(r));const copy=$("copyReport");copy.onclick=async()=>{try{await navigator.clipboard.writeText(reportText(r));copy.textContent="✓ Copié";message("Rapport intégral copié dans le presse-papiers.");}catch(e){const ta=document.createElement("textarea");ta.value=reportText(r);document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();if(!ok)throw e;copy.textContent="✓ Copié";message("Rapport intégral copié.");}};
 $("downloadPdf").onclick=()=>{try{const JsPDF=window.jspdf?.jsPDF;if(!JsPDF)throw Error("Le module PDF n'est pas chargé. Actualisez la page.");const pdf=new JsPDF({unit:"mm",format:"a4"});pdf.setFont("helvetica","bold");pdf.setFontSize(16);pdf.text(String(r.report_content?.title||"Rapport opérationnel"),15,18);pdf.setFont("helvetica","normal");pdf.setFontSize(9);const lines=pdf.splitTextToSize(reportText(r),180);let y=28;for(const line of lines){if(y>282){pdf.addPage();y=16;}pdf.text(line,15,y);y+=5;}pdf.save("AFE-CI-rapport-operationnel.pdf");message("Rapport PDF téléchargé.");}catch(e){message(e.message,true)}};
 $("downloadWord").onclick=async()=>{try{const lib=window.docx;if(!lib?.Document||!lib?.Packer)throw Error("Le module Word n'est pas chargé. Actualisez la page.");const paragraphs=reportText(r).split("\n").map(line=>new lib.Paragraph({children:[new lib.TextRun({text:line||" ",bold:/^[1-7]\. |^AFE-CI/.test(line)})]}));const doc=new lib.Document({sections:[{properties:{},children:paragraphs}]});const blob=await lib.Packer.toBlob(doc);const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="AFE-CI-rapport-operationnel.docx";a.click();URL.revokeObjectURL(url);message("Rapport Word téléchargé.");}catch(e){message(e.message,true)}};
 });
}
async function renderSettings(){
 const [s,a]=await Promise.all([api(base()+"settings"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents")]),cfg=s.settings,agents=arr(a.agents).filter(x=>x.status==="active"&&x.slug==="afe-ci-coo");
 $("view").innerHTML='<section class="card"><h2>COO IA — mandat et autonomie</h2><p class="small">Le niveau 2 permet de planifier et déléguer des opérations réversibles dans cet espace. Le niveau 3 reste verrouillé jusqu’à la réussite des tests de sécurité et une décision distincte de la Direction générale. L’arrêt d’urgence bloque les nouvelles orchestrations.</p><div class="form"><div><label>Agent COO désigné</label><select class="field" id="cooAgent"><option value="">Non désigné</option>'+agents.map(x=>'<option value="'+esc(x.id)+'" '+(cfg.coo_agent_id===x.id?"selected":"")+'>'+esc(x.name)+'</option>').join("")+'</select></div><div><label>Autonomie opérationnelle</label><select class="field" id="cooAutonomy"><option value="1" '+(Number(cfg.coo_autonomy_level)===1?"selected":"")+'>Niveau 1 — Proposer et planifier</option><option value="2" '+(Number(cfg.coo_autonomy_level)===2?"selected":"")+'>Niveau 2 — Déléguer les opérations réversibles</option></select></div><div><label>Activation du moteur</label><select class="field" id="cooEnabled"><option value="true" '+(cfg.coo_enabled?"selected":"")+'>Activé</option><option value="false" '+(!cfg.coo_enabled?"selected":"")+'>Désactivé</option></select></div><div><label>Arrêt d’urgence</label><select class="field" id="cooKill"><option value="false" '+(!cfg.coo_kill_switch?"selected":"")+'>Inactif</option><option value="true" '+(cfg.coo_kill_switch?"selected":"")+'>ACTIVÉ — bloquer les nouvelles orchestrations</option></select></div><div><label>Rapport automatique quotidien</label><select class="field" id="dailyEnabled"><option value="true" '+(cfg.daily_report_enabled?"selected":"")+'>Activé</option><option value="false" '+(!cfg.daily_report_enabled?"selected":"")+'>Désactivé</option></select></div></div><p><button class="btn primary" id="saveSettings" '+(role==="owner"?"":"disabled") +'>Enregistrer les paramètres du COO IA</button></p></section>';
 $("saveSettings").onclick=async()=>{try{await api(base()+"settings",{method:"PATCH",body:JSON.stringify({cooAgentId:$("cooAgent").value||null,cooAutonomyLevel:Number($("cooAutonomy").value),cooEnabled:$("cooEnabled").value==="true",cooKillSwitch:$("cooKill").value==="true",dailyReportEnabled:$("dailyEnabled").value==="true"})});message("Mandat et autonomie du COO IA enregistrés.");await render()}catch(e){message(e.message,true)}};
}
async function render(){if(!wid)return;try{$("role").textContent="Rôle : "+role;const w=await api("/team/api/workspaces/"+encodeURIComponent(wid));role=w.role||role;$("role").textContent="Rôle : "+role;const v=$("view");v.innerHTML='<section class="card">Chargement…</section>';if(tab==="overview"){const d=await loadCommon();v.innerHTML=renderOverview(d)}else if(tab==="missions")await renderMissions();else if(tab==="departments")await renderDepartments();else if(tab==="tasks")await renderTasks();else if(tab==="alerts")await renderAlerts();else if(tab==="reports")await renderReports();else if(tab==="settings")await renderSettings()}catch(e){message(e.message,true);$("view").innerHTML='<section class="card error">'+esc(e.message)+'</section>'}}
$("tabs").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(!b)return;tab=b.dataset.tab;$("tabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));render()});
$("spaces").onchange=()=>{wid=$("spaces").value;render()};$("refresh").onclick=()=>render();if(!session()?.access_token)loginPrompt("Authentification requise.");else loadWorkspaceList().catch(e=>{if(!session()?.access_token)loginPrompt("Session expirée.");else message(e.message,true)});
</script></body></html>`;
