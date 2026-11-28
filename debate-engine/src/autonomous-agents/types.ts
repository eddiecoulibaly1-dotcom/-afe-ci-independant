export type AutonomyLevel = 1 | 2 | 3;
export type AgentStatus = "draft" | "active" | "paused" | "archived";
export type MissionStatus = "queued" | "planning" | "running" | "waiting_approval" | "paused" | "completed" | "failed" | "cancelled";
export type ToolPermission = "read" | "write" | "execute";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type MemoryStatus = "proposed" | "validated" | "rejected" | "superseded";

export interface AgentDepartmentTemplate {
  slug: string;
  name: string;
  specialty: string;
  mandate: string;
  defaultAutonomy: AutonomyLevel;
  defaultTools: readonly string[];
}

export interface AgentToolGrant {
  toolKey: string;
  permission: ToolPermission;
  enabled: boolean;
  approvalRequired: boolean;
  limits: Readonly<Record<string, unknown>>;
}

export interface AgentExecutionContext {
  workspaceId: string;
  agentId: string;
  missionId: string;
  actorUserId: string;
  autonomyLevel: AutonomyLevel;
  grants: readonly AgentToolGrant[];
}

export const AGENT_DEPARTMENT_TEMPLATES: readonly AgentDepartmentTemplate[] = [
  {
    slug: "strategie",
    name: "AFE-CI Stratégie",
    specialty: "Stratégie, développement et planification",
    mandate: "Étudier les orientations, marchés, modèles économiques, opportunités, partenariats et trajectoires de développement. Produire des analyses sourcées, scénarios, feuilles de route et indicateurs. Signaler explicitement les hypothèses non vérifiées.",
    defaultAutonomy: 2,
    defaultTools: ["research.web_search", "research.fetch_url", "workspace.read_documents", "workspace.create_draft"]
  },
  {
    slug: "finance-investissements",
    name: "AFE-CI Finance & Investissements",
    specialty: "Finance, modélisation et investissements",
    mandate: "Construire et contrôler des modèles financiers, analyser rentabilité, liquidité, financement, valorisation et risques d'investissement. Ne jamais inventer une donnée financière absente et distinguer hypothèses, estimations et données observées.",
    defaultAutonomy: 2,
    defaultTools: ["research.web_search", "research.fetch_url", "workspace.read_documents", "finance.calculate", "workspace.create_draft"]
  },
  {
    slug: "gouvernance-conformite",
    name: "AFE-CI Gouvernance & Conformité",
    specialty: "Gouvernance, droit réglementaire et conformité",
    mandate: "Identifier les exigences légales et réglementaires applicables, vérifier leur source, leur autorité, leur territoire et leur date d'effet, analyser les écarts et recommander des mesures correctives. Ne jamais présenter une analyse IA comme une certification juridique ou réglementaire.",
    defaultAutonomy: 2,
    defaultTools: ["research.web_search", "research.fetch_url", "workspace.read_documents", "workspace.create_draft"]
  },
  {
    slug: "technologie-ingenierie",
    name: "AFE-CI Technologie & Ingénierie",
    specialty: "Architecture, développement logiciel et cybersécurité",
    mandate: "Concevoir, développer, tester et documenter les solutions techniques dans les dépôts et environnements explicitement autorisés. Les écritures de code, changements d'infrastructure et déploiements sont soumis aux permissions et approbations applicables.",
    defaultAutonomy: 2,
    defaultTools: ["workspace.read_documents", "code.read_repository", "code.propose_patch"]
  },
  {
    slug: "risques-controle",
    name: "AFE-CI Risques & Contrôle",
    specialty: "Gestion des risques, contrôle interne et audit",
    mandate: "Identifier, évaluer, hiérarchiser et suivre les risques, contrôler les dispositifs de maîtrise et proposer des plans de remédiation. Distinguer constats vérifiés, signaux faibles et hypothèses.",
    defaultAutonomy: 2,
    defaultTools: ["research.web_search", "research.fetch_url", "workspace.read_documents", "workspace.create_draft"]
  },
  {
    slug: "recherche-prospective",
    name: "AFE-CI Recherche & Prospective",
    specialty: "Recherche documentaire, études sectorielles et prospective",
    mandate: "Collecter, comparer et qualifier les sources, analyser les tendances et produire des études traçables. Enregistrer les dates, périmètres, limites méthodologiques et contradictions des sources.",
    defaultAutonomy: 2,
    defaultTools: ["research.web_search", "research.fetch_url", "workspace.read_documents", "workspace.create_draft"]
  }
] as const;

const HIGH_RISK_TOOL_PREFIXES = [
  "finance.transfer",
  "finance.execute_payment",
  "legal.commit",
  "identity.manage",
  "access.manage",
  "deployment.production",
  "database.destructive",
  "infrastructure.production"
] as const;

export function requiresHumanApproval(input: { risk: RiskLevel; toolKey: string; autonomyLevel: AutonomyLevel; grantApprovalRequired: boolean }): boolean {
  if (input.risk === "high" || input.risk === "critical") return true;
  if (HIGH_RISK_TOOL_PREFIXES.some(prefix => input.toolKey === prefix || input.toolKey.startsWith(prefix + "."))) return true;
  if (input.autonomyLevel < 3 && input.grantApprovalRequired) return true;
  return input.grantApprovalRequired;
}

export function canAgentUseTool(context: AgentExecutionContext, grant: AgentToolGrant, required: ToolPermission): boolean {
  if (context.workspaceId.length === 0 || context.agentId.length === 0 || context.missionId.length === 0) return false;
  if (!grant.enabled || grant.toolKey.length === 0) return false;
  if (context.autonomyLevel < 1 || context.autonomyLevel > 3) return false;
  const permissionRank: Record<ToolPermission, number> = { read: 1, write: 2, execute: 3 };
  if (permissionRank[grant.permission] < permissionRank[required]) return false;
  if (required === "execute" && context.autonomyLevel < 3) return false;
  return context.grants.some(item =>
    item.enabled &&
    item.toolKey === grant.toolKey &&
    item.permission === grant.permission &&
    item.approvalRequired === grant.approvalRequired
  );
}
