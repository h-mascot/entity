# Entity Document Integrations — Build Context

Status: execution-ready planning context; implementation has not started.

Run marker: `loom-run:entity-doc-integrations-20260809`

Linear project: [Entity — Document Integrations Loom](https://linear.app/theheraldlab/project/entity-document-integrations-loom-9f9b8ee9f437/overview)

Planning branch: `loom/entity-document-integrations-20260813`

Inspected base: `origin/main` at `91d54e4cc92f6f7bf809c8c13c516c58ab6c481f`

## Authority order

1. Henry's explicit instruction and a later explicit decision.
2. `phase2-canonical-prd.md` — SHA-256 `c82e82d8379c420946735bf79265895cc3a00937d2d9f2ec95de60979e492470`.
3. The assigned Linear parent and T-001..T-040 child issue.
4. `SUPERSPEC-REFERENCE.md` and the controlling SuperSpec.
5. Current repository evidence, `AGENTS.md`, `CONTEXT.md`, and `.project-gate.json`.

The canonical PRD is a deterministic transformation of the audited Oracle-derived PRD. Five MUST-FIX and five SHOULD-FIX items were applied. The entire `31. Open Questions` block remains byte-identical: 20 entries, SHA-256 `b02fbdf0032e5db4631d0cd48c6695afe45e1e3f93b4a0ffff3c5c026734655c`.

## Binding architecture corrections

- The provider-neutral API defaults to `/api/document-integrations`; do not add sibling provider routes to the existing `/api/documents` editor router without the required ADR and composed editor-scope enforcement.
- Use `document_integration_events`; `document_events` is already claimed by `packages/server/src/routes/agent-api.ts` with an incompatible schema.
- Qualify the new module as `document-providers` (or another T-001-approved document-specific name). `packages/server/src/provider-registry/` is the inference-provider registry.
- Creation idempotency needs an operation-scoped store resolvable before an Entity document ID exists. The existing doc-scoped idempotency table is insufficient for creation.
- Attach activity proof to `packages/server/src/receipt-writer.ts`; a second receipt store is a release blocker.
- Use `packages/server/src/phase2-flags.ts` unless T-001 records stronger current evidence for another canonical flag host.

## Delivery boundary

The repository's main-tracking gateway path can deploy automatically. For T-038 through T-040, the usual “Always Land on Main” rule is suspended by the canonical PRD and Henry's explicit instruction for this planning run.

- Do not merge this branch.
- Do not run an implementation build as part of this Loom run.
- Do not deploy a sandbox or production environment as part of this Loom run.
- Future implementation uses `npm run ship:sandbox`, then `npm run verify:sandbox`, then the approval-refusing `npm run promote:prod` path.
- Before a future merge, T-040 must record Henry's explicit approval or evidence that the automatic gateway deployer was disabled or repointed away from main.

## Pending decisions

- `OQ-001`: default provider-selection policy.
- `OQ-013`: one-link, folder, designated-drive/library, or workspace-wide discovery scope.
- `OQ-009`: supported desktop OS matrix for the first local release.
- `OQ-011`, `OQ-012`, `OQ-020`: local/cloud/disconnect retention.
- `OQ-017`: approved non-production Google and Microsoft tenant resources.
- `OQ-003`: Henry/Product confirmation-policy default remains open but does not block the policy machinery.

Do not silently decide these in code. Follow the downstream gate named in the canonical PRD and Linear issue.

## Proof and review baseline

Run focused tests first. Before implementation PR completion, the reviewed SHA must pass:

```sh
cd packages/server && npm run build && npx vitest run
npm run build
npm run ctrl:gate
npm run scan:private-defaults -- --enforce
npm run test:release-deploy
bash scripts/proof/entity-phase-2-smoke.sh
```

OpenWiki is explicitly excluded from per-child proof for T-001 through T-037. At T-038, run `npm run docs:wiki:update` once after all tracked feature/evidence changes, commit the generated output, then run `npm run test:wiki-html` and `npm run docs:wiki:verify` on the exact candidate SHA before CI and sandbox shipping.

High-risk work also requires Codex autoreview and Thermo-nuclear review to APPROVED with zero blockers. Fix every blocker with a failing-test-first Prove-It regression test. UI work requires live browser/DOM/screenshot proof.

Each child issue has one exact evidence destination under `docs/plans/evidence/entity-document-integrations/T-XXX/`. A task is not done until the reviewed SHA, commands, results, and artifact links are written there and linked in Linear.
