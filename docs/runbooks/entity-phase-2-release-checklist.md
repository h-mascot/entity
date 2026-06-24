# Entity Phase 2 Release Checklist

Linear issue: `THE-95` / source `THE-20.5`

Use this checklist before a Phase 2 release candidate is marked ready. It binds the PRD release readiness tests to concrete proof commands, review artifacts, and operator signoff. It is intentionally conservative: no implementation claim is release-ready without attached proof.

## Source References

- Canonical PRD: `docs/specs/entity-phase-2-prd-canonical-20260620.md`
- Detailed rollout spec: `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md` (`E15.T5`, `E15.T6`)
- Linear issue map: `docs/specs/entity-phase-2-linear-issue-map-20260620.md`
- Current-state gap matrix: `docs/context/entity-phase-2-current-state-gap-matrix.md`
- Migration rollback runbook: `docs/runbooks/entity-phase-2-migration-backfill-runbook.md`
- Release rollback runbook: `docs/runbooks/entity-phase-2-rollback-runbook.md`
- Boundary release gate: `docs/runbooks/entity-phase-2-boundary-release-gate.md`

## Proof Commands

Run these for every Phase 2 release candidate:

```bash
cd /Users/enterprise/Code/entity
cd packages/server && npm run build && npx vitest run
npm run build
bash scripts/proof/entity-phase-2-smoke.sh
npm run proof:phase2:first-session -- --out output/entity-phase-2/first-session-spine/THE-93
npm run proof:phase2:boundary -- --out output/entity-phase-2/boundary-release-gate/THE-94
git diff --check
```

For packet review and test gate:

```bash
/Users/enterprise/Code/cli-tester/bin/project-test-gate \
  --root /Users/enterprise/Code/entity \
  --config /Users/enterprise/Code/entity/.project-gate.json \
  verify THE-95 THE-95-rollback-runbook-release-checklist
```

If Book review returns `REQUESTED`, `safeToContinue=false`, or a packet-only stop state, do not continue release. Apply `docs/runbooks/entity-phase-2-rollback-runbook.md` where needed and rerun proof after fixes.

## Release Readiness

### Schema, API, UI, Migration, Tests, Docs, Rollout

- [ ] Schema/data proof is attached for org/team/project/task/accountability, ActivityEvent, EvidenceArtifact, Review, HumanGate, ObjectRef, permissions, notifications, integration refs, and migration fields touched by the release.
- [ ] API/service proof is attached for task creation/transition/completion, receipt generation, review decisions, human gates, Task Master routing, search, permissions, notifications, connectors, and migration/backfill touched by the release.
- [ ] UI/UX proof is attached for any changed workspace, task detail, docs/files/artifacts, review/gate, routing, search, inbox, agent/runtime, connector, migration warning, or degraded-state surface.
- [ ] Migration proof is attached: dry-run reports, before/after samples, confidence/provenance, cleanup queues, idempotence, rollback notes, and non-fabrication evidence.
- [ ] Test proof is attached: focused tests for changed code plus the full server Vitest suite where server code changed.
- [ ] Docs proof is attached: runbooks, ADRs, connector posture, receipt protocol, RBAC/search, migration, rollback, and release checklist updates relevant to the release.
- [ ] Rollout proof is attached: feature flag state, diagnostics/observability output, boundary gate output, rollback procedure, Book review, and CLI Tester gate.

### PRD Release Readiness Tests

- [ ] No completed `entity-mc` task can reach clean `done` without canonical receipt metadata, immutable markdown body, content hash, origin task linkage, and receipt-created activity.
- [ ] No raw receipt can be overwritten; corrections, retries, supersessions, or disputes create new artifacts/events.
- [ ] No self-review path exists where separation of duties excludes the reviewer.
- [ ] No Google Docs/Drive mutation exists in the V1 default path; V1 remains read, index, link, and preview only.
- [ ] No Helm sensitive runtime material, deep object browser, model/provider config, schedule editing, tool grants, deployment settings, destructive runtime actions, or billing/runtime policy appear in Entity.
- [ ] No ClickClack outage blocks Entity-owned docs, files, artifacts, receipts, proof, review, search, or core task flows.
- [ ] No restricted content leaks through search, snippets, previews, activity, artifacts, external refs, notifications, or ClickClack-linked content.
- [ ] No migration backfill fabricates certainty; historical completed tasks without canonical receipts remain `missing_receipt` or acknowledged as non-raw evidence.
- [ ] No implementation claim is accepted without concrete proof artifacts.

