export type PlanItem={id:string;title:string;description?:string;owner:string;deliverable:string;metric?:string;dueAt?:string;dependsOn?:string[];stopCondition?:string;fallback?:string};
export type DecisionStatus="draft"|"submitted"|"approved"|"rejected"|"returned-for-revision"|"execution-authorized"|"evaluating"|"closed";
export type DecisionActor={id:string;role:"DG"|"owner"|"editor"|"agent";};
export type DecisionEvent={at:string;actorId:string;action:string;from:DecisionStatus;to:DecisionStatus;rationale:string};
export type GovernedDecision={id:string;status:DecisionStatus;executingAgentId?:string|null;reviewerId?:string|null;events:DecisionEvent[];approvedAt?:string|null;executionAuthorizedAt?:string|null;immutableApprovedRecord?:any};
export function buildIntegratedPlan(items:PlanItem[]){
 if(!Array.isArray(items)||!items.length)throw new Error("Plan vide");
 const ids=new Set<string>();for(const x of items){if(!x.id||ids.has(x.id))throw new Error("IDs de tâches invalides ou dupliqués");ids.add(x.id);if(!x.title.trim()||!x.owner.trim()||!x.deliverable.trim())throw new Error("Titre, owner et livrable requis");}
 for(const x of items)for(const d of x.dependsOn??[])if(!ids.has(d))throw new Error("Dépendance inconnue: "+d);
 const visiting=new Set<string>(),visited=new Set<string>();const order:string[]=[];
 const visit=(id:string)=>{if(visiting.has(id))throw new Error("Cycle de dépendances détecté");if(visited.has(id))return;visiting.add(id);for(const d of items.find(x=>x.id===id)?.dependsOn??[])visit(d);visiting.delete(id);visited.add(id);order.push(id);};
 for(const x of items)visit(x.id);
 return {items:items.map(x=>({...x,dependsOn:[...(x.dependsOn??[])]})),topologicalOrder:order,criticalPathCandidates:order.filter(id=>items.find(x=>x.id===id)?.dependsOn?.length),status:"draft" as const,executionAuthorized:false};
}
export type E10BridgeProposalRecord = { proposalId: string; proposal: any; sourceItemId: string };

/** Convert an explicitly DG-authorized integrated plan into stable, non-executing E10 proposal drafts. */
export function buildE10BridgeProposals(
  decisionPackId: string,
  payload: any,
  createdBy: string,
  createdAt = new Date().toISOString()
): E10BridgeProposalRecord[] {
  if (typeof decisionPackId !== "string" || !decisionPackId.trim() || typeof createdBy !== "string" || !createdBy.trim()) throw new Error("Decision pack ID and creator are required.");
  const decision = payload?.decision;
  if (decision?.status !== "execution-authorized") throw new Error("DG execution authorization required before E10 bridge.");
  if (decision.id !== decisionPackId || !decision?.immutableApprovedRecord || decision.immutableApprovedRecord.decisionId !== decisionPackId || decision.immutableApprovedRecord.approvedStatus !== "approved" ||
      !decision.immutableApprovedRecord.approvedBy || !decision.approvedAt || decision.immutableApprovedRecord.approvedAt !== decision.approvedAt || !decision.executionAuthorizedAt) {
    throw new Error("Immutable DG approval and execution authorization snapshot required.");
  }
  const approvedBy = decision.immutableApprovedRecord.approvedBy;
  if (!Array.isArray(decision.immutableApprovedRecord.events) || !decision.immutableApprovedRecord.events.some((event: any) =>
    event?.action === "approve" && event?.to === "approved" && event?.actorId === approvedBy && Boolean(String(event?.rationale ?? "").trim())
  )) throw new Error("Immutable DG approval event required.");
  if (!Array.isArray(decision.events) || !decision.events.some((event: any) =>
    event?.action === "authorize-execution" && event?.from === "approved" && event?.to === "execution-authorized" &&
    Boolean(event?.actorId) && Boolean(String(event?.rationale ?? "").trim())
  )) throw new Error("Recorded DG execution authorization event required.");
  const plan = payload?.integratedPlan;
  if (!Array.isArray(plan?.items) || !plan.items.length) throw new Error("Integrated plan is empty; create and validate it first.");
  const validatedPlan = buildIntegratedPlan(plan.items);
  const question = typeof payload.question === "string" && payload.question.trim() ? payload.question.trim() : "Dossier stratégique";
  const expectedImpact = typeof payload.decisionSummary === "string" && payload.decisionSummary.trim()
    ? payload.decisionSummary.trim()
    : "Impact attendu à préciser à partir du dossier stratégique.";
  return validatedPlan.items.map(item => {
    const proposalId = "e12:" + decisionPackId + ":" + item.id;
    const proposal = {
      id: proposalId,
      title: item.title,
      problem: "Action issue du dossier E12 autorisé par le DG: " + question,
      rootCauseIds: ["e12:" + decisionPackId],
      actions: [{
        id: item.id,
        title: item.title,
        description: item.description ?? "",
        owner: item.owner,
        deliverable: item.deliverable,
        dueAt: item.dueAt ?? null,
        dependsOn: [...(item.dependsOn ?? [])],
        metric: item.metric ?? null,
        stopCondition: item.stopCondition ?? null,
        fallback: item.fallback ?? null
      }],
      expectedImpact,
      riskLevel: "medium",
      status: "draft",
      createdBy,
      createdAt,
      source: {
        type: "E12",
        decisionPackId,
        approvedBy: decision.immutableApprovedRecord.approvedBy,
        approvedAt: decision.approvedAt,
        authorizedBy: decision.events.find((event: any) => event?.action === "authorize-execution")?.actorId ?? null,
        authorizedAt: decision.executionAuthorizedAt
      }
    };
    return { proposalId, proposal, sourceItemId: item.id };
  });
}

