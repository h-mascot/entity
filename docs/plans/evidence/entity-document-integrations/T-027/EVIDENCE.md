# T-027 Evidence — Local managed storage / File Sources

## Scope and base

- Ticket: Linear THE-968 / LOOM-DOCS T-027
- Requirement: R-020 only
- Exact starting HEAD: `e308d5a54631cdbbc7f136cb26f380d30479c187`
- Working directory: `/Users/enterprise/Code/entity-document-integrations-runner-20260818`
- No routes, UI, registry, migrations, credentials, external calls, or production actions added.
- No same-issue path expansion was required. Existing `FileSourceRepository`, `LocalFileSourceAdapter`, and adapter `stat` contracts were sufficient.

## Implementation

- `packages/server/src/document-providers/local/managed-storage.ts`
  - Adds an opaque `file-source:v1.*` managed reference containing only a File Source ID and normalized source-relative path.
  - Registration and refresh resolve through the existing File Source repository and local adapter; no client absolute path is accepted or persisted.
  - Re-resolution on every refresh makes restart behavior deterministic.
  - Missing/moved/deleted files become sanitized explicit `unavailable` state with no host error/path leakage.
  - Source type and enabled state are checked before resolution.
- `packages/server/src/document-providers/local/managed-storage.test.ts`
  - Managed registration and opaque reference behavior.
  - Absolute client path rejection.
  - External move/delete unavailable behavior.
  - Fresh-instance restart/recovery behavior.

## Verification

Commands run from the repository:

```sh
cd packages/server && npx vitest run src/document-providers/local/managed-storage.test.ts src/fs/adapters/local.test.ts
```

Result: PASS — 2 test files, 8 tests.

```sh
cd packages/server && npm run build
```

Result: PASS — TypeScript build completed successfully.

```sh
git diff --check
```

Result: PASS — no whitespace errors.

## Delivery

- Focused commit: to be recorded after verification.
- Not pushed, merged, deployed, or applied to Linear.
