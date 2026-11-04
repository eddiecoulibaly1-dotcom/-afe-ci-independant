export interface StrategicFinancialInputs {
  currency?: string;
  targetActiveUsers?: number | null;
  fundingCap?: number | null;
  activeUsersM12?: number | null;
  activeUsersM24?: number | null;
  activeUsersM36?: number | null;
  pessimisticActiveUsersM36?: number | null;
  optimisticActiveUsersM36?: number | null;
  monthlyRevenuePerActive?: number | null;
  monthlyVariableCostPerActive?: number | null;
  monthlyFixedCosts?: number | null;
  customerAcquisitionCost?: number | null;
  monthlyChurnRatePct?: number | null;
}
export interface FinancialScenario {
  name: string;
  horizon: string;
  activeUsers: number | null;
  monthlyRevenuePerActive: number | null;
  monthlyVariableCostPerActive: number | null;
  monthlyFixedCosts: number | null;
  operatingResult: number | null;
  conclusion: string;
}
export interface StrategicFinancialCalculation {
  currency: string;
  status: "calculated" | "partial" | "insufficient";
  inputs: Array<{ metric:string; value:number|null; unit:string; basis:"provided"|"unknown" }>;
  scenarios: FinancialScenario[];
  breakEvenActiveUsers: number | null;
  contributionPerActive: number | null;
  cacPaybackMonths: number | null;
  estimatedLtv: number | null;
  ltvToCac: number | null;
  monthlyProjection: Array<{ month:number; activeUsers:number|null; revenue:number|null; operatingResult:number|null }>;
  cumulativeOperatingResult36: number | null;
  formulas: string[];
  limitations: string[];
}
const FIELDS = [
  ["targetActiveUsers","Objectif d'actifs","commerçants"],
  ["fundingCap","Plafond de financement externe","FCFA"],
  ["activeUsersM12","Commerçants actifs à M12","commerçants"],
  ["activeUsersM24","Commerçants actifs à M24","commerçants"],
  ["activeUsersM36","Commerçants actifs à M36","commerçants"],
  ["pessimisticActiveUsersM36","Actifs M36 — scénario pessimiste","commerçants"],
  ["optimisticActiveUsersM36","Actifs M36 — scénario optimiste","commerçants"],
  ["monthlyRevenuePerActive","Revenu mensuel par actif","FCFA/mois"],
  ["monthlyVariableCostPerActive","Coût variable mensuel par actif","FCFA/mois"],
  ["monthlyFixedCosts","Coûts fixes mensuels","FCFA/mois"],
  ["customerAcquisitionCost","Coût d'acquisition (CAC)","FCFA/commerçant"],
  ["monthlyChurnRatePct","Attrition mensuelle","%"]
] as const;
function valid(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function rounded(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function resultAt(users: number|null, arpu: number|null, variable: number|null, fixed: number|null): number|null {
  if (users === null || arpu === null || variable === null || fixed === null) return null;
  return rounded(users * (arpu - variable) - fixed);
}
export function calculateStrategicFinancialModel(input: StrategicFinancialInputs = {}): StrategicFinancialCalculation {
  const get = (key: keyof StrategicFinancialInputs): number|null => valid(input[key]) ? input[key] as number : null;
  const currency = typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : "XOF";
  const target = get("targetActiveUsers"), funding = get("fundingCap");
  const m12=get("activeUsersM12"),m24=get("activeUsersM24"),m36=get("activeUsersM36");
  const pessimistic=get("pessimisticActiveUsersM36"),optimistic=get("optimisticActiveUsersM36");
  const arpu=get("monthlyRevenuePerActive"),variable=get("monthlyVariableCostPerActive"),fixed=get("monthlyFixedCosts");
  const cac=get("customerAcquisitionCost"),churnPct=get("monthlyChurnRatePct");
  const contribution=arpu!==null&&variable!==null?rounded(arpu-variable):null;
  const breakEven=contribution!==null&&fixed!==null&&contribution>0?Math.ceil(fixed/contribution):null;
  const payback=contribution!==null&&cac!==null&&contribution>0?rounded(cac/contribution):null;
  const ltv=contribution!==null&&churnPct!==null&&churnPct>0?rounded(contribution/(churnPct/100)):null;
  const ltvCac=ltv!==null&&cac!==null&&cac>0?rounded(ltv/cac):null;
  const scenarios:FinancialScenario[]=[
    {name:"Pessimiste",horizon:"M36",activeUsers:pessimistic,monthlyRevenuePerActive:arpu,monthlyVariableCostPerActive:variable,monthlyFixedCosts:fixed,operatingResult:resultAt(pessimistic,arpu,variable,fixed),conclusion:pessimistic===null?"Nombre d'actifs non renseigné : résultat non calculable.":resultAt(pessimistic,arpu,variable,fixed)===null?"Données de revenus ou de coûts manquantes.":(resultAt(pessimistic,arpu,variable,fixed)!>=0?"Résultat opérationnel mensuel positif selon les entrées fournies.":"Résultat opérationnel mensuel négatif selon les entrées fournies.")},
    {name:"Central",horizon:"M36",activeUsers:m36,monthlyRevenuePerActive:arpu,monthlyVariableCostPerActive:variable,monthlyFixedCosts:fixed,operatingResult:resultAt(m36,arpu,variable,fixed),conclusion:m36===null?"Nombre d'actifs M36 non renseigné.":resultAt(m36,arpu,variable,fixed)===null?"Données de revenus ou de coûts manquantes.":(resultAt(m36,arpu,variable,fixed)!>=0?"Résultat opérationnel mensuel positif selon les entrées fournies.":"Résultat opérationnel mensuel négatif selon les entrées fournies.")},
    {name:"Optimiste",horizon:"M36",activeUsers:optimistic,monthlyRevenuePerActive:arpu,monthlyVariableCostPerActive:variable,monthlyFixedCosts:fixed,operatingResult:resultAt(optimistic,arpu,variable,fixed),conclusion:optimistic===null?"Nombre d'actifs non renseigné : résultat non calculable.":resultAt(optimistic,arpu,variable,fixed)===null?"Données de revenus ou de coûts manquantes.":(resultAt(optimistic,arpu,variable,fixed)!>=0?"Résultat opérationnel mensuel positif selon les entrées fournies.":"Résultat opérationnel mensuel négatif selon les entrées fournies.")}
  ];
  const monthlyProjection=[{month:12,activeUsers:m12,revenue:m12!==null&&arpu!==null?rounded(m12*arpu):null,operatingResult:resultAt(m12,arpu,variable,fixed)},{month:24,activeUsers:m24,revenue:m24!==null&&arpu!==null?rounded(m24*arpu):null,operatingResult:resultAt(m24,arpu,variable,fixed)},{month:36,activeUsers:m36,revenue:m36!==null&&arpu!==null?rounded(m36*arpu):null,operatingResult:resultAt(m36,arpu,variable,fixed)}];
  let cumulative:number|null=null;
  if(m12!==null&&m24!==null&&m36!==null&&arpu!==null&&variable!==null&&fixed!==null){
    const activeMonths=12*((0+m12)/2+(m12+m24)/2+(m24+m36)/2);
    cumulative=rounded(activeMonths*(arpu-variable)-36*fixed);
  }
  const inputs=FIELDS.map(([key,metric,unit])=>({metric,value:get(key),unit:key==="fundingCap"||key==="customerAcquisitionCost"||key==="monthlyRevenuePerActive"||key==="monthlyVariableCostPerActive"||key==="monthlyFixedCosts"?currency+(unit.includes("/")?unit.slice(unit.indexOf("/")):""):unit,basis:get(key)===null?"unknown" as const:"provided" as const}));
  const coreComplete=arpu!==null&&variable!==null&&fixed!==null&&m36!==null;
  const status=coreComplete?"calculated":inputs.some(x=>x.value!==null)?"partial":"insufficient";
  const formulas=[
    "Marge contributive mensuelle = revenu mensuel moyen par actif − coût variable mensuel par actif.",
    "Seuil de rentabilité en actifs = arrondi supérieur des coûts fixes mensuels ÷ marge contributive, uniquement si celle-ci est positive.",
    "Délai de récupération du CAC = CAC ÷ marge contributive mensuelle, uniquement si les deux données sont disponibles.",
    "LTV indicative = marge contributive mensuelle ÷ taux d'attrition mensuel (en décimal). Elle suppose une marge et une attrition constantes.",
    "Résultat opérationnel mensuel = actifs × (revenu mensuel par actif − coût variable mensuel par actif) − coûts fixes mensuels.",
    "Résultat opérationnel cumulé M1–M36 : approximation par interpolation linéaire entre 0, M12, M24 et M36 ; hors CAC, coûts de lancement, impôts, financement et investissements exceptionnels."
  ];
  const limitations=[
    "Les entrées sont des hypothèses ou données fournies par l'utilisateur ; aucune n'est qualifiée d'observation vérifiée par ce calculateur.",
    "Les scénarios M36 ne sont calculés que si le nombre d'actifs correspondant est fourni.",
    "Le résultat opérationnel ne constitue pas un flux de trésorerie ni un bénéfice net comptable.",
    "La LTV suppose une marge contributive et un taux d'attrition constants ; elle ne doit pas être interprétée comme une valeur observée.",
    "Le cumul sur 36 mois suppose une évolution linéaire des actifs entre les jalons ; il exclut CAC, coûts initiaux, impôts, financement et investissements non renseignés."
  ];
  if(target!==null&&m36!==null&&m36<target)limitations.push("L'objectif d'actifs fourni n'est pas atteint dans le scénario central à M36.");
  if(funding!==null)limitations.push("Le plafond de financement externe est enregistré, mais le besoin total de financement n'est pas calculé sans coûts d'acquisition, dépenses initiales et plan de trésorerie complets.");
  return {currency,status,inputs,scenarios,breakEvenActiveUsers:breakEven,contributionPerActive:contribution,cacPaybackMonths:payback,estimatedLtv:ltv,ltvToCac:ltvCac,monthlyProjection,cumulativeOperatingResult36:cumulative,formulas,limitations};
}
