# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (Gemini) -> Independent Judge -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, persistence and convergence instead of delegating the loop to an LLM.

## V0.3 Debate Lab

The browser interface is served by the engine itself:

```text
http://localhost:8787/lab
```

It provides:

- strategic question + context input;
- launch of a complete adversarial debate;
- round-by-round Architect / Red Team / Judge view;
- scores, critical disagreements and next-round objective;
- final convergence or unresolved decision;
- history loaded from the persistent store;
- individual debate replay from `/debates/:id`.

The UI never receives the Supabase service-role key. Persistence stays server-side.

## V0.2 memory

If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, completed debates are persisted to Supabase in:

- `debates`
- `debate_rounds`
- `debate_events`
- `debate_hypotheses`
- `debate_evidence`
- `debate_decisions`

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
- `GET /health` exposes the service health/version.

Example:

```json
{
  "question": "Quel est le meilleur wedge pour lancer la marketplace avicole AFE-CI ?",
  "context": "Contexte complémentaire"
}
```

## Database

The production Supabase project is `afe-ci-production`. The migration is committed under `supabase/migrations/` so the database model remains versioned with the engine.
