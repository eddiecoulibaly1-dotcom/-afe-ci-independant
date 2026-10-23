import "node:process";
import { createServer } from "node:http";
import { runDebate } from "./engine.js";
import { getDebate, listDebates, saveDebate } from "./store.js";
import { LAB_HTML, LAB_MANIFEST } from "./lab.js";
import type { DebateConfig, Provider } from "./types.js";

const VERSION = "0.6.3";
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

function send(res: import("node:http").ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(json(value));
}

const server = createServer(async (req, res) => {
  try {
    const pathname = req.url?.split("?")[0];
    if (req.method === "GET" && (pathname === "/" || pathname === "/lab" || pathname === "/lab/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(LAB_HTML);
      return;
    }
    if (req.method === "GET" && pathname === "/lab/manifest.webmanifest") {
      res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      res.end(LAB_MANIFEST);
      return;
    }
    if (req.method === "GET" && pathname === "/health") {
      send(res, 200, { ok: true, service: "afe-ci-debate-engine", version: VERSION, evidenceEngine: true, mobileLab: true, deployment: "ready" });
      return;
    }
    if (req.method === "GET" && pathname === "/debates") {
      send(res, 200, await listDebates());
      return;
    }
    if (req.method === "GET" && pathname?.startsWith("/debates/")) {
      const id = decodeURIComponent(pathname.slice("/debates/".length));
      const debate = await getDebate(id);
      if (!debate) { send(res, 404, { error: "Debate not found" }); return; }
      send(res, 200, debate);
      return;
    }
    if (req.method !== "POST" || (pathname !== "/debates/run" && pathname !== "/api/debates/run")) {
      send(res, 404, { error: "Not found" });
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { question?: string; context?: string };
    if (!input.question?.trim()) throw new Error("question is required");
    const result = await runDebate(input.question.trim(), input.context, config());
    await saveDebate(result);
    send(res, 200, result);
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : "Unknown error" });
  }
});

server.listen(port, () => console.log(`AFE-CI Debate Engine v${VERSION} listening on port ${port}`));
