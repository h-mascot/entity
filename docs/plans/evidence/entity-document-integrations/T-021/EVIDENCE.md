# T-021 evidence — Microsoft format capability spike / ADR

- **Issue:** THE-962 / LOOM-DOCS T-021
- **Base verified:** `714cf332ad1aeb731c9f34cff54c2661f5ea93d5`
- **Branch:** `runner/entity-document-integrations-20260818`
- **Date:** 2026-08-22
- **Scope:** only the four T-021 implementation/evidence paths; no provider calls, tenant data, credentials, deployment, GitHub, Linear, main, or queue operations.

## Deliverables

- `docs/adr/2026-08-microsoft-document-capabilities.md` — R-012/R-015 decision and evidence matrix.
- `packages/server/src/document-providers/microsoft/capability-spike.ts` — pure, non-wired catalogue and fail-closed helpers.
- `packages/server/src/document-providers/microsoft/fixtures/README.md` — sanitized fixture contract and per-format round-trip requirements.

## Capability dispositions

| Capability | Disposition | Fail-closed rule |
| --- | --- | --- |
| File creation | Conditional; default `unknown` pending T-022 fixture/open proof | not enabled by this spike |
| Word structured mutation | `unsupported` | `microsoftMutationAllowed('agent_text_mutation','document') === false` |
| Excel range mutation | `unsupported` | `microsoftMutationAllowed('agent_range_mutation','spreadsheet') === false` |
| PowerPoint slide mutation | `unsupported` | `microsoftMutationAllowed('agent_slide_mutation','presentation') === false` |
| Versions | `supported` as provider metadata, gated by later connection/destination/readiness | not semantic edit history |
| Change tracking | `supported` as Graph delta enumeration | not Word Track Changes or semantic diff |
| Previews | Conditional; default `unknown` | unavailable must remain typed, no fabricated preview |
| Open links | Conditional; default `unknown` | external open is distinct from embedded editor |
| WOPI/editor eligibility | `unknown` | embedded editor never enabled without technical + licensing proof |

No capability is wired into product routes or a registry by this ticket. The executable matrix
intentionally does not claim Graph format mutation or WOPI eligibility.

## Primary current documentation evidence

Retrieved 2026-08-22 (HTTP 200 verified):

1. https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0 — upload small files.
2. https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0 — resumable upload.
3. https://learn.microsoft.com/en-us/graph/api/driveitem-list-versions?view=graph-rest-1.0 — item versions.
4. https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0 — change enumeration.
5. https://learn.microsoft.com/en-us/graph/api/driveitem-list-thumbnails?view=graph-rest-1.0 — thumbnails.
6. https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0 — driveItem metadata/web URL surface.
7. https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/concepts — WOPI concepts.

These sources establish documented provider surfaces only. They do not establish Entity tenant
consent, destination policy, OOXML generation, Office-open proof, semantic mutation fidelity,
least-privilege scope approval, or WOPI commercial eligibility.

## Prototype fixture disposition

No live or tenant artifact was added. `fixtures/README.md` mechanically specifies DOCX, XLSX,
and PPTX sanitized fixture manifests plus required create/open/mutate/reopen proof. Upload-only
round trips are explicitly rejected as mutation proof.

## Proof commands and results

Commands run with Node 22 path prepended where applicable:

```text
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
git status --short --branch
PASS — clean at start; branch runner/entity-document-integrations-20260818
git rev-parse HEAD
PASS — 714cf332ad1aeb731c9f34cff54c2661f5ea93d5
git diff --check
PASS
cd packages/server && npm run build
PASS
cd packages/server && npx vitest run src/document-providers/microsoft/connection.test.ts src/document-providers/microsoft/destinations.test.ts
PASS
```

The scoped Microsoft tests cover the adjacent T-019/T-020 contracts. The spike is pure TypeScript
and has no external provider dependency; the strict server build is the focused type proof.

## Scope disposition

**Complete for T-021 spike/ADR.** T-022 owns per-format create/open proof; T-023 owns any future
proven structured mutation; T-024 owns versions/permissions/change/preview/open normalization;
WOPI/editor embedding remains proof-gated and disabled. No final commit SHA is recorded here.
