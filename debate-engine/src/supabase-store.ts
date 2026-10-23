import type { Debate, DebateRound, JudgeDecision } from "./types.js";

function getConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getConfig();
  if (!config) throw new Error("Supabase persistence is not configured");

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text ? JSON.parse(text) as T : (undefined as T);
}

export function supabasePersistenceEnabled(): boolean {
  return Boolean(getConfig());
}

export async function saveDebateToSupabase(debate: Debate): Promise<void> {
  await request("debates?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: debate.id,
      question: debate.question,
      context: debate.context ?? null,
      mode: "decision",
      status: debate.status,
      config: debate.config ?? {},
      final_decision: debate.finalDecision ?? null
    })
  });

  for (const round of debate.rounds) {
    const roundRows = await request<Array<{ id: string }>>("debate_rounds?on_conflict=debate_id%2Cround_number&select=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        debate_id: debate.id,
        round_number: round.round,
        architect_proposal: round.architect,
        red_team_critique: round.redTeam,
        judge_decision: round.judge
      })
    });
    const roundId = roundRows[0]?.id;
    if (!roundId) throw new Error(`Supabase did not return round id for round ${round.round}`);

    await request("debate_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([
        { debate_id: debate.id, round_id: roundId, event_type: "architect_proposal", actor: "architect", payload: round.architect },
        { debate_id: debate.id, round_id: roundId, event_type: "evidence_audit", actor: "evidence_engine", payload: round.evidenceAudit ?? {} },
        { debate_id: debate.id, round_id: roundId, event_type: "red_team_critique", actor: "red_team", payload: round.redTeam },
        { debate_id: debate.id, round_id: roundId, event_type: "judge_decision", actor: "judge", payload: round.judge }
      ])
    });

    if (round.evidenceAudit?.records.length) {
      const evidenceRows = round.evidenceAudit.records.flatMap((record) => record.evidenceRefs.map((ref) => ({
        debate_id: debate.id,
        round_id: roundId,
        kind: "source",
        title: `${record.claimId} evidence reference`,
        url: ref.startsWith("http://") || ref.startsWith("https://") ? ref : null,
        excerpt: null,
        strength: Math.round(record.confidence * 100),
        metadata: { claim_id: record.claimId, classification: record.classification, status: record.status, rationale: record.rationale }
      })));
      if (evidenceRows.length) {
        await request("debate_evidence", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(evidenceRows)
        });
      }
    }

    const hypotheses = round.architect.claims
      .filter((claim) => claim.type === "hypothesis")
      .map((claim) => ({
        debate_id: debate.id,
        statement: claim.statement,
        status: "open",
        confidence: claim.confidence,
        source_round: round.round
      }));
    if (hypotheses.length > 0) {
      await request("debate_hypotheses", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(hypotheses)
      });
    }
  }

  if (debate.finalDecision) {
    await request("debate_decisions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        debate_id: debate.id,
        decision_type: debate.status === "converged" ? "final" : "unresolved",
        statement: debate.finalDecision.decision,
        score: Math.max(debate.finalDecision.architectScore, debate.finalDecision.redTeamScore),
        rationale: debate.finalDecision.rationale,
        status: debate.status === "converged" ? "accepted" : "needs_validation"
      })
    });
  }
}

type DebateRow = Omit<Debate, "rounds" | "finalDecision"> & {
  final_decision?: JudgeDecision | null;
  debate_rounds: Array<{
    round_number: number;
    architect_proposal: DebateRound["architect"];
    red_team_critique: DebateRound["redTeam"];
    judge_decision: DebateRound["judge"];
    created_at: string;
  }>;
};

function normalizeRow(row: DebateRow): Debate {
  return {
    id: row.id,
    question: row.question,
    context: row.context,
    status: row.status,
    config: row.config,
    finalDecision: row.final_decision ?? undefined,
    rounds: (row.debate_rounds ?? [])
      .sort((a, b) => a.round_number - b.round_number)
      .map((round) => ({
        round: round.round_number,
        architect: round.architect_proposal,
        redTeam: round.red_team_critique,
        judge: round.judge_decision,
        createdAt: round.created_at
      }))
  };
}

export async function listDebatesFromSupabase(): Promise<Debate[]> {
  const rows = await request<DebateRow[]>("debates?select=*,debate_rounds(*)&order=created_at.desc");
  return rows.map(normalizeRow);
}

export async function getDebateFromSupabase(id: string): Promise<Debate | null> {
  const rows = await request<DebateRow[]>(`debates?select=*,debate_rounds(*)&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] ? normalizeRow(rows[0]) : null;
}
