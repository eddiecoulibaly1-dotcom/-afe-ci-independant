import type { Debate, DebateRound, JudgeDecision } from "./types.js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertConfig(): { url: string; key: string } {
  if (!supabaseUrl) throw new Error("SUPABASE_URL is missing");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
  return { url: supabaseUrl.replace(/\/$/, ""), key: serviceRoleKey };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = assertConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${response.status}: ${body}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function saveDebateToSupabase(debate: Debate): Promise<void> {
  await request("debates?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: debate.id,
      question: debate.question,
      context: debate.context ?? null,
      status: debate.status,
      config: debate.config ?? null,
      final_decision: debate.finalDecision ?? null
    })
  });

  for (const round of debate.rounds) {
    await request("debate_rounds?on_conflict=debate_id,round_number", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        debate_id: debate.id,
        round_number: round.round,
        architect_proposal: round.architect,
        red_team_critique: round.redTeam,
        judge_decision: round.judge,
        created_at: round.createdAt
      })
    });
  }
}

interface DebateRow extends Omit<Debate, "rounds" | "finalDecision"> {
  final_decision?: JudgeDecision | null;
  debate_rounds: Array<{
    round_number: number;
    architect_proposal: DebateRound["architect"];
    red_team_critique: DebateRound["redTeam"];
    judge_decision: DebateRound["judge"];
    created_at: string;
  }>;
}

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
  const rows = await request<DebateRow[]>(`debates?id=eq.${encodeURIComponent(id)}&select=*,debate_rounds(*)&limit=1`);
  return rows[0] ? normalizeRow(rows[0]) : null;
}
