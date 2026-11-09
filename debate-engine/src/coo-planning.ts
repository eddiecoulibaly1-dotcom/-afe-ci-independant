export type CooWorkstream = {
  departmentSlug: string;
  missionTitle: string;
  objective: string;
  priority: number;
  dueInHours: number;
  tasks: Array<{ title: string; description: string; priority: number; dueInHours: number }>;
};

export function consolidateDepartmentWorkstreams<T extends CooWorkstream>(
  streams: T[]
): { workstreams: T[]; mergedDepartmentSlugs: string[] } {
  const grouped = new Map<string, T>();
  const merged = new Set<string>();

  for (const stream of streams) {
    const existing = grouped.get(stream.departmentSlug);
    if (!existing) {
      grouped.set(stream.departmentSlug, {
        ...stream,
        tasks: [...stream.tasks]
      });
      continue;
    }

    merged.add(stream.departmentSlug);
    const priorTitle = existing.missionTitle;
    existing.missionTitle = (priorTitle.slice(0, 190) + " (plan consolidé)").slice(0, 220);
    existing.objective = [
      existing.objective,
      "Volet complémentaire — " + stream.missionTitle + " : " + stream.objective
    ].filter(Boolean).join("\n\n");
    existing.tasks.push(...stream.tasks);
    // Keep the earliest deadline so consolidation never relaxes a commitment.
    existing.dueInHours = Math.min(existing.dueInHours, stream.dueInHours);
    // Preserve the first workstream's priority rather than guessing the priority scale.
  }

  return {
    workstreams: [...grouped.values()],
    mergedDepartmentSlugs: [...merged]
  };
}
