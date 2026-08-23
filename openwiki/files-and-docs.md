---
type: Feature Surface
title: Files and documents
description: File browsing and document workspace surface for Entity. Covers the unified file dashboard, Doc Hub chrome, document editor, file sources, document collaboration records, and docs-serving routes.
tags: [entity, files, docs, doc-hub, collaboration, file-sources]
---

# Files and documents

The Files area is a shared workspace for browsing content from one or more sources, opening documents, editing markdown-like files, and keeping collaboration state attached to the document.

The main source seams are:

- `packages/app/src/views/FilesView.tsx` for the top-level Files route.
- `packages/app/src/components/UnifiedFileDashboard.tsx` for the multi-source browser.
- `packages/app/src/components/doc-hub/DocHubWorkspaceChrome.tsx` for the tabbed Doc Hub chrome.
- `packages/app/src/views/DocumentEditorView.tsx` and related editor components for editing, comments, suggestions, and review markers.
- `packages/server/src/routes/docs.ts`, `packages/server/src/routes/documents.ts`, and `packages/server/src/routes/search.ts` for document serving and document APIs.
- `packages/db/src/file-sources.ts` and `packages/db/src/document-collab.ts` for source registration and collaboration persistence.
- `packages/server/src/config/runtime.ts`, `packages/server/src/config/schema.ts`, `packages/server/src/fs/adapters/local.ts`, `packages/server/src/fs/adapters/http-markdown.ts`, `packages/server/src/fs/adapters/bounded-read.ts`, `packages/server/src/fs/routes-sources.ts`, and `packages/server/src/fs/routes-files.ts` for bootstrap allowlisting, read-only enforcement, bounded reads, and remote raw-read handling on local and HTTP-backed file sources.

## What users can do

- Browse files from the workspace and other configured sources.
- Open documents in a tabbed Doc Hub shell.
- Edit content in the document editor.
- Read markdown previews and file history.
- Switch between file sources when multi-source browsing is enabled.
- See comments, suggestions, presence, authorship ranges, and review runs attached to the document.
- Use text-to-speech controls for document reading where enabled.

## Unified file browsing

`FilesView` decides whether the user sees the unified dashboard or a simpler “select a file” fallback. The decision is controlled by the runtime flag exposed to the view as `fsMultiSourceEnabled`.

When multi-source browsing is enabled, the UI renders `UnifiedFileDashboard`, which is the product’s primary entry into source selection and file browsing. The dashboard and source tree are consistent with the file source registry in `packages/db/src/file-sources.ts`, which stores source type, base path, base URL, auth type, enabled state, icon, health, and sync timestamps.

The example config in `entity.config.example.yaml` shows two local sources by default: `workspace` and `entity-wiki`. The wiki source is declared `readOnly: true`, and runtime bootstrap adds configured local file-source roots to `ENTITY_FS_LOCAL_SOURCE_ROOTS` so the allowlist covers trusted roots before the adapter enforces read-only behavior. The effective-config path now reconstructs stored capabilities into `readOnly`, so Admin and file-source views stay aligned with the Entity Wiki bootstrap contract.

## Doc Hub and document editing

`DocHubWorkspaceChrome` keeps document tabs and top-level workspace actions together. It is the shell around the document editor, not the editor itself.

The editor-specific state is persisted in `packages/db/src/document-collab.ts`. That schema stores:

- document sessions;
- authorship ranges and history;
- presence records;
- comments and replies;
- suggestions with open/accepted/rejected state;
- review runs with pending/running/completed/failed state.

```mermaid
erDiagram
  document_sessions ||--o{ document_presence : tracks
  document_sessions ||--o{ document_comment : contains
  document_sessions ||--o{ document_suggestion : contains
  document_sessions ||--o{ document_review_run : contains
  document_sessions ||--o{ document_authorship_range : annotates
  document_sessions ||--o{ document_authorship_history : records
  document_comment ||--o{ document_comment_reply : has
```

That collaboration layer is what makes the Files surface more than a file browser: it is the shared document state that the UI can render and the server can validate.

## Document serving and access control

`packages/server/src/routes/docs.ts` resolves document paths from several allowed roots, including workspace-backed candidates and legacy fallback roots. It rejects path traversal and only allows text-oriented file extensions.

