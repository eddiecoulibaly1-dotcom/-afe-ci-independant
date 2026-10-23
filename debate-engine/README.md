# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (Gemini) -> Evidence Engine -> Independent Judge -> deterministic score -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, evidence auditing, persistence, scoring and convergence instead of delegating the loop to an LLM.

## V0.6 Mobile + Deployment Ready

V0.6 turns the Lab into a mobile-first web cockpit and prepares the engine for public deployment.

The phone flow is:

`Phone browser -> Debate Lab -> Debate Engine -> OpenAI/Gemini -> Evidence Engine -> Arbiter -> Supabase`

The Lab is served at `/lab` and the production runtime is configured for Node.js 24 through `vercel.json`. Vercel can deploy the Node server directly and keeps API/database secrets server-side. citeturn0search1turn0search0

V0.6 includes:

- mobile-first Debate Lab;
- evidence-aware round display;
- debate history and replay;
- installable web-app manifest;
- `/health` reporting version, Evidence Engine and mobile Lab status;
- Node.js 24 production runtime configuration;
- no API key exposed to the browser.

### Production deployment

Import the repository into Vercel and set the project root to `debate-engine`. Vercel supports importing a Git repository and automatically deploying from the connected branch. citeturn0search7

Set these server-side environment variables in Vercel:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional model/provider settings from `.env.example`

Secrets should be configured as server-side Secret environment variables, never in client-exposed variables. After changing environment variables, redeploy. citeturn0search0turn0search2

Vercel will provide the public HTTPS URL. That URL is the address to open from the phone; GitHub remains the source-code repository, while Supabase remains the persistent memory.

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
| Trust / fraud | 10 |
| Technical feasibility | 10 |
| Acquisition | 5 |
| Monetization | 5 |
| **Total** | **100** |

## Memory

If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, completed debates are persisted to Supabase in:

- `debates`
- `debate_rounds`
- `debate_events`
- `debate_hypotheses`
- `debate_evidence`
- `debate_decisions`

Without those variables, the engine falls back to the local JSON store under `data/`.

The service-role key is server-side only and must never be exposed to a browser/client or committed to GitHub.

## Install / run

```bash
npm install
cp .env.example .env
npm run typecheck
npm run dev
```

Then open:

```text
http://localhost:8787/lab
```

API:

- `POST /debates/run` starts a debate.
- `GET /debates` returns stored debates.
- `GET /debates/:id` returns one complete debate.
- `GET /health` exposes deployment health.

## Database

The production Supabase project is `afe-ci-production`. The migration is committed under `supabase/migrations/` so the database model remains versioned with the engine.
