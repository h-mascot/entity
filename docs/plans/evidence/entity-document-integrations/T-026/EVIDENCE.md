# T-026 / THE-967 evidence

## Scope and base

- Exact reviewed candidate/base: `aeb4a167a2a3b0dc008b85d2e583249fb4dbf19c`
- Head before repair commit: `aeb4a167a2a3b0dc008b85d2e583249fb4dbf19c`
- Repair scope: only the targeted Luna-max CHANGES_REQUESTED R-018/R-019 blockers; no additional local-provider path was necessary.
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
- R-018/R-019 review blocker repair: expired sessions are evicted before session-cap admission; registered targets are revalidated as regular files at authorization time, including atomic same-path directory replacement; public handshake/authorize inputs are runtime-validated before property access and reject malformed values with sanitized `LocalBridgeSecurityError`s. Regressions cover all three blockers, including nonce reuse after failed revalidation.
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

- `git rev-parse HEAD` — PASS; exact base/head before repair: `aeb4a167a2a3b0dc008b85d2e583249fb4dbf19c`.
- `cd packages/server && npx vitest run src/document-providers/local/bridge.test.ts` — PASS (1 file, 12 tests).
- `cd packages/server && npm run build` — PASS (TypeScript build).
- `git diff --check` — PASS.
- Full server suite not run: explicitly unnecessary for this focused, colocated bridge repair; no unrelated test evidence is claimed.
- No browser proof: no route/UI/browser-visible behavior was added; browser verification is not applicable.
- No Linear mutation, push, merge, deploy, or production change performed.

- R-018/R-019 mapping: R-018 covers fail-closed malformed handshake/authorize payload handling and regular-file revalidation; R-019 covers expired-session eviction before the 128-session admission cap. Focused regressions prove each listed blocker.
- Changed paths: `packages/server/src/document-providers/local/bridge.ts`, `packages/server/src/document-providers/local/bridge.test.ts`, and this evidence file. No same-issue path expansion was necessary.
- No Linear mutation, push, merge, deploy, or production change performed.
- One clean commit is required; final commit SHA and clean-worktree proof are supplied in the completion report.
