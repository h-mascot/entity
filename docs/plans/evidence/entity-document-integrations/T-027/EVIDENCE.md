# T-027 Evidence — Local managed storage / File Sources

- Ticket: Linear THE-968 / LOOM-DOCS T-027
- Candidate/base requested: `af4c3caaa9a06653edba8183f5b3eee81af6b2a2`
- Final HEAD: `65a2f8c328467f6d4ae58b4bc9fd7677d95c0519`
- Exactly one focused commit: `fix(local): close managed storage security seam blockers`
- No routes, UI, credentials, external calls, deployment, production action, or Linear mutation.

## Changed paths

- `packages/server/src/document-providers/local/managed-storage.ts`
  - Rejects raw POSIX, Windows-drive, and UNC absolute paths before slash normalization.
  - Keeps opaque source-relative File Source references and re-resolves them through the existing local adapter.
  - Registers ready managed local references into the existing Entity `DocumentRegistry` as `local_office` canonical document objects, using the managed reference as `external_id`, current adapter metadata as revision, and caller workspace scope.
  - Keeps source disabled/type mismatch, missing/moved files, and adapter containment failures unavailable with sanitized output.
- `packages/server/src/document-providers/local/managed-storage.test.ts`
  - Focused register-path security and seam tests for absolute-path forms, normalized relative input, traversal/containment symlink threat, disabled/type-mismatched sources, move/delete, restart recovery, and canonical document registration.
- `docs/plans/evidence/entity-document-integrations/T-027/EVIDENCE.md`
  - This proof record.

## B1–B4 mapping

- **B1 PASS:** `register` calls the pre-normalization absolute-path guard. POSIX, drive, UNC, and host-absolute paths are rejected with the generic source-relative error; no raw path is included in the error or evidence. `nested/../brief.docx` remains safe and resolves to the managed file.
- **B2 PASS:** The existing File Source repository/local adapter seam now feeds the existing `DocumentRegistry.register` contract. No parallel store, namespace, route, root, migration, credential flow, external call, or client-path API was added. The canonical `external_id` is the opaque managed reference and workspace isolation is delegated to the existing registry.
- **B3 PASS:** T-027 registration/recovery is revision-aware at the existing seam: adapter `stat` metadata (`updatedAt:size`) is returned as the canonical document `current_revision`; every refresh re-resolves the source and file, so restart and move/delete behavior is explicit and fail-closed. The canonical PRD assigns the watcher/dedupe/crash-injection coordinator acceptance to T-028; no watcher implementation is claimed here.
- **B4 PASS:** Tests exercise traversal/normalized-relative handling, raw normalized-absolute rejection, disabled and type-mismatched source rejection, symlink containment escape, move/delete, and sanitized unavailable states. Failures fail closed and expose only typed status/reason codes.

## Verification

Commands run from repository root:

```sh
cd packages/server && npx vitest run src/document-providers/local/managed-storage.test.ts src/fs/adapters/local.test.ts
```

Result: **PASS** — 2 files, 8 tests.

```sh
cd packages/server && npm run build
```

Result: **PASS** — TypeScript build completed successfully.

```sh
git diff --check
```

Result: **PASS** — no whitespace errors.
