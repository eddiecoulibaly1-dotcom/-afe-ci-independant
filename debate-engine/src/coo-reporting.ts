export type ReportingMission = {
  id: string;
  status: string;
  effective_department_id?: string | null;
  title?: string;
  department_name?: string;
};
export type ReportingTask = {
  id: string;
  mission_id?: string | null;
  status: string;
  effective_department_id?: string | null;
};
export type DepartmentPerformance = { missionCount: number };
export function resolveTaskDepartmentId(
  task: { department_id?: string | null },
  mission?: { effective_department_id?: string | null } | null,
  agent?: { department_id?: string | null } | null
): string | null {
  return task.department_id ?? mission?.effective_department_id ?? agent?.department_id ?? null;
}
export function buildCooDataQuality(
  missions: ReportingMission[],
  tasks: ReportingTask[],
  departmentPerformance: DepartmentPerformance[]
) {
  const tasksByMission = new Map<string, ReportingTask[]>();
  for (const task of tasks) {
    if (!task.mission_id) continue;
    const linked = tasksByMission.get(task.mission_id) ?? [];
    linked.push(task);
    tasksByMission.set(task.mission_id, linked);
  }
  const completed = missions.filter(m => m.status === "completed");
  const completedWithoutTasks = completed.filter(m => !(tasksByMission.get(m.id)?.length));
  const completedWithIncompleteTasks = completed.filter(m => {
    const linked = tasksByMission.get(m.id) ?? [];
    return linked.length > 0 && linked.some(t => t.status !== "done");
  });
  const completedVerified = completed.filter(m => {
    const linked = tasksByMission.get(m.id) ?? [];
    return linked.length > 0 && linked.every(t => t.status === "done");
  });
  const assignedMissionCount = missions.filter(m => Boolean(m.effective_department_id)).length;
  const unassignedMissions = missions.filter(m => !m.effective_department_id);
  const departmentMissionCount = departmentPerformance.reduce((n, d) => n + (Number.isFinite(d.missionCount) ? d.missionCount : 0), 0);
  const findings: string[] = [];
  if (completedWithoutTasks.length) findings.push(completedWithoutTasks.length + " mission(s) terminée(s) sans tâche opérationnelle associée : exécution non démontrée par le registre des tâches.");
  if (completedWithIncompleteTasks.length) findings.push(completedWithIncompleteTasks.length + " mission(s) terminée(s) possèdent des tâches non terminées : clôture incohérente.");
  if (unassignedMissions.length) findings.push(unassignedMissions.length + " mission(s) sans direction identifiable après rapprochement avec le responsable IA.");
  if (assignedMissionCount + unassignedMissions.length !== missions.length) findings.push("Le total des missions affectées et non affectées ne réconcilie pas le portefeuille.");
  if (departmentMissionCount !== assignedMissionCount) findings.push("La ventilation des missions par direction (" + departmentMissionCount + ") ne correspond pas au nombre de missions affectées (" + assignedMissionCount + ").");
  return {
    missionCount: missions.length,
    assignedMissionCount,
    departmentMissionCount,
    unassignedMissionCount: unassignedMissions.length,
    completedVerifiedMissionCount: completedVerified.length,
    completedWithoutTasks: completedWithoutTasks.map(m => ({ id: m.id, title: m.title ?? "", department: m.department_name ?? "Non affectée" })),
    completedWithIncompleteTasks: completedWithIncompleteTasks.map(m => ({ id: m.id, title: m.title ?? "", department: m.department_name ?? "Non affectée" })),
    findings
  };
}
