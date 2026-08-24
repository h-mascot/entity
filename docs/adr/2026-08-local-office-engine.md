# ADR: Local Office engine boundary (T-025 / THE-966 / R-017)

- **Status:** Candidate boundary selected; concrete engine deferred
- **Date:** 2026-08-22
- **Scope:** Local DOCX/XLSX/PPTX engine comparison only

## Decision

Keep local Office behind the provider-neutral `LocalOfficeEngine` seam and use a document-scoped desktop bridge as the reversible human-editing boundary. Do **not** select GenOffice, ONLYOFFICE, or Univer as the production engine yet. No bridge, route, registry, filesystem access, Electron integration, credentials, or network client is introduced by T-025.

The executable decision seam is `packages/server/src/document-providers/local/engine-spike.ts`. It is pure and only promotes a candidate when bridge readiness, required-format fidelity evidence, and licensing evidence are present.

## Candidate matrix

| Candidate | Fidelity | Structured mutation | Human editing | Headless | Licensing | Security/file model | Maintenance | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GenOffice | Unmeasured | Unmeasured | Unmeasured | Unmeasured | Unverified | Unverified | Unverified | Defer |
| ONLYOFFICE | Unmeasured | Adapter required | Embedded candidate | Possible | Review required | Sandbox required | Active upstream (not independently verified here) | Defer |
| Univer | Unmeasured | Adapter required | Embedded candidate | Possible | Review required | Sandbox required | Active upstream (not independently verified here) | Defer |
| Installed desktop app + bridge | Conditional | Adapter required | External desktop | Unmeasured | Review required | Entity document allowlist | Installed-app dependent | Recommend boundary |

These are dispositions, not performed benchmarks. The fixture README records the required manual protocol and explicitly records open/edit/save/reopen as **not performed**.

## Evaluation

- **Fidelity:** Real OOXML round-trip behavior is the release gate; no candidate receives a fidelity claim without sanitized DOCX/XLSX/PPTX fixtures.
- **Licensing/distribution:** Concrete license terms, redistribution rights, bundled runtime obligations, and platform coverage remain unverified. Legal/product review is required before adoption.
- **Security/file access:** The bridge must accept an Entity document/file-source reference, not a caller path; resolve an allowlisted canonical file, use authenticated short-lived authorization, and expose an operation allowlist. T-026 owns implementation and attack tests. Arbitrary filesystem browsing remains prohibited.
- **Maintenance:** Concrete engine upgrades and compatibility are deferred until upstream/version evidence and support policy exist. An installed-editor bridge minimizes initial vendor coupling but inherits each installed editor's compatibility and lifecycle.
- **Human experience:** External desktop editing is the least speculative first boundary; browser-only users must receive a truthful unavailable/install state. Embedded editing is not implied.
- **Agent mutation:** The seam permits a future adapter, but mutation is not enabled merely because a file can be opened or uploaded. Revision-aware save and candidate validation belong to later local milestones.

## Recommendation and reversibility

Proceed with the provider-neutral seam plus a document-scoped desktop bridge in T-026. Re-evaluate the concrete editor after T-029 fixture proof. Reversing this decision means selecting a different `LocalOfficeEngine` implementation or retaining the bridge boundary; no schema, route, registry, or stored artifact format depends on a named engine.

## Unresolved risks / limitations

1. No local engine was installed or run in this spike.
2. No manual open/edit/save/reopen result was produced.
3. DOCX/XLSX/PPTX fidelity, performance, crash recovery, OS support, API stability, and license compatibility remain evidence gates.
4. The desktop bridge security model is reviewed as a design boundary only; its implementation and negative security suite are T-026.