const transitions:Record<DecisionStatus,DecisionStatus[]>={draft:["submitted"],submitted:["approved","rejected","returned-for-revision"],approved:["execution-authorized","returned-for-revision"],rejected:[], "returned-for-revision":["draft","submitted"],"execution-authorized":["evaluating"],evaluating:["closed"],closed:[]};
export function transitionDecision(decision:GovernedDecision,action:"submit"|"approve"|"reject"|"return"|"revise"|"authorize-execution"|"start-evaluation"|"close",actor:DecisionActor,rationale:string,at=new Date().toISOString()){
 if(!rationale.trim())throw new Error("Justification obligatoire");
 const map:Record<typeof action,DecisionStatus>={submit:"submitted",approve:"approved",reject:"rejected",return:"returned-for-revision",revise:"draft","authorize-execution":"execution-authorized","start-evaluation":"evaluating",close:"closed"};
 const to=map[action];if(!transitions[decision.status].includes(to))throw new Error("Transition non autorisée: "+decision.status+" → "+to);
 if(action==="approve"||action==="reject"||action==="return"){if(actor.role!=="DG")throw new Error("Arbitrage réservé au DG");if(decision.executingAgentId&&actor.id===decision.executingAgentId)throw new Error("Séparation des fonctions: agent exécutant ne peut arbitrer sa propre décision");}
 if(action==="authorize-execution"&&actor.role!=="DG")throw new Error("Autorisation d'exécution réservée au DG");
 if(action==="start-evaluation"&&decision.status!=="execution-authorized")throw new Error("Exécution explicitement autorisée requise");
 const event={at,actorId:actor.id,action,from:decision.status,to,rationale};const next={...decision,status:to,events:[...decision.events,event]};
 if(action==="approve")next.approvedAt=at;
 if(action==="authorize-execution")next.executionAuthorizedAt=at;
 if(action==="approve")next.immutableApprovedRecord={decisionId:decision.id,approvedAt:at,approvedBy:actor.id,approvedStatus:"approved",rationale,events:[...next.events]};
 return next;
}
export type OutcomeEvaluation={baseline:Record<string,number|null>;expected:Record<string,number|null>;actual:Record<string,number|null>;evidenceIds:string[];lessons:string[];followUp?:string};
export function evaluateDecisionOutcome(input:OutcomeEvaluation){
 if(!input.evidenceIds.length)throw new Error("Preuves d’évaluation requises");
 const keys=new Set([...Object.keys(input.baseline),...Object.keys(input.expected),...Object.keys(input.actual)]);
 const metrics=[...keys].map(metric=>{const b=input.baseline[metric]??null,e=input.expected[metric]??null,a=input.actual[metric]??null;return{metric,baseline:b,expected:e,actual:a,variance:a===null||e===null?null:a-e,improvementFromBaseline:a===null||b===null?null:a-b,coverage:a===null?0:100};});
 return {evaluatedAt:new Date().toISOString(),metrics,evidenceIds:[...input.evidenceIds],lessons:[...input.lessons],followUp:input.followUp??null,limitations:metrics.filter(m=>m.actual===null).map(m=>m.metric+" : résultat réel manquant"),policyMutation:false,autoExecution:false};
}
