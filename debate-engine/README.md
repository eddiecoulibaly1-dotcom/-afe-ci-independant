# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (Gemini) -> Evidence Engine -> Independent Judge -> deterministic score -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, evidence auditing, persistence, scoring and convergence instead of delegating the loop to an LLM.

## V0.8 Accounts + private decision memory

V0.8 converts the mobile application shell into a personal application.

Phone flow:

`Phone -> Supabase Auth -> AFE-CI Debate Engine -> OpenAI/Gemini -> Evidence Engine -> Arbiter -> private Supabase history`

V0.8 includes:

- email/password account creation and sign-in;
- Supabase Auth session stored on the phone;
- automatic access-token refresh;
- authenticated debate creation;
- debate history scoped to the signed-in user;
- server-side bearer-token validation;
- `debates.user_id` ownership and index;
- RLS policies for authenticated ownership;
- public Supabase publishable key only in the browser;
- `SUPABASE_SERVICE_ROLE_KEY` remains server-side only;
- mobile account screen and sign-out;
- V0.8 mobile/PWA lab.

The V0.8 migration is `supabase/migrations/20261023_v08_debate_user_ownership.sql`.

## V0.7 Mobile Application / PWA

V0.7 turns the mobile-first Lab into an installable application shell while keeping the decision engine server-side.

V0.7 includes mobile navigation, PWA manifest/icon, service worker, local draft persistence and native share/copy support.

## Production environment

Required server-side variables:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLISHABLE_KEY`
- optional model/provider settings from `.env.example`

`SUPABASE_PUBLISHABLE_KEY` is safe for browser authentication. Service-role and model API keys must never be sent to the browser.

## API

Public:

- `GET /lab`
- `GET /lab/manifest.webmanifest`
- `GET /lab/sw.js`
- `GET /lab/icon.svg`
- `GET /health`
- `GET /auth/config`

Authenticated:

- `GET /me`
- `GET /debates`
- `GET /debates/:id`
- `POST /debates/run`
- `POST /api/debates/run`

## Decision intelligence

V0.4 introduced a deterministic 100-point scorecard. V0.5 added evidence intelligence. V0.8 adds identity and private ownership around that decision memory.
