# E12.7 Outcome Evaluation UX and Closure Gate — 2026-11-28

## Delivered
- Evaluating decision packs expose a JSON evaluation form for baseline, expected, actual, evidence IDs, lessons and follow-up.
- API rejects evaluation submissions without evidence IDs or at least one substantive lesson.
- Outcome metrics display baseline, expected, actual, variance and improvement-from-baseline.
- Decision closure is refused until an evidence-backed outcome evaluation and lessons are saved.
- The UI hides the close action until an evaluation exists.

## Safety
- No migration or remote DB write.
- No secrets/config changes.
- Preview only; Production untouched.
- Authenticated runtime remains blocked by SSO.

## Validation
- Strict typecheck and full test suite will be run in the isolated sandbox.
- GitHub CI and Preview deployment will be checked on the PR.
