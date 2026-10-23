import "node:process";
import { createServer } from "node:http";
import { runDebate } from "./engine.js";
import { saveDebate } from "./store.js";
import type { DebateConfig, Provider } from "./types.js";

const port = Number(process.env.PORT ?? 8787);
const json = (value: unknown) => JSON.stringify(value, null, 2);

function config(): DebateConfig {
  const provider = (value: string | undefined, fallback: Provider): Provider => value === "gemini" ? "gemini" : value === "openai" ? "openai" : fallback;
  return {
    maxRounds: Number(process.env.MAX_ROUNDS ?? 6),
    convergenceScore: Number(process.env.CONVERGENCE_SCORE ?? 85),
    architect: { provider: provider(process.env.ARCHITECT_PROVIDER, "openai"), model: process.env.OPENAI_MODEL ?? "gpt-5.5" },
    redTeam: { provider: provider(process.env.RED_TEAM_PROVIDER, "gemini"), model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" },
    judge: { provider: provider(process.env.JUDGE_PROVIDER, "openai"), model: process.env.JUDGE_MODEL ?? "gpt-5.5" }
  };
}

const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200); res.end(json({ ok: true, service: "afe-ci-debate-engine" })); return;
  }
  if (req.method !== "POST" || req.url !== "/debates/run") {
    res.writeHead(404); res.end(json({ error: "Not found" })); return;
  }
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { question?: string; context?: string };
    if (!input.question?.trim()) throw new Error("question is required");
    const result = await runDebate(input.question.trim(), input.context, config());
    await saveDebate(result);
    res.writeHead(200); res.end(json(result));
  } catch (error) {
    res.writeHead(400); res.end(json({ error: error instanceof Error ? error.message : "Unknown error" }));
  }
});

server.listen(port, () => console.log(`AFE-CI Debate Engine listening on http://localhost:${port}`));
