# Entity Document Integrations — Loom Issue Map

Canonical PRD SHA-256: `83cacbc51a1eb15649d6e0a17759e2115a3c2185a93b7c4532001beee2527137`

Linear project: https://linear.app/theheraldlab/project/entity-document-integrations-loom-9f9b8ee9f437/overview

Idempotency marker: `loom-run:entity-doc-integrations-20260809`

This map is the durable pre-creation graph. The final receipt replaces template identifiers with live Linear identifiers and records parent/dependency readback.

## P-01 — Foundation, architecture, and core platform

- **T-001** — Create clean implementation worktree and audit base
  - Blocked by: None
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-001/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `docs/loom/entity-document-integrations/BUILD-CONTEXT.md`, `packages/server/src/phase2-flags.ts`, `packages/server/src/receipt-writer.ts`, `packages/server/src/editor/index.ts`, `.project-gate.json`
- **T-002** — Write capability architecture ADR
  - Blocked by: T-001
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-002/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `docs/adr/2026-08-entity-document-capability-architecture.md`, `packages/server/src/document-providers/types.ts`, `packages/server/src/document-providers/capability-resolver.test.ts`
- **T-003** — Define and migrate unified document persistence
  - Blocked by: T-001, T-002
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-003/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/db/src/document-integrations.ts`, `packages/db/src/document-integrations.test.ts`, `packages/server/src/document-providers/migrations.ts`
- **T-004** — Implement Document Registry
  - Blocked by: T-003
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-004/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/registry.ts`, `packages/server/src/document-providers/registry.test.ts`, `packages/db/src/document-integrations.ts`
- **T-005** — Implement provider adapter contract and fake adapter
  - Blocked by: T-002, T-004
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-005/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/types.ts`, `packages/server/src/document-providers/fake-adapter.ts`, `packages/server/src/document-providers/contract.test.ts`
- **T-006** — Implement Capability Resolver
  - Blocked by: T-002, T-005
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-006/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/capability-resolver.ts`, `packages/server/src/document-providers/capability-resolver.test.ts`, `packages/server/src/phase2-flags.ts`
- **T-007** — Implement provider destinations and write policy
  - Blocked by: T-003, T-006
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-007/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/destinations.ts`, `packages/server/src/document-providers/write-policy.ts`, `packages/server/src/document-providers/write-policy.test.ts`
- **T-008** — Implement provider-neutral Document API
  - Blocked by: T-004, T-005, T-006, T-007
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-008/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/routes/document-integrations.ts`, `packages/server/src/routes/document-integrations.test.ts`, `packages/server/src/index.ts`, `packages/server/src/editor/index.ts`
- **T-009** — Implement Revision Coordinator
  - Blocked by: T-008
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-009/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/revision-coordinator.ts`, `packages/server/src/document-providers/revision-coordinator.test.ts`, `packages/server/src/routes/document-integrations.ts`
- **T-010** — Integrate activity and Entity execution receipts
  - Blocked by: T-008
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-010/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/receipt-writer.ts`, `packages/server/src/receipt-writer.test.ts`, `packages/server/src/document-providers/activity-adapter.ts`, `.project-gate.json`
- **T-011** — Integrate search and associations
  - Blocked by: T-004
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-011/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-objects.ts`, `packages/server/src/routes/scoped-search-documents.ts`, `packages/db/src/index.ts`, `packages/server/src/document-objects.test.ts`

## P-02 — Google Workspace lane

- **T-012** — Migrate existing Google read path into unified document model
  - Blocked by: T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-012/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/google-docs-metadata.ts`, `packages/server/src/document-objects.ts`, `packages/server/src/document-objects.test.ts`, `packages/db/src/index.ts`
