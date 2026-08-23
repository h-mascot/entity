# T-028 Evidence — Local version watcher and safe save coordinator

## Scope expansion record

The canonical named paths did not exist in this worktree. The following indispensable colocated local-provider paths were added:

- `packages/server/src/document-providers/local/file-watcher.ts` — deterministic revision inspection and watcher dedupe required by R-021.
- `packages/server/src/document-providers/local/safe-save.ts` — failure-safe candidate/validate/recovery/atomic replacement coordinator required by R-021.
- `packages/server/src/document-providers/local/safe-save.test.ts` — required colocated watcher dedupe, stale-save, authority, recovery, and crash-injection proof.
- `docs/plans/evidence/entity-document-integrations/T-028/EVIDENCE.md` — required evidence receipt for this workstream.

No unrelated providers, routes, schemas, UI, production configuration, Linear, main, merge, push, or deployment were touched.

## Implementation proof

- Revision tokens combine filesystem identity, size, modification time, and SHA-256 content hash.
- Saves inspect the current revision and reject mismatches before candidate creation.
- Candidate output is separately written and passed to the caller's validator.
- Previous content is retained in a scoped recovery artifact before replacement.
- Replacement uses same-directory `rename`, providing atomic replacement on supported local filesystems.
- Final content is reopened/reinspected and its revision is returned.
- Unknown/degraded authority and invalid workspace/tenant scope fail closed.
- Save-stage crash injection is deterministic and does not emit secrets, document contents, or absolute paths in errors.

## Verification

Commands run from the assigned worktree:

```sh
cd packages/server && npx vitest run src/document-providers/local/safe-save.test.ts
# BLOCKED (exit 1): vitest/config could not resolve because this worktree has no installed dependencies; no installation or network fetch attempted.

cd packages/server && npm run build
# BLOCKED (exit 127): tsc not found because this worktree has no installed dependencies; no installation or network fetch attempted.

git diff --check
# PASS (exit 0)
```

The focused proof is committed only after the reproducible implementation review and whitespace gate; dependency-blocked commands are recorded exactly and are not represented as passing tests.
