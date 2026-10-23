# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (Gemini) -> Evidence Engine -> Independent Judge -> deterministic score -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, evidence auditing, persistence, scoring and convergence instead of delegating the loop to an LLM.

## V0.6.3 Mobile + Deployment

V0.6.3 keeps the mobile-first Lab self-contained inside the Node server so the production deployment does not depend on filesystem access to static Lab files.

The phone flow is:

`Phone browser -> Debate Lab -> Debate Engine -> OpenAI/Gemini -> Evidence Engine -> Arbiter -> Supabase`

The Lab is served at `/lab`. The production runtime uses Node.js 24 from `package.json` and Vercel's zero-configuration Node server detection.

V0.6.3 includes:

- mobile-first Debate Lab;
- embedded Lab HTML and manifest for reliable Vercel deployment;
- evidence-aware round display;
- debate history and replay;
- installable web-app manifest;
- `/health` reporting version, Evidence Engine and mobile Lab status;
- Node.js 24 production runtime;
- no API key exposed to the browser.

### Production deployment

Import the repository into Vercel and set the project root to `debate-engine`.

Set these server-side environment variables in Vercel:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional model/provider settings from `.env.example`

Secrets must remain server-side. After changing environment variables, redeploy.

Vercel provides the public HTTPS URL. That URL is the address to open from the phone; GitHub remains the source-code repository, while Supabase remains the persistent memory.

## V0.5 Evidence Intelligence

V0.5 adds an epistemic gate between debate generation and convergence.

Rules:

- `fact` requires evidence references;
- `hypothesis` is explicitly treated as a testable hypothesis;
- `opinion` does not require external evidence;
- a claim with no evidence reference is `unsupported`;
- unsupported high-impact claims block convergence;
- evidence references declared by a model are recorded as declared references, not silently treated as independently verified sources.

The deterministic Evidence Engine produces, per round:

- claim classification;
- support status;
- evidence references;
- confidence;
- impact;
- blocking state;
- next tests required to reduce uncertainty.

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

## V0.3 Lab

The Lab exposes:

- `GET /lab`
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
