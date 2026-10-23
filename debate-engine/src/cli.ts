import { runDebate } from "./engine.js";
import type { DebateConfig } from "./types.js";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error("Usage: npm run debate -- \"Your strategic question\"");
  process.exit(1);
}

const config: DebateConfig = {
  maxRounds: Number(process.env.MAX_ROUNDS ?? 6),
  convergenceScore: Number(process.env.CONVERGENCE_SCORE ?? 85),
  architect: { provider: "openai", model: process.env.OPENAI_MODEL ?? "gpt-5.5" },
  redTeam: { provider: "gemini", model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" },
  judge: { provider: process.env.JUDGE_PROVIDER === "gemini" ? "gemini" : "openai", model: process.env.JUDGE_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5" }
};

console.log(JSON.stringify(await runDebate(question, undefined, config), null, 2));
