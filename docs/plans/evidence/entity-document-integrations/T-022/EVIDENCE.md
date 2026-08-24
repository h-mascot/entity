# T-022 (THE-963) — B2 targeted material fix

## Scope and exact revision

- Base / required starting HEAD: `87cfb7bd79a4d55380f3ab37db717240fb164dfd`.
- Branch: `runner/entity-document-integrations-20260818`.
- This is the single focused follow-up for blocker B2 only. No reset, clean, stash, cherry-pick, history rewrite, push, merge, deploy, Linear, route, registry, migration, provider, or external call was performed.
- Allowed paths changed only:
  - `packages/db/src/document-integrations.ts`
  - `packages/db/src/document-integrations.test.ts`
  - `docs/plans/evidence/entity-document-integrations/T-022/EVIDENCE.md`

## B2 disposition

Fixed. Adapter-owned durable rows with a request fingerprint are no longer mutable through generic upsert: same-fingerprint upsert rejects any attempted lifecycle/result mutation from `in_flight` (and permits only an exact no-op replay of terminal rows). Durable completion now requires the stored row to be `in_flight`, the supplied fingerprint to match exactly, and the next state to be terminal (`completed` or `uncertain`). Existing valid claim/completion flow and B1 behavior remain unchanged.

Direct DB prove-it coverage now includes:

- same-fingerprint generic overwrite attempting to change `in_flight` to `completed` and write result/document identity is rejected, with the stored row unchanged;
- completion with a wrong fingerprint is rejected, with the row unchanged;
- completion from a fingerprinted `requested` predecessor is rejected, with the row unchanged;
- valid `in_flight` completion succeeds, and a second result-bearing completion is rejected without overwriting the original result.

## Verification commands and exits

- `cd packages/db && /opt/homebrew/opt/node@22/bin/node ../../node_modules/vitest/vitest.mjs run src/document-integrations.test.ts` — exit 0; 1 file, 37 tests passed.
- `cd packages/server && npm run build` — exit 0.
- `git diff --check` — exit 0.

The full suite was intentionally not run per the request. No external/provider/network behavior was exercised.

## Pre-commit proof and audit

- Pre-commit `git write-tree`: `40107201be62c6a87c9737bface1c0c0c3fd420b`.
- Allowed-path audit: `git diff --name-only` contains only the three paths listed above; no other path is part of this follow-up.
- One conventional commit is required for delivery; final worktree status must be clean afterward.