- **T-013** — Add Google admin write gate and destination UX
  - Blocked by: T-007, T-012
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-013/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/google/write-policy.ts`, `packages/server/src/routes/document-integrations.ts`, `packages/app/src/components/settings/DocsSettings.tsx`, `packages/server/src/document-objects.test.ts`
- **T-014** — Implement Google Docs create/mutate
  - Blocked by: T-013
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-014/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/google/docs-adapter.ts`, `packages/server/src/document-providers/google/docs-adapter.test.ts`, `packages/server/src/routes/document-integrations.ts`
- **T-015** — Implement Google Sheets create/range mutate
  - Blocked by: T-013, T-009
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-015/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/google/sheets-adapter.ts`, `packages/server/src/document-providers/google/sheets-adapter.test.ts`, `packages/server/src/document-providers/revision-coordinator.ts`
- **T-016** — Implement Google Slides create/mutate
  - Blocked by: T-013, T-009
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-016/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/google/slides-adapter.ts`, `packages/server/src/document-providers/google/slides-adapter.test.ts`, `packages/server/src/document-providers/revision-coordinator.ts`
- **T-017** — Implement Google change tracking and reconciliation
  - Blocked by: T-012
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-017/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/google/reconciler.ts`, `packages/server/src/document-providers/google/reconciler.test.ts`, `packages/server/src/google-docs-metadata.ts`
- **T-018** — Implement Google preview/open/permissions states
  - Blocked by: T-012
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-018/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/google/read-state.ts`, `packages/app/src/components/mission-control/utils/externalDocumentPreview.ts`, `packages/app/src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts`

## P-03 — Microsoft 365 lane

- **T-019** — Implement Microsoft Entra connection and tenant binding
  - Blocked by: T-001, T-006
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-019/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/microsoft/connection.ts`, `packages/server/src/document-providers/microsoft/connection.test.ts`, `packages/server/src/document-providers/types.ts`
- **T-020** — Implement Microsoft destination discovery/policy
  - Blocked by: T-019, T-007
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-020/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/microsoft/destinations.ts`, `packages/server/src/document-providers/microsoft/destinations.test.ts`, `packages/server/src/document-providers/write-policy.ts`
- **T-021** — Microsoft format capability spike/ADR
  - Blocked by: T-019
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-021/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `docs/adr/2026-08-microsoft-document-capabilities.md`, `packages/server/src/document-providers/microsoft/capability-spike.ts`, `packages/server/src/document-providers/microsoft/fixtures/README.md`
- **T-022** — Implement Microsoft create lanes
  - Blocked by: T-020, T-021
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-022/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/microsoft/create-adapter.ts`, `packages/server/src/document-providers/microsoft/create-adapter.test.ts`, `packages/server/src/routes/document-integrations.ts`
- **T-023** — Implement proven Microsoft structured mutations
  - Blocked by: T-021, T-022, T-009
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-023/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/microsoft/mutation-adapter.ts`, `packages/server/src/document-providers/microsoft/mutation-adapter.test.ts`, `packages/server/src/document-providers/revision-coordinator.ts`
- **T-024** — Implement Microsoft versions/permissions/change tracking/open
  - Blocked by: T-019, T-022
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-024/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/microsoft/read-state.ts`, `packages/server/src/document-providers/microsoft/reconciler.ts`, `packages/server/src/document-providers/microsoft/reconciler.test.ts`

## P-04 — Local Office lane

- **T-025** — Run local engine comparison spike
  - Blocked by: T-001, T-002
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-025/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `docs/adr/2026-08-local-office-engine.md`, `packages/server/src/document-providers/local/engine-spike.ts`, `packages/server/src/document-providers/local/fixtures/README.md`
- **T-026** — Implement local bridge security skeleton
  - Blocked by: T-025
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-026/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/local/bridge.ts`, `packages/server/src/document-providers/local/bridge.test.ts`, `electron/main.js`
- **T-027** — Integrate local managed storage/File Sources
  - Blocked by: T-026, T-004
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-027/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/local/managed-storage.ts`, `packages/server/src/document-providers/local/managed-storage.test.ts`, `packages/db/src/file-sources.ts`, `packages/server/src/fs/adapters/local.ts`
- **T-028** — Implement local version watcher and safe save coordinator
  - Blocked by: T-027, T-009
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-028/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/local/file-watcher.ts`, `packages/server/src/document-providers/local/safe-save.ts`, `packages/server/src/document-providers/local/safe-save.test.ts`
- **T-029** — Deliver local DOCX milestone
  - Blocked by: T-025, T-026, T-027, T-028
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-029/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/local/docx-engine.ts`, `packages/server/src/document-providers/local/docx-engine.test.ts`, `packages/server/src/document-providers/local/fixtures/docx/`
- **T-030** — Deliver local XLSX milestone
  - Blocked by: T-029
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-030/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/local/xlsx-engine.ts`, `packages/server/src/document-providers/local/xlsx-engine.test.ts`, `packages/server/src/document-providers/local/fixtures/xlsx/`
- **T-031** — Deliver local PPTX milestone
  - Blocked by: T-030
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-031/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/local/pptx-engine.ts`, `packages/server/src/document-providers/local/pptx-engine.test.ts`, `packages/server/src/document-providers/local/fixtures/pptx/`

## P-05 — Agent tools and product UX

- **T-032** — Implement provider-neutral agent tools
  - Blocked by: T-008; one of: T-014, T-022, T-029
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-032/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/agent/tools.ts`, `packages/server/src/agent/tools.test.ts`, `packages/server/src/routes/document-integrations.ts`
- **T-033** — Build canonical document UX
  - Blocked by: T-006, T-008
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-033/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/app/src/components/DocumentViewer.tsx`, `packages/app/src/components/DocumentReadingView.tsx`, `packages/app/src/components/document-integrations/DocumentActions.tsx`, `packages/app/src/components/document-integrations/DocumentActivity.tsx`
- **T-034** — Build provider administration UX
  - Blocked by: T-007, T-013, T-019, T-026
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-034/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/app/src/components/settings/DocsSettings.tsx`, `packages/app/src/components/document-integrations/ProviderSettings.tsx`, `packages/server/src/routes/document-integrations.ts`

