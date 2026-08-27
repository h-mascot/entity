# Geordi QA harness (GQR-006)

Committed, deterministic harness pieces for the Geordi QA runs against the
Entity sandbox. These modules correct the run-1 (2026-08-26) harness defects
recorded in `docs/plans/ACTIVE_PLAN.md` GQR-006 and are what the post-merge
focused reruns and the full 62-row rerun use.

## Modules

| Module | Purpose |
|---|---|
| `fixtures.mjs` + `fixtures/` | Six deterministic browser fixtures: admin navigation (incl. Users & Access), task/Handoffs, provider preview, refresh persistence, mobile viewport, external document metadata. Secret-free, base64-free, closed id set. |
| `progress-state.mjs` | Live `state.json` store: atomic tmp+rename writes, `lastProgressTime` stamped on every transition, idempotent lane completion, monotonic percent, final terminal states (`complete`/`stopped`/`wrong-build`/`aborted`, plus `WRONG BUILD` verdict). |
| `watchdog.mjs` | Script-only observer of the progress state. Emits `observing`/`stalled`/`absent` events, never kills the worker, and self-pauses with a structured receipt as soon as the state is terminal. |
| `source-cleanliness.mjs` | Verifies the target checkout is clean *from the source cwd*: every git invocation runs with `cwd` = realpath of the checkout; refuses paths that are not their own worktree root. |
| `compact-index.mjs` | Semantic payload checks for `compact-evidence-index.json`: structural field equality between metadata and index entries (never substring matching), lane allowlist, base64-free enforcement, prefix-trap diagnosis. |
| `supersede-report.mjs` | Builds the superseding report correcting the historical I2 contract FAIL to `INVALID_PREREQUISITE` (invalid prerequisite/setup, not a product pass), guarded by the recorded broker-absence evidence — the quote must be proven (exact or whitespace-normalized) inside the loaded content of the evidence file the corrected row cites; never mutates the historical report. Committed artifact: `docs/reports/geordi-qa/20260826T103159Z-rerun1/`. |

## Usage

```bash
npm run test:geordi-qa                 # full harness suite (node --test)
node supersede-report.mjs --report <historical-report.json> --out <dir>
```

The QA worker consumes the fixtures from `fixtures/` when grading lanes B, C,
E/F, and the metadata surface, writes progress through `progress-state.mjs`,
and is observed by `watchdog.mjs`.

## Boundaries

- Sandbox target only (`http://sandbox.entity`); never production.
- No credentials, secrets, OAuth approval, or external provider writes.
- Historical QA reports and receipts under the run output trees are
  preserved verbatim; corrections happen only in superseding reports.
- QA grading vocabulary is fixed; `INVALID_PREREQUISITE` is a setup-invalid
  classification, never a product pass.
