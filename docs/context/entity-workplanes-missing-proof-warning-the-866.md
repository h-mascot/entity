# THE-866 / WP1-B-05 — Missing-proof warning panel

**Decision:** IMPLEMENTED
**Date:** 2026-07-31
**Worktree:** `/Users/enterprise/Code/entity-the-866-wp1-b-05`
**Depends on:** THE-864 / WP1-B-03 Done at `622c878`; THE-865 / WP1-B-04 Done at `034090a`

## Purpose

Render a dedicated Workplane missing-proof warning panel that explicitly shows when a task lacks required proof/evidence/output links. Derived from the existing ProofBundle load envelope — never invents Engineering data and never claims review-ready.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneMissingProof.ts` | Detect missing/degraded/unavailable proof from ProofBundle load state |
| `packages/app/src/lib/workplaneMissingProof.test.ts` | No-proof, proof-present, unknown/degraded, shell wiring |
| `packages/app/src/components/workplane/MissingProofWarningPanel.tsx` | Presentational warning panel |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Wires `missing_proof_warnings` panel |

## Behavior

| Status | When | UI |
| --- | --- | --- |
| `loading` | Proof fetch in flight | “Checking proof and evidence…” |
| `warning` | No usable proof / missing evidence | Alert banner + warning rows; `warningVisible=true` |
| `degraded` | Proof present but unknown/unavailable links | Degraded banner; still not review-ready |
| `clear` | Usable proof present, not missing | “No missing-proof warning”; `warningVisible=false` |
| `empty` | No task id / 404 / invalid payload | Explicit unavailable warning |
| `error` | Transport/server failure | Alert + Retry |

`reviewReady` is always `false` from this panel. Review-gate enforcement remains WP1-C-06.

## Non-goals honored

- No comments/review checklist (THE-? / WP1-C-05)
- No review-gate enforcement (WP1-C-06)
- No viewport smoke (WP1-B-07)
- No ActivityEvents (WP1-C)
- No Doc Hub rebuild / DB migration / production runtime changes