### Product Boundary Review

- [ ] Entity is described as the work plane / workspace OS, not only Mission Control and not only a task board.
- [ ] Helm remains the runtime/admin plane; Entity exposes status, deep links, and policy-allowed light controls only.
- [ ] ClickClack remains the chat/collaboration primitive owner; Entity owns work-object context and core task/proof/review behavior.
- [ ] Google Docs/Drive V1 remains read-only by default.
- [ ] OpenClaw, Hermes, Codex, Claude Code, and other providers are runtime/provider-backed agents, not Entity itself.
- [ ] Paperclip appears only as an external competitor/reference and never as an Entity internal provider, module, product, layer, architecture concept, or dependency.
- [ ] Curacel appears only as design-customer/pilot context and never as hardcoded workflow, repo, demo, or product framing.

### Feature Flag And Observability Review

- [ ] `receipt_completion_enforcement` state is intentional and documented.
- [ ] `review_gate_policy_enforcement` state is intentional and documented.
- [ ] `worktype_registry_surface` state is intentional and documented.
- [ ] `migration_enforcement` remains observation-only unless release scope explicitly enables stricter behavior for newly touched records.
- [ ] `search_permission_strictness` fails closed when disabled or misconfigured.
- [ ] `taskmaster_automation` is enabled only when policy/routing proof is clean.
- [ ] `/api/phase2/diagnostics` or equivalent proof shows receipt, review/gate, search, integration, notification, and migration states without logging restricted content.

### Rollback Readiness

- [ ] `docs/runbooks/entity-phase-2-rollback-runbook.md` has been reviewed by the release operator.
- [ ] Feature flag rollback actions are known for each strict surface.
- [ ] Migration rollback points to the THE-90 migration runbook and preserves human corrections.
- [ ] Receipt failure recovery preserves raw receipt artifacts and audit trail.
- [ ] Task Master runaway-loop rollback disables automation without deleting routing history.
- [ ] Search permission leak rollback fails closed and avoids copying leaked content into proof.
- [ ] Connector degradation rollback preserves Entity core flows while showing honest degraded states.
- [ ] Notification failure rollback preserves canonical Entity notification records and marks external delivery failure/degradation.

### Proof Attachment Standards

- [ ] Linear proof comment lists branch, commit, changed files, and generated artifact paths.
- [ ] Linear proof comment includes command names and pass/fail results, not only a verbal summary.
- [ ] Book review receipt path is attached, with `decision=APPROVED` and `safeToContinue=true` before verify/continue.
- [ ] CLI Tester test-gate receipt path is attached, with `status=PASS`, `reviewGateStatus=PASS`, `nextChildBlocked=false`, and no blockers.
- [ ] Generated artifacts remain under ignored `output/`; committed docs reference paths but do not commit generated receipts.
- [ ] UI-facing changes have browser/DOM/screenshot proof. If no UI changed, state that browser proof was not required.

## Staging Sample

Completed sample checklist for a documentation-only THE-95 staging release:

- [x] Scope is docs-only: rollback runbook and release checklist.
- [x] No runtime behavior, schema, API, UI, migration writer, connector, Helm, ClickClack, Google, or notification code changed.
- [x] Release readiness items are mapped to PRD release tests and proof commands.
- [x] Boundary review includes Entity/Helm/ClickClack, Google V1, Paperclip external-only, and Curacel pilot-only checks.
- [x] Rollback readiness covers feature flags, migration rollback, receipt writer defect, Task Master runaway loop, search permission leak, connector degradation, notification failure, receipt artifacts, and audit trail.
- [x] Proof scripts are named: `proof:phase2:first-session`, `proof:phase2:boundary`, `entity-phase-2-smoke.sh`, server build/Vitest, root build, and CLI Tester verify.
- [x] Linear issue map is referenced so reviewers can trace `THE-95` to `THE-20.5`.
- [ ] Focused doc proof has passed for this branch.
- [ ] Full repo proof has passed for this branch.
- [ ] Book review has approved this branch.
- [ ] CLI Tester verify has passed for this branch.

## Operator Signoff

- Release operator:
- Date:
- Branch:
- Commit:
- Book review receipt:
- Test-gate receipt:
- First-session proof output:
- Boundary proof output:
- Rollback rehearsal notes:
- Residual risks:
