export type Sector =
  | "public_policy" | "transport" | "finance" | "agriculture" | "health"
  | "energy" | "technology" | "education" | "commerce" | "general";

export interface SectorProfile {
  sector: Sector;
  label: string;
  scope: string;
  criteria: Array<{ id: string; label: string; weight: number; evidenceNeeded: string[] }>;
  indicators: string[];
  sourceDomains: string[];
  analysisInstructions: string[];
}

const WEIGHTS = [15, 15, 15, 15, 10, 10, 10, 5, 5] as const;
const IDS = ["buyerValue","sellerValue","coteDIvoireFit","marketplaceLiquidity","differentiation","trustFraud","technicalFeasibility","acquisition","monetization"] as const;
const COMMON_LABELS = ["Valeur pour les bénéficiaires","Valeur pour les opérateurs et partenaires","Adéquation au contexte local","Demande, capacité et dynamique du marché","Avantage distinctif","Conformité, confiance et intégrité","Faisabilité technique et opérationnelle","Adoption et mobilisation des acteurs","Viabilité économique et financement"] as const;
const COMMON = IDS.map((id,i)=>({id,label:COMMON_LABELS[i],weight:WEIGHTS[i],evidenceNeeded:["indicateurs observés","sources primaires","méthode et période de mesure"]}));

const PROFILES: Record<Sector, Omit<SectorProfile, "sector">> = {
  public_policy: { label:"Politiques publiques",scope:"efficacité, équité, soutenabilité budgétaire et capacité institutionnelle",criteria:[...COMMON].map(x=>({...x})),indicators:["coût public total","coût par bénéficiaire","couverture","effet distributif","efficacité budgétaire","impact mesuré"],sourceDomains:["gouv.ci","ins.ci","bceao.int","worldbank.org","imf.org","afdb.org","un.org"],analysisInstructions:["Distinguer annonce politique, budget voté, engagement, décaissement et réalisation.","Examiner les effets distributifs, les coûts récurrents et les capacités institutionnelles."] },
  transport: { label:"Transport et infrastructures",scope:"mobilité, capacité, coûts de cycle de vie, sécurité et intégration territoriale",criteria:[...COMMON].map(x=>({...x})),indicators:["voyageurs/jour","temps de parcours","coût par voyageur-km","coût complet du cycle de vie","taux de disponibilité","accidentologie","émissions"],sourceDomains:["gouv.ci","ins.ci","worldbank.org","afdb.org","un.org","itf-oecd.org"],analysisInstructions:["Comparer les options sur un même périmètre, une même période et une même unité de service.","Intégrer coûts d'investissement, exploitation, maintenance, foncier, sécurité et externalités.","Ne pas assimiler capacité théorique et fréquentation observée."] },
  finance: { label:"Finance et services financiers",scope:"rentabilité, liquidité, risques, conformité et protection des clients",criteria:[...COMMON].map(x=>({...x})),indicators:["revenu net","marge","CAC","LTV","liquidité","défaut","coût du risque","exigences réglementaires"],sourceDomains:["bceao.int","amf-umoa.org","crepmf.org","ohada.org","imf.org","worldbank.org"],analysisInstructions:["Distinguer activité réglementée, intermédiation, prestation technique et partenariat sous licence.","Vérifier la réglementation applicable dans la juridiction et à la date de décision.","Séparer rentabilité comptable, trésorerie et solvabilité."] },
  agriculture: { label:"Agriculture et agroalimentaire",scope:"production, rendement, intrants, chaîne de valeur, saisonnalité et résilience",criteria:[...COMMON].map(x=>({...x})),indicators:["rendement/ha","prix producteur","coût des intrants","pertes post-récolte","marge par unité","saisonnalité","accès au marché"],sourceDomains:["gouv.ci","anader.ci","fao.org","ifad.org","worldbank.org","afdb.org"],analysisInstructions:["Tenir compte des saisons, des zones agroécologiques, des pertes et de la volatilité des intrants.","Ne pas extrapoler un prix ou rendement local à une autre région sans ajustement documenté."] },
  health: { label:"Santé",scope:"sécurité clinique, accès, qualité, efficacité et soutenabilité",criteria:[...COMMON].map(x=>({...x})),indicators:["résultats cliniques","couverture","effets indésirables","coût par résultat","capacité du système","équité d'accès"],sourceDomains:["who.int","afro.who.int","gouv.ci","worldbank.org","unicef.org"],analysisInstructions:["Privilégier recommandations et données sanitaires officielles et évaluations systématiques.","Ne pas transformer une association statistique en causalité clinique."] },
  energy: { label:"Énergie",scope:"sécurité d'approvisionnement, coûts système, fiabilité et transition",criteria:[...COMMON].map(x=>({...x})),indicators:["coût actualisé","capacité ferme","facteur de charge","pertes réseau","disponibilité","émissions","sécurité d'approvisionnement"],sourceDomains:["gouv.ci","iea.org","irena.org","worldbank.org","afdb.org"],analysisInstructions:["Comparer coûts complets du système, stockage, réseau, combustible et intermittence.","Séparer capacité installée, production réelle et puissance disponible."] },
  technology: { label:"Technologie et numérique",scope:"adoption, sécurité, interopérabilité, coûts de possession et valeur utilisateur",criteria:[...COMMON].map(x=>({...x})),indicators:["coût total de possession","taux d'adoption","disponibilité","latence","incidents","rétention","interopérabilité"],sourceDomains:["itu.int","iso.org","nist.gov","worldbank.org","ec.europa.eu"],analysisInstructions:["Évaluer coûts d'intégration, maintenance, cybersécurité, dépendance fournisseur et réversibilité.","Distinguer prototype, pilote, produit déployé et usage réellement actif."] },
  education: { label:"Éducation",scope:"apprentissages, accès, équité, qualité pédagogique et coût par apprenant",criteria:[...COMMON].map(x=>({...x})),indicators:["acquis d'apprentissage","achèvement","assiduité","coût par apprenant","accès rural","écarts de résultats"],sourceDomains:["gouv.ci","unesco.org","unicef.org","worldbank.org","uis.unesco.org"],analysisInstructions:["Distinguer accès à un service, usage régulier et amélioration effective des apprentissages.","Contrôler la comparabilité des cohortes et des méthodes d'évaluation."] },
  commerce: { label:"Commerce et distribution",scope:"demande, marges, rotation, logistique et comportement client",criteria:[...COMMON].map(x=>({...x})),indicators:["volume de ventes","marge brute","rotation des stocks","coût d'acquisition","récurrence","pertes","coût logistique"],sourceDomains:["gouv.ci","ins.ci","worldbank.org","unctad.org","afdb.org"],analysisInstructions:["Séparer ventes déclarées, transactions observées, intention d'achat et marché théorique.","Analyser saisonnalité, fonds de roulement, retours, pertes et concentration des acheteurs."] },
  general: { label:"Analyse transversale",scope:"valeur créée, faisabilité, risques, preuves et soutenabilité",criteria:[...COMMON].map(x=>({...x})),indicators:["impact","coût total","délai","adoption","risque","résultat mesurable"],sourceDomains:["worldbank.org","imf.org","oecd.org","un.org","afdb.org"],analysisInstructions:["Identifier le domaine principal et ses règles spécifiques avant de conclure.","Expliciter les données manquantes et les limites de comparabilité."] }
};

