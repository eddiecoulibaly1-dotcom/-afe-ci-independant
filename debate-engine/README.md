# AFE-CI Debate Engine

Adversarial strategic decision engine for AFE-CI.

## Flow

`Question -> Architect (OpenAI) -> Red Team (OpenAI fallback-compatible) -> Evidence Engine -> Independent Judge -> deterministic score -> next round -> convergence/unresolved`

The orchestrator is deterministic: it controls rounds, evidence auditing, persistence, scoring and convergence instead of delegating the loop to an LLM.

## V1.0.8 Vercel API runtime + market ledger hardening

The API entrypoint exports a Vercel-compatible default HTTP handler and starts a local Node HTTP server only outside Vercel. Request JSON bodies are capped at 1 MB, malformed JSON is rejected with HTTP 400, oversized bodies with HTTP 413, and internal server errors are logged without exposing database/provider details to clients. Public endpoints include `GET /health`, `GET /auth/config`, and token-based share resolution; protected routes require a valid Supabase bearer token.

The market-price list supports `product`, `kind`, `country`, `region`, `city`, `currency` and `unit` filters. `currency` and `unit` are exact-match filters against the ledger.

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

## COO Operations Control Plane

The authenticated `/coo` page provides the operational command surface for the Direction des Opérations: central dashboard, institutional departments, mission portfolio, task assignment, performance indicators, deduplicated alerts and reporting to the workspace owner representing the Direction générale.

The implementation uses the existing workspace, agent, mission queue, Supabase persistence and notification system. Its schema is additive in `supabase/migrations/20261107190000_afe_ci_coo_operations_control_plane.sql` and `supabase/migrations/20261107200000_afe_ci_coo_foreign_key_indexes.sql`; the technical specification and validation gates are in `docs/AFE_CI_COO_OPERATIONS_CONTROL_PLANE.md`.

A Vercel Cron worker is configured hourly and checks each workspace's daily report hour (default 08:00 UTC). It requires `CRON_SECRET` or `COO_REPORT_WORKER_SECRET`. Vercel Cron is not active on Preview deployments. The migration, tests, Preview acceptance and any Production rollout remain separate approval gates; this increment does not apply the migration or deploy Production.

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

The market evidence layer includes validated JSON-feed and CSV parsers. The authenticated
`GET /market-prices` endpoint currently reads persisted, non-superseded observations from
the Supabase ledger. The configured-feed adapter (`MARKET_PRICE_FEED_URL` and optional
`MARKET_PRICE_FEED_TOKEN`) exists in `src/market-sources.ts`, but is not currently exposed
as an HTTP route or automatically merged into the ledger response.

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
string containing UTF-8 CSV. It validates every row, creates an import batch, persists
non-duplicate observations and returns inserted/duplicate counts. Optional chick fields
include `productCategory`, `strain`, `vaccinationStatus`, `minimumQuantity`,
`packSize`, `deliveryFee` and `availabilityDate`. Example body:

```json
{
  "csv": "id,product,normalizedProduct,kind,value,currency,unit,country,sourceName,sourceUrl,sourceClass,retrievedAt\\n...",
  "fileName": "market-prices.csv"
}
```

This endpoint writes to the append-only ledger using a server-side Supabase secret key.
The authenticated user's ID is attached to the batch and every observation. Do not expose
the Supabase secret/service-role key to browser code.


### Durable market price ledger

The ledger migrations are stored in `supabase/migrations/`:
- `20261102120000_market_price_ledger.sql`: import batches, immutable observations, correction history and initial read policies.
- `20261102150000_market_price_security_and_chicks.sql`: owner-scoped fingerprints, batch ownership, chick quotation fields and integrity constraints.
- `20261102160000_market_price_advisor_hardening.sql`: fixed function search paths and RLS/index hardening.
- `20261102170000_refresh_market_price_current_view.sql`: repair for databases where chick fields were added after the current-observations view was first created.

Do not replay migrations already recorded as applied. For an existing database that has applied the first three migrations, apply only the view-refresh migration after reviewing it.

Authenticated API routes (all require a valid Supabase bearer token, except the public share/auth/health routes documented elsewhere):
- `GET /market-prices/chick-catalog`: supplier directory and required chick quotation fields; no live prices are fabricated.
- `POST /market-prices/import`: validated UTF-8 CSV import into the durable ledger; returns inserted and duplicate counts.
- `GET /market-prices`: current (non-superseded) observations for the authenticated user, with optional product/kind/country/region/city filters.
- `GET /market-prices/:id/history`: original observation and its sequential correction history.
- `POST /market-prices/:id/corrections`: append a corrected version with a mandatory reason.

The ledger stores source name, URL, source class, original source observation ID, publication/observation/
retrieval dates, geography, unit, currency, import batch and a SHA-256 duplicate fingerprint.
Database triggers reject UPDATE and DELETE. Corrections are new rows linked by `supersedes_id`;
the previous value remains available in history. Duplicate imports are ignored per owner/fingerprint.

Server-side Supabase credentials are required. Browser clients receive no write policy; writes
are made by the authenticated API after validating the user's bearer token. The service key
must never be exposed to the browser. The current view returns only latest versions, while the
base table retains the complete audit trail.
