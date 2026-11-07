export type DepartmentCode = "RES" | "STR" | "FIN" | "COM" | "OPS" | "RSK" | "AUD" | "TEC";
export type OfficeKind = "executive" | "department" | "agent";
export type AutonomyLevel = 1 | 2 | 3;

export interface DepartmentDefinition {
  code: DepartmentCode;
  name: string;
  purpose: string;
  mandate: readonly string[];
  capabilities: readonly string[];
  defaultDeliverables: readonly string[];
  independentReview: boolean;
}

export interface OfficeDefinition {
  id: string;
  kind: OfficeKind;
  label: string;
  parentId: string | null;
  departmentCode?: DepartmentCode;
  ownerRole: "human_owner" | "general_manager" | "department_director" | "specialist_agent";
}

export interface AgentRoleDefinition {
  roleId: string;
  title: string;
  departmentCode: DepartmentCode;
  capabilities: readonly string[];
  mandate: readonly string[];
  autonomyLevel: AutonomyLevel;
  requiresIndependentReviewFor: readonly string[];
}

export const ORGANIZATION_ID = "afe-ci-intelligence-organization";
export const ORGANIZATION_NAME = "AFE-CI Intelligence Organization";

export const DEPARTMENT_CATALOG: readonly DepartmentDefinition[] = [
  { code: "RES", name: "Recherche & Evidence Intelligence", purpose: "Produire un socle documentaire traçable et vérifier la provenance des informations.", mandate: ["rechercher des sources autorisées", "extraire et qualifier les éléments probants", "documenter les limites et lacunes"], capabilities: ["research", "source_verification", "evidence_synthesis"], defaultDeliverables: ["source_register", "evidence_brief", "coverage_report"], independentReview: false },
  { code: "STR", name: "Stratégie & Développement", purpose: "Analyser les options, le positionnement, les trajectoires et les conséquences stratégiques.", mandate: ["diagnostiquer une situation", "comparer les options", "formuler des recommandations conditionnelles"], capabilities: ["strategic_analysis", "option_design", "foresight"], defaultDeliverables: ["strategic_diagnosis", "options_analysis", "recommendation"], independentReview: false },
  { code: "FIN", name: "Finance & Investissements", purpose: "Évaluer les dimensions financières et économiques sur la base de données explicites.", mandate: ["construire des modèles financiers", "analyser coûts et budgets", "tester rentabilité et sensibilité"], capabilities: ["financial_modeling", "budget_analysis", "investment_appraisal"], defaultDeliverables: ["financial_model", "investment_note", "sensitivity_analysis"], independentReview: false },
  { code: "COM", name: "Commercial & Marché", purpose: "Évaluer demande, concurrence, clientèle, prix et débouchés.", mandate: ["étudier le marché", "analyser la concurrence", "élaborer des hypothèses commerciales"], capabilities: ["market_research", "competitive_analysis", "sales_forecasting"], defaultDeliverables: ["market_study", "commercial_strategy", "sales_forecast"], independentReview: false },
  { code: "OPS", name: "Opérations & Exécution", purpose: "Concevoir les processus, ressources, capacités et plans de mise en œuvre.", mandate: ["décrire les processus", "évaluer capacités et ressources", "préparer un plan d'exécution"], capabilities: ["operating_model", "capacity_planning", "implementation_planning"], defaultDeliverables: ["operating_plan", "resource_plan", "implementation_roadmap"], independentReview: false },
  { code: "RSK", name: "Risques & Faisabilité", purpose: "Identifier les incertitudes, risques, contraintes, contrôles et conditions de faisabilité.", mandate: ["identifier et évaluer les risques", "tester les hypothèses défavorables", "proposer des mesures de maîtrise"], capabilities: ["risk_assessment", "feasibility_analysis", "stress_testing"], defaultDeliverables: ["risk_register", "feasibility_assessment", "mitigation_plan"], independentReview: false },
  { code: "AUD", name: "Audit, Qualité & Gouvernance", purpose: "Effectuer une revue indépendante des méthodes, preuves, calculs et conclusions.", mandate: ["examiner les preuves et leur traçabilité", "détecter incohérences et biais", "émettre un avis indépendant"], capabilities: ["independent_review", "quality_assurance", "governance_audit"], defaultDeliverables: ["independent_review_report", "quality_findings", "open_reservations"], independentReview: true },
  { code: "TEC", name: "Technologie & Ingénierie", purpose: "Concevoir, construire, sécuriser et tester les systèmes techniques.", mandate: ["concevoir des architectures", "développer et maintenir les composants", "vérifier sécurité et qualité technique"], capabilities: ["software_architecture", "engineering", "security_testing"], defaultDeliverables: ["technical_design", "implementation", "test_report"], independentReview: false }
] as const;

export const EXECUTIVE_OFFICES: readonly OfficeDefinition[] = [
  { id: "president-office", kind: "executive", label: "Bureau du Président", parentId: null, ownerRole: "human_owner" },
  { id: "general-management-office", kind: "executive", label: "Bureau du Directeur général IA", parentId: "president-office", ownerRole: "general_manager" },
  ...DEPARTMENT_CATALOG.map((department): OfficeDefinition => ({
    id: `department-office-${department.code.toLowerCase()}`,
    kind: "department",
    label: `Bureau — ${department.name}`,
    parentId: "general-management-office",
    departmentCode: department.code,
    ownerRole: "department_director"
  }))
];

export interface MissionCapabilityNeed {
  capability: string;
  required: boolean;
  reason: string;
}

export interface DepartmentMatch {
  department: DepartmentDefinition;
  matchedCapabilities: string[];
  missingRequiredCapabilities: string[];
  score: number;
}

export function validateOrganizationCatalog(): string[] {
  const errors: string[] = [];
  const codes = DEPARTMENT_CATALOG.map(item => item.code);
  if (new Set(codes).size !== codes.length) errors.push("duplicate_department_code");
  const officeIds = EXECUTIVE_OFFICES.map(item => item.id);
  if (new Set(officeIds).size !== officeIds.length) errors.push("duplicate_office_id");
  for (const office of EXECUTIVE_OFFICES) {
    if (office.parentId && !officeIds.includes(office.parentId)) errors.push(`missing_office_parent:${office.id}`);
    if (office.kind === "department" && (!office.departmentCode || !codes.includes(office.departmentCode))) errors.push(`invalid_department_office:${office.id}`);
  }
  const audit = DEPARTMENT_CATALOG.find(item => item.code === "AUD");
  if (!audit?.independentReview) errors.push("independent_audit_must_be_explicit");
  return errors;
}

export function matchDepartments(needs: readonly MissionCapabilityNeed[]): DepartmentMatch[] {
  const required = needs.filter(item => item.required).map(item => item.capability);
  const requested = new Set(needs.map(item => item.capability));
  return DEPARTMENT_CATALOG.map(department => {
    const matchedCapabilities = department.capabilities.filter(capability => requested.has(capability));
    const missingRequiredCapabilities = required.filter(capability =>
      !DEPARTMENT_CATALOG.some(candidate => candidate.capabilities.includes(capability)) ||
      (department.capabilities.includes(capability) && !matchedCapabilities.includes(capability))
    );
    return {
      department,
      matchedCapabilities,
      missingRequiredCapabilities,
      score: matchedCapabilities.length
    };
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.department.code.localeCompare(b.department.code));
}

export function getDepartmentOffice(code: DepartmentCode): OfficeDefinition | undefined {
  return EXECUTIVE_OFFICES.find(office => office.kind === "department" && office.departmentCode === code);
}
