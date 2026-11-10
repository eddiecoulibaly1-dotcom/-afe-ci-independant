export type CanonicalWorkstream = {
  code: string;
  label: string;
  departmentSlug: string;
  requiredTerms: string[];
  requiredMandateTerms: string[];
  charter: string;
};

export const MATURITY_PROGRAMME_V1: CanonicalWorkstream[] = [
  { code:"P0", label:"Intégrité des données et fiabilité du système", departmentSlug:"risques-controle", requiredTerms:["données","intégrité","fiabilité"], requiredMandateTerms:["risques","contrôles","indépendance"], charter:"P0 — Intégrité des données et fiabilité du système. Mandat : établir les contrôles d'intégrité, détecter les incohérences, définir les règles de qualité des données et vérifier la fiabilité des enregistrements." },
  { code:"P1", label:"Dépendances entre missions et coordination des directions", departmentSlug:"operations-missions", requiredTerms:["dépendances","coordination","missions"], requiredMandateTerms:["missions","tâches","dépendances"], charter:"P1 — Dépendances entre missions et coordination des directions. Mandat : cartographier les dépendances, clarifier les responsabilités inter-directions, séquencer les travaux et prévenir les blocages." },
  { code:"P2", label:"Fiabilité des agents, workers et mécanismes de reprise", departmentSlug:"audit-qualite", requiredTerms:["agents","workers","reprise"], requiredMandateTerms:["qualité","traçabilité","procédures"], charter:"P2 — Fiabilité des agents, workers et mécanismes de reprise. Mandat : tester les exécutions, tentatives, leases, reprises, idempotence, journaux et critères de clôture des agents et workers." },
  { code:"P3", label:"Contrôle interne, risques et conformité", departmentSlug:"gouvernance-conformite", requiredTerms:["contrôle","risques","conformité"], requiredMandateTerms:["délégations","conformité","conflits d'intérêts"], charter:"P3 — Contrôle interne, risques et conformité. Mandat : examiner la séparation des fonctions, les habilitations, les contrôles, les conflits d'intérêts et les exigences de conformité." },
  { code:"P4", label:"Evidence Intelligence et traçabilité", departmentSlug:"evidence-intelligence", requiredTerms:["preuves","traçabilité","sources"], requiredMandateTerms:["provenance","empreintes","preuves"], charter:"P4 — Evidence Intelligence et traçabilité. Mandat : garantir provenance, intégrité, qualification, conservation et rattachement des preuves aux constats." },
  { code:"P5", label:"Reporting et intelligence de gestion", departmentSlug:"documentation-reporting", requiredTerms:["reporting","indicateurs","rapports"], requiredMandateTerms:["rapports","synthèses","archives"], charter:"P5 — Reporting et intelligence de gestion. Mandat : fiabiliser les indicateurs, rapprochements, synthèses DG, rapports, exports et archives." },
  { code:"P6", label:"Gouvernance, responsabilités et expérience utilisateur", departmentSlug:"secretariat-general", requiredTerms:["gouvernance","responsabilités","procédures"], requiredMandateTerms:["mandats","jalons","affectations"], charter:"P6 — Gouvernance, responsabilités et expérience utilisateur. Mandat : formaliser rôles, responsabilités, procédures, circuits de validation, consignes et parcours opérationnels." },
  { code:"P7", label:"Résilience, sécurité et continuité opérationnelle", departmentSlug:"infrastructure-securite", requiredTerms:["résilience","sécurité","continuité"], requiredMandateTerms:["architecture","disponibilité","sécurité"], charter:"P7 — Résilience, sécurité et continuité opérationnelle. Mandat : vérifier disponibilité, sauvegardes, restauration, sécurité, séparation des environnements et continuité." }
];

export function isMaturityProgrammeInstruction(instruction: string): boolean {
  return /programme de fiabilisation et de maturité organisationnelle|référentiel directeur.*P0|\bP0\b[\s\S]*\bP7\b/i.test(instruction);
}

export function assertCanonicalMaturityPlan(
  workstreams: Array<{departmentSlug:string;missionTitle:string;objective:string;tasks:Array<{title:string;description:string}>}>,
  availableDepartments: Array<{slug:string;active?:boolean;is_independent?:boolean;human_only?:boolean;director_agent_id?:string|null;mandate?:string}>
): void {
  const errors:string[]=[];
  const normalize=(value:string)=>value.toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const byCode = new Map<string, typeof workstreams[number]>();
  for (const stream of workstreams) {
    const code = stream.missionTitle.match(/\bP[0-7]\b/i)?.[0]?.toUpperCase();
    if (!code) { errors.push("Chantier sans code P0–P7 : "+stream.missionTitle); continue; }
    if (byCode.has(code)) errors.push("Code de chantier dupliqué : "+code);
    else byCode.set(code,stream);
  }
  for (const spec of MATURITY_PROGRAMME_V1) {
    const stream=byCode.get(spec.code);
    if (!stream) { errors.push("Chantier obligatoire manquant : "+spec.code); continue; }
    if (stream.departmentSlug!==spec.departmentSlug) errors.push(spec.code+" doit relever de "+spec.departmentSlug+", pas de "+stream.departmentSlug);
    const department=availableDepartments.find(d=>d.slug===spec.departmentSlug);
    if (!department || department.active===false || department.is_independent || department.human_only || !department.director_agent_id) errors.push("Direction/mandat indisponible pour "+spec.code+" ("+spec.departmentSlug+")");
    const mandate=normalize(typeof department?.mandate==="string"?department.mandate:"");
    const missingMandate=spec.requiredMandateTerms.filter(term=>!mandate.includes(normalize(term)));
    if (missingMandate.length) errors.push(spec.code+" : mandat de direction incompatible ou incomplet (attendus : "+missingMandate.join(", ")+")");
    const objective=normalize(typeof stream.objective==="string"?stream.objective:"");
    const missingObjective=spec.requiredTerms.filter(term=>!objective.includes(normalize(term)));
    if (missingObjective.length) errors.push(spec.code+" : objectif métier incompatible ou incomplet (attendus : "+missingObjective.join(", ")+")");
    if (!Array.isArray(stream.tasks) || stream.tasks.length===0 || stream.tasks.some(t=>!t || typeof t.title!=="string" || !t.title.trim() || typeof t.description!=="string" || !t.description.trim())) {
      errors.push(spec.code+" : au moins une tâche exploitable avec titre et description est obligatoire");
    }
  }
  for (const code of byCode.keys()) if (!MATURITY_PROGRAMME_V1.some(x=>x.code===code)) errors.push("Code non prévu dans le référentiel : "+code);
  if (byCode.size!==8) errors.push("Le référentiel exige exactement huit chantiers P0 à P7.");
  if (errors.length) throw new Error("Validation du référentiel P0–P7 refusée : "+errors.join(" ; "));
}

export function canonicalizeMaturityPlan<T extends {departmentSlug:string;missionTitle:string;objective:string;tasks:Array<{title:string;description:string}>}>(workstreams:T[]):T[] {
  return MATURITY_PROGRAMME_V1.map(spec=>{
    const stream=workstreams.find(x=>x.missionTitle.match(/\bP[0-7]\b/i)?.[0]?.toUpperCase()===spec.code)!;
    return {...stream,missionTitle:spec.code+" — "+spec.label,objective:spec.charter+"\n\nObjectif et livrables proposés par le COO :\n"+stream.objective};
  });
}
