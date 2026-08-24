# Entity Document Integrations — Scoped Agent Rules

These rules apply to this directory and the T-001..T-040 implementation it governs. Root `AGENTS.md` still applies except where the canonical PRD's Gate 8 and Henry's explicit review-before-merge instruction impose a stricter delivery boundary.

## Read before editing

- `BUILD-CONTEXT.md`
- `phase2-canonical-prd.md`
- the assigned Linear parent and child issue
- `ISSUE-MAP.md`
- root `AGENTS.md`, `CONTEXT.md`, and `.project-gate.json`

## Source and scope

- Treat canonical PRD SHA-256 `83cacbc51a1eb15649d6e0a17759e2115a3c2185a93b7c4532001beee2527137` as the implementation authority.
- Preserve all 20 open questions. Do not convert an unresolved question into a default without the named owner decision and receipt.
- Work only from a clean worktree based on the intended `origin/main`; never absorb an operator's existing dirty checkout.
- Keep changes within the assigned ticket's exact paths unless the proof comment explains a necessary, reviewed expansion.

## Architecture guardrails

- Default provider-neutral API namespace: `/api/document-integrations`.
- Event table: `document_integration_events`, never the already-claimed `document_events`.
- Document-provider module naming must not collide with `packages/server/src/provider-registry/`.
- Unknown or degraded mutation/embedding capability fails closed.
- Provider writes require connection, destination, policy, scope, readiness, revision, and idempotency checks.
- Never introduce a second receipt store; integrate with `packages/server/src/receipt-writer.ts`.

## Proof

- Add or update focused tests with each logic change.
- Include a negative/degraded/security path, not only the happy path.
- Record proof under `docs/plans/evidence/entity-document-integrations/T-XXX/` and link it in Linear.
- Run the binding commands in `BUILD-CONTEXT.md`, plus live UI proof when relevant.
- High-risk changes require Codex and Thermo-nuclear reviews to closure.

## Delivery

- Do not merge to main until T-040 records Henry's approval or the automatic main-tracking deployer mitigation.
- Do not deploy from an implementation ticket unless that exact release ticket authorizes the stage and the approval gate is satisfied.
- Never represent a green branch or sandbox as production completion.