HTTP markdown sources now have two explicit discovery modes. Without a manifest they remain exact-read-only: users can open a known path, but the adapter does not claim list or search capability and `/api/sources` reports `searchability: "exact-read-only"`. When an `http-markdown` source is configured with `manifestPath` under its base URL, or a same-origin `manifestUrl` that stays under the source `baseUrl`, the adapter loads a version-1 manifest and reports `searchability: "manifest-backed"`. That manifest can drive `/api/fs/tree`, source sync, and `/api/fs/search` without giving the remote source write capability.

The manifest path is configured through the File Sources settings form and stored in the source capabilities JSON. The server enforces the safety contract in `packages/server/src/fs/adapters/http-markdown.ts` and `packages/server/src/fs/routes-sources.ts`: only one of `manifestPath` or `manifestUrl` is allowed, remote manifest URLs must be same-origin and below the base URL, the manifest is capped at 2 MiB and 10,000 files, each listed file is capped at 16 MiB, file paths must be normalized text paths, and duplicate or ambiguous file/directory-shadowing paths are rejected. This keeps remote Ada-style documentation searchable while preserving the adapter's read-only boundary.

`packages/server/src/routes/documents.ts` adds the document-specific API surface. That route is where document sessions, blocks, presence, snapshots, events, and share-token authorization are handled.

A shared bounded-read helper in `packages/server/src/fs/adapters/bounded-read.ts` now enforces a 16 MiB ceiling for file-source reads and remote text reads. `packages/server/src/fs/adapters/local.ts`, `packages/server/src/fs/adapters/http-markdown.ts`, and `packages/server/src/fs/adapters/docsify.ts` all call that helper so oversized content is rejected consistently instead of being buffered or concatenated blindly. `packages/server/src/fs/adapters/http-markdown.ts` also exposes a `readRaw` fallback for unsupported text content, returning binary metadata when the text read path refuses a non-text resource. The file route in `packages/server/src/fs/routes-files.ts` maps `SourceReadLimitError` to HTTP 413, so user-visible reads fail with a specific bounded-response instead of a generic server error, and the local adapter keeps the same limit in sync for direct filesystem reads. The legacy file routes now mirror that same boundary: `packages/server/src/routes/legacy-files.ts` uses the shared read-only source check to reject writes into read-only local source trees and aliases, and its coverage proves the nested alias case stays blocked even when the path is reached through a symlink. The file route also treats that HTTP markdown raw fallback as binary so the UI can display non-text resources without pretending they were textual markdown. The same read ceiling also matches the file-browsing boundary described in [Configuration, Admin, Plugins, and Services](platform/configuration-and-plugins.md), so source browsing, indexing, and the admin-configured file-source experience stay aligned.

The access model is explicit:

- public documents are readable without a share token;
- shared/private documents require a valid token from the `Authorization: Bearer ...` header, `X-Share-Token`, or `?token=` query parameter;
- document edits and events are persisted in SQLite-backed tables.

Local file sources add another boundary: the server seeds trusted local roots into `ENTITY_FS_LOCAL_SOURCE_ROOTS` during bootstrap, the local adapter reports `readOnly` in stored capabilities, and `packages/server/src/fs/routes-files.ts` rejects write requests when the adapter says the source is read-only. The adapter itself also blocks direct `write` and `mkdir` calls for read-only sources, so both the HTTP surface and the adapter layer enforce the same contract. The HTTP markdown adapter follows the same read-only rule, but its `readRaw` path can still return binary content and the file route will flag the payload as `isBinary` when the text read path rejects a non-text resource. The file-source API also refuses to delete config-managed local sources and preserves the `entity.config.yaml` source marker on updates, which closes the delete/recreate path that could otherwise bypass the trusted read-only policy. New local source registrations also inherit read-only policy when their root overlaps any protected read-only local root, so same-root, parent, and child aliases cannot be used to regain writes around a trusted wiki source. The local capability helper now reconstructs `readOnly` from stored capabilities so effective-config views and the adapter stay aligned even when the source record is persisted separately.

## Change notes for future agents

When changing Files / Doc Hub, check these seams together:

1. `packages/app/src/views/FilesView.tsx` and `packages/app/src/components/UnifiedFileDashboard.tsx` for navigation and source selection.
2. `packages/app/src/views/DocumentEditorView.tsx` and `packages/app/src/components/doc-hub/DocHubWorkspaceChrome.tsx` for editing and tabs.
3. `packages/server/src/routes/docs.ts` and `packages/server/src/routes/documents.ts` for serving and authorization.
4. `packages/db/src/file-sources.ts` and `packages/db/src/document-collab.ts` for persistence.

If you change the allowed document file types or auth model, update the server route and the UI together so the workspace does not offer a capability the backend rejects.
