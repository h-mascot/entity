# T-026 / THE-967 evidence

## Scope and base

- Exact base: `5af5943152a71f6436416d42eaba39c6a9ea4d22`
- Head before commit: `5af5943152a71f6436416d42eaba39c6a9ea4d22`
- Scope: local bridge security skeleton only; no route, UI, DB, Electron, engine, network, or production changes.
- T-025 seam consumed: `packages/server/src/document-providers/local/engine-spike.ts`; the bridge remains an independent document-scoped security boundary as required by `docs/adr/2026-08-local-office-engine.md`.

## Implementation

`packages/server/src/document-providers/local/bridge.ts` provides a pure security skeleton with:

- protocol-versioned authenticated handshake bound to an explicit origin and client nonce;
- short-lived sessions, constant-time token verification, request nonce anti-replay, and session revocation;
- explicit readiness states from R-019;
- document-reference-only authorization against a server-registered managed-path allowlist;
- operation allowlist (`open`, `inspect`, `save`);
- canonical path containment against configured roots, symlink rejection, and revalidation at authorization time;
- no raw long-lived secret returned by the handshake (only an expiring session token), no transport, filesystem browsing API, engine invocation, or external network client.

## Acceptance mapping

- R-018 handshake/auth/origin binding: focused tests cover valid handshake, bad proof, wrong origin, and wrong protocol.
- R-018 expiry/revocation/replay: focused tests cover expired sessions, revoked sessions, and reused request IDs.
- R-018 allowlist and operation controls: focused tests cover unknown/arbitrary path references and invalid operations.
- R-018 path protections: focused tests cover traversal/nonexistent paths and symlink registration rejection; authorization revalidates canonical paths.
- R-019 readiness: readiness is explicit and returned in the handshake; test covers `ready` and the implementation retains all required degraded/unavailable states.
- T-026 “arbitrary path access tests fail”: arbitrary caller-supplied `/etc/passwd` is rejected because requests contain only `documentRef`, not a path, and unknown references fail closed.

## Changed paths

- `packages/server/src/document-providers/local/bridge.ts` — implementation.
- `packages/server/src/document-providers/local/bridge.test.ts` — colocated focused security tests (bounded same-issue expansion required by server convention and acceptance).
- `docs/plans/evidence/entity-document-integrations/T-026/EVIDENCE.md` — this evidence record.

No additional implementation paths were added. No manual/browser proof was run: this task adds no route/UI/browser-visible behavior and the PRD explicitly calls for a dedicated bridge attack-test suite; automated server proof is the applicable evidence.

## Verification

- `cd packages/server && npx vitest run src/document-providers/local/bridge.test.ts` — PASS (1 file, 6 tests).
- `cd packages/server && npm run build` — PASS (TypeScript build).
- `git diff --check` — PASS.
- Full suite intentionally not run: user required focused Vitest and relevant build/typecheck only; this isolated local security skeleton has no existing route/DB/UI wiring.
- No Linear mutation, push, merge, deploy, or production change performed.

- Final commit SHA is supplied in the completion report; the final worktree is clean.
