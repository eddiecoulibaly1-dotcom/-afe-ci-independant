# AFE-CI Debate Engine — Compliance Register

Version: 1.0  
Baseline: `feature/BR-DEC-001-decision-progression`  
Implementation branch: `build/afe-ci-compliance-v1`  
Production policy: no merge or production promotion without explicit approval.

## Status vocabulary
- VERIFIED: automated or end-to-end test demonstrates the behavior.
- PARTIAL: implementation exists, but coverage or runtime proof is incomplete.
- NOT VERIFIED: source inspection is insufficient to assert behavior.
- MISSING: implementation is absent after repository inspection.
- BLOCKED: external dependency or configuration prevents validation.

A green build is not proof of production readiness. Provider-backed E2E, browser/mobile acceptance, Supabase migration/RLS validation and operational recovery tests must be reported separately.

## Workstreams and acceptance criteria

| ID | Workstream | Mandatory acceptance criteria |
|---|---|---|
| ARC | Orchestration | Ordered agent steps; durable state; idempotent claims; retry/lease recovery; event history; user-scoped access; deterministic terminal state. |
| AGT | Agent intelligence | Distinct Architect, Red Team and Arbiter; role-specific prompts; prior-round context; claim-level attacks; justified position revisions; no self-approval. |
| NOV | Progression / anti-repeat | Normalize and compare claims and attacks across rounds; identify paraphrase duplicates; require new evidence, refutation, analysis, consequence or reasoned revision; duplicate-only rounds cannot converge. |
| EVD | Evidence engine | Each factual claim has source provenance, opened content, supporting excerpt, retrieval/publication dates, source classification and explicit status; unsupported critical claims block decisions. |
| GPH | Evidence graph | Claim-to-source, claim-to-attack, rebuttal and decision links; traceable dependency and contradiction history. |
| FAL | Falsification | Falsifiable hypotheses, refutation conditions, counterexamples, hidden assumptions, sensitivity and reversal tests. |
| SIM | Scenario engine | Optimistic/base/pessimistic and rupture scenarios; causal links; sensitivity; early indicators; explicit data provenance. |
| DEC | Arbitration | Independent judge; unresolved critical objections block convergence; evidence and uncertainty are considered; scorecards never select winner; conditional/suspended outcomes supported. |
| FIN | Financial analysis | Domain-specific inputs; explicit units and currency; deterministic calculations; break-even, margin, cash-flow, ROI/payback where inputs support them; no invented missing values. |
| MEM | Strategic memory | Persist debates, rounds, claims, evidence, objections, revisions, decisions and versions; retrieve and compare; expire stale evidence. |
| OUT | Outcome learning | Track forecast versus actual outcome; evaluate hypotheses and forecast errors; version learning changes; no silent production self-modification. |
| GOV | Human governance | User challenges, source uploads, re-open/re-run, approval gates for sensitive actions, immutable audit of human overrides. |
| REP | Reporting | Executive, strategic, evidence, contradiction, finance, risk, scenario, arbitration, audit, action and follow-up reports generated from persisted data. |
| SEC | Security | Authenticated ownership checks; workspace isolation; RLS tests; UUID validation; server secrets only; secure sharing and audit logs. |
| UX | User experience | Mobile responsive; truthful progress; report generation, audio play/pause/resume/stop, section navigation, exports, history and recoverable errors. |
| CAL | Calibration | Factuality, citation, contradiction coverage, repetition, decision consistency, confidence calibration and regression metrics. |
| TST | Testing | Unit, integration, provider-backed E2E, DB/RLS, failure/recovery, mobile/browser, load, security and regression suites. |
| OPS | Delivery | Protected baseline, isolated branches, preview deployments, reproducible builds, release notes, rollback and explicit production approval. |

## Implemented in this workstream

- `debate-engine/src/compliance-engine.ts`: deterministic primitives for evidence status, source corroboration, novelty, convergence blockers and report completeness.
- `debate-engine/src/engine.ts`: initial integration that prevents a round with only repeated Architect claims from being treated as a valid progressing decision.
- `debate-engine/test/compliance-engine.test.ts`: regression tests for the new primitives.

## Known limitations / remaining validation

1. The novelty gate currently covers Architect claims; it must be extended to Red Team attacks, Arbiter reasoning and the full contribution graph.
2. The new evidence audit primitive is not yet wired to every persisted claim/source record and must be connected to the research bundle and evidence registry.
3. The convergence helper is a reusable policy primitive; the complete debate lifecycle must call it with persisted round-level novelty and all unresolved critical objections.
4. The report completeness audit must be integrated into report generation and rendered with its warnings in the UI.
5. The repository requires a complete migration/RLS audit; successful TypeScript and unit tests do not establish Supabase schema readiness.
6. Real OpenAI/Gemini/Tavily provider-backed tests and mobile/browser end-to-end tests remain necessary.
7. The full 18-workstream register is a target specification, not a claim that every item is already implemented.

## Release gate

A release is conformant only when every mandatory requirement is mapped to code, persisted data where applicable, automated tests and a passing runtime acceptance test. No critical security, evidence-integrity or arbitration failure may be offset by a high average score.
