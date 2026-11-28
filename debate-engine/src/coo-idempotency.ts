export type CooIdempotencyScope = { workspaceId: string; missionId: string; operation: string; leaseToken?: string };

/** Stable, deterministic identity for one logical COO side-effect. */
export function cooIdempotencyKey(scope: CooIdempotencyScope): string {
  const parts = [scope.workspaceId, scope.missionId, scope.operation, scope.leaseToken ?? "logical"];
  if (parts.some(part => !part.trim())) throw new Error("COO idempotency key components must be non-empty.");
  return parts.map(part => encodeURIComponent(part)).join(":");
}

/** Reject duplicate task results instead of silently collapsing them in a Map. */
export function validateUniqueCooTaskResults<T extends { taskId: unknown }>(results: T[]): string[] {
  const ids = results.map(result => String(result.taskId ?? "").trim());
  if (ids.some(id => !id)) throw new Error("COO task result contains an empty taskId.");
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate COO task result taskId detected; refusing synchronization.");
  return ids;
}

/** Publication must be fenced to the current claim; stale claims never publish. */
export function assertCooPublicationFence(claim: { mission_id: string; workspace_id: string; lease_token: string }, expected: { missionId: string; workspaceId: string; leaseToken: string }): void {
  if (claim.mission_id !== expected.missionId || claim.workspace_id !== expected.workspaceId || claim.lease_token !== expected.leaseToken) {
    throw new Error("COO publication fence mismatch: stale or foreign claim.");
  }
}