export function detectSector(question: string, context = ""): SectorProfile {
  const text = (question + " " + context).toLowerCase();
  const rules: Array<[Sector, RegExp]> = [
    ["transport",/transport|mobilit|route|circulation|embouteillage|bus|train|infrastructure|portuaire|aéroport/],
    ["finance",/banque|financ|crédit|paiement|assurance|microfinance|investissement|bceao|monnaie/],
    ["agriculture",/agric|élevage|volaille|récolte|intrant|engrais|agroaliment|ferme|pêche/],
    ["health",/santé|hôpital|médical|clinique|vaccin|maladie|soin/],
    ["energy",/énergie|électricité|solaire|pétrole|gaz|énergétique|réseau électrique/],
    ["technology",/logiciel|numérique|intelligence artificielle|application|cybersécurité|technologie|plateforme/],
    ["education",/éducation|école|enseignement|apprentissage|formation|université/],
    ["commerce",/commerce|distribution|vente|marché|retail|grossiste|détaillant/],
    ["public_policy",/politique publique|budget public|collectivité|ministère|service public|réforme publique/]
  ];
  const sector = rules.find(([,pattern])=>pattern.test(text))?.[0] ?? "general";
  return { sector, ...PROFILES[sector] };
}

export function sectorPromptGuidance(profile: SectorProfile): string {
  return [
    "PROFIL SECTORIEL DÉTECTÉ : "+profile.label,
    "Périmètre d'analyse : "+profile.scope+".",
    "Critères d'arbitrage et pondérations : "+profile.criteria.map(x=>x.label+" ("+x.weight+" %)").join("; ")+".",
    "Indicateurs sectoriels à rechercher : "+profile.indicators.join("; ")+".",
    ...profile.analysisInstructions,
    "Si le secteur détecté est incorrect, signale l'ambiguïté et n'applique pas aveuglément ces critères."
  ].join("\n");
}
