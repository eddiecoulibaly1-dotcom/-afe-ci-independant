export type MissionDependency = { missionId: string; dependsOnMissionId: string };
export type DependencyReadiness = { ready: boolean; pending: string[]; failed: string[]; missing: string[] };
export function assertDependencyAddition(missionId:string,dependsOnMissionId:string,existing:MissionDependency[]):void {
 if(!missionId||!dependsOnMissionId)throw new Error("Mission et prérequis obligatoires.");
 if(missionId===dependsOnMissionId)throw new Error("Une mission ne peut pas dépendre d'elle-même.");
 const graph=new Map<string,string[]>();
 for(const edge of existing)graph.set(edge.missionId,[...(graph.get(edge.missionId)??[]),edge.dependsOnMissionId]);
 if((graph.get(missionId)??[]).includes(dependsOnMissionId))throw new Error("Cette dépendance existe déjà.");
 const stack=[dependsOnMissionId],visited=new Set<string>();
 while(stack.length){const current=stack.pop()!;if(current===missionId)throw new Error("Cette dépendance créerait un cycle.");if(visited.has(current))continue;visited.add(current);stack.push(...(graph.get(current)??[]));}
}
export function evaluateDependencyReadiness(deps:MissionDependency[],statuses:ReadonlyMap<string,string>):DependencyReadiness {
 const pending:string[]=[],failed:string[]=[],missing:string[]=[];
 for(const edge of deps){const status=statuses.get(edge.dependsOnMissionId);if(status===undefined)missing.push(edge.dependsOnMissionId);else if(status==="failed"||status==="cancelled")failed.push(edge.dependsOnMissionId);else if(status!=="���q�^