export type DelegationState = "open" | "closed";
export type MissionTerminalStatus = "completed" | "failed" | "cancelled";

export function canAddChildToCoordinator(input: {
  orchestrationMode: string;
  delegationState: DelegationState | string | null | undefined;
  status: string;
}) {
  return input.orchestrationMode === "coordinator"
    && input.delegationState === "open"
    && ["queued", "planning", "paused"].includes(input.status);
}

export function canClaimCoordinator(input: {
  orchestrationMode: string;
  delegationState: DelegationState | string | null | undefined;
  children: Array<{ status: string }>;
}) {
  if (input.orchestrationMode !== "coordinator") return true;
  if (input.delegationState !== "closed") return false;
  return input.children.every(child =>
    ["completed", "failed", "cancelled"].includes(child.status)
  );
}

export function summarizeDelegation(children: Array<{ status: string }>) {
  const completed = children.filter(child => child.status === "completed").length;
  const failed = children.filter(child => child.status === "failed").length;
  const cancelled = children.filter(child => child.status === "cancelled").length;
  const pending = children.length - completed - failed - cancelled;
  return {
    total: children.length,
    completed,
    failed,
    cancelled,
    pending,
    readyForCoordinator: pending === 0
  };
}
