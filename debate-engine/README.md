# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (Gemini) -> Evidence Engine -> Independent Judge -> deterministic score -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, evidence auditing, persistence, scoring and convergence instead of delegating the loop to an LLM.

## V0.9 Teams, roles and controlled sharing

V0.9 turns the personal application into a collaborative decision workspace without making every debate public.

Phone flow:

`Phone -> Supabase Auth -> Profile -> Workspace/Role -> Debate -> OpenAI/Gemini -> Evidence Engine -> Arbiter -> controlled Supabase memory`

V0.9 includes:

- debate-specific user profiles, isolated from unrelated application profile tables;
- workspaces owned by a user;
- roles: `owner`, `admin`, `editor`, `viewer`;
- workspace membership and access control;
- debate ownership plus optional workspace ownership;
- direct debate sharing with `viewer` or `editor` permission;
- workspace assignment when creating or editing a debate;
- mobile workspace management and member administration;
- server-side authorization before workspace/share mutations;
- RLS on the V0.9 collaboration tables;
- no service-role key exposed to the browser.

The V0.9 migration is `supabase/migrations/20261023_v09_workspaces_roles_sharing.sql`.

## V0.8 Accounts + private decision memory

V0.8 converts the mobile application shell into a personal application with Supabase Auth, private history and server-side bearer-token validation.

## V0.7 Mobile Application / PWA

V0.7 turns the mobile-first Lab into an installable application shell while keeping the decision engine server-side.

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
- `PATCH /me`
- `GET /workspaces`
- `POST /workspaces`
- `GET /workspaces/:id`
- `POST /workspaces/:id/members`
- `PATCH /workspaces/:id/members/:userId`
- `DELETE /workspaces/:id/members/:userId`
- `GET /debates`
- `GET /debates/:id`
- `POST /debates/run`
- `POST /api/debates/run`
- `POST /debates/:id/workspace`
- `GET /debates/:id/shares`
- `POST /debates/:id/shares`
- `DELETE /debates/:id/shares/:userId`

## Decision intelligence

V0.4 introduced a deterministic 100-point scorecard. V0.5 added evidence intelligence. V0.8 added identity and private ownership. V0.9 adds collaboration while preserving controlled access.
