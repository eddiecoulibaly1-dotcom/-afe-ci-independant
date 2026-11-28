export type StrategicHorizon=30|60|90;
export interface StrategicSnapshot { generated_at?:string; health_snapshot?:any; }
export interface StrategicInput { health:any; history?:StrategicSnapshot[]; rootCauses?:any[]; horizon?:StrategicHorizon; now?:string; }
export interface Trend { metric:string; current:number|null; previous:number|null; delta:number|null; direction:"improving"|"stable"|"worsening"|"unknown"; forecast:number|null; confidence:number; evidence:string[]; }
const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const num=(v:any):number|null=>typeof v==="number"&&Number.isFinite(v)?v:null;
const value=(h:any,k:string)=>num(h?.rates?.[k]);
function trend(metric:string,current:number|null,history:number[],horizon:StrategicHorizon,evidence:string[]):Trend{
 const valid=history.filter(Number.isFinite),prev=valid.length?valid.at(-1)??null:current;
 const delta=current!==null&&prev!==null?current-prev:null;
 const direction=delta===null?"unknown":delta>3?"worsening":delta< -3?"improving":"stable";
 const forecast=current===null?null:clamp(current+(delta??0)*(horizon/30));
 return{metric,current,previous:prev,delta,direction,forecast,confidence:valid.length>=3?.75:valid.length>=1?.55:.3,evidence};
}
export function buildStrategicIntelligence(i:StrategicInput){
 const h=i.health,history=[...(i.history??[])].sort((a,b)=>Date.parse(a.generated_at??"")-Date.parse(b.generated_at??"")).map(x=>x.health_snapshot).filter(Boolean),horizon=i.horizon??30;
 const metrics=[
  trend("overdueMissionRate",value(h,"overdueMissionRate"),history.map(x=>value(x,"overdueMissionRate")??NaN),horizon,["Missions actives en retard / missions actives"]),
  trend("missionFailureRate",value(h,"missionFailureRate"),history.map(x=>value(x,"missionFailureRate")??NaN),horizon,["Missions échouées / missions du portefeuille"]),
  trend("blockedMissionRate",value(h,"blockedMissionRate"),history.map(x=>value(x,"blockedMissionRate")??NaN),horizon,["Missions bloquées / portefeuille"]),
  trend("taskCompletionRate",value(h,"taskCompletionRate"),history.map(x=>value(x,"taskCompletionRate")??NaN),horizon,["Tâches terminées / tâches total"]),
  trend("taskBlockedRate",value(h,"taskBlockedRate"),history.map(x=>value(x,"taskBlockedRate")??NaN),horizon,["Tâches bloquées / tâches total"])
 ];
 const warnings:any[]=[];
 const overdue=h.portfolio?.overdueMissionCount??0,blocked=h.portfolio?.blockedMissionCount??0,failed=h.portfolio?.failedMissionCount??0,openAlerts=h.portfolio?.activeAlertCount??0,pending=h.portfolio?.pendingApprovalCount??0;
 if(overdue>=2|| (value(h,"overdueMissionRate")??0)>=25)warnings.push({id:"early:overdue",severity:overdue>=5?"critical":"high",title:"Dérive des échéances",evidence:[overdue+" mission(s) en retard",value(h,"overdueMissionRate")+"%"],trigger:">=2 missions en retard ou taux >=25%",recommendedAction:"Replanifier les échéances et traiter les prérequis prioritaires."});
 if(blocked>=2)warnings.push({id:"early:blocked",severity:blocked>=5?"critical":"high",title:"Risque de congestion du portefeuille",evidence:[blocked+" missions bloquées"],trigger:">=2 missions bloquées",recommendedAction:"Débloquer les dépendances, clarifier les propriétaires et escalader les obstacles."});
 if(failed>=1)warnings.push({id:"early:failure",severity:failed>=3?"critical":"high",title:"Récurrence potentielle d'échecs",evidence:[failed+" mission(s) échouée(s)"],trigger:">=1 mission échouée",recommendedAction:"Lancer un post-mortem factuel et vérifier les critères d'acceptation."});
 if(openAlerts>=3)warnings.push({id:"early:alerts",severity:openAlerts>=6?"critical":"high",title:"Accumulation d'alertes",evidence:[openAlerts+" alertes actives"],trigger:">=3 alertes actives",recommendedAction:"Prioriser les alertes selon impact et clôturer avec preuve."});
 if(pending>=3)warnings.push({id:"early:governance",severity:pending>=6?"critical":"moderate",title:"Ralentissement décisionnel",evidence:[pending+" arbitrages en attente"],trigger:">=3 décisions en attente",recommendedAction:"Préparer un dossier d'arbitrage synthétique et priorisé pour le DG."});
 const risks=warnings.map((w,index)=>{const impact=w.severity==="critical"?5:w.severity==="high"?4:3,likelihood=w.severity==="critical"?5:4,score=impact*likelihood;return{id:"risk:"+w.id,sourceWarningId:w.id,title:w.title,description:w.evidence.join("; "),likelihood,impact,score,level:score>=20?"critical":score>=12?"high":"moderate",owner:"COO",mitigation:w.recommendedAction,status:"open"};});
 const active= h.portfolio?.activeMissionCount??0,openTasks=h.portfolio?.openTaskCount??0,taskRate=value(h,"taskCompletionRate"),blockedTask=h.portfolio?.blockedTaskCount??0;
 const capacityPressure=active+openTasks===0?null:clamp(Math.round((active*2+openTasks+blockedTask*2)/Math.max(1,active+openTasks)*20));
 const scenarios=[
 {id:"base",name:"Tendance actuelle",assumption:"Les tendances et la capacité actuelles restent similaires.",forecast:metrics.map(m=>({metric:m.metric,value:m.forecast})),riskLevel:warnings.some(w=>w.severity==="critical")?"critical":warnings.length>=2?"high":"moderate",confidence:history.length>=3?.75:history.length? .55:.3},
 {id:"stress",name:"Scénario de tension",assumption:"Retards et blocages augmentent; débit de tâches baisse de 20%.",forecast:metrics.map(m=>({metric:m.metric,value:m.forecast===null?null:clamp(m.forecast+(m.metric==="taskCompletionRate"?-20:15))})),riskLevel:"critical",confidence:.35},
 {id:"recovery",name:"Scénario de redressement",assumption:"Les actions prioritaires sont approuvées et exécutées; amélioration ciblée de 15 points.",forecast:metrics.map(m=>({metric:m.metric,value:m.forecast===null?null:clamp(m.forecast+(m.metric==="taskCompletionRate"?15:-15))})),riskLevel:"moderate",confidence:.4}
 ];
 const options=[
 {id:"option:dependency-control",title:"Contrôle renforcé des dépendances",trigger:warnings.some(x=>x.id==="early:blocked"||x.id==="early:overdue"),actions:["Cartographier les prérequis critiques","Nommer un propriétaire par dépendance","Escalader les blocages persistants"],impact:"Réduire les retards et le temps de blocage",risk:"low",priority:1},
 {id:"option:capacity-balancing",title:"Rééquilibrage de capacité et WIP",trigger:capacityPressure!==null&&capacityPressure>=50,actions:["Limiter les missions simultanées","Rééquilibrer la charge entre directions","Protéger la capacité des missions prioritaires"],impact:"Améliorer le débit et réduire la congestion",risk:"medium",priority:2},
 {id:"option:decision-fastlane",title:"Circuit d'arbitrage prioritaire DG",trigger:pending>=3,actions:["Regrouper les décisions par risque","Préparer impacts et options","Escalader les arbitrages bloquants"],impact:"Réduire le délai décisionnel",risk:"medium",priority:3},
 {id:"option:failure-prevention",title:"Programme de prévention des échecs",trigger:failed>=1,actions:["Post-mortem avec preuves","Renforcer critères d'acceptation","Ajouter contrôles de qualité avant clôture"],impact:"Réduire les échecs récurrents",risk:"medium",priority:4}
 ].filter(x=>x.trigger).sort((a,b)=>a.priority-b.priority);
 const overall=warnings.some(w=>w.severity==="critical")?"critical":warnings.length>=3?"high":warnings.length?"moderate":"low";
 return{schemaVersion:1,generatedAt:i.now??new Date().toISOString(),horizonDays:horizon,dataCoverage:{snapshots:history.length,confidence:history.length>=3?"high":history.length?"medium":"low",limitations:history.length<3?["Historique insuffisant pour une tendance statistique robuste; prévisions indicatives et règles déterministes."]:[]},overallRisk:overall,earlyWarnings:warnings,trends:metrics,capacity:{activeMissions:active,openTasks,blockedTasks:blockedTask,taskCompletionRate:taskRate,pressureScore:capacityPressure,band:capacityPressure===null?"insufficient_data":capacityPressure>=70?"high":capacityPressure>=45?"moderate":"low"},riskRegister:risks,scenarios,strategicOptions:options,governance:{autoExecution:false,requiresDGApproval:true,generatedOptionsAreProposals:true}};
}
export function compareStrategicScenarios(intelligence:any,scenarioIds:string[]=["base","stress","recovery"]){const selected=intelligence.scenarios.filter((s:any)=>scenarioIds.includes(s.id));if(selected.length<2)throw Error("Au moins deux scénarios sont requis.");return{comparedAt:intelligence.generatedAt,scenarios:selected.map((s:any)=>({id:s.id,name:s.name,assumption:s.assumption,riskLevel:s.riskLevel,confidence:s.confidence,forecast:s.forecast})),decisionNote:"Comparaison indicative; aucun scénario ne modifie le portefeuille ou les paramètres d'exécution."};}
