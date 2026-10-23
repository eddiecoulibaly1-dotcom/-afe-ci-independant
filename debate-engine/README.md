# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (Gemini) -> Evidence Engine -> Independent Judge -> deterministic score -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, evidence auditing, persistence, scoring and convergence instead of delegating the loop to an LLM.

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

The Arbiter receives this state, but the final evidence gate is enforced in code. A model cannot bypass it by returning `converged`.

## V0.4 Decision Intelligence

V0.4 introduced a deterministic 100-point decision scorecard. The Judge supplies raw 0-100 assessments for each dimension; the engine applies the weights and convergence policy in code.

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

## V0.5 Mobile Debate Lab

The V0.5 browser interface is served by the engine itself and is designed to work on a phone browser:

```text
http://localhost:8787/lab
```

It provides:

- strategic question + context input;
- launch of a complete adversarial debate;
- round-by-round Architect / Red Team / Evidence / Judge view;
- evidence blocking and next tests;
- final convergence or unresolved decision;
- history and debate replay.

The UI never receives the Supabase service-role key. Persistence stays server-side.

## Memory

If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, completed debates are persisted to Supabase in:

- `debates`
- `debate_rounds`
- `debate_events`
- `debate_hypotheses`
- `debate_evidence`
- `debate_decisions`

V0.5 records the evidence audit as a `debate_events` entry and stores declared evidence references in `debate_evidence`.

Without those variables, the engine falls back to the local JSON store under `data/`.

The service-role key is server-side only and must never be exposed to a browser/client or committed to GitHub.

## Install

```bash
npm install
cp .env.example .env
```

## Run

```bash
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
- `GET /health` exposes service health and V0.5 evidence status.

Example:

```json
{
  "question": "Quel est le meilleur wedge pour lancer la marketplace avicole AFE-CI ?",
  "context": "Contexte complémentaire"
}
```

## Database

The production Supabase project is `afe-ci-production`. The migration is committed under `supabase/migrations/` so the database model remains versioned with the engine.
