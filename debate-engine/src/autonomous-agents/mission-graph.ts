export type MissionLifecycle = "queued"|"planning"|"running"|"waiting_approval"|"paused"|"completed"|"failed"|"cancelled";
export type MissionNode = { id:string; parentMissionId:string|null; status:MissionLifecycle; depth:number };
export type MissionDependency = { missionId:string; dependsOnMissionId:string };

const TERMINAL = new Set<MissionLifecycle>(["completed","failed","cancelled"]);
export function validateMissionGraph(nodes:MissionNode[],dependencies:MissionDependency[],maxDepth=5){
  const byId=new Map(nodes.map(n=>[n.id,n]));
  if(byId.size!==nodes.length)throw new Error("Duplicate mission identifier.");
  for(const n of nodes){
    if(n.parentMissionId){
      if(n.parentMissionId===n.id)throw new Error("Mission cannot be its own parent.");
      if(!byId.has(n.parentMissionId))throw new Error("Parent mission is outside this graph.");
      let cursor:MissionNode|undefined=byId.get(n.parentMissionId),depth=1;
      const seen=new Set([n.id]);
      while(cursor){
        if(seen.has(cursor.id))throw new Error("Mission hierarchy cycle detected.");
        seen.add(cursor.id);
        if(!cursor.parentMissionId)break;
        cursor=byId.get(cursor.parentMissionId);depth++;
        if(depth>maxDepth)throw new Error("Maximum mission hierarchy depth exceeded.");
      }
      if(n.depth!==depth)throw new Error("Mission hierarchy depth is inconsistent.");
    }else if(n.depth!==0)throw new Error("Root mission depth must be zero.");
  }
  const edges=new Set<string>();
  const adjacency=new Map<string,string[]>();
  for(const d of dependencies){
    if(!byId.has(d.missionId)||!byId.has(d.dependsOnMissionId))throw new Error("Dependency crosses graph/workspace boundary.");
    if(d.missionId===d.dependsOnMissionId)throw new Error("Mission cannot depend on itself.");
    const key=d.missionId+":"+d.dependsOnMissionId;
    if(edges.has(key))continue;edges.add(key);
    const xs=adjacency.get(d.dependsOnMissionId)??[];xs.push(d.missionId);adjacency.set(d.dependsOnMissionId,xs);
  }
  const visiting=new Set<string>(),visited=new Set<string>();
  function visit(id:string){if(visiting.has(id))throw new Error("Mission dependency cycle detected.");if(visited.has(id))return;visiting.add(id);for(const next of adjacency.get(id)??[])visit(next);visiting.delete(id);visited.add(id);}
  for(const id of byId.keys())visit(id);
  return {nodeCount:nodes.length,dependencyCount:edges.size,readyMissionIds:nodes.filter(n=>!TERMINAL.has(n.status)&&dependencies.filter(d=>d.missionId===n.id).every(d=>byId.get(d.dependsOnMissionId)?.status==="completed")).map(n=>n.id)};
}
export function aggregateChildMissionStatus(children:MissionNode[]){
  if(!children.length)return "empty" as const;
  if(children.some(c=>c.status==="failed"))return "attention_required" as const;
  if(children.every(c=>c.status==="completed"))return "completed" as const;
  if(children.every(c=>TERMINAL.has(c.status)))return "completed_with_exceptions" as const;
  if(children.some(c=>c.status==="waiting_approval"))return "waiting_approval" as const;
  if(children.some(c=>c.status==="running"||c.status==="planning"))return "in_progress" as const;
  return "pending" as const;
}
export function canStartMission(node:MissionNode,dependencies:MissionDependency[],nodes:MissionNode[]){
  const byId=new Map(nodes.map(n=>[n.id,n]));
  return dependencies.filter(d=>d.missionId===node.id).every(d=>byId.get(d.dependsOnMissionId)?.status==="completed");
}