## P-06 — Observability and cross-provider QA

- **T-035** — Add observability and redaction proof
  - Blocked by: T-014, T-015, T-016, T-017, T-018, T-022, T-023, T-024, T-029, T-030, T-031
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-035/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/phase2-observability.ts`, `packages/server/src/phase2-observability.test.ts`, `packages/server/src/agent/log.ts`, `scripts/scan-private-defaults.mjs`
- **T-036** — Cross-provider contract/E2E matrix
  - Blocked by: T-018, T-024, T-031, T-032, T-033, T-034, T-035
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-036/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `packages/server/src/document-providers/contract.test.ts`, `packages/server/src/document-providers/e2e.test.ts`, `packages/app/src/components/document-integrations/`, `docs/plans/evidence/entity-document-integrations/T-036/`
- **T-037** — Independent architecture/security review
  - Blocked by: T-036
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-037/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `docs/reviews/entity-document-integrations-codex.md`, `docs/reviews/entity-document-integrations-thermo-nuclear.md`, `.project-gate.json`, `AGENTS.md`

## P-07 — Release evidence and approval

- **T-038** — Exact-SHA CI and sandbox deployment
  - Blocked by: T-037
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-038/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `.github/workflows/main.yml`, `scripts/entity-release-info.mjs`, `scripts/entity-deploy-sandbox.sh`, `docs/plans/evidence/entity-document-integrations/T-038/`
- **T-039** — Live sandbox verification
  - Blocked by: T-038
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-039/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `scripts/proof/entity-document-integrations-smoke.sh`, `scripts/entity-verify-sandbox.sh`, `docs/plans/evidence/entity-document-integrations/T-039/`
- **T-040** — Production approval gate
  - Blocked by: T-039
  - Evidence: `docs/plans/evidence/entity-document-integrations/T-040/`
  - Paths: `docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `docs/runbooks/entity-document-integrations-promotion.md`, `scripts/entity-promote-prod.sh`, `docs/plans/evidence/entity-document-integrations/T-040/`
