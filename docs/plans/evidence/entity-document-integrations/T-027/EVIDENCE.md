# T-027 Evidence — Local managed storage / File Sources

- Ticket: Linear THE-968 / LOOM-DOCS T-027
- Exact base HEAD: `43633e5a14ac7915a77f40423300f16c020023fe`
- Focused implementation commit before evidence amendment: `005f45fdf82d67230dfb0543589fc5d798573d77`
- Final HEAD is the amended version of that same single focused commit (reported by the final `git rev-parse HEAD` closeout command).
- Exactly one focused commit; no reset/revert, push, merge, production, deployment, external calls, routes, migrations, watcher/T-028 behavior, or Linear mutation.

## Changed paths and reasons

- `packages/server/src/document-providers/local/managed-storage.ts`
  - Persists a previously registered unavailable managed reference as `readiness_state: degraded` through the existing `DocumentRegistry`, preserving its canonical identity and prior metadata/history.
  - Rejects local File Sources whose persisted health is not `ok` before adapter resolution, failing closed with sanitized unavailable state.
  - Enforces the existing `assertAllowedLocalSourceBasePath` allowlist before any adapter filesystem access.
- `packages/server/src/document-providers/local/managed-storage.test.ts`
  - Colocated focused proof for raw absolute-reference rejection, degraded/error source health, pre-adapter allowlist rejection, truthful degraded registry state after delete, and real-registry workspace isolation.

No other paths were changed; the existing File Source repository, local adapter, allowlist helper, and DocumentRegistry were composed without new persistence, roots, routes, or namespaces.

## B1–B4 mapping

- **B1 PASS:** after a previously registered managed file is deleted, `register` returns `unavailable` and updates the existing canonical record to `readiness_state: degraded` with `degraded_reason_code: file_unavailable`; the canonical id remains stable and prior revision metadata is preserved. No new record is minted.
- **B2 PASS:** `sourceFor` requires `type: local`, `enabled: true`, and `health: ok`; `degraded` and `error` sources resolve to sanitized `source_unavailable` and cannot register/retain a ready canonical state.
- **B3 PASS:** `assertAllowedLocalSourceBasePath(source.base_path)` runs before `createFileSourceAdapter` and `stat`; an unallowlisted source is sanitized to `file_unavailable` without adapter filesystem access.
- **B4 PASS:** the real in-memory SQLite `DocumentRegistry` proves the same managed identity cannot register into another workspace, while the unavailable update is scoped to the original workspace and does not mutate or expose a cross-workspace record.

## Verification

All commands were run from the repository root under Node 22.22.2 (required for the installed better-sqlite3 native binding):

```sh
source /Users/enterprise/.nvm/nvm.sh && nvm use 22 >/dev/null && cd packages/server && npx vitest run src/document-providers/local/managed-storage.test.ts
# exit 0 — 1 file, 5 tests passed

source /Users/enterprise/.nvm/nvm.sh && nvm use 22 >/dev/null && cd packages/server && npm run build
# exit 0 — TypeScript build completed

git diff --check
# exit 0 — no whitespace errors

git status --short
# exit 0 — clean after the evidence amendment
```

The implementation was committed once as `fix(local): close managed storage security seam blockers`; the evidence update is an amendment of that same commit, not a second focused commit.
