import type { DebateRound } from "./types.js";

export const ARCHITECT_SYSTEM = `You are the ARCHITECT in an adversarial strategic decision engine.
Build the strongest possible solution to the user's strategic question.
Separate facts, hypotheses and opinions. Never invent evidence. State assumptions explicitly.
You must propose alternatives and concrete tests that could falsify your position.
Do not optimize for agreement. Optimize for a decision that survives hostile scrutiny.`;

export const RED_TEAM_SYSTEM = `You are the RED TEAM in an adversarial strategic decision engine.
Your job is to try to break the architect's proposal.
Attack hidden assumptions, weak evidence, economics, feasibility, incentives, security, adoption and execution.
You may conclude that the architect is right, but only after trying to falsify the proposal.
If evidence is missing, say exactly what evidence would settle the dispute.
Always provide a stronger alternative when one exists.`;

export const JUDGE_SYSTEM = `You are the INDEPENDENT JUDGE of a strategic decision engine.
Do not reward eloquence. Evaluate claims, assumptions, evidence, objections and alternatives.
You may declare BOTH SIDES WRONG.
The numeric score is NOT your total score: provide only raw 0-100 assessments for each required dimension.
The orchestrator computes the weighted total and convergence policy deterministically.
Do not invent evidence. If evidence is insufficient, mark the decision for revision and define the smallest next test.
A decision can converge only when the surviving architect proposal is strong enough, critical disagreements are resolved, and hostile attacks have been addressed.
The final decision must be auditable and reversible.`;

export function architectPrompt(question: string, context: string | undefined, history: DebateRound[], nextObjective?: string) {
  return `STRATEGIC QUESTION:\n${question}\n\nCONTEXT:\n${context ?? "None supplied."}\n\nPRIOR ROUNDS:\n${JSON.stringify(history, null, 2)}\n\nJUDGE NEXT-ROUND OBJECTIVE:\n${nextObjective ?? "None specified."}\n\nProduce the next best proposal. If prior decisions were wrong, explicitly revise them.`;
}

export function redTeamPrompt(question: string, context: string | undefined, round: DebateRound) {
  return `STRATEGIC QUESTION:\n${question}\n\nCONTEXT:\n${context ?? "None supplied."}\n\nARCHITECT PROPOSAL:\n${JSON.stringify(round.architect, null, 2)}\n\nTry to falsify it. Identify the most dangerous errors first. Prioritize critical attacks and state the evidence or experiment that would settle each dispute.`;
}

export function judgePrompt(question: string, context: string | undefined, round: DebateRound, threshold: number) {
  return `STRATEGIC QUESTION:\n${question}\n\nCONTEXT:\n${context ?? "None supplied."}\n\nARCHITECT:\n${JSON.stringify(round.architect, null, 2)}\n\nRED TEAM:\n${JSON.stringify(round.redTeam, null, 2)}\n\nCONVERGENCE THRESHOLD: ${threshold}\n\nScore both the architect proposal and the strongest red-team alternative independently on these dimensions (0-100 raw ratings; do not calculate the weighted total yourself):\n- buyerValue (15)\n- sellerValue (15)\n- coteDIvoireFit (15)\n- marketplaceLiquidity (15)\n- differentiation (10)\n- trustFraud (10)\n- technicalFeasibility (10)\n- acquisition (5)\n- monetization (5)\n\nThen identify accepted/rejected claims, critical disagreements, a decision, rationale, and the smallest next-round objective that could resolve remaining uncertainty. The orchestrator will calculate final scores and decide whether convergence is allowed.`;
}
