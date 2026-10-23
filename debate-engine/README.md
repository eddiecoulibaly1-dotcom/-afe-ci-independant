# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (Gemini) -> Evidence Engine -> Independent Judge -> deterministic score -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, evidence auditing, persistence, scoring and convergence instead of delegating the loop to an LLM.

## V0.7 Mobile Application / PWA

V0.7 turns the mobile-first Lab into an installable application shell while keeping the decision engine server-side.

Phone flow:

`Phone -> AFE-CI Debate Engine App -> Debate Engine -> OpenAI/Gemini -> Evidence Engine -> Arbiter -> Supabase`

V0.7 includes:

- application-style mobile navigation: Accueil, Historique, Nouveau, Aide;
- install prompt when the browser supports PWA installation;
- Android home-screen friendly manifest and application icon;
- service worker and cached application shell for degraded-network access;
- local draft persistence for a question and its context;
- decision copy/share actions using native phone capabilities when available;
- debate history and replay;
- Evidence Engine and Arbiter views from V0.6;
- `/health` reporting `pwa: true`;
- Node.js 24 production runtime;
- no API key exposed to the browser.

The PWA is an application layer, not a replacement for the debate orchestrator. Actual debates still require the server and configured provider APIs.

## V0.6 Deployment

The Lab is self-contained inside the Node server so the production deployment does not depend on filesystem access to static Lab files.

The production runtime uses Node.js 24 and Vercel's zero-configuration Node server detection.

Set these server-side environment variables in Vercel:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional model/provider settings from `.env.example`

Secrets must remain server-side. After changing environment variables, redeploy.

## V0.5 Evidence Intelligence

V0.5 adds an epistemic gate between debate generation and convergence.

Rules:

- `fact` requires evidence references;
- `hypothesis` is explicitly treated as a testable hypothesis;
- `opinion` does not require external evidence;
- a claim with no evidence reference is `unsupported`;
- unsupported high-impact claims block convergence;
- evidence references declared by a model are recorded as declared references, not silently treated as independently verified sources.

## V0.4 Decision Intelligence

V0.4 introduced a deterministic 100-point decision scorecard.

| Dimension | Weight |
|---|---:|
| Buyer value | 15 |
| Seller value | 15 |
| Côte d'Ivoire fit | 15 |
| Marketplace liquidity | 15 |
| Differentiation | 10 |
| Trust/fraud | 10 |
| Technical feasibility | 10 |
| Acquisition | 5 |
| Monetization | 5 |

The LLMs provide raw dimension evaluations; the code computes the weighted score.

## API

The Lab exposes:

- `GET /lab`
- `GET /lab/manifest.webmanifest`
- `GET /lab/sw.js`
- `GET /lab/icon.svg`
- `GET /health`
- `GET /debates`
- `GET /debates/:id`
- `POST /debates/run`
- `POST /api/debates/run`

## V0.2 Supabase memory

The server can persist completed debates to Supabase in:

- `debates`
- `debate_rounds`
- `debate_events`
- `debate_hypotheses`
- `debate_evidence`
- `debate_decisions`

RLS is enabled and server-side persistence uses `SUPABASE_SERVICE_ROLE_KEY` only.
