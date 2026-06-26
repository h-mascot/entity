# Entity Phase 2 Boundary Release Gate

Linear issue: `THE-94` / source `THE-20.4`

This runbook documents the local security/privacy/product-boundary release gate for Entity Phase 2. The gate is deterministic and source-driven: it scans product source for forbidden boundary drift, verifies existing negative/security proof fixtures are present, and emits review artifacts under ignored `output/`.

## Run

```bash
npm run proof:phase2:boundary -- --out output/entity-phase-2/boundary-release-gate/THE-94
```

The command fails if it finds blocking drift. It writes:

- `THE-94.boundary-release-gate.json` - structured scan, evidence, and validation result.
- `THE-94.summary.md` - reviewer-readable proof summary.
- `THE-94.dom-receipt.html` - DOM receipt with validation `data-*` attributes.

## Boundary Scope

The gate covers the THE-94 release risks:

- Paperclip remains external reference context only and must not appear as an internal provider, product layer, module, or dependency.
- Curacel remains design-customer context only and must not appear as hardcoded repo/demo/product framing.
- Helm exposure is limited to status references and safe light controls, with no sensitive-material payloads, deep object browser, or runtime admin mutation.
- Google Docs/Drive V1 remains read/index/link/preview only, with no create/update/write/export/sync helpers.
- ClickClack unavailable/degraded state must not block Entity-owned docs, files, proof, review, task, or search flows.
- Permission-denied and restricted objects must not return snippets, previews, activity body, evidence body, or open URLs.

## Baseline Handling

The gate distinguishes blocking drift from legacy label-only context. For example, historical Mission Control project labels may still contain customer names as data labels. Those are reported as baseline observations in the JSON/summary, not silently ignored. Curacel-specific repo URLs, demo framing, or hardcoded workflow framing remain blocking findings.

This is intentional: THE-94 should block release-risk drift without repeating the false-positive pattern where broad scans report old docs/spec text as new product leakage.

## Proof Checklist

Attach the focused THE-94 gate output plus the normal build/test proof:

```bash
npm run proof:phase2:boundary -- --out output/entity-phase-2/boundary-release-gate/THE-94
cd packages/server && npm run build && npx vitest run
npm run build
bash scripts/proof/entity-phase-2-smoke.sh
```

For packet gates, include the generated output paths in CLI Tester / Book review evidence for `THE-94`.
