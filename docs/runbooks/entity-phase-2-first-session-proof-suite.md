# Entity Phase 2 First-Session Proof Suite

Linear issue: `THE-93` / source `THE-20.3`

This runbook documents the local proof suite for the Phase 2 buyer first-session spine. The suite is deterministic and fixture-driven: it proves the expected release path without requiring live Helm, ClickClack, Google, or browser infrastructure to be available.

## What It Covers

Run from the repo root:

```bash
npm run proof:phase2:first-session -- --out output/entity-phase-2/first-session-spine/THE-93
```

The suite validates:

- Indexed context is connected/read through a local fixture.
- One Helm-backed agent binding is registered with explicit unknown/stale runtime status.
- A business-ops task has initiator, owner, assignee, executor, submitted-by, org, team, project, and done criteria.
- External document context and Entity-native artifact context are linked separately.
- Agent proof submission, receipt creation, review acceptance, and human gate approval are represented.
- Human gate approval resolves before the task reaches done.
- Task Master stalled-path proof includes nudge and owner escalation events without arbitrary takeover.
- Search proof includes receipt/activity results and a restricted external-document result with snippet suppression.
- Helm, ClickClack, and Google degraded states remain visible and do not block core proof/review flow.

## Artifacts

The command writes ignored local proof artifacts under the selected output directory:

- `THE-93.first-session-spine.json` - structured proof fixture and validation checks.
- `THE-93.canonical-receipt.md` - canonical receipt sample for the first-session task.
- `THE-93.dom-receipt.html` - DOM receipt with `data-*` attributes for issue, step, state, and validation status.
- `THE-93.summary.md` - human-readable summary for Linear proof comments and Book review.

These artifacts are proof outputs, not source of truth code. Keep them in ignored `output/` unless a reviewer explicitly asks for a sanitized sample to be checked in.

## Degraded-State Posture

THE-93 must not fake healthy integration status. The proof suite intentionally models:

- Helm as `unknown` through a stale Helm-managed runtime binding.
- ClickClack as unavailable while docs/proof/review/search remain available.
- Google as degraded/expired and read-only, with no mutation attempt and restricted snippet suppression.

This matches the Phase 2 rule that missing, unknown, and degraded states must be visible rather than coerced to healthy.

## Release Proof

Focused proof:

```bash
npm run proof:phase2:first-session -- --out output/entity-phase-2/first-session-spine/THE-93
```

Full local gate still requires the normal Phase 2 commands:

```bash
cd packages/server && npm run build && npx vitest run
npm run build
bash scripts/proof/entity-phase-2-smoke.sh
```

For packet gating, include the focused proof artifact paths in the CLI Tester / Book review evidence for `THE-93`.
