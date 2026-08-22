# T-026 / THE-967 evidence

## Scope and base

- Exact reviewed candidate/base: `60a3ec73991ac1a52870df1de3c829ee08db65b2`
- Head before repair commit: `60a3ec73991ac1a52870df1de3c829ee08db65b2`
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

- R-018 handshake/auth/origin binding: focused tests cover valid handshake, bad proof, wrong origin, wrong protocol, wrong token, bounded oversized handshake/request fields, and sanitized audit events.
- R-018/R-019 review blocker repair: readiness must be `ready` for handshake and authorization; registered paths are revalidated before nonce consumption, including symlink replacement, with a regression proving the nonce remains reusable after failed revalidation; document/session revocation and bridge-wide shutdown are tested.
- R-019 retained state: sessions are capped at 128 and replay nonces at 256 per session; shutdown clears and permanently revokes all sessions.
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

- `cd packages/server && npx vitest run src/document-providers/local/bridge.test.ts` — PASS (1 file, 9 tests).
- `cd packages/server && npm run build` — PASS (TypeScript build).
- `cd packages/server && npx vitest run` — FAIL/ENVIRONMENT: 88 failed, 135 passed, 96 skipped; existing native `better-sqlite3` binary is Node module version 127 while this Node requires 147, plus dependent scoped-search 500s. Focused bridge tests passed.
- `git diff --check` — PASS.
- No browser proof: no route/UI/browser-visible behavior was added; browser verification is not applicable.
- No Linear mutation, push, merge, deploy, or production change performed.

- Review-blocker resolution: R-018/R-019 CHANGES_REQUESTED items were repaired only in the bridge skeleton/tests: bounded pre-auth fields, sanitized audit boundary, ready-only authorization, fail-closed path revalidation with preserved failed-revalidation nonce behavior, bounded retained state/shutdown revocation, wrong-token and document-revocation regressions.
- Changed paths: `packages/server/src/document-providers/local/bridge.ts`, `packages/server/src/document-providers/local/bridge.test.ts`, and this evidence file. No same-issue path expansion was necessary.
- No Linear mutation, push, merge, deploy, or production change performed.
- Final commit SHA is supplied in the completion report; the final worktree is clean.
