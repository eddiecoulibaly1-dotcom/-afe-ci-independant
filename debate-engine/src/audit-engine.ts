export type AuditEventType = "request_classified" | "agent_selected" | "claim_recorded" | "evidence_checked" | "scenario_built" | "risk_assessed" | "score_calculated" | "arbitration_completed" | "report_generated";
export interface ReasoningAuditEvent {
  id: string;
  caseId: string;
  actor: string;
  type: AuditEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
}
export function createAuditEvent(input: Omit<ReasoningAuditEvent, "occurredAt"> & { occurredAt?: string }): ReasoningAuditEvent {
  if (!input.id.trim() || !input.caseId.trim() || !input.actor.trim()) throw new Error("AUDIT_EVENT_ID_CASE_ACTOR_REQUIRED");
  const date = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error("AUDIT_EVENT_TIMESTAMP_INVALID");
  return { ...input, occurredAt: date.toISOString() };
}
export function verifyAuditSequence(events: ReasoningAuditEvent[]): { valid: boolean; duplicateIds: string[]; invalidTimestamps: string[] } {
  const ids = new Set<string>();
  const duplicateIds: string[] = [];
  const invalidTimestamps: string[] = [];
  for (const event of events) {
    if (ids.has(event.id)) duplicateIds.push(event.id);
    ids.add(event.id);
    if (!Number.isFinite(Date.parse(event.occurredAt))) invalidTimestamps.push(event.id);
  }
  return { valid: duplicateIds.length === 0 && invalidTimestamps.length === 0, duplicateIds, invalidTimestamps };
}
