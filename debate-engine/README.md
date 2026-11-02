# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (OpenAI fallback-compatible) -> Evidence Engine -> Independent Judge -> deterministic score -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, evidence auditing, persistence, scoring and convergence instead of delegating the loop to an LLM.

## V1.0.6 Realtime + production hardening

V1.0.6 completes the mobile collaboration foundation and aligns the application with the current Supabase secret-key model.

It adds:

- mobile realtime refresh signals through Supabase Realtime Postgres Changes;
- realtime subscriptions scoped to the authenticated user's notifications, audit records and share links;
- V1.0.6 PWA cache migration with `skipWaiting`, `clients.claim` and old-cache cleanup;
- server-side share-link listing, creation, expiration and revocation;
- presentation-safe public share viewer;
- provider-specific OpenAI/Gemini error diagnostics without exposing secrets;
- CSP connectivity for the Supabase HTTPS API and Realtime WebSocket endpoints;
- server support for `SUPABASE_SECRET_KEY` with legacy `SUPABASE_SERVICE_ROLE_KEY` fallback;
- deterministic scoring and convergence retained in the orchestrator;
- Node.js 24 and TypeScript strict typechecking;
- reproducible `package-lock.json` for production installs.

Realtime is intentionally used as a refresh signal, not as the source of truth: durable state remains in Postgres. Supabase Realtime requires the relevant tables to be in the `supabase_realtime` publication and the table RLS policies continue to govern Postgres Changes delivery.

The V1.0.6 database migration is `supabase/migrations/v1_0_6_realtime_collaboration.sql`.

## V1.0 Product foundation

V1.0 hardens the collaborative product layer around the decision engine.

It adds a production-ready Supabase foundation for:

- email invitations for workspace members using the server-side Supabase Auth Admin API;
- in-app notifications with read/unread state;
- an audit trail for profile, workspace, sharing and debate actions;
- secure share links using 256-bit random tokens stored only as SHA-256 hashes;
- optional share-link expiration and server-side revocation;
- `viewer` / `editor` share permissions;
- indexed notification and audit history for mobile use;
- RLS on secure share links;
- server-only use of the Supabase secret/service-role credential.

The V1.0 database migration is `supabase/migrations/v1_0_secure_sharing_notifications_audit.sql`.

### V1.0 security model

A share link never stores its raw token in Supabase. The application generates a high-entropy token, stores only its SHA-256 hash, and returns the raw token once to the authorized creator. Expired or revoked links are rejected server-side.

The notification and audit tables remain user-scoped. The audit layer records who performed an action, what entity was affected, when it happened, and structured details.

## V0.9 Teams, roles and controlled sharing

V0.9 turns the personal application into a collaborative decision workspace without making every debate public.

Phone flow:

`Phone -> Supabase Auth -> Profile -> Workspace/Role -> Debate -> OpenAI -> Evidence Engine -> Arbiter -> controlled Supabase memory`

V0.9 includes:

- debate-specific user profiles;
- workspaces owned by a user;
- roles: `owner`, `admin`, `editor`, `viewer`;
- workspace membership and access control;
- debate ownership plus optional workspace ownership;
- direct debate sharing with `viewer` or `editor` permission;
- workspace assignment when creating or editing a debate;
- mobile workspace management and member administration;
- server-side authorization before workspace/share mutations;
- RLS on collaboration tables;
- no service-role key exposed to the browser.

## V0.8 Accounts + private decision memory

V0.8 converts the mobile application shell into a personal application with Supabase Auth, private history and server-side bearer-token validation.

## V0.7 Mobile Application / PWA

V0.7 turns the mobile-first Lab into an installable application shell while keeping the decision engine server-side.

## Production environment

Required server-side variables:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (preferred current Supabase server credential)
- `SUPABASE_PUBLISHABLE_KEY`
- legacy `SUPABASE_SERVICE_ROLE_KEY` remains supported for compatibility
- optional model/provider settings from `.env.example`

`SUPABASE_PUBLISHABLE_KEY` is safe for browser authentication. Supabase secret/service-role and model API keys must never be sent to the browser.

## V1.0 backend API foundation

Authenticated capabilities are implemented in `src/v1-store.ts` for integration into the application server:

- notifications: list, mark one read, mark all read;
- audit log: retrieve the user's own audit trail;
- secure share links: create, revoke, resolve and expire;
- workspace invitation through Supabase Auth Admin;
- server-side notification and audit creation.

Public share resolution is deliberately limited to a high-entropy token; the raw token is never persisted.

## Decision intelligence

