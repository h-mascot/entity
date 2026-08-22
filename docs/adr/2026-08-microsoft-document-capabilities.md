# ADR: Microsoft document capability truth (T-021 / THE-962)

- **Status:** Accepted for spike; no Microsoft structured mutation enabled
- **Date:** 2026-08-22
- **Scope:** Microsoft 365 file creation, format mutation, versions, change tracking, previews, open links, and WOPI/editor eligibility
- **Authority:** This repair follows the scoped `docs/loom/entity-document-integrations/AGENTS.md` contract. The observed conflicting pins are scoped AGENTS `83cacbc…` and the local canonical PRD/BUILD-CONTEXT `c82e82d…`; reconciliation remains manager-owned, pending authority resolution. The canonical PRD and BUILD-CONTEXT are intentionally unchanged.
- **Retrieval date for provider evidence:** 2026-08-22

## Decision

Entity separates provider file operations, format-aware mutation, provider-native human editing,
and optional embedding. Microsoft Graph storage/upload evidence must never be presented as Word,
Excel, or PowerPoint structured mutation evidence. The default for any unproven mutation or
embedding capability is fail-closed (`unsupported` or `unknown`). `Edit in Microsoft 365` may be
implemented later as an external-open capability, independently of embedded editing.

The executable catalogue is `packages/server/src/document-providers/microsoft/capability-spike.ts`.
It is deliberately pure: it performs no provider call, stores no credentials, and is not wired
into routes or the capability registry by this ticket.

## R-012/R-015 evidence matrix

| Capability | Word / Excel / PowerPoint disposition | Current evidence | Entity disposition |
| --- | --- | --- | --- |
| File creation | Graph can upload small files and resumable uploads. This does not prove valid format generation or Office-open proof. | [Upload small files](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0); [createUploadSession](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0) | **Conditional; default unknown.** T-022 must add valid sanitized fixtures and bounded Microsoft 365 open proof per artifact type. |
| Word structured mutation | No documented route or approved format engine identified in this spike. | Graph upload route above only proves bytes can be stored. | **Unsupported.** Never whole-file overwrite as a substitute. |
| Excel range/workbook mutation | No documented route or approved format engine identified in this spike. | Graph upload route above only proves bytes can be stored. | **Unsupported.** |
| PowerPoint slide mutation | No documented route or approved format engine identified in this spike. | Graph upload route above only proves bytes can be stored. | **Unsupported.** |
| Versions | Graph documentation describes a driveItem versions collection. | [List versions](https://learn.microsoft.com/en-us/graph/api/driveitem-list-versions?view=graph-rest-1.0) | **Unknown and non-actionable in this spike.** Adapter, connection, destination, runtime, and policy evidence remain required before T-024 can normalize it. Not a semantic edit history claim. |
| Change tracking | Graph documentation describes delta enumeration for a driveItem collection. | [driveItem delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0) | **Unknown and non-actionable in this spike.** No provider integration or readiness lane is implemented; this is not Word Track Changes, Excel revision semantics, or author-level diff. |
| Previews/thumbnails | Graph exposes thumbnail retrieval where the provider can generate one. | [Retrieve thumbnails](https://learn.microsoft.com/en-us/graph/api/driveitem-list-thumbnails?view=graph-rest-1.0) | **Conditional; default unknown.** Missing preview is a typed unavailable/unsupported state, never fabricated. |
| Open links | A driveItem includes provider metadata such as `webUrl` when available. | [driveItem resource](https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0) | **Conditional; default unknown.** Requires item metadata and permission proof. External open does not imply embed. |
| WOPI / embedded editor | Microsoft WOPI integration requires technical host/endpoint obligations; Entity has no recorded technical eligibility or commercial/licensing approval. | [WOPI key concepts](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/concepts) | **Unknown; default unknown; never render.** R-015 requires both technical and licensing evidence before enablement. |

### Evidence limits

The Microsoft Learn pages above are primary provider documentation, but they do not establish:
Entity's tenant consent, destination policy, exact least-privilege scopes, a valid OOXML generator,
Office-open round trips, semantic mutation fidelity, or WOPI commercial eligibility. Those are
separate gates and remain explicit unknown/conditional work. No Graph/WOPI claim beyond the linked
page's documented surface is made here.

## Fail-closed contract

- `microsoftCapabilityState()` returns `unknown` for capabilities and artifact types not positively represented.
- `microsoftMutationAllowed()` returns false for every current matrix entry; no adapter/connection/destination/runtime/policy evidence lane exists in this spike.
- `embed_editor` is `unknown` and is never actionable.
- Provider identity (`microsoft_365`) never implies mutation, preview, open, or embedding capability.
- Storage/upload, versions, delta, thumbnails, and `webUrl` are distinct from format mutation and embedded editing.

## Authority and evidence boundary

The matrix and ADR record documentation/metadata only. No Microsoft provider integration, tenant authorization,
destination policy, runtime readiness, or product wiring is implemented. Reconciliation of the observed
`83cacbc…` versus `c82e82d…` authority pins remains manager-owned and pending authority resolution.

## Consequences and follow-up

T-022 may establish creation only after per-format fixture/open evidence. T-023 may enable a
mutation only after an exact documented route or approved engine, authentication requirements,
concurrency semantics, known limitations, and a sanitized round-trip fixture are recorded. T-024
may normalize versions, permissions, changes, previews, and open links, with unavailable states
preserved. WOPI remains disabled until a separate ADR records technical and licensing proof.
