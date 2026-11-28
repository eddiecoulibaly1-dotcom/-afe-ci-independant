export type CooDispatchRecoveryTask = { coo_task_key: unknown };

/** Pure completeness check for a read-back after an RPC outcome became ambiguous. */
export function validateAmbiguousCooDispatchRecovery(
  missionId: unknown,
  missionKey: string,
  expectedTaskCount: number,
  tasks: CooDispatchRecoveryTask[]
): { missionId: string; taskCount: number } | null {
  if (missionId == null || missionId === "") return null;
  if (!Number.isSafeInteger(expectedTaskCount) || expectedTaskCount < 0) {
    throw new Error("Invalid expected task count for dispatch recovery.");
  }
  const expectedKeys = Array.from({ length: expectedTaskCount }, (_, index) => missionKey + ":task:" + index);
  const actualKeys = tasks.map(task => String(task.coo_task_key ?? ""));
  const complete = expectedKeys.every(key => actualKeys.includes(key)) &&
    actualKeys.length === expectedTaskCount && new Set(actualKeys).size === expectedTaskCount;
  if (!complete) {
    throw new Error("Ambiguous RPC result: mission found but task set incomplete or inconsistent. No automatic redispatch; recovery required.");
  }
  return { missionId: String(missionId), taskCount: tasks.length };
}