V0.4 introduced a deterministic 100-point scorecard. V0.5 added evidence intelligence. V0.8 added identity and private ownership. V0.9 added collaboration. V1.0 adds the product trust layer. V1.0.6 adds realtime synchronization, PWA migration and production hardening.

## Market intelligence — Côte d'Ivoire (V2.1)

The market evidence layer supports validated JSON feeds and CSV exports. The authenticated
`GET /market-prices` endpoint reads a server-side feed configured with
`MARKET_PRICE_FEED_URL` and optionally `MARKET_PRICE_FEED_TOKEN`, then applies the
city-first, same-country fallback and 30-day freshness policy.

Expected JSON response from the configured provider:

```json
{
  "source": "SIMAgri export",
  "observations": [{
    "id": "simagri-maize-001",
    "product": "maïs jaune",
    "normalizedProduct": "mais jaune",
    "kind": "raw_material",
    "value": 215,
    "currency": "XOF",
    "unit": "FCFA/kg",
    "country": "Côte d'Ivoire",
    "region": "Gbêkê",
    "city": "Bouaké",
    "sourceName": "SIMAgri",
    "sourceUrl": "https://simagri-ci.info/product-detail/mais-jaune",
    "sourceClass": "public_market_system",
    "publishedAt": "2026-10-28T00:00:00Z",
    "retrievedAt": "2026-10-29T00:00:00Z"
  }]
}
```

Example request (after authentication):

`GET /market-prices?product=ma%C3%AFs%20jaune&kind=raw_material&country=C%C3%B4te%20d'Ivoire&city=Bouak%C3%A9&currency=XOF&unit=FCFA%2Fkg`

The OCPV and SIMAgri public pages were identified as useful reference sources, but no
documented public JSON API was confirmed during implementation. Do not point the feed
variables at undocumented endpoints or scrape pages contrary to their terms. Use an
authorized API/export or an approved data relay. Until configured, the endpoint returns
a configuration error; it does not fabricate or substitute prices. Supplier quotations
for feed bags, chicks and guinea fowl require their own verified supplier feed or CSV
import and must not be inferred from grain-market prices.

### Partner access and CSV intake

The partner outreach pack for OCPV and SIMAgri is in `docs/market-partner-access.md`.
It contains verified public contact channels, the data-access questions, a ready-to-send
French email and the proposed normalized data contract. The CSV column template is
`templates/market-prices-template.csv`.

The authenticated `POST /market-prices/import` endpoint accepts JSON with a `csv`
string containing UTF-8 CSV. It validates every row and can optionally assess the
uploaded observations when `product`, `kind`, `country`, `currency` and `unit`
are supplied (with optional `city` and `region`). Example body:

```json
{
  "csv": "id,product,normalizedProduct,kind,value,currency,unit,country,sourceName,sourceUrl,sourceClass,retrievedAt\\n...",
  "product": "maïs jaune",
  "kind": "raw_material",
  "country": "Côte d'Ivoire",
  "city": "Abidjan",
  "currency": "XOF",
  "unit": "FCFA/kg"
}
```

This endpoint currently performs a validated import preview only: `persisted:false`.
It does not write rows to a database or retain uploaded data after the request. Durable
storage is deliberately deferred until its table, retention policy, source attribution,
and access controls are agreed. Do not treat a preview as a permanent price feed.


### Durable market price ledger (migration pending approval)

The append-only ledger migration is at `supabase/migrations/20261102120000_market_price_ledger.sql`.
It creates import batches, immutable price observations, duplicate fingerprints, correction links,
row-level read policies and a current-observations view. The migration has **not** been applied
to any Supabase project.

Once the migration is reviewed and explicitly approved, the API supports:
- `POST /market-prices/import`: authenticated CSV import; returns inserted and duplicate counts.
- `GET /market-prices`: current (non-superseded) observations, scoped to the authenticated user.
- `GET /market-prices/:id/history`: original observation and its sequential correction history.
- `POST /market-prices/:id/corrections`: append a corrected version with a mandatory reason.

The ledger stores source name, URL, source class, original source observation ID, publication/observation/
retrieval dates, geography, unit, currency, import batch and a SHA-256 duplicate fingerprint.
Database triggers reject UPDATE and DELETE. Corrections are new rows linked by `supersedes_id`;
the previous value remains available in history. Duplicate imports are ignored by unique fingerprint.

Server-side Supabase credentials are required. Browser clients receive no write policy; writes
are made by the authenticated API after validating the user's bearer token. The service key
must never be exposed to the browser. The current view returns only latest versions, while the
base table retains the complete audit trail.

**Operational gate:** apply the SQL migration manually only after reviewing it and approving the
target Supabase project. Until then the durable endpoints return HTTP 503 and no data is written.
