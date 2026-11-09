import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "./auth.js";
import { callModel } from "./providers.js";
import { runAgentWorkerForWorkspace } from "./autonomous-agents/worker.js";
import { buildCooDataQuality, buildCooReportActivity, buildCooReportIdempotencyKey, resolveTaskDepartmentId } from "./coo-reporting.js";
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
  return { access: a, settings: s };}async function validateDepartment(workspaceId: string, departmentId: string, allowIndependent = false) {  const rows = await db<any[]>("afe_org_departments?id=eq." + enc(departmentId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
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
  } else if (found[0].status === "resolved" || found[0].workflow_status === "pending_verification") {
    const reopenedAt = nowIso();
    await db("afe_coo_alerts?id=eq." + enc(found[0].id) + "&workspace_id=eq." + enc(workspaceId), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "open", workflow_status: "reopened", severity: alert.severity, title: alert.title, description: alert.description,
        acknowledged_by: null, acknowledged_at: null, resolved_by: null, resolved_at: null, verified_by: null, verified_at: null,
        evidence_reference: "", resolution_summary: "", verification_note: "",
        reopen_count: Number(found[0].reopen_count || 0) + 1, last_reopened_at: reopenedAt, updated_at: reopenedAt
      })
    });
    await appendAlertEvent(workspaceId, found[0].id, null, "condition_reappeared", { alert_type: alert.type, message: "La condition déclenchante est réapparue après clôture." });
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
    if (known && !active && alert.workflow_status !== "pending_verification" && alert.status !== "resolved") {
      const clearedAt = nowIso();
      await db("afe_coo_alerts?id=eq." + enc(alert.id) + "&workspace_id=eq." + enc(workspaceId), {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "acknowledged", workflow_status: "pending_verification", updated_at: clearedAt })
      });
      await appendAlertEvent(workspaceId, alert.id, null, "condition_cleared_pending_verification", {
        message: "La condition déclenchante n'est plus détectée. La résolution reste à documenter et à vérifier indépendamment."
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
  return {    generatedAt: nowIso(),
    indicators: {      totalMissions: data.missions.length, activeMissions: activeMissions.length, completedMissions,
      failedMissions, overdueMissions: overdueMissions.length,      unassignedMissions: data.missions.filter(m => !m.effective_department_id).length,
      blockedMissions: data.missions.filter(m => Boolean(m.blocked_reason) || m.status === "paused").length,
      totalTasks: data.tasks.length, openTasks: openTasks.length,
      blockedTasks: data.tasks.filter(t => t.status === "blocked").length,
      overdueTasks: overdueTasks.length, activeDepartments: data.departments.filter(d => d.active).length,
      departmentsWithActivity: deptPerformance.filter(d => d.active && (d.missionCount > 0 || d.taskCount > 0)).length,
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
  const a = await requireAccess(workspaceId, user);  await settings(workspaceId, a.workspace.owner_id);
  await ensureDepartments(workspaceId, user.id);
  const data = await snapshot(workspaceId);  await refreshAlerts(workspaceId, data.missions, data.tasks);
  const refreshed = await snapshot(workspaceId);
  return { dashboard: computeDashboard(refreshed), departments: refreshed.departments, missions: refreshed.missions, tasks: refreshed.tasks, alerts: refreshed.alerts.filter(x => x.status !== "resolved"), settings: await settings(workspaceId, a.workspace.owner_id) };}
async function generateReport(workspaceId: string, reportType: "daily" | "weekly" | "ad_hoc", periodStart: string, periodEnd: string, actorId?: string) {
  const startMs = Date.parse(periodStart), endMs = Date.parse(periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw fail("Période de rapport invalide : dates ISO requises et début antérieur à la fin.");
  }
  const initial = await snapshot(workspaceId);
  await refreshAlerts(workspaceId, initial.missions, initial.tasks);
  const fullData = await snapshot(workspaceId);
  // Report the complete current portfolio, then disclose the creation flow for the selected period separately.
  const periodActivity = buildCooReportActivity(fullData.missions, fullData.tasks, periodStart, periodEnd);
  const data = fullData;
  const dashboard = computeDashboard(data);
  const dataQuality = buildCooDataQuality(fullData.missions, fullData.tasks, dashboard.departmentPerformance);
  const { completedVerifiedMissionCount, completedWithoutTasks, completedWithIncompleteTasks } = dataQuality;
  const reportContent = {
    schemaVersion: 2,
    scopeDescription: "Les indicateurs décrivent le portefeuille au moment de la génération. Les volumes de création décrivent l'activité comprise dans la période.",
    title: reportType === "daily" ? "Rapport opérationnel quotidien" : reportType === "weekly" ? "Revue opérationnelle hebdomadaire" : "Rapport opérationnel",
    generatedAt: nowIso(), period: { start: periodStart, end: periodEnd }, periodActivity, indicators: {
      ...dashboard.indicators,
      completedVerifiedMissions: completedVerifiedMissionCount,
      completedUnverifiedMissions: completedWithoutTasks.length + completedWithIncompleteTasks.length
    },
    departmentPerformance: dashboard.departmentPerformance, missionsAtRisk: dashboard.missionsAtRisk, priorityAlerts: dashboard.priorityAlerts,
    dataQuality: { ...dataQuality },
    decisionsRequired: { humanApprovals: data.approvals, escalations: dashboard.priorityAlerts.filter(x => x.severity === "critical") },
    governanceNote: "Ce rapport décrit l'exécution opérationnelle. Une mission terminée sans tâches opérationnelles toutes achevées est signalée comme non vérifiée. Il ne modifie aucun constat technique, arbitrage indépendant ou décision soumise à validation humaine."
  };
  const key = buildCooReportIdempotencyKey(reportType, periodStart, periodEnd);
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
  return { report, created, reconciliation: { portfolioMissionCount: dataQuality.missionCount, periodMissionCount: periodActivity.missionsCreated, assignedMissionCount: dataQuality.assignedMissionCount, unassignedMissionCount: dataQuality.unassignedMissionCount, completedVerifiedMissionCount: completedVerifiedMissionCount, completedUnverifiedMissionCount: completedWithoutTasks.length + completedWithIncompleteTasks.length, taskCount: dataQuality.taskCount, assignedTaskCount: dataQuality.assignedTaskCount, unassignedTaskCount: dataQuality.unassignedTaskCount, periodActivity } };
}
async function listReports(workspaceId: string) {
  return db<any[]>("afe_coo_reports?workspace_id=eq." + enc(workspaceId) + "&order=created_at.desc&limit=100");
}
async function ensureAlertConditionCleared(workspaceId: string, alert: any) {
  if (alert.alert_type === "task_blocked" && alert.task_id) {
    const tasks = await db<any[]>("afe_operational_tasks?id=eq." + enc(alert.task_id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
    const task = tasks[0];
    if (task && (task.status === "blocked" || clean(task.blocked_reason, 3000))) {
      throw fail("Cette alerte ne peut pas être résolue : la tâche est toujours bloquée. Le responsable doit lever le blocage et mettre à jour la tâche avant la clôture.", 409);
    }
  }
  if (alert.alert_type === "mission_blocked" && alert.mission_id) {
    const missions = await db<any[]>("afe_agent_missions?id=eq." + enc(alert.mission_id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
    const mission = missions[0];
    if (mission && (mission.status === "paused" || clean(mission.blocked_reason, 3000))) {
      throw fail("Cette alerte ne peut pas être résolue : la mission est toujours suspendue ou conserve un motif de blocage. Le blocage doit être levé avant la clôture.", 409);
    }
  }
}

async function appendAlertEvent(workspaceId: string, alertId: string, actorId: string | null, eventType: string, details: Record<string, unknown> = {}) {
  await db("afe_coo_alert_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, alert_id: alertId, actor_id: actorId, event_type: eventType, details })
  });
}

async function getAlertDetails(workspaceId: string, id: string) {
  const rows = await db<any[]>("afe_coo_alerts?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  if (!rows[0]) throw fail("Alerte introuvable.", 404);
  const events = await db<any[]>("afe_coo_alert_events?alert_id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId) + "&order=created_at.desc&limit=100");
  return { alert: rows[0], events };
}

async function actOnAlert(workspaceId: string, user: AuthUser, id: string, input: any) {
  const action = clean(input?.action, 40);
  const rows = await db<any[]>("afe_coo_alerts?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
  const alert = rows[0];
  if (!alert) throw fail("Alerte introuvable.", 404);
  const stamp = nowIso();
  const patch: Record<string, unknown> = { updated_at: stamp };
  const details: Record<string, unknown> = {};
  let eventType = "";
  const diagnosis = clean(input?.diagnosis, 4000);
  const correctiveAction = clean(input?.correctiveAction, 4000);
  const evidenceReference = clean(input?.evidenceReference, 2000);
  const resolutionSummary = clean(input?.resolutionSummary, 4000);
  const verificationNote = clean(input?.verificationNote, 2000);

  if (action === "assign") {
    if (alert.workflow_status === "resolved" || alert.status === "resolved") throw fail("Une alerte clôturée doit être rouverte avant réaffectation.", 409);
    const assignedTo = clean(input?.assignedTo, 64);
    if (!assignedTo) throw fail("Sélectionne un responsable de traitement.", 400);
    await validateMember(workspaceId, assignedTo);
    patch.status = "acknowledged"; patch.workflow_status = "assigned";
    patch.assigned_to = assignedTo; patch.assigned_at = stamp;
    patch.acknowledged_by = user.id; patch.acknowledged_at = stamp;
    const dueAt = clean(input?.dueAt, 40);
    if (dueAt) {
      const dueTime = Date.parse(dueAt);
      if (!Number.isFinite(dueTime) || dueTime <= Date.now()) throw fail("L'échéance doit être une date future valide.", 400);
      patch.due_at = new Date(dueTime).toISOString();
      details.due_at = patch.due_at;
    }
    eventType = "assigned"; details.assigned_to = assignedTo;
  } else if (action === "acknowledge" || action === "take") {
    if (alert.workflow_status === "resolved" || alert.status === "resolved") throw fail("Cette alerte est déjà clôturée. Utilise Réouvrir si le problème est réapparu.", 409);
    patch.status = "acknowledged"; patch.workflow_status = "assigned";
    patch.assigned_to = user.id; patch.assigned_at = stamp;
    patch.acknowledged_by = user.id; patch.acknowledged_at = stamp;
    const dueAt = clean(input?.dueAt, 40);
    if (dueAt) {
      const dueTime = Date.parse(dueAt);
      if (!Number.isFinite(dueTime) || dueTime <= Date.now()) throw fail("L'échéance doit être une date future valide.", 400);
      patch.due_at = new Date(dueTime).toISOString();
      details.due_at = patch.due_at;
    }
    eventType = "taken_in_charge";
  } else if (action === "diagnose") {
    if (alert.workflow_status === "resolved") throw fail("Une alerte clôturée doit être rouverte avant modification.", 409);
    if (diagnosis.length < 20) throw fail("Le diagnostic doit comporter au moins 20 caractères et décrire la cause du problème.", 400);
    patch.diagnosis = diagnosis; patch.workflow_status = "diagnosing"; patch.status = "acknowledged";
    eventType = "diagnosis_recorded"; details.diagnosis = diagnosis;
  } else if (action === "start") {
    if (diagnosis.length < 20 || correctiveAction.length < 20) throw fail("Renseigne un diagnostic et un plan correctif précis (20 caractères minimum chacun).", 400);
    patch.diagnosis = diagnosis; patch.corrective_action = correctiveAction;
    patch.workflow_status = "in_progress"; patch.status = "acknowledged";
    eventType = "remediation_started"; details.corrective_action = correctiveAction;
  } else if (action === "submit_for_verification") {
    if (diagnosis.length < 20 || correctiveAction.length < 20 || evidenceReference.length < 10 || resolutionSummary.length < 20) {
      throw fail("Avant la vérification, renseigne le diagnostic, les actions réalisées, une référence de preuve et le résumé du résultat.", 400);
    }
    await ensureAlertConditionCleared(workspaceId, alert);
    patch.diagnosis = diagnosis; patch.corrective_action = correctiveAction;
    patch.evidence_reference = evidenceReference; patch.resolution_summary = resolutionSummary;
    patch.workflow_status = "pending_verification"; patch.status = "acknowledged";
    patch.verification_note = "";
    eventType = "submitted_for_verification";
    details.evidence_reference = evidenceReference; details.resolution_summary = resolutionSummary;
  } else if (action === "verify") {
    if (alert.workflow_status !== "pending_verification") throw fail("Cette alerte n'attend pas de vérification.", 409);
    if (!alert.assigned_to) throw fail("Cette alerte doit d'abord être prise en charge par un responsable avant la vérification indépendante.", 409);
    if (alert.assigned_to === user.id) throw fail("La vérification doit être effectuée par une personne différente du responsable de la correction.", 403);
    if (clean(alert.evidence_reference, 2000).length < 10 || clean(alert.resolution_summary, 4000).length < 20) throw fail("La résolution ne peut pas être validée sans référence de preuve et résumé du résultat.", 409);
    if (verificationNote.length < 20) throw fail("La note de vérification doit comporter au moins 20 caractères.", 400);
    const decision = clean(input?.decision, 16);
    if (decision === "approve") {
      await ensureAlertConditionCleared(workspaceId, alert);
      patch.workflow_status = "resolved"; patch.status = "resolved";
      patch.resolved_by = user.id; patch.resolved_at = stamp;
      patch.verified_by = user.id; patch.verified_at = stamp;
      patch.verification_note = verificationNote;
      eventType = "resolution_verified";
    } else if (decision === "reject") {
      patch.workflow_status = "in_progress"; patch.status = "acknowledged";
      patch.verified_by = user.id; patch.verified_at = stamp;
      patch.verification_note = verificationNote;
      eventType = "verification_rejected";
    } else throw fail("Décision de vérification invalide.", 400);
    details.decision = decision; details.verification_note = verificationNote;
  } else if (action === "reopen") {
    if (alert.workflow_status !== "resolved" && alert.status !== "resolved") throw fail("Seule une alerte clôturée peut être rouverte.", 409);
    if (verificationNote.length < 20) throw fail("Explique la réouverture (20 caractères minimum).", 400);
    patch.status = "open"; patch.workflow_status = "reopened";
    patch.resolved_by = null; patch.resolved_at = null;
    patch.verified_by = null; patch.verified_at = null;
    patch.evidence_reference = ""; patch.resolution_summary = ""; patch.verification_note = "";
    patch.reopen_count = Number(alert.reopen_count || 0) + 1;
    patch.last_reopened_at = stamp;
    patch.verification_note = verificationNote;
    eventType = "reopened"; details.reason = verificationNote;
  } else if (action === "resolve") {
    throw fail("La clôture directe est désactivée. Soumets d'abord la correction à une vérification indépendante.", 409);
  } else throw fail("Action d'alerte invalide.", 400);

  await db("afe_coo_alerts?id=eq." + enc(id) + "&workspace_id=eq." + enc(workspaceId), {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch)
  });
  await appendAlertEvent(workspaceId, id, user.id, eventType, details);
  await audit(workspaceId, user.id, "coo.alert." + eventType, "alert", id);
  return { id, status: patch.status || alert.status, workflow_status: patch.workflow_status || alert.workflow_status };
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
    const workloadByAgent = new Map<string, {activeMissions:number;openTasks:number}>();    for (const agent of agents) workloadByAgent.set(agent.id, {
      activeMissions: activeMissions.filter(m => m.agent_id === agent.id).length,
      openTasks: openTasks.filter(t => t.assigned_agent_id === agent.id).length
    });    const eligible = departments
      .filter(d => !d.is_independent && !d.human_only && !["direction-generale","direction-operations"].includes(d.slug) && d.director_agent_id)
      .map(d => ({ slug: d.slug, name: d.name, mandate: d.mandate, director: agentById.get(d.director_agent_id), workload: workloadByAgent.get(d.director_agent_id) ?? {activeMissions:0,openTasks:0} }))
      .filter(x => x.director && x.director.status === "active" && x.director.department_id === departments.find(d => d.slug === x.slug)?.id && x.workload.activeMissions < 2 && x.workload.openTasks < 10);    if (!eligible.length) throw fail("Aucune direction opérationnelle ne dispose d'un directeur IA actif.", 409);
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
        error_message: (error instanceof Error ? error.message : String(error)).slice(0, 3000),        completed_at: nowIso()
      })
    });
    await audit(workspaceId, user.id, partial ? "coo.orchestration.partial_failure" : "coo.orchestration.failed", "coo_run", run.id, {
      cooAgentId: coo.id, missionsCreated: createdMissions.length,      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000)
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
    if (resource === "archives" && method === "GET" && p.length === 6) {
      await requireAccess(workspaceId, user);
      const archives = await db<any[]>("afe_coo_mission_archives?workspace_id=eq." + enc(workspaceId) + "&order=archive_date.desc,mission_number.desc&limit=1000");
      send(res, 200, { archives, total: archives.length }); return true;
    }
    if (resource === "archives" && p[6] && method === "GET" && p.length === 7) {
      await requireAccess(workspaceId, user);
      const found = await db<any[]>("afe_coo_mission_archives?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
      if (!found[0]) throw fail("Dossier d’archive introuvable.", 404);
      const [documents, availableDocuments] = await Promise.all([
        db<any[]>("afe_coo_mission_archive_documents?archive_id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&order=linked_at.desc"),
        db<any[]>("debate_workspace_documents?workspace_id=eq." + enc(workspaceId) + "&order=created_at.desc&limit=300")
      ]);
      const linkedIds = new Set(documents.map(d => d.source_document_id).filter(Boolean));
      send(res, 200, { archive: found[0], documents, availableDocuments: availableDocuments.filter(d => !linkedIds.has(d.id)) }); return true;
    }
    if (resource === "archives" && p[6] && p[7] === "documents" && method === "POST" && p.length === 8) {
      await requireAccess(workspaceId, user, "editor");
      const archiveRows = await db<any[]>("afe_coo_mission_archives?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
      if (!archiveRows[0]) throw fail("Dossier d’archive introuvable.", 404);
      const input = await readBody(req), documentId = clean(input.documentId, 64);
      if (!documentId) throw fail("Sélectionnez un document à rattacher.");
      const sourceRows = await db<any[]>("debate_workspace_documents?id=eq." + enc(documentId) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
      if (!sourceRows[0]) throw fail("Document introuvable dans cet espace de travail.", 404);
      const source = sourceRows[0];
      const alreadyLinked = await db<any[]>("afe_coo_mission_archive_documents?archive_id=eq." + enc(p[6]) + "&source_document_id=eq." + enc(source.id) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
      if (alreadyLinked[0]) { send(res, 200, { ok: true, document: alreadyLinked[0], alreadyLinked: true }); return true; }
      const archive = archiveRows[0];
      const safeName = String(source.title || "document").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "document";
      const archivedPath = "archives/" + workspaceId + "/" + archive.mission_number + "/" + source.id + "-" + safeName;
      const c = config();
      const copied = await fetch(c.url + "/storage/v1/object/copy", { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" }, body: JSON.stringify({ bucketId: "afe-ci-team-documents", sourceKey: source.storage_path, destinationKey: archivedPath }) });
      const copyText = await copied.text();
      if (!copied.ok) throw fail("La copie sécurisée du document vers les archives a échoué (" + copied.status + "). Le document source est conservé.", 502);
      const linked = await db<any[]>("afe_coo_mission_archive_documents?on_conflict=archive_id%2Csource_document_id", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ workspace_id: workspaceId, archive_id: p[6], source_document_id: source.id, title: source.title, description: source.description ?? "", storage_path: archivedPath, source_storage_path: source.storage_path, mime_type: source.mime_type, size_bytes: source.size_bytes, uploaded_by: source.uploaded_by, source_created_at: source.created_at, linked_by: user.id })
      });
      const docs = await db<any[]>("afe_coo_mission_archive_documents?archive_id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId));
      await db("afe_coo_mission_archives?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", body: JSON.stringify({ document_count: docs.length, document_status: docs.length ? "partial" : "pending", updated_at: nowIso() }) });
      await audit(workspaceId, user.id, "coo.mission_archive.document_linked", "mission_archive", p[6], { documentId: source.id, title: source.title });
      send(res, 201, { ok: true, document: linked[0] ?? source, documentCount: docs.length }); return true;
    }
    if (resource === "archives" && p[6] && p[7] === "documents" && p[8] && p[9] === "signed-url" && method === "POST" && p.length === 10) {
      await requireAccess(workspaceId, user);
      const docs = await db<any[]>("afe_coo_mission_archive_documents?id=eq." + enc(p[8]) + "&archive_id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
      if (!docs[0]) throw fail("Document non rattaché à ce dossier.", 404);
      const c = config(), objectPath = docs[0].storage_path.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(c.url + "/storage/v1/object/sign/afe-ci-team-documents/" + objectPath, { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }) });
      const raw = await response.text();
      if (!response.ok) throw fail("Le service de téléchargement documentaire est indisponible.", 502);
      const signed = JSON.parse(raw || "{}"), signedPath = signed.signedURL ?? signed.signedUrl ?? signed.url;
      if (typeof signedPath !== "string") throw fail("URL de téléchargement absente.", 502);
      send(res, 200, { url: signedPath.startsWith("http") ? signedPath : c.url + "/storage/v1" + (signedPath.startsWith("/") ? signedPath : "/" + signedPath) }); return true;
    }
    if (resource === "archives" && p[6] && p[7] === "upload-url" && method === "POST" && p.length === 8) {
      await requireAccess(workspaceId, user, "editor");
      const found = await db<any[]>("afe_coo_mission_archives?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
      if (!found[0]) throw fail("Dossier d’archive introuvable.", 404);
      const input = await readBody(req);
      const fileName = clean(input.fileName, 180), mimeType = clean(input.mimeType, 120), sizeBytes = Number(input.sizeBytes);
      const allowed = new Set(["application/pdf","text/plain","text/csv","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation","image/jpeg","image/png","image/webp"]);
      if (!fileName || !allowed.has(mimeType) || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 50000000) throw fail("Fichier invalide, type non autorisé ou taille supérieure à 50 Mo.");
      const safeName = fileName.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "document";
      const objectPath = "archives/" + workspaceId + "/" + found[0].mission_number + "/" + randomUUID() + "-" + safeName;
      const c = config(), segments = objectPath.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(c.url + "/storage/v1/object/upload/sign/afe-ci-team-documents/" + segments, { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" }, body: JSON.stringify({ upsert: false }) });
      const raw = await response.text();
      if (!response.ok) throw fail("Impossible de préparer le dépôt sécurisé du document.", 502);
      const signed = JSON.parse(raw || "{}"), signedPath = signed.signedURL ?? signed.signedUrl ?? signed.url;
      if (typeof signedPath !== "string") throw fail("URL de dépôt signée absente.", 502);
      send(res, 200, { path: objectPath, uploadUrl: signedPath.startsWith("http") ? signedPath : c.url + "/storage/v1" + (signedPath.startsWith("/") ? signedPath : "/" + signedPath), method: "PUT", expiresInSeconds: 7200 }); return true;
    }
    if (resource === "archives" && p[6] && p[7] === "upload-complete" && method === "POST" && p.length === 8) {
      await requireAccess(workspaceId, user, "editor");
      const found = await db<any[]>("afe_coo_mission_archives?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
      if (!found[0]) throw fail("Dossier d’archive introuvable.", 404);
      const input = await readBody(req), path = clean(input.path, 700), title = clean(input.title, 180), mimeType = clean(input.mimeType, 120), sizeBytes = Number(input.sizeBytes);
      const prefix = "archives/" + workspaceId + "/" + found[0].mission_number + "/";
      const allowed = new Set(["application/pdf","text/plain","text/csv","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation","image/jpeg","image/png","image/webp"]);
      if (!path.startsWith(prefix) || path.includes("..") || !title || !allowed.has(mimeType) || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 50000000) throw fail("Métadonnées de document invalides.");
      const c = config(), segments = path.split("/").map(encodeURIComponent).join("/");
      const verified = await fetch(c.url + "/storage/v1/object/sign/afe-ci-team-documents/" + segments, { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }) });
      if (!verified.ok) throw fail("Le fichier n’a pas été confirmé dans le stockage privé. Aucun document n’a été enregistré.", 409);
      const docs = await db<any[]>("afe_coo_mission_archive_documents", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ workspace_id: workspaceId, archive_id: p[6], title, description: clean(input.description, 2000), storage_path: path, source_storage_path: path, mime_type: mimeType, size_bytes: sizeBytes, uploaded_by: user.id, source_created_at: nowIso(), linked_by: user.id }) });
      const allDocs = await db<any[]>("afe_coo_mission_archive_documents?archive_id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId));
      await db("afe_coo_mission_archives?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", body: JSON.stringify({ document_count: allDocs.length, document_status: allDocs.length ? "partial" : "pending", updated_at: nowIso() }) });
      await audit(workspaceId, user.id, "coo.mission_archive.document_uploaded", "mission_archive", p[6], { title, mimeType, sizeBytes });
      send(res, 201, { ok: true, document: docs[0], documentCount: allDocs.length }); return true;
    }
    if (resource === "archives" && p[6] && p[7] === "complete" && method === "POST" && p.length === 8) {
      await requireAccess(workspaceId, user, "owner");
      const found = await db<any[]>("afe_coo_mission_archives?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&limit=1");
      if (!found[0]) throw fail("Dossier d’archive introuvable.", 404);
      const input = await readBody(req), checklist = input.checklist ?? {};
      const required = ["dgReport", "departmentReports", "supportingEvidence"];
      if (!required.every(key => checklist[key] === true)) throw fail("La Direction générale doit confirmer le rapport DG, les rapports des directions concernées et les justificatifs ou leur non-applicabilité.");
      const docs = await db<any[]>("afe_coo_mission_archive_documents?archive_id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId) + "&select=id");
      if (!docs.length) throw fail("Ajoutez au moins un document au dossier avant de confirmer sa complétude.");
      const rows = await db<any[]>("afe_coo_mission_archives?id=eq." + enc(p[6]) + "&workspace_id=eq." + enc(workspaceId), {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ document_count: docs.length, document_status: "complete", updated_at: nowIso() })
      });
      await audit(workspaceId, user.id, "coo.mission_archive.completeness_confirmed", "mission_archive", p[6], { documentCount: docs.length, checklist: Object.fromEntries(required.map(key => [key, true])) });
      send(res, 200, { ok: true, archive: rows[0] ?? found[0] }); return true;
    }
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
        const access = await requireAccess(workspaceId, user, method === "POST" ? "owner" : "viewer");        const missionId = p[6];
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
        if (action === "accept_closure") {          if (independentReview?.verdict !== "accepted") throw fail("Clôture refusée : le contrôle indépendant n'a pas rendu un verdict accepted.", 409);
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
          const decisionEventRows = await db<any[]>("afe_agent_events", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ workspace_id: workspaceId, mission_id: missionId, agent_id: mission.agent_id, actor_type: "human", actor_id: user.id, event_type: "coo.mission.human_decision", payload: decision }) });
          const archiveRows = await db<any[]>("afe_coo_mission_archives?workspace_id=eq." + enc(workspaceId) + "&mission_id=eq." + enc(missionId) + "&limit=1");
          if (archiveRows[0] && decisionEventRows[0]) {
            const archivedEvents = Array.isArray(archiveRows[0].events_snapshot) ? archiveRows[0].events_snapshot : [];
            const decisionEvent = decisionEventRows[0];
            const eventsSnapshot = decisionEvent.id && archivedEvents.some((event: any) => event.id === decisionEvent.id) ? archivedEvents : [...archivedEvents, decisionEvent];
            await db("afe_coo_mission_archives?id=eq." + enc(archiveRows[0].id) + "&workspace_id=eq." + enc(workspaceId), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ events_snapshot: eventsSnapshot, updated_at: nowIso() }) });
          }
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
      if (method === "GET" && p[6]) { send(res, 200, await getAlertDetails(workspaceId, p[6])); return true; }
      if (method === "GET") { const data = await snapshot(workspaceId); await refreshAlerts(workspaceId, data.missions, data.tasks); const [fresh, members] = await Promise.all([snapshot(workspaceId), db<any[]>("debate_workspace_members?workspace_id=eq." + enc(workspaceId) + "&order=created_at.asc")]); send(res, 200, { alerts: fresh.alerts, members: members.filter(m => rank[m.role as Role] >= rank.editor).map(m => ({ user_id: m.user_id, role: m.role })) }); return true; }
      if (p[6] && method === "POST") { await canOperate(workspaceId, user); send(res, 200, await actOnAlert(workspaceId, user, p[6], await readBody(req))); return true; }
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
        const i = await readBody(req), patch: Record<string, unknown> = { updated_at: nowIso() };        if (i.cooAgentId !== undefined) {
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
:root{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#172338;background:#f3f6fa}*{box-sizing:border-box}body{margin:0}header{background:#10243a;color:#fff;padding:22px max(18px,calc((100vw - 1180px)/2));display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}header h1{font-size:22px;margin:0}header p{margin:5px 0 0;color:#c8d5e4;font-size:13px}.wrap{max-width:1180px;margin:auto;padding:18px}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.field,button,select,textarea{font:inherit}.field,select,textarea{width:100%;padding:10px 12px;border:1px solid #d4dce7;border-radius:9px;background:white;color:#172338}.bar select{max-width:360px}.btn{border:1px solid #cbd5e1;background:#fff;color:#17314b;padding:9px 13px;border-radius:9px;cursor:pointer;font-weight:650}.btn.primary{background:#176b52;color:white;border-color:#176b52}.btn.danger{color:#a42b2b}.btn:disabled{opacity:.45;cursor:not-allowed}.tabs{display:flex;gap:7px;overflow:auto;padding:4px 0 12px}.tabs button{white-space:nowrap}.tabs button.active{background:#173b58;color:#fff;border-color:#173b58}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px}.card{background:white;border:1px solid #e0e6ee;border-radius:13px;padding:16px;margin:0 0 13px;box-shadow:0 2px 8px #17233808}.card h2{font-size:17px;margin:0 0 12px}.card h3{font-size:14px;margin:0 0 8px}.metric{padding:14px;border:1px solid #e3e9f0;border-radius:10px}.metric b{display:block;font-size:25px}.muted,.small{color:#64748b;font-size:12px}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #edf1f5}.row:first-of-type{border-top:0}.row strong{display:block}.tag{font-size:11px;border-radius:30px;padding:4px 8px;background:#edf2f7;color:#30465c;white-space:nowrap}.tag.critical{background:#fee2e2;color:#991b1b}.tag.warning{background:#fff0ce;color:#895400}.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.form label{display:block;font-size:12px;color:#526176;margin-bottom:5px}.form .wide{grid-column:1/-1}.notice{padding:12px;border-radius:9px;background:#eef5f3;color:#245441;margin:8px 0}.login-card{max-width:560px;margin:12px 0;border:1px solid #d5e0eb}.login-card[hidden]{display:none}.login-card label{display:block;font-size:13px;color:#526176;margin:10px 0 5px}.login-card input{width:100%;padding:12px;border:1px solid #d4dce7;border-radius:9px;background:#fff;color:#172338}.login-error{color:#a42b2b;font-size:13px;margin-top:9px;white-space:pre-wrap}.error{background:#fff0f0;color:#a12424}.empty{padding:20px;text-align:center;color:#64748b}.actions{display:flex;gap:7px;flex-wrap:wrap}.manual-content{line-height:1.65}.manual-content h1{font-size:25px;color:#173b58}.manual-content h2{font-size:19px;color:#173b58;margin:0 0 12px}.manual-content h3{font-size:15px;margin:20px 0 8px;color:#245441}.manual-content p{margin:8px 0}.manual-content ul,.manual-content ol{padding-left:24px}.manual-content li{margin:5px 0}.manual-content table{width:100%;border-collapse:collapse;display:block;overflow-x:auto;margin:12px 0}.manual-content th,.manual-content td{border:1px solid #dbe3ec;padding:8px;text-align:left;vertical-align:top}.manual-content th{background:#eef3f8}.manual-toc{display:flex;gap:7px;flex-wrap:wrap}.manual-toc a{display:inline-block;padding:6px 9px;background:#eef3f8;border-radius:7px;text-decoration:none;font-size:12px}.manual-toolbar{position:sticky;top:0;z-index:5}.manual-search{max-width:460px}.manual-section{scroll-margin-top:130px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f8fb;padding:12px;border-radius:9px;font-size:12px}a{color:#176b52}@media(max-width:600px){header{padding:18px}.wrap{padding:12px}.row{align-items:flex-start;flex-direction:column}}</style></head><body>
<header><div><h1>AFE-CI · Direction des Opérations</h1><p>Poste de commandement du COO · Portefeuille · Directions · Exécution · Performance</p></div><div class="actions"><a href="/team" style="color:white">Équipe & Gouvernance ↗</a><button class="btn" id="refresh">Actualiser</button></div></header>
<main class="wrap"><div id="message" class="notice">Chargement de l'espace de travail…</div><section id="cooLogin" class="card login-card"><h2>Connexion à AFE-CI</h2><p class="small">Connecte-toi avec ton adresse e-mail et ton mot de passe habituels. Le mot de passe est transmis uniquement au service Auth et n’est pas conservé par cette page.</p><label for="cooLoginEmail">Adresse e-mail</label><input id="cooLoginEmail" type="email" autocomplete="username" placeholder="vous@exemple.com"><label for="cooLoginPassword">Mot de passe</label><input id="cooLoginPassword" type="password" autocomplete="current-password" placeholder="Mot de passe"><button class="btn primary" id="cooLoginButton" type="button">Se connecter</button><div id="cooLoginError" class="login-error" role="alert"></div><p class="small">Après connexion, tu reviendras automatiquement au poste de commandement COO.</p></section><div class="bar"><label for="spaces" class="small">Espace de travail</label><select id="spaces" class="field"></select><span id="role" class="small"></span></div>
<nav class="tabs" id="tabs"><button class="btn active" data-tab="overview">Vue centrale</button><button class="btn" data-tab="missions">Portefeuille des missions</button><button class="btn" data-tab="departments">Directions</button><button class="btn" data-tab="tasks">Tâches & affectations</button><button class="btn" data-tab="alerts">Alertes</button><button class="btn" data-tab="reports">Reporting DG</button><button class="btn" data-tab="archives">Archives des missions</button><button class="btn" data-tab="settings">Paramètres COO</button><button class="btn" data-tab="manual">Manuel d’utilisation</button></nav><section id="view"></section></main>
<script>
</script>
<script defer src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script><script defer src="https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"></script>
<script>
const $=id=>document.getElementById(id),arr=x=>Array.isArray(x)?x:[],esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const COO_MANUAL_SOURCE = "# AFE-CI — Manuel de procédures d’utilisation\n## Direction des Opérations (COO) · Version 1.0\n\n**Document de référence utilisateur**  \n**Périmètre :** espace de travail AFE-CI, écran \`/coo\`, fonctions de pilotage opérationnel et lien vers « Équipe & Gouvernance ».  \n**Public :** Direction générale, COO, administrateurs, responsables opérationnels et lecteurs autorisés.\n\n---\n\n## 1. Objet, périmètre et règles de lecture\n\nCe manuel décrit les fonctions réellement présentes dans le poste de commandement COO : connexion, sélection de l’espace, vue centrale, portefeuille des missions, directions, tâches et affectations, alertes, reporting à la Direction générale, paramètres COO et dossier détaillé de contrôle d’une mission.\n\nLe manuel distingue :\n- **Consulter** : lire les informations sans les modifier.\n- **Préparer** : saisir une instruction, une mission ou une tâche avant de l’enregistrer.\n- **Enregistrer** : transmettre une modification au serveur. Un message de confirmation doit apparaître.\n- **Exécuter** : lancer le worker sur des missions éligibles. Cette action déclenche un traitement réel.\n- **Contrôler** : examiner les livrables et la revue indépendante.\n- **Valider / clôturer** : décision réservée à l’autorité humaine habilitée. Une revue indépendante acceptée ne vaut pas, à elle seule, validation humaine.\n\nLes intitulés et droits visibles peuvent dépendre du rôle attribué au compte et de la configuration du workspace. Les champs non affichés à un rôle ne doivent pas être considérés comme disponibles.\n\n### Règles impératives de gouvernance\n\n1. L’espace de travail sélectionné détermine le périmètre des données affichées et des opérations. Vérifier son nom avant toute modification.\n2. La Direction générale conserve les décisions stratégiques, les engagements sensibles et la validation humaine finale.\n3. Le COO IA peut planifier et déléguer des opérations dans les limites de son mandat. Il ne remplace ni l’arbitrage indépendant ni l’autorité humaine.\n4. L’Arbitrage indépendant, l’Audit interne indépendant et l’Autorité de validation humaine sont des fonctions protégées. Elles ne doivent pas être affectées comme directions opérationnelles ordinaires.\n5. Une mission n’est pas réputée achevée simplement parce qu’un agent a produit un texte ou déclaré son travail terminé. Les tâches, preuves, livrables, contrôles et validations doivent être examinés.\n6. Ne jamais modifier les paramètres d’autonomie ou activer/désactiver le moteur sans mandat explicite de la Direction générale.\n7. Ne jamais communiquer un mot de passe, une clé API, un jeton de session ou un secret dans une instruction, une mission, une tâche ou un rapport.\n\n---\n\n## 2. Accéder à l’application et ouvrir une session\n\n### 2.1 Ouvrir le poste COO\n\n1. Ouvrir le lien officiel de l’espace COO communiqué par l’administrateur de l’entreprise.\n2. Vérifier que l’adresse comporte le chemin \`/coo\` et que l’en-tête affiche **AFE-CI · Direction des Opérations**.\n3. Ne pas utiliser un lien Debate Engine ou une autre Preview qui ne correspond pas à l’espace COO officiel.\n4. Attendre le chargement de la page.\n\n### 2.2 Se connecter\n\nLorsque la carte **Connexion à AFE-CI** apparaît :\n\n1. Saisir l’adresse e-mail associée au compte.\n2. Saisir le mot de passe habituel.\n3. Cliquer sur **Se connecter** ou appuyer sur Entrée depuis le champ mot de passe.\n4. Attendre le message de connexion et le chargement des espaces de travail.\n\nLe mot de passe est transmis au service d’authentification et n’est pas conservé par la page COO. La session est ensuite utilisée pour les appels authentifiés.\n\n**En cas d’échec :**\n- vérifier l’adresse e-mail et le mot de passe ;\n- vérifier que le compte a bien été invité dans le workspace ;\n- actualiser la page et réessayer ;\n- si la session a expiré, se reconnecter ;\n- si le compte est authentifié mais qu’aucun workspace n’apparaît, demander à un propriétaire de vérifier l’adhésion au workspace.\n\nNe pas créer un nouveau compte pour contourner un problème d’accès sans instruction de l’administrateur : cela pourrait créer un compte distinct sans les droits ni l’historique attendus.\n\n### 2.3 Sélectionner un espace de travail\n\nLe champ **Espace de travail** liste les espaces auxquels le compte a accès. Sélectionner le workspace concerné. Le rôle associé est affiché à côté.\n\nAvant chaque opération importante, contrôler :\n- le nom du workspace ;\n- le rôle affiché ;\n- le titre de la mission ou de la tâche concernée.\n\nChanger de workspace recharge les données du nouvel espace. Les données ne sont pas fusionnées entre espaces.\n\n### 2.4 Actualiser\n\nLe bouton **Actualiser** recharge la vue active depuis le serveur. L’utiliser après une opération, après une attente d’exécution ou lorsqu’un autre membre a pu modifier les données. Si le résultat ne se met pas à jour, vérifier le message d’état avant de recommencer une action afin d’éviter les doublons.\n\n---\n\n## 3. Comprendre les rôles et les droits\n\nLes rôles connus du workspace sont :\n\n- **Owner / Propriétaire** : contrôle principal du workspace. Peut administrer les paramètres réservés au propriétaire et exercer les décisions de validation finale prévues par l’application.\n- **Admin / Administrateur** : dispose de droits élevés de gestion, dans les limites fixées par les contrôles serveur. Certaines opérations restent réservées au propriétaire.\n- **Editor / Éditeur** : peut contribuer aux opérations et aux contenus autorisés, sans disposer de tous les pouvoirs d’administration.\n- **Viewer / Lecteur** : consulte les informations autorisées sans pouvoir réaliser les modifications réservées aux rôles supérieurs.\n\nLes droits sont vérifiés par le serveur. L’apparition ou l’absence d’un bouton dans l’interface ne remplace pas cette vérification. Si une action renvoie « Accès refusé », ne pas essayer de contourner le contrôle : demander le droit approprié au propriétaire.\n\nLe COO désigné peut disposer de droits opérationnels spécifiques. Les opérations sensibles et les décisions réservées restent soumises aux contrôles humains.\n\n---\n\n## 4. Navigation générale\n\nLe bandeau supérieur présente :\n- **AFE-CI · Direction des Opérations** : identification de l’espace ;\n- **Équipe & Gouvernance** : ouvre l’espace de gestion de l’équipe et de la gouvernance ;\n- **Actualiser** : recharge la vue active.\n\nLa barre de contexte présente :\n- **Espace de travail** : sélection du workspace ;\n- **Rôle** : rôle effectif du compte dans le workspace.\n\nLes onglets du poste COO sont :\n\n1. **Vue centrale**\n2. **Portefeuille des missions**\n3. **Directions**\n4. **Tâches & affectations**\n5. **Alertes**\n6. **Reporting DG**\n7. **Paramètres COO**\n8. **Manuel d’utilisation** (présent dans la version intégrant ce manuel)\n\nChaque onglet charge des données depuis le workspace courant. En cas d’erreur, lire le message affiché avant de changer d’onglet ou de relancer une opération.\n\n---\n\n## 5. Vue centrale — tableau de bord opérationnel\n\n### 5.1 Finalité\n\nLa Vue centrale donne une lecture synthétique de la situation opérationnelle. Elle sert à repérer les retards, blocages, alertes et besoins de décision, puis à orienter l’utilisateur vers le portefeuille, les tâches ou le centre d’alertes.\n\n### 5.2 Indicateurs de situation opérationnelle\n\nLes cartes affichent notamment :\n\n- **Missions actives** : missions en cours de traitement selon leur statut opérationnel.\n- **Missions terminées** : missions portant le statut terminé. Ce nombre ne dispense pas de vérifier le dossier de contrôle et les tâches.\n- **Missions en retard** : missions dont l’échéance est dépassée et qui ne sont pas dans un statut final.\n- **Missions bloquées** : missions suspendues ou portant un motif de blocage.\n- **Tâches ouvertes** : tâches qui ne sont pas encore terminées ou annulées.\n- **Tâches bloquées** : tâches dont le statut est bloqué.\n- **Tâches en retard** : tâches dont l’échéance est dépassée et qui ne sont pas terminées ou annulées.\n- **Alertes ouvertes** : alertes qui restent à traiter.\n- **Alertes critiques** : alertes ouvertes de sévérité critique.\n- **Validations humaines en attente** : décisions pour lesquelles une intervention humaine est encore attendue.\n\nLes nombres sont des indicateurs de suivi, pas des décisions automatiques. Un indicateur nul ne prouve pas l’absence de risque si des informations n’ont pas encore été enregistrées.\n\n### 5.3 Performance par direction\n\nChaque ligne présente le nom de la direction, son nombre de missions, ses tâches ouvertes, ses tâches bloquées et, lorsque le calcul est possible, le taux de tâches terminées.\n\nSi l’application affiche **Pas encore de données**, ne pas interpréter cette mention comme un taux de 0 %. Elle signifie que le taux n’est pas calculable à partir des éléments disponibles.\n\n### 5.4 Alertes prioritaires et missions à risque\n\nLire le titre, la description, la date et le niveau de sévérité de chaque alerte. Pour les missions à risque, examiner la direction, le statut, l’échéance et la priorité. Ouvrir ensuite l’onglet correspondant pour effectuer le suivi détaillé.\n\n### 5.5 Procédure quotidienne recommandée\n\n1. Ouvrir la Vue centrale.\n2. Vérifier le workspace et l’heure d’actualisation.\n3. Examiner les missions en retard et bloquées.\n4. Examiner les tâches en retard et bloquées.\n5. Examiner les alertes critiques.\n6. Examiner les validations humaines en attente.\n7. Ouvrir le portefeuille ou les tâches pour traiter les causes.\n8. Consigner toute décision ou demande de correction dans le dossier correspondant.\n9. Générer ou consulter le rapport destiné à la Direction générale selon la périodicité convenue.\n\n---\n\n## 6. Portefeuille des missions\n\n### 6.1 Finalité et contenu\n\nLe Portefeuille rassemble les missions du workspace. Il permet de transmettre une instruction au COO IA, d’enregistrer une mission manuellement, de suivre les missions, de consulter leur dossier de contrôle, de mettre à jour un pourcentage de progression et de lancer le worker lorsque les conditions sont réunies.\n\nLes indicateurs du portefeuille distinguent :\n- les missions soumises à validation COO ;\n- les missions pour lesquelles des corrections sont demandées ;\n- les revues indépendantes acceptées ;\n- le nombre d’anomalies relevées par les revues.\n\n### 6.2 Transmettre une instruction directe au COO IA\n\nCette zone sert à formuler un objectif de travail au COO, qui prépare les chantiers, consulte les directions IA disponibles et peut créer des missions et tâches dans la file durable.\n\nProcédure :\n1. Rédiger une instruction claire dans **Instruction directe au COO IA**.\n2. Décrire le résultat recherché, le contexte, le périmètre, les directions concernées et les livrables attendus.\n3. Préciser les contraintes, les exclusions, l’échéance et les critères de réussite.\n4. Éviter les formulations vagues comme « améliore l’entreprise ». Préférer un mandat mesurable, par exemple : « réaliser un diagnostic des contrôles du processus X, cartographier les risques, documenter les preuves et remettre un plan d’action priorisé ».\n5. Cliquer sur **Transmettre l’instruction au COO IA**.\n6. Lire le résultat affiché. Vérifier ensuite dans le portefeuille les missions créées et leur rattachement.\n\nUne instruction ne signifie pas que toutes les actions seront automatiquement exécutées. Les décisions sensibles ou réservées restent soumises à approbation humaine. Une demande peut être refusée, limitée ou rester en attente si le moteur est désactivé, si l’autonomie ne le permet pas ou si une validation est nécessaire.\n\n### 6.3 Créer une mission manuellement\n\nRenseigner les champs :\n\n- **Direction responsable** : direction opérationnelle qui porte la mission. Les fonctions indépendantes et humaines protégées ne sont pas proposées.\n- **Agent responsable** : agent IA actif chargé de la mission. Choisir un agent cohérent avec le mandat et la direction.\n- **Responsable opérationnel** : membre humain autorisé du workspace, si un suivi humain est requis.\n- **Priorité** : 1 = critique / très haute ; 2 = haute ; 3 = normale ; 4 = basse ; 5 = très basse.\n- **Intitulé** : titre court, précis et identifiable.\n- **Objectif et livrables attendus** : résultat attendu, périmètre, étapes, preuves, format des livrables et critères d’acceptation.\n- **Échéance** : date et heure cible.\n\nAvant de cliquer sur **Créer la mission**, vérifier le rattachement, le responsable, la priorité, le contenu et l’échéance. La mission est inscrite dans la file durable existante. Sa création ne garantit pas son exécution immédiate : celle-ci dépend du worker, de l’état de l’agent et des paramètres du COO.\n\n### 6.4 Suivre une mission dans le portefeuille\n\nChaque ligne de mission présente, selon les données disponibles :\n- l’intitulé ;\n- la direction ;\n- l’agent ;\n- le statut ;\n- l’échéance ;\n- la progression ;\n- le résumé de l’agent ;\n- les livrables ;\n- les informations de revue indépendante ;\n- les motifs de blocage ou de correction.\n\nLe bouton **Dossier de contrôle** ouvre le détail complet de la mission. Le champ numérique de progression permet de saisir un pourcentage de 0 à 100, puis **Maj %** enregistre la mise à jour. La progression est un indicateur de suivi : elle ne constitue pas une preuve de réalisation ni une validation.\n\nLe bouton **Copier** copie un état textuel du portefeuille, notamment les intitulés, directions, agents, statuts, priorités, progressions, échéances, objectifs, résumés, livrables et blocages. Vérifier le contenu copié avant de le diffuser.\n\n### 6.5 Démarrer l’exécution des missions en attente\n\nLe bouton **Démarrer l’exécution des missions en attente** déclenche le worker de manière contrôlée, une mission par appel. Il est réservé à la Preview et à la Direction générale selon le texte de l’interface.\n\nAvant de lancer :\n1. vérifier que les missions sont correctement définies et affectées ;\n2. vérifier que l’agent responsable est actif ;\n3. vérifier que le moteur COO est activé et que l’arrêt d’urgence n’est pas enclenché ;\n4. vérifier qu’aucune validation humaine préalable n’est requise ;\n5. s’assurer que l’exécution est autorisée dans l’environnement utilisé.\n\nAprès le lancement :\n1. lire le résultat affiché ;\n2. actualiser le portefeuille ;\n3. vérifier le statut, le résumé, les livrables et les tâches ;\n4. ouvrir le dossier de contrôle ;\n5. ne pas relancer immédiatement si la première requête est encore en cours ou si le résultat est ambigu.\n\n### 6.6 Dossier de contrôle d’une mission\n\nLe dossier est accessible par **Dossier de contrôle**. Il comporte plusieurs zones.\n\n**A. En-tête et synthèse de mission**  \nPrésente le titre, la direction, l’agent, le statut, la progression, l’état de la revue et le nombre de validations en attente. Un motif de blocage peut être affiché.\n\n**B. Soumission de l’agent**  \nLire la synthèse, l’analyse, les livrables de mission et les résultats par tâche. Vérifier que les résultats sont concrets, spécifiques au mandat et cohérents avec les critères de réussite. Un texte générique ou une simple affirmation d’achèvement ne suffit pas.\n\n**C. Revue indépendante**  \nPrésente le verdict de la revue, l’identité ou le type du contrôleur, le modèle éventuellement indiqué, le score qualité, les contrôles qualité et les constats. Le contrôleur indépendant évalue la soumission ; il ne prend pas la décision de clôture.\n\nLes constats peuvent comporter un code, une sévérité, une description et des citations de preuve. Lire chaque anomalie et vérifier la traçabilité des citations.\n\n**D. Tâches opérationnelles**  \nAffiche les tâches rattachées, leur statut, leur progression, leur priorité et leurs éventuels blocages. Une mission terminée dont les tâches ne sont pas terminées présente une incohérence qui doit être corrigée.\n\n**E. Historique de contrôle et validations**  \nPrésente les événements, les dates, les acteurs, les données de contrôle et les validations enregistrées. Cet historique sert à comprendre la séquence des actions et à conserver la traçabilité.\n\n**F. Décision de la Direction générale**  \nCette zone n’est affichée qu’aux personnes habilitées lorsque les conditions le permettent.\n\n- **Demander une correction et relancer** : saisir un motif précis d’au moins 8 caractères, puis cliquer. Décrire les éléments manquants, les preuves à fournir, les analyses à reprendre et les critères à respecter. La demande est journalisée et la mission retourne dans la file de traitement. La revue précédente est invalidée jusqu’à une nouvelle soumission et une nouvelle revue.\n- **Valider et clôturer la mission** : action réservée à l’autorité habilitée. Le bouton n’est disponible que si la revue indépendante est acceptée. La clôture exige aussi que toutes les tâches attendues soient achevées à 100 % avec leurs livrables. Lire l’intégralité du dossier avant de confirmer.\n\nUne revue indépendante acceptée n’est pas une clôture automatique. Une mission ne doit pas être clôturée si une preuve manque, si une tâche reste incomplète, si une anomalie bloquante demeure ou si l’approbation humaine requise n’a pas été donnée.\n\n---\n\n## 7. Directions — organigramme opérationnel\n\n### 7.1 Finalité\n\nL’onglet Directions présente les fonctions institutionnelles, leur nature, leur rattachement, leur mandat, leur responsable humain et/ou leur agent directeur.\n\nLa structure comprend des fonctions exécutives, opérationnelles, de contrôle, de support et des fonctions indépendantes ou réservées à l’autorité humaine. Les fonctions indépendantes et humaines ne relèvent pas de la chaîne de commandement du COO.\n\n### 7.2 Lire une fiche direction\n\nChaque ligne peut présenter :\n- le nom de la direction ;\n- sa catégorie ;\n- son rattachement hiérarchique ;\n- le caractère opérationnel ou indépendant ;\n- le responsable désigné ;\n- le mandat ;\n- l’état actif ou inactif.\n\n### 7.3 Modifier un mandat\n\nPour une direction modifiable :\n1. lire le mandat actuel ;\n2. modifier le texte pour préciser la mission, les responsabilités, les limites et les livrables ;\n3. cliquer sur **Enregistrer** ;\n4. attendre la confirmation ;\n5. actualiser et vérifier que le texte enregistré est toujours présent.\n\nUn mandat doit rester institutionnel, précis et compatible avec la séparation des fonctions. Ne pas donner à une direction opérationnelle le pouvoir de valider ses propres travaux ou de neutraliser un contrôle indépendant.\n\n### 7.4 Désigner les responsables\n\nPour les directions autorisées, sélectionner :\n- un **Responsable humain** parmi les membres disposant d’un rôle approprié ;\n- un **Agent directeur** parmi les agents actifs compatibles avec la direction.\n\nCliquer sur **Enregistrer** pour enregistrer le mandat et les responsables affichés. Éviter de désigner deux responsables incompatibles ou de confier une fonction indépendante à un agent opérationnel.\n\nLa Direction des Opérations (COO) est gérée par la Direction générale. Les fonctions protégées et la Direction générale ne sont pas modifiables comme des directions ordinaires.\n\n### 7.5 Activer ou désactiver une direction\n\nLe bouton **Activer / Désactiver** est disponible uniquement pour les directions éligibles. Avant de désactiver une direction, vérifier qu’elle ne porte pas de missions ou de tâches actives et prévoir leur réaffectation. Une direction indépendante ou humaine protégée ne doit pas être désactivée par le COO.\n\n---\n\n## 8. Tâches & affectations\n\n### 8.1 Finalité\n\nLa tâche représente une unité de travail concrète, attribuable à une direction, à un agent IA et/ou à un collaborateur humain. Elle doit être suffisamment précise pour que son résultat soit vérifiable.\n\n### 8.2 Créer et attribuer une tâche\n\nRenseigner :\n\n- **Direction** : choisir une direction active autorisée.\n- **Mission associée** : sélectionner une mission de la même direction, ou choisir « Aucune » si la tâche n’est pas rattachée à une mission.\n- **Agent responsable** : sélectionner un agent actif compatible avec la direction, ou « Non affecté ».\n- **Collaborateur responsable** : sélectionner un membre humain autorisé, ou « Non affecté ».\n- **Intitulé** : décrire l’action à réaliser.\n- **Description / critères de réalisation** : préciser le périmètre, les étapes, les pièces attendues et les critères d’acceptation.\n- **Priorité** : 1 critique, 2 haute, 3 normale, 4 basse, 5 très basse.\n- **Échéance** : définir une date et une heure réalistes.\n\nLa sélection de la direction filtre les agents et les missions compatibles. Si une mission attendue n’apparaît pas, vérifier qu’elle appartient à la direction choisie.\n\nCliquer sur **Attribuer la tâche**. Le système enregistre et journalise la tâche. Vérifier qu’elle apparaît ensuite dans **Suivi des tâches**.\n\n### 8.3 Mettre à jour le statut\n\nDans **Suivi des tâches**, utiliser la liste de statut de la tâche :\n\n- **À faire** : travail non commencé ;\n- **En cours** : travail commencé ;\n- **Bloquée** : obstacle empêchant l’avancement ;\n- **Terminée** : travail déclaré terminé ;\n- **Annulée** : travail abandonné avec motif approprié dans le suivi opérationnel.\n\nNe choisir **Terminée** que lorsque le travail est réellement achevé et que le livrable attendu existe. Une tâche terminée peut encore nécessiter un contrôle de preuve ou une revue dans le dossier de mission.\n\nLorsqu’une tâche est bloquée, documenter le motif dans le processus de suivi approprié, identifier le responsable du déblocage et, si nécessaire, signaler l’alerte au COO.\n\n### 8.4 Bonnes pratiques de découpage\n\nUne mission complexe doit être découpée en tâches distinctes, par exemple :\n1. cadrage et collecte des informations ;\n2. analyse et vérification ;\n3. production d’un livrable ;\n4. contrôle qualité ;\n5. consolidation et soumission.\n\nChaque tâche doit avoir un responsable, une échéance, une priorité et un résultat observable. Éviter les tâches trop larges telles que « faire toute l’étude ».\n\n---\n\n## 9. Alertes — centre de traitement\n\n### 9.1 Types de situations signalées\n\nLe centre d’alertes peut faire remonter :\n- mission en retard ;\n- mission en échec ;\n- mission bloquée ou suspendue ;\n- validation en attente depuis trop longtemps ;\n- tâche en retard ;\n- tâche bloquée.\n\nLes alertes possèdent un niveau de sévérité, un titre, une description, une date et éventuellement un lien avec une mission ou une tâche.\n\n### 9.2 Prendre en charge une alerte\n\n1. Ouvrir l’onglet **Alertes**.\n2. Lire le titre et la description.\n3. Identifier la mission ou la tâche concernée.\n4. Cliquer sur **Prendre en charge**.\n5. Vérifier que l’état de l’alerte a été actualisé.\n\nLa prise en charge indique qu’un responsable s’occupe du sujet ; elle ne signifie pas que le problème est résolu.\n\n### 9.3 Résoudre une alerte\n\n1. Vérifier que la cause de l’alerte a disparu ou que le risque a été traité.\n2. Vérifier le statut de la mission ou de la tâche concernée.\n3. Cliquer sur **Résoudre**.\n4. Actualiser le centre d’alertes.\n\nNe pas résoudre une alerte uniquement pour faire disparaître un signal visuel. Si la situation persiste, l’alerte peut être réouverte par le mécanisme de surveillance.\n\n---\n\n## 10. Reporting à la Direction générale\n\n### 10.1 Finalité\n\nLe reporting DG consolide les données opérationnelles et les présente sous une forme lisible, archivable et exportable. Il sert à informer la Direction générale sur les missions, tâches, directions, alertes, risques, décisions requises et qualité des données.\n\n### 10.2 Générer un rapport\n\n1. Ouvrir **Reporting DG**.\n2. Vérifier le workspace.\n3. Cliquer sur **Générer un rapport maintenant**.\n4. Attendre la confirmation.\n5. Vérifier si un nouveau rapport a été créé ou si un rapport identique existe déjà.\n6. Consulter la liste des rapports archivés.\n\nLa génération peut être idempotente : si un rapport identique existe déjà pour la période, l’application peut indiquer qu’il n’a pas été recréé. Cela évite les doublons.\n\n### 10.3 Consulter un rapport archivé\n\nCliquer sur **Consulter** à côté du rapport. Le détail contient notamment :\n1. synthèse exécutive ;\n2. performance par direction ;\n3. missions à risque ;\n4. alertes prioritaires ;\n5. décisions et escalades ;\n6. état des missions terminées vérifiées et non vérifiées ;\n7. constats de qualité et de réconciliation des données.\n\nLire les limites de données et les anomalies avant de transmettre le rapport. Un rapport est un instantané des informations disponibles au moment de sa génération ; il ne remplace pas le suivi courant.\n\nLes indicateurs de portefeuille (missions actives, missions en retard, tâches ouvertes, alertes et validations) décrivent l’état complet du workspace au moment de la génération. Les compteurs « missions créées sur la période » et « tâches créées sur la période » isolent les nouvelles créations comprises entre les deux bornes. Un rapport archivé est conservé comme preuve et n’est pas réécrit lors d’une nouvelle consultation.\n\n### 10.4 Copier ou télécharger\n\nDans le détail d’un rapport :\n\n- **Copier** : copie le contenu textuel du rapport dans le presse-papiers.\n- **Télécharger PDF** : produit un fichier PDF.\n- **Télécharger Word** : produit un document Word modifiable.\n\nAprès export, ouvrir le fichier pour vérifier le titre, la période, les chiffres, les accents, les tableaux et les sauts de page avant diffusion.\n\n### 10.5 Contrôles de réconciliation à lire attentivement\n\nLe rapport peut signaler :\n- missions terminées sans tâches opérationnelles ;\n- missions déclarées terminées alors que des tâches ne le sont pas ;\n- missions sans direction identifiable ;\n- écarts entre le total des missions affectées et la somme des missions par direction ;\n- écarts entre le total des tâches affectées et la ventilation par direction ;\n- tâches rattachées à une direction différente de celle de leur mission.\n\nCes constats indiquent une anomalie de qualité ou de traçabilité. Ils doivent être investigués et corrigés à la source. Ne pas ajuster manuellement un chiffre dans le rapport pour masquer un écart.\n\n### 10.6 Rapport automatique quotidien\n\nLe paramètre **Rapport automatique quotidien** peut être activé ou désactivé dans les paramètres COO. La génération automatique dépend aussi du worker planifié et de la configuration de l’environnement. Une option activée dans l’interface ne constitue pas, à elle seule, une preuve que le cron est opérationnel dans un environnement Preview.\n\n---\n\n## 11. Paramètres COO — mandat, autonomie et sécurité\n\n### 11.1 Accès et prudence\n\nLes paramètres sont réservés au propriétaire pour l’enregistrement dans l’interface. Les changements affectent le fonctionnement du COO IA. Ne les modifier qu’après validation explicite de la Direction générale.\n\n### 11.2 Agent COO désigné\n\nChoisir l’agent actif prévu pour le rôle COO. Vérifier son identité avant l’enregistrement. Si aucun agent n’est désigné, ne pas supposer que le moteur peut orchestrer normalement.\n\n### 11.3 Niveau d’autonomie\n\n- **Niveau 1 — Proposer et planifier** : le COO prépare les propositions et plans ; les actions restent soumises aux validations et interventions prévues.\n- **Niveau 2 — Déléguer les opérations réversibles** : le COO peut planifier et déléguer des opérations réversibles dans le périmètre autorisé.\n- Le niveau 3 n’est pas proposé dans cette interface : il reste verrouillé jusqu’à la réussite de contrôles de sécurité et une décision distincte de la Direction générale.\n\nNe pas choisir le niveau supérieur disponible sans vérifier les délégations, les agents, les limites et les contrôles humains.\n\n### 11.4 Activation du moteur\n\n- **Activé** : le moteur COO peut fonctionner sous réserve des autres conditions.\n- **Désactivé** : les nouvelles orchestrations sont désactivées.\n\nLa désactivation ne doit pas être confondue avec la suppression des données ou l’annulation des missions déjà enregistrées.\n\n### 11.5 Arrêt d’urgence\n\nL’option **ACTIVÉ — bloquer les nouvelles orchestrations** déclenche le coupe-circuit du COO. Elle doit être utilisée en cas d’incident, de comportement inattendu ou de risque de lancement non autorisé. Après activation :\n1. ne pas relancer le worker ;\n2. prévenir la Direction générale et le responsable technique ;\n3. identifier les missions et actions en cours ;\n4. documenter l’incident ;\n5. ne désactiver le coupe-circuit qu’après autorisation et vérification.\n\nL’arrêt d’urgence bloque les nouvelles orchestrations ; il ne doit pas être interprété comme une annulation rétroactive de toutes les opérations déjà engagées.\n\n### 11.6 Rapport quotidien\n\nChoisir **Activé** ou **Désactivé** selon la décision de gouvernance. Cliquer sur **Enregistrer les paramètres du COO IA**, attendre le message de confirmation et vérifier les valeurs après rechargement.\n\n### 11.7 Enregistrer les paramètres\n\nAvant de cliquer :\n- confirmer l’agent COO ;\n- confirmer le niveau d’autonomie ;\n- confirmer l’état du moteur ;\n- confirmer l’état du coupe-circuit ;\n- confirmer l’option de rapport quotidien.\n\nAprès l’enregistrement, vérifier le message de succès et relire les valeurs affichées. En cas d’erreur ou de doute, ne pas répéter plusieurs fois sans vérifier l’état serveur.\n\n---\n\n## 12. Équipe & Gouvernance — espace lié\n\nLe lien **Équipe & Gouvernance** ouvre un espace distinct de gestion de l’équipe, des agents et de la gouvernance du workspace. Il ne s’agit pas d’un onglet du poste COO.\n\nDepuis cet espace, les utilisateurs autorisés peuvent accéder aux fonctions de gestion prévues par leur rôle, notamment les agents IA, les membres et les rôles. Les règles d’accès du workspace continuent de s’appliquer.\n\nAvant d’inviter un membre ou d’activer un agent :\n1. vérifier l’identité et le besoin d’accès ;\n2. appliquer le principe du moindre privilège ;\n3. attribuer le rôle approprié ;\n4. vérifier que l’agent est rattaché à la bonne direction ;\n5. ne pas attribuer de pouvoirs d’approbation humaine à un agent IA.\n\nCe manuel décrit le lien et son rôle dans le parcours COO, mais ne prétend pas remplacer une procédure détaillée de chaque écran de gestion de l’espace Équipe & Gouvernance, qui constitue un module distinct.\n\n---\n\n## 13. Procédures de bout en bout\n\n### 13.1 Cycle normal d’une mission\n\n1. La Direction générale définit un objectif et un mandat.\n2. Le COO reçoit une instruction ou un utilisateur habilité crée une mission.\n3. La mission est rattachée à une direction et à un agent actif.\n4. Le travail est découpé en tâches avec responsables, priorités et échéances.\n5. Le worker exécute les missions éligibles.\n6. Les agents produisent une synthèse, une analyse et des livrables concrets.\n7. Les résultats et preuves sont enregistrés.\n8. Une revue indépendante examine la qualité, la traçabilité et les constats.\n9. Si des corrections sont requises, le responsable demande une reprise motivée.\n10. L’agent soumet une nouvelle version ; la revue indépendante est renouvelée.\n11. Lorsque les critères sont réunis, l’autorité humaine examine le dossier.\n12. L’autorité humaine décide de valider et clôturer, de demander une correction ou de rejeter selon les options disponibles.\n13. Le rapport DG et le journal d’audit conservent la trace des opérations.\n\n### 13.2 Traitement d’une mission en retard\n\n1. Repérer la mission sur la Vue centrale ou dans les Alertes.\n2. Ouvrir le Portefeuille et le Dossier de contrôle.\n3. Identifier la tâche ou la dépendance à l’origine du retard.\n4. Vérifier le responsable, l’échéance et le motif.\n5. Réaffecter ou replanifier uniquement si l’utilisateur possède les droits et si le mandat le permet.\n6. Documenter la décision et suivre l’alerte.\n7. Ne résoudre l’alerte qu’après traitement de la cause.\n\n### 13.3 Traitement d’une mission bloquée\n\n1. Lire le motif de blocage.\n2. Déterminer s’il s’agit d’une dépendance, d’un manque de données, d’un défaut d’agent, d’une validation attendue ou d’un problème technique.\n3. Ne pas modifier arbitrairement le statut pour faire disparaître le blocage.\n4. Affecter une action de déblocage à un responsable compétent.\n5. Escalader à la Direction générale si une décision réservée est nécessaire.\n6. Actualiser le dossier et suivre le résultat.\n\n### 13.4 Traitement d’une anomalie de reporting\n\n1. Ouvrir le rapport concerné.\n2. Lire le constat exact de réconciliation.\n3. Identifier les missions, tâches et directions concernées.\n4. Ouvrir les dossiers sources.\n5. Corriger le rattachement ou le statut à la source, selon les droits et les preuves.\n6. Actualiser le reporting et générer un nouveau rapport si nécessaire.\n7. Vérifier que l’écart a disparu et que l’historique reste explicable.\n\n---\n\n## 14. Bonnes pratiques de saisie et de qualité\n\n### Une bonne instruction\n\nUne instruction efficace précise : contexte, objectif, périmètre, directions impliquées, contraintes, échéance, livrables, preuves attendues et critères d’acceptation.\n\n### Une bonne mission\n\nUne mission possède un intitulé unique et compréhensible, un objectif mesurable, un responsable, une priorité justifiée, une échéance réaliste et des livrables vérifiables.\n\n### Une bonne tâche\n\nUne tâche décrit une action concrète, un résultat observable, un responsable, une échéance et des critères d’achèvement. Elle ne doit pas être un doublon d’une autre tâche.\n\n### Une bonne revue\n\nLe contrôleur doit pouvoir retrouver la preuve, comprendre le raisonnement, vérifier la cohérence des conclusions et distinguer les faits, les hypothèses et les recommandations.\n\n### Une bonne clôture\n\nAvant clôture, vérifier au minimum :\n- objectif atteint ;\n- livrables présents et exploitables ;\n- tâches achevées ;\n- preuves traçables ;\n- revue indépendante acceptée ;\n- constats bloquants traités ;\n- validation humaine enregistrée par l’autorité habilitée.\n\n---\n\n## 15. Résolution des difficultés courantes\n\n| Symptôme | Vérification et action recommandée |\n|---|---|\n| La page demande une connexion | Se reconnecter avec le compte membre du workspace. |\n| Aucun workspace n’apparaît | Demander au propriétaire de vérifier l’invitation et l’adhésion au workspace. |\n| Accès refusé | Vérifier le rôle et demander l’habilitation requise ; ne pas contourner le contrôle. |\n| La vue ne se met pas à jour | Lire le message d’état, actualiser une fois, puis vérifier le serveur avant de répéter une action. |\n| Un agent n’apparaît pas dans une liste | Vérifier qu’il est actif et rattaché à la direction sélectionnée. |\n| Une mission n’apparaît pas pour une tâche | Vérifier le workspace et la direction de la mission. |\n| L’exécution ne démarre pas | Vérifier l’état du moteur, le coupe-circuit, l’agent, l’éligibilité de la mission et les validations en attente. |\n| La mission reste en attente de contrôle | Ouvrir le dossier, examiner la soumission et la revue indépendante ; ne pas forcer la clôture. |\n| Le bouton de clôture est désactivé | Vérifier que la revue indépendante est acceptée, que les tâches sont terminées à 100 % et que le compte possède le droit de validation. |\n| Une alerte réapparaît | Vérifier si la cause est toujours active ; une alerte peut être réouverte par la surveillance. |\n| Le rapport ne se régénère pas | Vérifier si un rapport identique existe déjà pour la période. |\n| Un export PDF ou Word échoue | Actualiser la page, vérifier le chargement du module d’export et réessayer une fois. |\n| Les chiffres du rapport ne réconcilient pas | Traiter l’anomalie dans les données sources ; ne pas modifier le chiffre du rapport manuellement. |\n\nEn cas de panne persistante, conserver le message d’erreur exact, l’heure, le workspace, l’onglet, l’opération tentée et l’identifiant de mission ou de tâche. Ne jamais transmettre de mot de passe, de jeton ou de secret dans le signalement.\n\n---\n\n## 16. Sécurité, confidentialité et conservation\n\n- Utiliser uniquement un compte personnel autorisé.\n- Ne pas partager les identifiants de connexion.\n- Se déconnecter ou protéger l’appareil lorsqu’il est partagé.\n- Ne pas inclure de secrets, mots de passe ou clés API dans les contenus métier.\n- Ne pas exporter ou diffuser un rapport à des personnes non autorisées.\n- Vérifier les destinataires avant de copier ou télécharger un dossier.\n- Respecter les rôles et la séparation des fonctions.\n- Ne pas supprimer, désactiver ou réaffecter un élément sans comprendre ses dépendances.\n- En cas d’incident, préserver les informations utiles et alerter la Direction générale / le responsable technique.\n\n---\n\n## 17. Liste de contrôle opérationnelle\n\n### À chaque ouverture\n- [ ] Bon lien COO et bon environnement.\n- [ ] Connexion établie.\n- [ ] Bon workspace sélectionné.\n- [ ] Rôle affiché correctement.\n- [ ] Vue centrale actualisée.\n\n### Chaque jour\n- [ ] Missions en retard et bloquées examinées.\n- [ ] Tâches en retard et bloquées examinées.\n- [ ] Alertes critiques prises en charge.\n- [ ] Validations humaines en attente identifiées.\n- [ ] Dossiers de mission prioritaires examinés.\n- [ ] Reporting DG consulté ou généré selon la procédure.\n\n### Avant toute exécution\n- [ ] Mandat clair et autorisé.\n- [ ] Direction et agent actifs corrects.\n- [ ] Tâches et critères de réussite définis.\n- [ ] Échéance et priorité cohérentes.\n- [ ] Moteur activé et coupe-circuit inactif.\n- [ ] Aucune approbation humaine préalable manquante.\n\n### Avant toute clôture\n- [ ] Synthèse et analyse examinées.\n- [ ] Livrables concrets vérifiés.\n- [ ] Toutes les tâches achevées et documentées.\n- [ ] Revue indépendante acceptée.\n- [ ] Constats bloquants traités.\n- [ ] Décision humaine prise par l’autorité habilitée.\n\n---\n\n## 18. Gouvernance documentaire\n\nCe manuel décrit le fonctionnement de l’interface COO observé dans la version de l’application qui l’intègre. Si un écran, un bouton, un droit ou un processus évolue, le manuel doit être révisé et sa version mise à jour.\n\n**Propriétaire du document :** Direction générale / Gouvernance & Conformité.  \n**Responsable de mise à jour :** Documentation & Reporting, avec validation de la Direction générale.  \n**Règle de diffusion :** utiliser la copie intégrée à l’application comme référence courante ; les copies téléchargées sont des instantanés et peuvent devenir obsolètes après une mise à jour logicielle.\n\n**Fin du manuel.**\n\n\n---\n\n## 19. Module « Équipe & Gouvernance » — procédures de chaque fenêtre\n\n### 19.1 Ouvrir le module et choisir le workspace\n\nLe lien **Équipe & Gouvernance** ouvre la page \`/team\`. Ce module est distinct du poste COO, mais il utilise le même compte et le même espace de travail.\n\nLa barre supérieure permet :\n- de sélectionner un workspace auquel le compte a accès ;\n- de voir le rôle du compte et le nombre de membres affiché ;\n- de créer un espace avec le champ de nom et le bouton **Créer** lorsque cette action est autorisée ;\n- de naviguer entre les quatorze onglets du module.\n\nToujours vérifier le workspace avant d'inviter un membre, de créer un agent, de déposer un document ou d'approuver une action. Les données et les droits restent cloisonnés par workspace.\n\n### 19.2 Vue générale\n\n**Objectif :** obtenir une synthèse de l'activité collaborative du workspace.\n\nLes indicateurs affichés comprennent :\n- **Membres** : nombre de membres ;\n- **Débats** : nombre de débats enregistrés ;\n- **Débats en cours** : débats encore en traitement ;\n- **Tâches ouvertes** : tâches non terminées ;\n- **En retard** : tâches en retard ;\n- **Validations en attente** : décisions humaines en attente ;\n- **Documents** : documents enregistrés dans l'espace.\n\nLa zone **Activité récente** présente les dernières actions journalisées avec leur date.\n\n**Procédure de consultation :**\n1. sélectionner le workspace ;\n2. ouvrir **Vue générale** ;\n3. examiner les indicateurs ;\n4. lire les dernières activités ;\n5. ouvrir l'onglet métier correspondant à chaque anomalie.\n\nLes chiffres sont une synthèse. Pour examiner une opération, consulter sa fiche détaillée ou son journal d'audit.\n\n### 19.3 Agents IA\n\n**Objectif :** superviser les agents spécialisés du workspace et gérer leur cycle de vie.\n\nLa page présente :\n- les agents actifs ;\n- les missions en attente et en cours ;\n- les approbations requises ;\n- les délégations en attente ;\n- les mémoires proposées à validation.\n\n**Créer les six profils de département (brouillons)** : cette action initialise les profils prévus comme brouillons. Elle ne signifie pas que tous les agents sont immédiatement actifs. Vérifier ensuite la liste.\n\n**Créer un agent spécialisé :**\n1. saisir le **Nom de l’agent** ;\n2. saisir un identifiant technique unique dans **identifiant-agent** ;\n3. renseigner la **Spécialité** ;\n4. rédiger un **Mandat détaillé** d'au moins dix caractères, décrivant la mission, le périmètre, les responsabilités, les limites et les livrables ;\n5. renseigner les **Instructions système complémentaires** si nécessaire ;\n6. choisir le niveau d'autonomie :\n   - **L1 · Analyse** : analyser et proposer ;\n   - **L2 · Production de livrables** : produire des résultats dans le périmètre autorisé ;\n   - **L3 · Actions autorisées sous contrôle** : capacité plus sensible, à n'utiliser qu'après vérification des permissions et des contrôles applicables ;\n7. cliquer sur **Créer l’agent en brouillon** ;\n8. relire le mandat et vérifier le rattachement avant activation.\n\nUn agent en brouillon ne doit pas être considéré comme opérationnel. Les boutons **Activer** sont réservés aux rôles autorisés, notamment propriétaire ou administrateur, et ne s'affichent que pour les agents en brouillon.\n\n**Exécuter une étape de mission (Preview)** : déclenche une étape du worker dans l'environnement Preview. Cette opération peut prendre en charge une mission éligible et produire un résultat. Elle est réservée au propriétaire ou à l'administrateur dans cette interface. Vérifier la mission et son résultat après exécution ; ne pas lancer plusieurs fois une opération encore en cours.\n\n### 19.4 Missions — file de travail des agents\n\nCet onglet permet de créer une mission directement dans la file de travail des agents et de consulter son historique.\n\n**Créer une mission :**\n1. choisir un **Agent responsable** parmi les agents actifs ;\n2. saisir un **Titre** explicite ;\n3. décrire l’**Objectif** et le résultat attendu ;\n4. compléter le **Contexte complémentaire** avec les informations utiles, contraintes, hypothèses et références ;\n5. choisir la **Priorité** (1 très haute, 2 haute, 3 normale, 4 basse, 5 très basse) ;\n6. cliquer sur **Enregistrer la mission** ;\n7. vérifier le message de confirmation et le statut attribué.\n\nLa mission est enregistrée dans la file serveur. Elle ne sera exécutée que lorsque le worker et les conditions d'éligibilité le permettront.\n\n**Consulter les détails :**\n1. ouvrir l'historique ;\n2. cliquer sur **Détails** sur la mission choisie ;\n3. examiner l'objectif, le statut, le nombre de tentatives, le résultat et le journal d'événements ;\n4. examiner le panneau **Contrôle qualité & décision COO**.\n\nLe panneau de contrôle indique l'état de la revue, l'éligibilité de clôture et les événements relatifs à la soumission, aux preuves et aux décisions. La déclaration de fin de l'agent n'est pas une clôture.\n\nLorsque le compte est propriétaire ou administrateur et qu'une soumission attend une revue, les actions possibles sont :\n\n- **Valider et clôturer** : confirme la clôture après examen du résultat et des contrôles. Une confirmation explicite est demandée.\n- **Retourner en correction** : saisir une note d'au moins dix caractères, préciser les éléments à reprendre, puis confirmer. La mission repart en correction.\n- **Rejeter le livrable** : saisir une note d'au moins dix caractères, expliquer le motif du rejet, puis confirmer.\n\nLe détail peut aussi proposer :\n- **Copier** : copie la conclusion ou le rapport ;\n- **Word** : télécharge une version compatible Word ;\n- **PDF** : ouvre la fenêtre d'impression ; choisir « Enregistrer au format PDF » ;\n- **Écouter la conclusion** : lance la lecture vocale du rapport si le navigateur le permet.\n\nAprès toute décision, vérifier le statut et le journal d'événements. Ne pas valider un résultat non vérifié ou un livrable incomplet.\n\n### 19.5 Délégations — messages inter-agents\n\n**Objectif :** transmettre un travail d'un agent actif à un autre agent actif.\n\nChamps :\n- **Agent émetteur** : agent qui formule la délégation ;\n- **Agent destinataire** : agent qui reçoit le travail ; il doit être différent de l'émetteur ;\n- **Objet** : sujet court de la délégation ;\n- **Consigne de délégation** : instructions détaillées, périmètre, livrables et critères de qualité.\n\nProcédure :\n1. choisir l'émetteur ;\n2. choisir le destinataire ;\n3. saisir un objet explicite ;\n4. rédiger les instructions ;\n5. cliquer sur **Envoyer la délégation** ;\n6. vérifier le message de confirmation ;\n7. consulter l'**Historique des messages inter-agents**.\n\nUne délégation crée un message durable. Le worker peut ensuite le convertir en mission pour l'agent destinataire. Le traitement est conçu pour éviter la création répétée de la même mission. Un message envoyé ne signifie pas que le destinataire a déjà terminé le travail.\n\n### 19.6 Approbations IA — autoriser la reprise d'un workflow\n\nCette fenêtre liste les actions d'agents qui attendent une décision humaine. Chaque ligne indique la clé de l'action, le niveau de risque, la date et la mission concernée.\n\nPour chaque demande :\n1. ouvrir la ligne et identifier la mission ;\n2. consulter le dossier de mission et les informations disponibles ;\n3. comprendre précisément l'action demandée et son risque ;\n4. cliquer sur **Approuver** ou **Rejeter** ;\n5. vérifier que la décision est enregistrée.\n\nUne approbation autorise uniquement la reprise du workflow enregistré. Elle ne réalise pas à elle seule une action externe et ne doit pas être considérée comme une autorisation générale pour d'autres opérations. En cas de doute, rejeter ou demander des précisions plutôt que d'approuver par défaut.\n\n### 19.7 Notifications\n\nLa page **Notifications** rassemble les messages associés au compte : titre, contenu, date et état lu / non lu.\n\n- **Marquer comme lu** : marque une notification individuelle comme consultée.\n- **Tout marquer comme lu** : marque toutes les notifications affichées comme lues.\n\nLa lecture d'une notification ne clôture pas la mission ou l'alerte à laquelle elle se rapporte. Après lecture, ouvrir l'élément métier pour traiter l'action éventuellement attendue.\n\n### 19.8 Membres — invitations, rôles et révocations\n\nCette fenêtre permet de consulter les membres et, selon les droits, de gérer les accès.\n\n**Inviter un membre :**\n1. saisir son adresse e-mail ;\n2. choisir le rôle initial : **Viewer**, **Editor** ou **Admin** ;\n3. cliquer sur **Inviter** ;\n4. vérifier la confirmation ;\n5. suivre l'invitation dans la zone **En attente**, qui indique l'adresse, le rôle et l'expiration.\n\n**Modifier un rôle :** utiliser la liste de rôle associée au membre. Le serveur applique les limites de gouvernance : le propriétaire conserve son statut ; un administrateur ne peut gérer que les rôles inférieurs autorisés, notamment Editor et Viewer.\n\n**Retirer un membre :** utiliser **Retirer** uniquement après avoir vérifié que la personne n'a plus besoin d'accéder au workspace et que ses responsabilités ont été reprises.\n\n**Révoquer une invitation :** dans la zone **En attente**, cliquer sur **Révoquer** pour invalider l'invitation correspondante.\n\nRègles :\n- le propriétaire ne peut pas être remplacé par une simple modification de rôle ;\n- un administrateur ne peut pas promouvoir un membre au-delà des limites prévues ;\n- un éditeur ou un lecteur ne gère pas les adhésions ;\n- appliquer le principe du moindre privilège ;\n- vérifier l'adresse e-mail avant l'envoi.\n\n### 19.9 Débats — délibération contradictoire multi-agents\n\nCette fenêtre sert à rattacher une délibération à une mission ouverte ou à créer une mission de diagnostic dédiée.\n\n**Choisir ou créer la mission :**\n- si une mission ouverte éligible existe, la sélectionner ;\n- sinon, renseigner le titre, l'objectif, l'agent responsable et le contexte du diagnostic, puis créer la mission dans l'environnement prévu.\n\n**Constituer la délibération :**\n1. sélectionner au moins deux agents actifs participants ;\n2. choisir un **Arbitre indépendant** ;\n3. vérifier que l'arbitre est différent des agents participants ;\n4. choisir le nombre de tours (2 à 5) ;\n5. cliquer sur **Créer et rattacher le débat**.\n\nLa délibération ne doit pas être créée si le nombre d'agents est insuffisant, si l'arbitre n'est pas désigné ou si l'arbitre participe lui-même comme agent débattant.\n\n**Exécuter le worker Preview :**\n1. vérifier que la mission et la délibération sont correctement enregistrées ;\n2. cliquer sur **Exécuter le worker maintenant** ;\n3. lire le résultat du worker ;\n4. vérifier si une mission a été prise en charge et si le traitement a abouti ;\n5. actualiser et consulter les délibérations enregistrées.\n\nLe worker ne crée pas une nouvelle mission lorsqu'il est déclenché depuis cette zone : il traite une mission admissible déjà présente dans la file.\n\n**Consulter les détails d'une délibération :**\n- examiner le statut, le nombre de tours, les contributions et les preuves ;\n- lire les constats et l'arbitrage ;\n- lire les désaccords non résolus et les limites ;\n- utiliser **Copier le rapport**, **Télécharger Word**, **Exporter PDF** ou **Écouter la conclusion** selon le besoin.\n\nLorsque l'arbitrage exige une validation humaine et que le compte possède les droits, la zone de validation permet **Approuver l’arbitrage** ou **Rejeter l’arbitrage**. La décision est enregistrée et auditée. Lire le rapport complet avant de prendre cette décision.\n\n### 19.10 Tâches — suivi de l'exécution\n\nLa page liste les tâches avec leur titre, leur statut, leur priorité et leur échéance.\n\n**Créer une tâche :**\n1. saisir le titre ;\n2. décrire le travail dans **Description** ;\n3. choisir la priorité : normal, low, high ou critical ;\n4. renseigner l'échéance si nécessaire ;\n5. cliquer sur **Créer**.\n\n**Mettre à jour une tâche :** utiliser la liste de statut associée à la tâche :\n- À faire ;\n- En cours ;\n- Bloquée ;\n- Terminée ;\n- Annulée.\n\nNe choisir « Terminée » qu'après réalisation réelle. Le statut doit rester cohérent avec les livrables et les preuves de la mission associée.\n\n### 19.11 Validations — approbations liées aux débats\n\nCette fenêtre présente les demandes de validation associées aux débats, leur identifiant et leur statut.\n\n**Demander une validation :**\n1. saisir l'ID exact du débat ;\n2. rédiger une note expliquant l'objet de la demande ;\n3. cliquer sur **Demander validation** ;\n4. vérifier que la demande apparaît dans la liste.\n\n**Traiter une demande en attente :** les comptes owner ou admin autorisés peuvent cliquer sur **Approuver** ou **Rejeter**. La décision met à jour le statut de la demande. Vérifier l'identifiant du débat et le rapport associé avant de décider.\n\nNe pas confondre cette fenêtre avec **Approbations IA** : les validations portent sur des demandes liées aux débats, tandis que les approbations IA portent sur des actions de workflow d'agents.\n\n### 19.12 Documents — coffre documentaire privé\n\nLa page **Documents** présente les documents enregistrés avec leur titre, leur type MIME et leur taille.\n\n**Formats annoncés par l'interface :** PDF, TXT, CSV, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, JPEG, PNG et WEBP. La limite indiquée est de 50 Mo par document. Le stockage est privé et le téléchargement utilise une URL temporaire.\n\n**Téléverser un document :**\n1. saisir un titre ou laisser le nom du fichier être repris ;\n2. choisir le fichier dans le sélecteur ;\n3. vérifier le nom et la taille ;\n4. cliquer sur **Téléverser et enregistrer** ;\n5. attendre la confirmation ;\n6. vérifier que le document apparaît dans la liste.\n\n**Télécharger un document :**\n1. retrouver le document dans la liste ;\n2. cliquer sur **Télécharger** ;\n3. le système demande une URL temporaire de téléchargement ;\n4. ouvrir le fichier et vérifier qu'il s'agit du bon document.\n\nNe téléverser que des documents autorisés pour ce workspace. Vérifier les droits d'accès et la sensibilité du contenu avant partage.\n\n### 19.13 Audit — journal et export CSV\n\nLe journal d'audit présente les événements enregistrés avec l'action, le type d'entité et la date.\n\n**Consulter :**\n1. ouvrir **Audit** ;\n2. rechercher l'action ou l'entité concernée dans la chronologie ;\n3. relever la date et le contexte ;\n4. rapprocher l'événement du dossier de mission, de la tâche, du membre ou du débat.\n\n**Exporter CSV :** cliquer sur **Exporter CSV**, attendre le téléchargement, puis ouvrir le fichier avec un tableur. Conserver le fichier dans un emplacement autorisé et ne pas le diffuser à des personnes non habilitées.\n\nLe journal d'audit est un outil de traçabilité ; il ne remplace pas le contenu complet des dossiers métier.\n\n### 19.14 Assistant IA — aide à la gouvernance\n\nCette fenêtre présente des suggestions générées à partir des indicateurs disponibles dans le workspace.\n\nLes suggestions sont des pistes d'analyse. Elles ne modifient pas automatiquement les permissions, les paramètres, les missions ou les décisions. L'utilisateur doit vérifier leur pertinence et ouvrir les modules métier pour agir.\n\nLe lien **Ouvrir Decision Lab V2** ouvre un module distinct d'analyse et de décision. Les procédures détaillées de ce module doivent être consultées dans son manuel spécifique.\n\n### 19.15 Paramètres du workspace\n\nCette fenêtre permet de modifier les informations générales de l'espace :\n\n- **Nom** : intitulé du workspace ;\n- **Description** : objet et contexte de l'espace ;\n- **Catégorie** : classification de l'espace.\n\nPour modifier :\n1. saisir les nouvelles valeurs ;\n2. vérifier l'orthographe et le sens ;\n3. cliquer sur **Enregistrer** ;\n4. vérifier la confirmation et le nouveau nom affiché.\n\nPour un propriétaire, des actions supplémentaires peuvent apparaître :\n- **Archiver** : archive l'espace après une confirmation. Cette opération ne doit pas être utilisée comme une suppression ordinaire ; vérifier les conséquences et les besoins de conservation avant de confirmer.\n- **Restaurer l’espace** : réactive un espace précédemment archivé.\n\nL'archivage et la restauration sont réservés au propriétaire. Ne pas archiver le workspace de production pour résoudre un problème d'affichage ou d'accès.\n\n### 19.16 Créer un workspace\n\nLorsque le compte est autorisé, le champ de création d'espace permet de saisir un nom puis de cliquer sur **Créer**. Après création :\n1. sélectionner le nouvel espace ;\n2. vérifier son nom et son rôle ;\n3. inviter uniquement les personnes nécessaires ;\n4. configurer les agents, les missions et les paramètres adaptés à ce périmètre.\n\nLa création d'un workspace distinct ne déplace pas automatiquement les données d'un autre workspace.\n\n---\n\n## 20. Limites de périmètre et modules distincts\n\nLe présent manuel couvre les deux surfaces de l'organisation autonome :\n- le poste **Direction des Opérations** (\`/coo\`) ;\n- l'espace **Équipe & Gouvernance** (\`/team\`).\n\nLe **Decision Lab / Debate Engine** accessible depuis les modules de débat ou le laboratoire (\`/lab\` et \`/lab/v2\`) constitue une surface applicative distincte, avec ses propres écrans de délibération, de recherche, de preuve et de décision. Le lien vers Decision Lab V2 est décrit dans le présent manuel, mais le détail exhaustif de ses écrans doit faire l'objet d'un manuel spécialisé séparé afin de ne pas mélanger les procédures de gouvernance opérationnelle avec celles du moteur de débat.\n\n**Règle de mise à jour :** à chaque ajout ou modification d'un onglet, d'un champ, d'un bouton, d'un droit ou d'un workflow dans \`/coo\` ou \`/team\`, la présente procédure doit être révisée et testée avant diffusion.\n";
function session(){try{return JSON.parse(localStorage.getItem("afe-v09-session")||"null")}catch{return null}}
let wid="",role="viewer",tab="overview",cache={};
function message(t,error){$("message").textContent=t;$("message").className=error?"notice error":"notice"}
function showLogin(){const card=$("cooLogin");if(card)card.hidden=false}
function loginPrompt(text){message(text,true);showLogin();$("message").innerHTML='Authentification requise. Tu peux te connecter directement ci-dessous ou utiliser <a href="/team?return=%2Fcoo" style="font-weight:700">Équipe & Gouvernance ↗</a>';}
async function loginFromCoo(){const button=$("cooLoginButton"),error=$("cooLoginError");error.textContent="";const email=$("cooLoginEmail").value.trim(),password=$("cooLoginPassword").value;if(!email||!password){error.textContent="Saisis ton adresse e-mail et ton mot de passe.";return}button.disabled=true;button.textContent="Connexion…";try{const response=await fetch("/auth/session",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({action:"signin",email,password})});const raw=await response.text();let data={};try{data=JSON.parse(raw||"{}")}catch{}if(!response.ok||!data.access_token||!data.user?.id)throw new Error(data.msg||data.message||data.error_description||data.error||"Connexion impossible. Vérifie tes identifiants.");localStorage.setItem("afe-v09-session",JSON.stringify(data));$("cooLoginPassword").value="";$("cooLogin").hidden=true;message("Connexion réussie. Chargement de ton espace de travail…");const loaded=await loadWorkspaceList();if(!loaded)throw new Error("Connexion établie, mais le chargement de l’espace de travail a échoué. La session est conservée.");}catch(e){error.textContent=e instanceof Error?e.message:"Erreur de connexion.";if(!session()?.access_token)showLogin();else $("cooLogin").hidden=true;}finally{button.disabled=false;button.textContent="Se connecter";}}
let refreshInFlight=null;
async function refreshSession(){
 const current=session();
 if(!current?.refresh_token)throw Error("Session expirée. Reconnecte-toi.");
 if(!refreshInFlight)refreshInFlight=(async()=>{
  const response=await fetch("/auth/session",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({action:"refresh",refresh_token:current.refresh_token})});
  const raw=await response.text();let data={};try{data=JSON.parse(raw||"{}")}catch{}
  if(!response.ok||!data.access_token||!data.user?.id)throw Error(data.msg||data.message||data.error_description||data.error||"Renouvellement de session impossible.");
  localStorage.setItem("afe-v09-session",JSON.stringify(data));return data;
 })().finally(()=>{refreshInFlight=null});
 return refreshInFlight;
}
async function api(path,options){ let s=session();
 if(!s?.access_token){loginPrompt("Authentification requise.");throw Error("Connecte-toi pour accéder à ton espace de travail.");}
 const expiry=Number(s.expires_at||0);
 if(s.refresh_token&&expiry>0&&expiry*1000<Date.now()+60000){try{s=await refreshSession()}catch(e){localStorage.removeItem("afe-v09-session");loginPrompt("Ta session a expiré. Reconnecte-toi.");throw e}}
 const request=async(token)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{return await fetch(path,{...(options||{}),signal:controller.signal,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...((options&&options.headers)||{})}})}
  catch(e){if(e?.name==="AbortError")throw Error("Le serveur met trop de temps à répondre ("+path+"). Réessaie dans quelques instants.");throw Error("Impossible de joindre le serveur ("+path+"). "+(e?.message||""))}
  finally{clearTimeout(timer)}
 };
 let r=await request(s.access_token);
 if(r.status===401&&s.refresh_token){
  try{s=await refreshSession();r=await request(s.access_token)}
  catch(e){localStorage.removeItem("afe-v09-session");loginPrompt("Session expirée. Reconnecte-toi.");throw e}
 }
 const raw=await r.text();let d={};try{d=JSON.parse(raw||"{}")}catch{}
 if(r.status===401){localStorage.removeItem("afe-v09-session");loginPrompt("Session expirée. Reconnecte-toi.");}
 if(!r.ok)throw Error(d.error||d.message||("Erreur serveur "+r.status+" sur "+path));
 return d;
}
const base=()=>"/team/api/workspaces/"+encodeURIComponent(wid)+"/coo/";
const metric=(label,value)=>'<div class="metric"><b>'+esc(value??"—")+'</b><span class="small">'+esc(label)+'</span></div>';
const date=v=>v?new Date(v).toLocaleString("fr-FR"):"—";
const statusLabel=s=>({queued:"En attente",planning:"Planification",running:"En cours",waiting_approval:"Validation requise",paused:"Suspendue",completed:"Terminée",failed:"Échec",cancelled:"Annulée",todo:"À faire",in_progress:"En cours",blocked:"Bloquée",done:"Terminée",open:"Ouverte",acknowledged:"Prise en charge",resolved:"Résolue"}[s]||s||"—");
async function loadWorkspaceList(){message("Connexion validée. Récupération de tes espaces de travail…");const data=await api("/team/api/workspaces");const spaces=arr(data);$("spaces").innerHTML=spaces.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+' · '+esc(x.role)+'</option>').join("")||'<option value="">Aucun espace</option>';if(!wid&&spaces.length)wid=spaces[0].id;if(wid)$("spaces").value=wid;if(!wid){$("cooLogin").hidden=true;message("Connecté, mais aucun espace de travail n'est associé à ce compte.",true);return false}const rendered=await render();if(!rendered)return false;$("cooLogin").hidden=true;message("Espace de travail chargé · "+spaces.find(x=>x.id===wid)?.name);return true}
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
 const findingCards=findings.map(f=>'<div class="row"><div><strong>'+esc(f.code||"Constat")+'</strong><span class="small">'+esc(f.message||f.description||"Anomalie signalée par le contrôle indépendant.")+'</span>'+arr(f.citations).map(q=>'<blockquote class="small"><strong>'+esc(q.sourceId)+'</strong> — « '+esc(q.quote)+' »</blockquote>').join("")+'</div><span class="tag '+(f.severity==="blocking"?"critical":"warning")+'">'+esc(f.severity||"constat")+'</span></div>').join("")||'<div class="notice">Aucune anomalie structurelle signalée. Cela ne vaut pas validation humaine.</div>';
 const eventCards=events.slice().reverse().map(e=>'<div class="row"><div><strong>'+esc(e.event_type)+'</strong><span class="small">'+date(e.created_at)+' · '+esc(e.actor_type||"système")+'</span><pre>'+esc(JSON.stringify(e.payload||{},null,2))+'</pre></div></div>').join("")||'<div class="empty">Aucun événement de contrôle archivé.</div>';
 const deliverables=arr(result.deliverables),taskResults=arr(result.task_results);
 $("view").innerHTML='<section class="card"><div class="actions" style="justify-content:space-between"><div><h2>'+esc(m.title||"Dossier de mission")+'</h2><span class="small">'+esc(m.department_name||"Direction non renseignée")+' · '+esc(m.agent_name||"Agent non renseigné")+' · '+esc(statusLabel(m.status))+'</span></div><button class="btn" id="backToMissions">← Retour au portefeuille</button></div><div class="grid" style="margin-top:12px">'+metric("Progression",String(m.progress_percent??0)+" %")+metric("État opérationnel",statusLabel(m.status))+metric("État du contrôle",reviewLabel)+metric("Validations en attente",approvals.filter(a=>a.status==="pending").length)+'</div>'+(m.blocked_reason?'<div class="notice error">'+esc(m.blocked_reason)+'</div>':'')+'</section><section class="card"><h2>1. Soumission de l’agent</h2><h3>Synthèse</h3><p>'+esc(result.summary||"Aucune synthèse enregistrée.")+'</p><h3>Analyse</h3><pre>'+esc(result.analysis||"Aucune analyse enregistrée.")+'</pre><h3>Livrables de mission</h3>'+(deliverables.length?deliverables.map((x,i)=>'<div class="row"><strong>Livrable '+(i+1)+'</strong><pre>'+esc(x)+'</pre></div>').join(""):'<div class="empty">Aucun livrable de mission.</div>')+'<h3>Résultats par tâche</h3>'+taskResults.map(t=>'<div class="row"><div><strong>'+esc(t.taskId||"Tâche")+' · '+esc(statusLabel(t.status))+'</strong><span class="small">'+esc(t.progressPercent??0)+' %</span><pre>'+esc(t.deliverable||t.summary||"Aucun livrable de tâche.")+'</pre></div></div>').join("")+'</section><section class="card"><h2>2. Revue indépendante</h2><div class="notice '+(review.verdict==="rejected"?"error":"")+'"><strong>'+esc(reviewLabel)+'</strong><p class="small">Contrôleur : '+esc(review.semanticReview?.reviewerProvider||review.semanticReviewerType||review.reviewerType||review.reviewerAgentId||"Non renseigné")+' · Modèle : '+esc(review.semanticReview?.reviewerModel||"non renseigné")+' · Le contrôleur ne décide jamais de la clôture.</p></div>'+'<div class="grid">'+metric("Score qualité",review.qualityScore===undefined?"—":review.qualityScore+" / 100")+metric("Contrôles qualité",arr(review.qualityChecks).filter(q=>q.passed).length+" / "+arr(review.qualityChecks).length)+'</div><h3>Grille de qualité</h3>'+qualityCards+'<h3>Anomalies et demandes de correction</h3>'+findingCards+'</section><section class="card"><h2>3. Tâches opérationnelles</h2>'+taskCards+'</section><section class="card"><h2>4. Historique de contrôle et validations</h2>'+eventCards+(approvals.length?approvals.map(a=>'<div class="row"><div><strong>Validation '+esc(a.action_key||a.id)+'</strong><span class="small">'+esc(a.status)+' · '+date(a.created_at)+'</span></div><span class="tag">'+esc(a.risk_level||"—")+'</span></div>').join(""):'')+'</section>'+(canValidate&&m.status!=="completed"?'<section class="card"><h2>5. Décision de la Direction générale</h2><p class="small">La clôture est réservée au propriétaire de l’espace. Elle exige un verdict indépendant accepté et toutes les tâches attendues terminées à 100 % avec leurs livrables.</p><label for="reviewNote">Motif ou instruction de reprise</label><textarea class="field" id="reviewNote" rows="3" placeholder="Décrire précisément les corrections attendues si nécessaire."></textarea><div class="actions"><button class="btn danger" id="requestRevision">Demander une correction et relancer</button><button class="btn primary" id="acceptClosure" '+(review.verdict==="accepted"?"":"disabled")+'>Valider et clôturer la mission</button></div></section>':'');
 $("backToMissions").onclick=()=>renderMissions();
 const revision=$("requestRevision");if(revision)revision.onclick=async()=>{const note=$("reviewNote").value.trim();if(note.length<8){message("Précisez les corrections attendues (8 caractères minimum).",true);return;}revision.disabled=true;try{await api(base()+"missions/"+encodeURIComponent(missionId)+"/review",{method:"POST",body:JSON.stringify({action:"request_revision",note})});message("Demande de correction enregistrée ; mission remise en file d’exécution.");await renderMissions()}catch(e){message(e.message,true)}finally{revision.disabled=false}};
 const accept=$("acceptClosure");if(accept)accept.onclick=async()=>{accept.disabled=true;try{await api(base()+"missions/"+encodeURIComponent(missionId)+"/review",{method:"POST",body:JSON.stringify({action:"accept_closure",note:$("reviewNote").value.trim()})});message("Mission validée et clôturée après contrôle indépendant.");await renderMissions()}catch(e){message(e.message,true);accept.disabled=false}};
}
async function renderMissions(){
 const [m,agents,dep,members]=await Promise.all([api(base()+"missions"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/agents"),api(base()+"departments"),api("/team/api/workspaces/"+encodeURIComponent(wid)+"/members")]);
 const missions=arr(m.missions),activeAgents=arr(agents.agents).filter(a=>a.status==="active"),departments=arr(dep.departments).filter(d=>d.active&&!d.is_independent&&!d.human_only),reviewPending=missions.filter(x=>x.result?.coo_review?.status==="pending"),revisionRequired=missions.filter(x=>x.result?.coo_review?.status==="revision_required"),independentAccepted=missions.filter(x=>x.result?.coo_review?.independentReview?.verdict==="accepted"),reviewFindings=missions.reduce((n,x)=>n+arr(x.result?.coo_review?.independentReview?.findings).length,0);
 $("view").innerHTML='<section class="card"><h2>Instruction directe au COO IA</h2><p class="small">La Direction générale transmet un objectif. Le COO consulte les directeurs IA disponibles, prépare les chantiers et crée les missions et tâches dans la file durable. Les demandes nécessitant une décision réservée restent en attente d’approbation humaine.</p><textarea class="field" id="cooInstruction" rows="4" maxlength="12000" placeholder="Ex. COO, organise un diagnostic transversal de la gouvernance et des risques, fais intervenir les directions concernées et présente-moi un rapport consolidé."></textarea><p><button class="btn primary" id="cooRun">Transmettre l’instruction au COO IA</button></p><div id="cooRunResult" class="small"></div></section><section class="card"><h2>Enregistrer une mission manuellement</h2><div class="form"><div><label>Direction responsable</label><select class="field" id="missionDepartment">'+departments.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>').join("")+'</select></div><div><label>Agent responsable</label><select class="field" id="missionAgent"></select></div><div><label>Responsable opérationnel</label><select class="field" id="missionOwner"><option value="">Non désigné</option>'+arr(members).filter(x=>["owner","admin","editor"].includes(x.role)).map(x=>'<option value="'+esc(x.user_id)+'">'+esc(x.profile?.full_name||x.profile?.email||x.user_id)+'</option>').join("")+'</select></div><div><label>Priorité (1 = très haute)</label><select class="field" id="missionPriority"><option value="1">1 · Critique</option><option value="2">2 · Haute</option><option value="3" selected>3 · Normale</option><option value="4">4 · Basse</option><option value="5">5 · Très basse</option></select></div><div class="wide"><label>Intitulé</label><input class="field" id="missionTitle" maxlength="220" placeholder="Ex. Diagnostic global des risques opérationnels"></div><div class="wide"><label>Objectif et livrables attendus</label><textarea class="field" id="missionObjective" rows="3" placeholder="Définir le résultat, le périmètre, les critères de réussite et les livrables."></textarea></div><div><label>Échéance</label><input class="field" id="missionDue" type="datetime-local"></div></div><p><button class="btn primary" id="missionCreate" '+(activeAgents.length?"":"disabled") +'>Créer la mission</button></p><p class="small">La mission est enregistrée dans la file durable existante. Son exécution dépend du worker et de l’activation de l’agent. Le COO ne peut pas créer de mission d’arbitrage ni de validation humaine.</p></section><section class="card"><div class="row" style="align-items:center;justify-content:space-between;gap:12px"><h2 style="margin:0">Portefeuille ('+missions.length+')</h2><button class="btn" type="button" id="copyCooPortfolio" aria-label="Copier tous les résultats du portefeuille" title="Copier tous les résultats du portefeuille">⧉ <span>Copier</span></button></div><div class="grid" style="margin:12px 0">'+metric("Soumises à validation",reviewPending.length)+metric("Corrections demandées",revisionRequired.length)+metric("Revues acceptées",independentAccepted.length)+metric("Anomalies relevées",reviewFindings)+'</div><p class="small">Lancement contrôlé du worker : une mission par appel, avec suivi du résultat et arrêt automatique lorsqu’aucune mission n’est éligible. Une mission soumise reste suspendue jusqu’à la décision de contrôle. Réservé à la Preview et à la Direction générale.</p><p><button class="btn primary" id="cooExecute" '+(missions.some(m=>m.status==="queued"||m.status==="planning"||m.status==="running")?"":"disabled") +'>Démarrer l’exécution des missions en attente</button></p><div id="cooExecutionResult" class="small"></div>'+(missions.length?missions.map(m=>'<div class="row"><div style="flex:1"><strong>'+esc(m.title)+'</strong><span class="small">'+esc(m.department_name)+' · '+esc(m.agent_name)+' · '+esc(m.result?.coo_review?.status==="pending"?"Livrables soumis — validation COO requise":statusLabel(m.status))+' · '+date(m.due_at)+'</span><div class="small">Progression : '+esc(m.progress_percent||0)+' %</div>'+(m.result?.summary?'<div class="small" style="margin-top:7px"><strong>Compte rendu de l’agent :</strong> '+esc(m.result.summary)+'</div>':'')+(Array.isArray(m.result?.deliverables)&&m.result.deliverables.length?'<div class="small">Livrables : '+esc(m.result.deliverables.join(" · "))+'</div>':'')+(m.result?.coo_review?.independentReview?'<div class="small">Revue indépendante : '+esc(m.result.coo_review.independentReview.verdict)+' · '+arr(m.result.coo_review.independentReview.findings).length+' anomalie(s) · clôture : '+(m.result.coo_review.closureEligible?"autorisée":"non autorisée")+'</div>':'')+(m.result?.coo_review?.status==="revision_required"?'<div class="small" style="color:#d97706">Correction demandée : '+esc(m.result.coo_review.revisionNote||m.blocked_reason||"Voir le dossier de contrôle")+'</div>':'')+(m.blocked_reason?'<div class="small" style="color:#a33">Blocage : '+esc(m.blocked_reason)+'</div>':'')+'</div><div class="actions"><button class="btn" data-review-mission="'+esc(m.id)+'">Dossier de contrôle</button><input class="field" type="number" min="0" max="100" style="width:82px" data-mission-progress="'+esc(m.id)+'" value="'+esc(m.progress_percent||0)+'"><button class="btn" data-save-mission="'+esc(m.id)+'">Maj %</button><span class="tag '+(m.status==="failed"?"critical":"")+'">P'+esc(m.priority)+'</span></div></div>').join(""):'<div class="empty">Aucune mission enregistrée.</div>')+'</section>';
 $("copyCooPortfolio").onclick=async()=>{const button=$("copyCooPortfolio");const lines=["AFE-CI — PORTEFEUILLE DES MISSIONS","Nombre de missions : "+missions.length,"Date d'export : "+new Date().toLocaleString("fr-FR"),""];missions.forEach((m,index)=>{lines.push("MISSION "+(index+1)+" — "+String(m.title||"Sans titre"),"Direction : "+String(m.department_name||"Non renseignée"),"Agent responsable : "+String(m.agent_name||"Non affecté"),"Statut : "+String(statusLabel(m.status)||"Non renseigné"),"Priorité : P"+String(m.priority??"—"),"Progression : "+String(m.progress_percent??0)+" %","Échéance : "+String(date(m.due_at)||"Non renseignée"));if(m.objective)lines.push("Objectif : "+String(m.objective));if(m.result?.summary)lines.push("Compte rendu de l'agent : "+String(m.result.summary));if(Array.isArray(m.result?.deliverables)&&m.result.deliverables.length)lines.push("Livrables : "+m.result.deliverables.join(" · "));if(m.blocked_reason)lines.push("Blocage : "+String(m.blocked_reason));lines.push("","—".repeat(48),"");});const textValue=lines.join("\n");button.disabled=true;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(textValue);}else{const ta=document.createElement("textarea");ta.value=textValue;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();if(!ok)throw Error("Copie indisponible sur cet appareil.");}button.innerHTML="✓ <span>Copié</span>";message("Les "+missions.length+" mission(s) et leurs résultats ont été copiés intégralement.");}catch(e){message("Impossible de copier le portefeuille : "+e.message,true);}finally{button.disabled=false;setTimeout(()=>{if(button.isConnected)button.innerHTML="⧉ <span>Copier</span>";},2200);}};
 $("cooExecute").onclick=async()=>{const b=$("cooExecute"),out=$("cooExecutionResult");b.disabled=true;b.textContent="Exécution en cours…";out.textContent="Le worker prend en charge les missions éligibles. Cette opération peut prendre plusieurs minutes.";const results=[];try{for(let i=0;i<5;i++){const r=await api(base()+"execute-next",{method:"POST",body:"{}"});results.push(r);if(!r.claimed)break;if(r.completed===false&&r.paused)continue;if(r.completed===false&&r.retryScheduled)continue;}const completed=results.filter(x=>x.completed).length,claimed=results.filter(x=>x.claimed).length,paused=results.filter(x=>x.paused).length;out.textContent=claimed+" mission(s) prise(s) en charge · "+completed+" terminée(s) avec résultat · "+paused+" suspendue(s) pour tâches incomplètes. "+(claimed<5?"Aucune autre mission éligible détectée ou limite de traitement atteinte.":"Limite de sécurité de 5 missions par vague atteinte.");message("Vague d’exécution terminée. Consultez les résultats mission par mission.");await render()}catch(e){out.textContent="Exécution interrompue : "+e.message;message(e.message,true)}finally{b.disabled=false;b.textContent="Démarrer l’exécution des missions en attente"}}; $("cooRun").onclick=async()=>{const instruction=$("cooInstruction").value.trim();if(instruction.length<10){message("Décris un objectif suffisamment précis.",true);return}const b=$("cooRun");b.disabled=true;b.textContent="Le COO analyse et planifie…";try{const r=await api(base()+"orchestrate",{method:"POST",body:JSON.stringify({instruction})});const dispatched=arr(r.dispatched);$("cooRunResult").textContent=r.run?.status==="approval_required"?"Plan soumis à décision humaine : "+arr(r.plan?.decisionsRequired).join(" · "):"Plan créé : "+dispatched.length+" mission(s), "+dispatched.reduce((n,x)=>n+Number(x.taskCount||0),0)+" tâche(s) distribuée(s).";message("Instruction traitée par le COO IA.");await render()}catch(e){message(e.message,true)}finally{b.disabled=false;b.textContent="Transmettre l’instruction au COO IA"}};
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
async function renderAlerts(){
 const d=await api(base()+"alerts"),alerts=arr(d.alerts),active=alerts.filter(x=>x.workflow_status!=="resolved"&&x.status!=="resolved"),closed=alerts.filter(x=>x.workflow_status==="resolved"||x.status==="resolved");
 const label=x=>({new:"Nouvelle",assigned:"Prise en charge",diagnosing:"Diagnostic",in_progress:"Correction en cours",pending_verification:"À vérifier",resolved:"Résolue",reopened:"Rouverte"}[x.workflow_status]||x.status||"À traiter");
 const card=x=>{
  const state=x.workflow_status|| (x.status==="resolved"?"resolved":x.status==="acknowledged"?"assigned":"new");
  const fields='<div class="grid"><label>Responsable de traitement<select name="assignedTo"><option value="">Sélectionner un membre</option>'+arr(d.members).filter(m=>m.role!=="viewer").map(m=>'<option value="'+esc(m.user_id)+'" '+(m.user_id===x.assigned_to?'selected':'')+'>'+esc(m.user_id.slice(0,8))+' · '+esc(m.role)+'</option>').join("")+'</select></label><label>Échéance de traitement (facultative)<input name="dueAt" type="datetime-local"></label><label>Diagnostic de la cause<textarea name="diagnosis" rows="2" maxlength="4000">'+esc(x.diagnosis||"")+'</textarea></label><label>Actions correctives réalisées / prévues<textarea name="correctiveAction" rows="2" maxlength="4000">'+esc(x.corrective_action||"")+'</textarea></label><label>Référence de preuve (lien, document ou identifiant)<input name="evidenceReference" maxlength="2000" value="'+esc(x.evidence_reference||"")+'"></label><label>Résumé du résultat obtenu<textarea name="resolutionSummary" rows="2" maxlength="4000">'+esc(x.resolution_summary||"")+'</textarea></label><label>Note de vérification / motif de réouverture<textarea name="verificationNote" rows="2" maxlength="2000" placeholder="Obligatoire pour valider, refuser ou rouvrir"></textarea></label></div>';
  let actions='';
  if(state==="new"||state==="reopened") actions+='<button class="btn" data-alert-action="take">Prendre en charge</button>';
  if(state!=="resolved") actions+='<button class="btn" data-alert-action="assign">Affecter / transférer</button><button class="btn" data-alert-action="diagnose">Enregistrer le diagnostic</button><button class="btn" data-alert-action="start">Démarrer / mettre à jour la correction</button><button class="btn" data-alert-action="submit_for_verification">Soumettre à vérification</button>';
  if(state==="pending_verification") actions+='<button class="btn" data-alert-action="verify" data-decision="approve">Valider la résolution</button><button class="btn danger" data-alert-action="verify" data-decision="reject">Refuser et retourner en correction</button>';
  if(state==="resolved") actions+='<button class="btn danger" data-alert-action="reopen">Réouvrir l’alerte</button>';
  return '<article class="card alert-card" data-alert-id="'+esc(x.id)+'"><div class="row"><div><strong>'+esc(x.title)+'</strong><span class="small">'+esc(x.description)+' · Détectée le '+date(x.created_at)+'</span><span class="small">Responsable : '+esc(x.assigned_to||"Non attribuée")+' · Échéance : '+date(x.due_at)+' · Réouvertures : '+esc(x.reopen_count||0)+'</span></div><div class="actions"><span class="tag '+esc(x.severity)+'">'+esc(x.severity)+'</span><span class="tag">'+esc(label(x))+'</span></div></div><details><summary>Dossier de traitement et historique</summary><form class="alert-workflow-form">'+fields+'<div class="actions">'+actions+'</div></form><div class="alert-history"><button class="btn" type="button" data-alert-history>Charger l’historique des actions</button><div data-alert-events></div></div></details></article>';
 };
 $("view").innerHTML='<section class="card"><h2>Centre d’alertes</h2><p class="small">Chaque alerte suit un cycle contrôlé : prise en charge → diagnostic → correction → preuves → vérification indépendante → clôture. Une clôture sans preuve ni vérification est interdite.</p><div class="metrics">'+metric("Alertes actives",active.length)+metric("À vérifier",active.filter(x=>x.workflow_status==="pending_verification").length)+metric("Critiques",active.filter(x=>x.severity==="critical").length)+metric("Clôturées",closed.length)+'</div></section><section class="card"><h3>Alertes à traiter</h3>'+ (active.map(card).join("")||'<div class="empty">Aucune alerte active.</div>')+'</section><section class="card"><h3>Historique des alertes clôturées</h3>'+ (closed.map(card).join("")||'<div class="empty">Aucune alerte clôturée.</div>')+'</section>';
 $("view").querySelectorAll("[data-alert-action]").forEach(b=>b.onclick=async e=>{e.preventDefault();const form=b.closest("form"),card=b.closest("[data-alert-id]"),data=Object.fromEntries(new FormData(form).entries());data.action=b.dataset.alertAction;if(b.dataset.decision)data.decision=b.dataset.decision;try{await api(base()+"alerts/"+encodeURIComponent(card.dataset.alertId),{method:"POST",body:JSON.stringify(data)});message("Action enregistrée dans le journal de l’alerte.");await renderAlerts()}catch(err){message(err.message,true)}});
 $("view").querySelectorAll("[data-alert-history]").forEach(b=>b.onclick=async()=>{const card=b.closest("[data-alert-id]"),target=card.querySelector("[data-alert-events]");try{const detail=await api(base()+"alerts/"+encodeURIComponent(card.dataset.alertId));target.innerHTML=arr(detail.events).map(ev=>'<div class="small">'+date(ev.created_at)+' · '+esc(ev.event_type)+' · '+esc(JSON.stringify(ev.details||{}))+'</div>').join("")||'<div class="small">Aucun événement enregistré.</div>';b.disabled=true}catch(err){message(err.message,true)}});
}
function reportText(report){
 const c=report.report_content||{},i=c.indicators||{},fmt=v=>v==null?"Non renseigné":String(v),pct=v=>v==null?"Non calculable":v+" %";
 const lines=[c.title||report.report_type||"Rapport opérationnel","Période : "+date(c.period?.start||report.period_start)+" → "+date(c.period?.end||report.period_end),"Généré le : "+date(c.generatedAt||report.created_at),"","1. SYNTHÈSE EXÉCUTIVE","Missions : "+fmt(i.totalMissions)+" au total, dont "+fmt(i.activeMissions)+" actives, "+fmt(i.completedMissions)+" terminées, "+fmt(i.failedMissions)+" en échec.","Tâches : "+fmt(i.totalTasks)+" au total, "+fmt(i.openTasks)+" ouvertes, "+fmt(i.blockedTasks)+" bloquées, "+fmt(i.overdueTasks)+" en retard.","Directions configurées actives : "+fmt(i.activeDepartments)+". Directions ayant une activité : "+fmt(i.departmentsWithActivity)+". Alertes ouvertes : "+fmt(i.openAlerts)+", dont "+fmt(i.criticalAlerts)+" critiques.","Validations humaines en attente : "+fmt(i.pendingHumanApprovals),"","2. PERFORMANCE PAR DIRECTION"];
 const activity=c.periodActivity||{};
 const activityAvailable=Number.isFinite(activity.missionsCreated)&&Number.isFinite(activity.tasksCreated);
 lines.splice(9,0,activityAvailable?"Activité sur la période : "+fmt(activity.missionsCreated)+" mission(s) créée(s), "+fmt(activity.tasksCreated)+" tâche(s) créée(s).":"Activité sur la période : non disponible dans cette version du rapport archivé.",c.scopeDescription||"");
 const depts=arr(c.departmentPerformance);if(!depts.length)lines.push("Aucune donnée de performance par direction n'est disponible.");else depts.forEach(d=>lines.push("- "+d.name+": "+fmt(d.missionCount)+" mission(s), "+fmt(d.completedMissions)+" terminée(s), "+fmt(d.runningMissions)+" en cours; "+fmt(d.taskCount)+" tâche(s), "+fmt(d.openTasks)+" ouverte(s), "+fmt(d.blockedTasks)+" bloquée(s); taux de clôture des missions : "+pct(d.missionClosureRate)+", taux d'achèvement des tâches : "+pct(d.taskCompletionRate)+"."));
 lines.push("","3. MISSIONS À RISQUE");const risks=arr(c.missionsAtRisk);if(!risks.length)lines.push("Aucune mission à risque recensée dans les données du rapport.");else risks.forEach(m=>lines.push("- "+m.title+" — "+statusLabel(m.status)+"; direction : "+(m.department_name||"non renseignée")+"; échéance : "+date(m.due_at)));
 lines.push("","4. ALERTES PRIORITAIRES");const alerts=arr(c.priorityAlerts);if(!alerts.length)lines.push("Aucune alerte prioritaire recensée.");else alerts.forEach(a=>lines.push("- ["+String(a.severity||"information").toUpperCase()+"] "+a.title+" : "+(a.description||"")));
 const decisions=c.decisionsRequired||{};lines.push("","5. DÉCISIONS ET ESCALADES");const approvals=arr(decisions.humanApprovals),escalations=arr(decisions.escalations);lines.push("Approbations humaines : "+approvals.length,"Escalades : "+escalations.length);approvals.forEach(a=>lines.push("- Approbation requise : "+(a.action_key||a.mission_id||a.id)));escalations.forEach(a=>lines.push("- Escalade : "+(a.title||a.description||a.id)));
 const verificationAvailable=Number.isFinite(i.completedVerifiedMissions)&&Number.isFinite(i.completedUnverifiedMissions);
 lines.push(verificationAvailable?"Missions terminées vérifiées : "+fmt(i.completedVerifiedMissions)+", non vérifiées : "+fmt(i.completedUnverifiedMissions):"Vérification des missions terminées : non disponible dans cette version du rapport archivé.");
 const missionCount=Number(i.totalMissions||0),departmentMissionCount=depts.reduce((n,d)=>n+Number(d.missionCount||0),0),findings=[];
 const quality=c.dataQuality||{};
 if(arr(quality.completedWithoutTasks).length&&!arr(quality.findings).some((x)=>/mission\(s\).*sans tâche opérationnelle associée/i.test(x)))findings.push(arr(quality.completedWithoutTasks).length+" mission(s) terminée(s) sans tâche opérationnelle associée : exécution non démontrée.");
 if(arr(quality.completedWithIncompleteTasks).length)findings.push(arr(quality.completedWithIncompleteTasks).length+" mission(s) terminée(s) avec des tâches non achevées : clôture incohérente.");
 if(Number(quality.unassignedMissionCount||0)>0)findings.push(Number(quality.unassignedMissionCount)+" mission(s) sans direction identifiable après rapprochement avec le responsable IA.");
 arr(quality.findings).filter((x)=>!findings.includes(x)).forEach((x)=>findings.push(x));
 if(Number(i.completedMissions||0)>0&&Number(i.totalTasks||0)===0)findings.push("Des missions sont déclarées terminées alors qu'aucune tâche n'est recensée. Leur exécution ne peut pas être confirmée par les données de tâches.");
 if(missionCount!==departmentMissionCount+Number(quality.unassignedMissionCount||0))findings.push("Le total des missions ("+missionCount+") ne se réconcilie pas avec les missions ventilées ("+departmentMissionCount+") et non affectées ("+Number(quality.unassignedMissionCount||0)+").");
 if(depts.some(d=>d.taskCompletionRate==null||d.missionClosureRate==null))findings.push("Certaines directions n'ont pas de volume d'activité permettant de calculer un taux de performance. Une valeur non calculable ne doit pas être interprétée comme 0 %.");
 lines.push("","6. QUALITÉ ET LIMITES DES DONNÉES");if(findings.length)findings.forEach(x=>lines.push("POINT DE VIGILANCE — "+x));else lines.push("Aucune incohérence évidente détectée dans les contrôles automatiques disponibles. Cela ne constitue pas une validation indépendante.");
 lines.push("","7. NOTE DE GOUVERNANCE",c.governanceNote||"Ce rapport décrit l'exécution opérationnelle et ne remplace aucune décision humaine, aucun arbitrage indépendant ni aucun constat technique.","","Fin du rapport.");return lines.join("\n");
}
function reportHtml(report){
 const c=report.report_content||{},i=c.indicators||{},depts=arr(c.departmentPerformance),text=reportText(report);
 const activity=c.periodActivity||{};
 const metricCards=[["Missions",i.totalMissions],["Terminées",i.completedMissions],["Actives",i.activeMissions],["Tâches",i.totalTasks],["Tâches ouvertes",i.openTasks],["Alertes",i.openAlerts],["Alertes critiques",i.criticalAlerts],["Validations humaines",i.pendingHumanApprovals],["Missions créées sur la période",activity.missionsCreated],["Tâches créées sur la période",activity.tasksCreated]];
 const missionCount=Number(i.totalMissions||0),byDept=depts.reduce((n,d)=>n+Number(d.missionCount||0),0),warnings=[];
 const quality=c.dataQuality||{};
 if(arr(quality.completedWithoutTasks).length&&!arr(quality.findings).some((x)=>/mission\(s\).*sans tâche opérationnelle associée/i.test(x)))warnings.push(arr(quality.completedWithoutTasks).length+" mission(s) terminée(s) sans tâche associée : exécution non démontrée.");
 if(Number(quality.unassignedMissionCount||0)>0)warnings.push(Number(quality.unassignedMissionCount)+" mission(s) sans direction identifiable.");
 arr(quality.findings).filter((x)=>!warnings.includes(x)).forEach((x)=>warnings.push(x));
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

function manualInline(value){return esc(value).replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\x60([^\x60]+)\x60/g,"<code>$1</code>").replace(/\*(.*?)\*/g,"<em>$1</em>");}
function manualToBlock(lines){ const first=lines[0]||"";
 if(/^---+$/.test(first))return "<hr>";
 if(lines.every(x=>/^\|/.test(x))){const rows=lines.filter(x=>! /^\|\s*:?-{2,}/.test(x)).map(x=>x.split("|").slice(1,-1).map(c=>c.trim()));if(!rows.length)return "";return "<table><thead><tr>"+rows[0].map(c=>"<th>"+manualInline(c)+"</th>").join("")+"</tr></thead><tbody>"+rows.slice(1).map(r=>"<tr>"+r.map(c=>"<td>"+manualInline(c)+"</td>").join("")+"</tr>").join("")+"</tbody></table>";}
 if(lines.every(x=>/^- /.test(x)))return "<ul>"+lines.map(x=>"<li>"+manualInline(x.slice(2).replace(/^\[ \] /,"☐ ").replace(/^\[x\] /i,"☑ "))+"</li>").join("")+"</ul>";
 if(lines.every(x=>/^\d+\. /.test(x)))return "<ol>"+lines.map(x=>"<li>"+manualInline(x.replace(/^\d+\. /,""))+"</li>").join("")+"</ol>";
 if(/^### /.test(first))return "<h3>"+manualInline(first.slice(4))+"</h3>"+(lines.length>1?"<p>"+manualInline(lines.slice(1).join(" "))+"</p>":"");
 return "<p>"+lines.map(manualInline).join("<br>")+"</p>";
}
function manualToHtml(markdown){
 const blocks=markdown.replace(/\r/g,"").split(/\n\s*\n/),out=[];let section=0;
 for(const raw of blocks){const block=raw.trim();if(!block)continue;const lines=block.split("\n");
  if(/^# /.test(lines[0])){out.push("<h1>"+manualInline(lines[0].slice(2))+"</h1>");continue;}
  if(/^## /.test(lines[0])){if(section)out.push("</div>");section++;out.push('<div class="card manual-section" id="manual-section-'+section+'"><h2>'+manualInline(lines[0].slice(3))+'</h2>');if(lines.length>1)out.push(manualToBlock(lines.slice(1)));continue;}
  out.push(manualToBlock(lines));
 }
 if(section)out.push("</div>");return out.join("");
}
function renderManual(){
 const html=manualToHtml(COO_MANUAL_SOURCE);
 $("view").innerHTML='<section class="card manual-toolbar"><div class="row" style="border:0;align-items:center"><div><h2>Manuel de procédures AFE-CI</h2><p class="small">Guide opérationnel détaillé · Direction des Opérations · Version 1.0</p></div><span class="tag">Document de référence</span></div><div class="actions"><button class="btn primary" id="manualPdf">Télécharger PDF</button><button class="btn" id="manualWord">Télécharger Word</button><button class="btn" id="manualHtml">Télécharger HTML</button><button class="btn" id="manualMd">Télécharger Markdown</button></div><p class="small">Le PDF et le document Word sont générés à partir du manuel affiché. Le fichier Markdown est la version source structurée.</p></section><section class="card"><h2>Recherche dans le manuel</h2><input class="field manual-search" id="manualSearch" type="search" placeholder="Rechercher une fonction, un bouton, une procédure…"><p class="small">Saisis un mot-clé pour filtrer les chapitres. Efface la recherche pour retrouver le manuel complet.</p><div class="manual-toc" id="manualToc"></div></section><div class="manual-content" id="manualBody">'+html+'</div>';
 const body=$("manualBody"),sections=[...body.querySelectorAll(".manual-section")];
 $("manualToc").innerHTML=sections.map((x,i)=>'<a href="#'+x.id+'">'+esc(x.querySelector("h2")?.textContent||("Chapitre "+(i+1)))+'</a>').join("");
 $("manualSearch").oninput=()=>{const q=$("manualSearch").value.trim().toLocaleLowerCase("fr");sections.forEach(x=>{x.hidden=Boolean(q)&&!x.textContent.toLocaleLowerCase("fr").includes(q)});};
 const plain=COO_MANUAL_SOURCE;
 const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $("manualMd").onclick=()=>download(new Blob([plain],{type:"text/markdown;charset=utf-8"}),"AFE-CI-Manuel-Procedures-COO.md");
 $("manualHtml").onclick=()=>download(new Blob(['<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AFE-CI — Manuel COO</title><style>body{font:16px/1.65 Arial,sans-serif;max-width:1000px;margin:35px auto;padding:0 18px;color:#172338}h1,h2,h3{color:#173b58}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd5df;padding:8px;text-align:left}li{margin:5px 0}</style><body>'+html+'</body></html>'],{type:"text/html;charset=utf-8"}),"AFE-CI-Manuel-Procedures-COO.html");
 $("manualPdf").onclick=()=>{try{const JsPDF=window.jspdf?.jsPDF;if(!JsPDF)throw Error("Le module PDF n’est pas chargé. Actualise la page.");const pdf=new JsPDF({unit:"mm",format:"a4"});let y=16;for(const raw of plain.split("\n")){const line=raw.trimEnd();if(!line){y+=3;continue;}const heading=/^#{1,3} /.test(line),text=pdf.splitTextToSize(line.replace(/^#{1,3} /,"").replace(/\*\*/g,"").replace(/\x60/g,""),180);if(heading){y+=2;pdf.setFont("helvetica","bold");pdf.setFontSize(line.startsWith("# ") ? 17 : line.startsWith("## ") ? 13 : 10);}else{pdf.setFont("helvetica","normal");pdf.setFontSize(9);}for(const part of text){if(y>282){pdf.addPage();y=16;}pdf.text(part,15,y);y+=heading?6:4.5;}}pdf.save("AFE-CI-Manuel-Procedures-COO.pdf");}catch(e){message(e.message,true)}}; $("manualWord").onclick=async()=>{try{const lib=window.docx;if(!lib?.Document||!lib?.Packer)throw Error("Le module Word n’est pas chargé. Actualise la page.");const paragraphs=plain.split("\n").map(line=>{const h=/^(#{1,3}) /.exec(line);return new lib.Paragraph({children:[new lib.TextRun({text:line.replace(/^#{1,3} /,"")||" ",bold:Boolean(h)||/^\*\*/.test(line),size:h?(h[1].length===1?34:h[1].length===2?28:24):20})],spacing:{after:100}})});const doc=new lib.Document({sections:[{properties:{},children:paragraphs}]});download(await lib.Packer.toBlob(doc),"AFE-CI-Manuel-Procedures-COO.docx");}catch(e){message(e.message,true)}};
}
let selectedArchiveId=null;
async function renderArchives(){
 const data=await api(base()+"archives"),archives=arr(data.archives),view=$("view");
 view.innerHTML='<section class="card"><div class="actions" style="justify-content:space-between"><div><h2>Archives centrales des missions</h2><p class="small">Dossiers de clôture conservés par numéro et date. Les instantanés de mission et de tâches sont en lecture seule.</p></div><span class="tag">'+archives.length+' dossier(s)</span></div><input class="field" id="archiveSearch" type="search" placeholder="Rechercher par numéro, mission, direction ou date…"><div id="archiveRows"></div></section><section id="archiveDetail"></section>';
 const rows=$("archiveRows"),search=$("archiveSearch");
 const paint=()=>{const q=search.value.trim().toLocaleLowerCase("fr"),filtered=archives.filter(a=>[a.mission_number,a.mission_title,a.department_name,a.archive_date].some(v=>String(v??"").toLocaleLowerCase("fr").includes(q)));rows.innerHTML=filtered.length?filtered.map(a=>'<div class="row"><div><strong>'+esc(a.mission_number)+' · '+esc(a.mission_title)+'</strong><span class="small">Clôturée le '+esc(a.archive_date)+' · '+esc(a.department_name||"Direction non renseignée")+' · '+esc(a.document_count||0)+' document(s)</span></div><button class="btn" data-open-archive="'+esc(a.id)+'">Ouvrir le dossier</button></div>').join(""):'<div class="empty">Aucun dossier ne correspond à cette recherche.</div>';rows.querySelectorAll("[data-open-archive]").forEach(b=>b.onclick=()=>openArchive(b.dataset.openArchive));};
 search.oninput=paint;paint();if(selectedArchiveId)await openArchive(selectedArchiveId);
 async function openArchive(id){
  selectedArchiveId=id;const d=await api(base()+"archives/"+encodeURIComponent(id)),a=d.archive,docs=arr(d.documents),available=arr(d.availableDocuments),snapshot=a.mission_snapshot||{},result=snapshot.result||{},related=arr(a.related_missions_snapshot),events=arr(a.events_snapshot),target=$("archiveDetail");
  target.innerHTML='<section class="card"><div class="actions" style="justify-content:space-between"><div><h2>'+esc(a.mission_number)+' · '+esc(a.mission_title)+'</h2><span class="small">Date d’archivage : '+esc(a.archive_date)+' · '+esc(a.department_name||"Direction non renseignée")+' · Agent : '+esc(a.agent_name||"Non renseigné")+'</span></div><button class="btn" id="closeArchiveDetail">Fermer</button></div><div class="grid"><div class="metric"><b>'+esc(arr(a.tasks_snapshot).length)+'</b><span class="small">Tâches figées à la clôture</span></div><div class="metric"><b>'+esc(docs.length)+'</b><span class="small">Documents rattachés</span></div><div class="metric"><b>'+esc(a.document_status==="complete"?"Complet":a.document_status==="partial"?"Partiel":"À compléter")+'</b><span class="small">État documentaire</span></div></div></section><section class="card"><h2>Rapport et résultats de mission</h2><h3>Synthèse</h3><p>'+esc(result.summary||"Aucune synthèse textuelle n’a été enregistrée dans le résultat de mission.")+'</p><h3>Analyse</h3><pre>'+esc(result.analysis||"Aucune analyse enregistrée.")+'</pre><h3>Livrables déclarés</h3>'+(arr(result.deliverables).length?arr(result.deliverables).map((x,i)=>'<div class="row"><strong>Livrable '+(i+1)+'</strong><pre>'+esc(typeof x==="string"?x:JSON.stringify(x,null,2))+'</pre></div>').join(""):'<div class="empty">Aucun livrable déclaré dans le résultat de mission.</div>')+'</section><section class="card"><h2>Rapports des directions contributrices</h2>'+(related.filter(m=>m.id!==a.mission_id).length?related.filter(m=>m.id!==a.mission_id).map(m=>{const r=m.result||{};return '<div class="row"><div><strong>'+esc(m.title||"Mission déléguée")+'</strong><span class="small">'+esc(m.department_name||"Direction non renseignée")+' · '+esc(m.agent_name||"Agent non renseigné")+' · '+esc(m.status||"Statut inconnu")+'</span><p>'+esc(r.summary||"Aucune synthèse enregistrée.")+'</p>'+(r.analysis?'<pre>'+esc(r.analysis)+'</pre>':'')+'</div></div>'}).join(""):'<div class="empty">Aucune sous-mission contributrice enregistrée dans cette mission.</div>')+'</section><section class="card"><h2>Photographie des tâches à la clôture</h2>'+(arr(a.tasks_snapshot).length?arr(a.tasks_snapshot).map(t=>'<div class="row"><div><strong>'+esc(t.title||t.id||"Tâche")+'</strong><span class="small">'+esc(t.status||"Statut inconnu")+' · '+esc(t.progress_percent??0)+' %</span></div></div>').join(""):'<div class="empty">Aucune tâche associée au moment de l’archivage.</div>')+'</section><section class="card"><h2>Historique des événements</h2>'+(events.length?events.map(e=>'<div class="row"><div><strong>'+esc(e.event_type||"Événement")+'</strong><span class="small">'+esc(e.actor_type||"Acteur non renseigné")+' · '+esc(e.created_at||"Date inconnue")+'</span><pre>'+esc(JSON.stringify(e.payload||{},null,2))+'</pre></div></div>').join(""):'<div class="empty">Aucun événement opérationnel enregistré.</div>')+'</section><section class="card"><h2>Documents et rapports associés</h2><p class="small">Chaque document est copié dans le stockage privé des archives. Le fichier source reste intact ; la copie archivée est indépendante et téléchargeable même si le document source est ultérieurement déplacé.</p>'+(docs.length?docs.map(doc=>'<div class="row"><div><strong>'+esc(doc.title)+'</strong><span class="small">'+esc(doc.mime_type)+' · '+esc(doc.size_bytes)+' octets · déposé le '+esc(doc.source_created_at||doc.linked_at)+'</span></div><button class="btn" data-download-archive-doc="'+esc(doc.id)+'">Télécharger</button></div>').join(""):'<div class="empty">Aucun document n’a encore été rattaché à ce dossier.</div>')+(available.length?'<div class="form" style="margin-top:12px"><div><label for="archiveDocumentSelect">Rattacher un document déjà enregistré dans le coffre</label><select class="field" id="archiveDocumentSelect"><option value="">Choisir un document…</option>'+available.map(doc=>'<option value="'+esc(doc.id)+'">'+esc(doc.title)+' · '+esc(doc.created_at)+'</option>').join("")+'</select></div><div style="align-self:end"><button class="btn primary" id="linkArchiveDocument">Rattacher au dossier</button></div></div>':'<p class="small">Aucun autre document disponible dans le coffre documentaire de cet espace.</p>')+'<div class="form" style="margin-top:14px"><div><label for="archiveFiles">Importer directement les rapports et livrables (PDF, Word, Excel, PowerPoint, images)</label><input class="field" id="archiveFiles" type="file" multiple accept=".pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp"></div><div style="align-self:end"><button class="btn primary" id="uploadArchiveFiles">Importer dans les archives</button></div></div></section><section class="card"><h2>Validation de la complétude documentaire</h2><p class="small">Réservé à la Direction générale. Confirmer uniquement après contrôle effectif des pièces du dossier ; la confirmation est horodatée et auditée.</p><label><input type="checkbox" id="archiveCheckDg"> Rapport de la Direction générale présent</label><label><input type="checkbox" id="archiveCheckDepartments"> Rapports des directions contributrices présents ou non applicables</label><label><input type="checkbox" id="archiveCheckEvidence"> Livrables et justificatifs présents ou non applicables</label><p><button class="btn primary" id="confirmArchiveComplete">Confirmer le dossier complet</button></p><p class="small">La confirmation ne supprime ni ne modifie les documents. Tout ajout ultérieur rouvre automatiquement le statut documentaire.</p></section><section class="card"><h2>Traçabilité et données de clôture</h2><pre>'+esc(JSON.stringify({missionId:a.mission_id,archivedAt:a.archived_at,missionSnapshot:snapshot},null,2))+'</pre></section>';
  $("closeArchiveDetail").onclick=()=>{selectedArchiveId=null;target.innerHTML=""};
  const complete=$("confirmArchiveComplete");if(complete)complete.onclick=async()=>{const checklist={dgReport:$("archiveCheckDg").checked,departmentReports:$("archiveCheckDepartments").checked,supportingEvidence:$("archiveCheckEvidence").checked};if(!Object.values(checklist).every(Boolean)){message("Confirmez les trois contrôles documentaires avant validation.",true);return}complete.disabled=true;try{await api(base()+"archives/"+encodeURIComponent(id)+"/complete",{method:"POST",body:JSON.stringify({checklist})});message("Complétude documentaire confirmée et auditée par la Direction générale.");await openArchive(id);await refreshArchiveRows()}catch(e){message(e.message,true);complete.disabled=false}};

  const link=$("linkArchiveDocument");if(link)link.onclick=async()=>{const documentId=$("archiveDocumentSelect").value;if(!documentId){message("Sélectionnez un document.",true);return}link.disabled=true;try{await api(base()+"archives/"+encodeURIComponent(id)+"/documents",{method:"POST",body:JSON.stringify({documentId})});message("Document rattaché au dossier d’archive.");await openArchive(id);await refreshArchiveRows()}catch(e){message(e.message,true)}finally{link.disabled=false}};
  const uploadButton=$("uploadArchiveFiles");if(uploadButton)uploadButton.onclick=async()=>{const files=Array.from($("archiveFiles").files||[]);if(!files.length){message("Sélectionnez au moins un fichier.",true);return}uploadButton.disabled=true;try{for(const file of files){const init=await api(base()+"archives/"+encodeURIComponent(id)+"/upload-url",{method:"POST",body:JSON.stringify({fileName:file.name,mimeType:file.type,sizeBytes:file.size})});const uploaded=await fetch(init.uploadUrl,{method:"PUT",headers:{"Content-Type":file.type},body:file});if(!uploaded.ok)throw new Error("Échec du téléversement de "+file.name+" ("+uploaded.status+").");await api(base()+"archives/"+encodeURIComponent(id)+"/upload-complete",{method:"POST",body:JSON.stringify({path:init.path,title:file.name,mimeType:file.type,sizeBytes:file.size})})}message(files.length+" document(s) archivé(s) avec succès.");await openArchive(id);await refreshArchiveRows()}catch(e){message(e.message,true)}finally{uploadButton.disabled=false}};
  target.querySelectorAll("[data-download-archive-doc]").forEach(b=>b.onclick=async()=>{try{const signed=await api(base()+"archives/"+encodeURIComponent(id)+"/documents/"+encodeURIComponent(b.dataset.downloadArchiveDoc)+"/signed-url",{method:"POST",body:"{}"});window.open(signed.url,"_blank","noopener,noreferrer")}catch(e){message(e.message,true)}});
 }
 async function refreshArchiveRows(){const fresh=await api(base()+"archives"),q=search.value.trim().toLocaleLowerCase("fr"),next=arr(fresh.archives).filter(a=>[a.mission_number,a.mission_title,a.department_name,a.archive_date].some(v=>String(v??"").toLocaleLowerCase("fr").includes(q)));rows.innerHTML=next.map(a=>'<div class="row"><div><strong>'+esc(a.mission_number)+' · '+esc(a.mission_title)+'</strong><span class="small">Clôturée le '+esc(a.archive_date)+' · '+esc(a.department_name||"Direction non renseignée")+' · '+esc(a.document_count||0)+' document(s)</span></div><button class="btn" data-open-archive="'+esc(a.id)+'">Ouvrir le dossier</button></div>').join("");rows.querySelectorAll("[data-open-archive]").forEach(b=>b.onclick=()=>openArchive(b.dataset.openArchive));}
}
async function render(){if(!wid){$("view").innerHTML='<section class="card">Aucun espace de travail sélectionné.</section>';return false}try{$("role").textContent="Rôle : "+role;const w=await api("/team/api/workspaces/"+encodeURIComponent(wid));role=w.role||role;$("role").textContent="Rôle : "+role;const v=$("view");v.innerHTML='<section class="card">Chargement des données COO…</section>';if(tab==="overview"){const d=await loadCommon();v.innerHTML=renderOverview(d)}else if(tab==="missions")await renderMissions();else if(tab==="departments")await renderDepartments();else if(tab==="tasks")await renderTasks();else if(tab==="alerts")await renderAlerts();else if(tab==="reports")await renderReports();else if(tab==="archives")await renderArchives();else if(tab==="settings")await renderSettings();else if(tab==="manual")renderManual();return true}catch(e){message("Échec du chargement COO : "+e.message,true);$("view").innerHTML='<section class="card error">'+esc(e.message)+'</section>';return false}}
$("tabs").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(!b)return;tab=b.dataset.tab;$("tabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));render()});
$("spaces").onchange=()=>{wid=$("spaces").value;render()};$("refresh").onclick=()=>render();$("cooLoginButton").onclick=loginFromCoo;$("cooLoginPassword").addEventListener("keydown",e=>{if(e.key==="Enter")loginFromCoo()});
const startupSession=session();if(startupSession?.access_token){$("cooLogin").hidden=true;message("Session reconnue. Récupération de ton espace de travail…");loadWorkspaceList().catch(e=>{if(!session()?.access_token){loginPrompt("Session expirée. Reconnecte-toi.");}else{$("cooLogin").hidden=true;message("Session active, mais impossible de charger l’espace de travail : "+e.message,true);}});}else{showLogin();loginPrompt("Authentification requise.");}
</script></body></html>`;