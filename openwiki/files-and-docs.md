---
type: Feature Surface
title: Files and documents
description: File browsing and document workspace surface for Entity. Covers the unified file dashboard, Doc Hub chrome, document editor, file sources, document collaboration records, and docs-serving routes.
tags: [entity, files, docs, doc-hub, collaboration, file-sources]
---

# Files and documents

The Files area is a shared workspace for browsing content from one or more sources, opening documents, editing markdown-like files, and keeping collaboration state attached to the document. It is the user-facing surface that consumes the file-source, read-only bootstrap, and bounded-read rules documented in [Admin and extensions](admin-and-extensions.md) and [Configuration, Admin, Plugins, and Services](platform/configuration-and-plugins.md).

The main source seams are:

- `packages/app/src/views/FilesView.tsx` for the top-level Files route.
- `packages/app/src/components/UnifiedFileDashboard.tsx` for the multi-source browser.
- `packages/app/src/components/doc-hub/DocHubWorkspaceChrome.tsx` for the tabbed Doc Hub chrome.
- `packages/app/src/views/DocumentEditorView.tsx` and related editor components for editing, comments, suggestions, and review markers.
- `packages/app/src/components/document-integrations/ProviderSettings.tsx` and `packages/app/src/components/settings/DocsSettings.tsx` for document-provider configuration in Admin.
- `packages/server/src/routes/document-integrations.ts`, `packages/server/src/document-providers/*`, and `packages/db/src/document-integrations.ts` for the provider-neutral document API, provider adapters, write policy, and integration persistence.
- `packages/server/src/routes/docs.ts`, `packages/server/src/routes/documents.ts`, and `packages/server/src/routes/search.ts` for document serving and document APIs.
- `packages/db/src/file-sources.ts` and `packages/db/src/document-collab.ts` for source registration and collaboration persistence.
- `packages/server/src/config/runtime.ts`, `packages/server/src/config/schema.ts`, `packages/server/src/fs/adapters/local.ts`, `packages/server/src/fs/adapters/http-markdown.ts`, `packages/server/src/fs/adapters/bounded-read.ts`, `packages/server/src/fs/adapters/github.ts`, `packages/server/src/fs/adapters/registry.ts`, `packages/server/src/fs/routes-sources.ts`, and `packages/server/src/fs/routes-files.ts` for bootstrap allowlisting, read-only enforcement, bounded reads, and remote raw-read handling on local, HTTP-backed, and GitHub-backed file sources. The local adapter now reuses a pooled managed-storage broker per executable and root, keeps the startup-root validation on `.` only, preserves typed missing-root and invalid-path messages, and applies the same 16 MiB ceiling as the other adapters; `packages/server/src/fs/managed-storage-broker.ts` and its tests document the fail-closed client lifecycle and root-bound IPC contract.

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

The new GitHub source type follows the same read-only file-source model from a different seam. `packages/app/src/components/settings/FileSourcesSettings.tsx` now labels the type as `GitHub repository`, requires a `baseUrl` like `https://github.com/owner/repo`, and sends test and sync requests through `useFileSources`. The server adapter in `packages/server/src/fs/adapters/github.ts` accepts either an HTTPS GitHub URL or an `owner/repo` slug, resolves optional bearer-token auth through an environment variable name stored in `auth_ref`, validates the repository with the GitHub API, and exposes read-only list/read operations backed by the GitHub tree and contents endpoints. The registry marks `github` as a live-validation adapter, so `/api/fs/sources/:id/test` and `/api/fs/sources/:id/sync` route through the real adapter instead of the placeholder path.

The manifest path is configured through the File Sources settings form and stored in the source capabilities JSON. The server enforces the safety contract in `packages/server/src/fs/adapters/http-markdown.ts` and `packages/server/src/fs/routes-sources.ts`: only one of `manifestPath` or `manifestUrl` is allowed, remote manifest URLs must be same-origin and below the base URL, the manifest is capped at 2 MiB and 10,000 files, each listed file is capped at 16 MiB, file paths must be normalized text paths, and duplicate or ambiguous file/directory-shadowing paths are rejected. This keeps remote Ada-style documentation searchable while preserving the adapter's read-only boundary.

`packages/server/src/routes/documents.ts` adds the document-specific API surface. That route is where document sessions, blocks, presence, snapshots, events, and share-token authorization are handled.

The onboarding flow also points new workspaces at the file-source surface. `packages/app/src/components/OnboardingFlow.tsx` now lets the first source be a `github` source, which it seeds as `displayName: 'GitHub source'` with the GitHub repository URL from the setup form. That keeps the initial source bootstrap aligned with the same adapter that the settings page and source routes use.

A shared bounded-read helper in `packages/server/src/fs/adapters/bounded-read.ts` now enforces a 16 MiB ceiling for file-source reads and remote text reads. `packages/server/src/fs/adapters/local.ts`, `packages/server/src/fs/adapters/http-markdown.ts`, and `packages/server/src/fs/adapters/docsify.ts` all call that helper so oversized content is rejected consistently instead of being buffered or concatenated blindly. `packages/server/src/fs/adapters/http-markdown.ts` also exposes a `readRaw` fallback for unsupported text content, returning binary metadata when the text read path refuses a non-text resource. The file route in `packages/server/src/fs/routes-files.ts` maps `SourceReadLimitError` to HTTP 413, so user-visible reads fail with a specific bounded-response instead of a generic server error, and the local adapter keeps the same limit in sync for direct filesystem reads. The legacy file routes now mirror that same boundary: `packages/server/src/routes/legacy-files.ts` uses the shared read-only source check to reject writes into read-only local source trees and aliases, and its coverage proves the nested alias case stays blocked even when the path is reached through a symlink. The file route also treats that HTTP markdown raw fallback as binary so the UI can display non-text resources without pretending they were textual markdown. The same read ceiling also matches the file-browsing boundary described in [Configuration, Admin, Plugins, and Services](platform/configuration-and-plugins.md), so source browsing, indexing, and the admin-configured file-source experience stay aligned.

Local file sources add a stricter server-side boundary of their own. `packages/server/src/fs/adapters/local.ts` now keeps a per-executable, per-root managed-storage broker pool so repeated route requests and index scans reuse one child process instead of spawning a fresh broker for every adapter instance. That adapter still validates the bound startup root by calling the broker on `.` only, and it derives write capability from the configured base path plus the read-only source flag stored with the source record. If the broker reports a missing root, the adapter preserves the user-facing "Local source path does not exist." validation message; if the broker reports an invalid path, the adapter re-surfaces the existing "Access outside source root is not allowed." message for read failures. The same adapter now enforces the shared 16 MiB ceiling when no explicit `maxBytes` is supplied, so local filesystem reads fail with the same bounded-read error as the other source adapters. `packages/server/src/fs/managed-storage-broker.ts` implements the pooled child-process protocol, keeps each request root-bound by sending the executable plus startup root only once at launch, and now fails closed when spawn throws synchronously, emits an asynchronous child error, or exits while requests are pending. `packages/server/src/fs/managed-storage-broker.test.ts` proves the client pool reuses children for repeated acquires, evicts dead clients, and fails closed when spawn cannot start. `packages/server/src/fs/adapters/local.integration.test.ts` covers the adapter-facing behavior on the real native broker: symlink escapes are rejected, oversized reads stop at 16 MiB, and repeated route/index-style adapter operations keep broker creation bounded to one child per source root. `packages/server/src/fs/adapters/local.test.ts` covers the adapter-facing behavior in unit tests: broker reuse, root validation, typed read translations, and the oversized-read rejection path. `packages/server/src/fs/routes-files.ts` maps the shared read-limit error to HTTP 413 so the UI sees a bounded read failure rather than a generic server error.

The broker hardening also affects route-level behavior. `packages/server/src/fs/routes-files.ts` maps the shared read-limit error to HTTP 413, so oversized local reads fail with a bounded response instead of a generic server error. `packages/server/src/routes/legacy-files.ts` continues to treat read-only local roots as immutable at the mutation boundary, and its realpath-aware overlap checks still prevent same-root, parent, and child aliases from sneaking writes into protected local sources.

The access model is explicit:

- public documents are readable without a share token;
- shared/private documents require a valid token from the `Authorization: Bearer ...` header, `X-Share-Token`, or `?token=` query parameter;
- document edits and events are persisted in SQLite-backed tables.

Local file sources add another boundary: the server seeds trusted local roots into `ENTITY_FS_LOCAL_SOURCE_ROOTS` during bootstrap, the local adapter reports `readOnly` in stored capabilities, and `packages/server/src/routes/docs.ts` rejects write requests when the adapter says the source is read-only. The adapter itself also blocks direct `write` and `mkdir` calls for read-only sources, so both the HTTP surface and the adapter layer enforce the same contract. The HTTP markdown adapter follows the same read-only rule, but its `readRaw` path can still return binary content and the file route will flag the payload as `isBinary` when the text read path rejects a non-text resource. The file-source API also refuses to delete config-managed local sources and preserves the `entity.config.yaml` source marker on updates, which closes the delete/recreate path that could otherwise bypass the trusted read-only policy. New local source registrations also inherit read-only policy when their root overlaps any protected read-only local root, so same-root, parent, and child aliases cannot be used to regain writes around a trusted wiki source. The local capability helper now reconstructs `readOnly` from stored capabilities so effective-config views and the adapter stay aligned even when the source record is persisted separately.

## Task and document relationships

A task output can target Doc Hub or the standalone document route; the route resolver is tested in `packages/app/src/lib/taskOutputDocTarget.test.ts`. Document comments are range-anchored collaboration objects, while task comments belong to [Mission Control](mission-control.md). Document review runs produce findings that may be applied or ignored; task review gates govern task completion. Keep these models distinct in UI and API changes.

The agent registry can bind agents to file sources, so [agent identity](agents-and-collaboration.md) is also used to filter and attribute file work.

## Change and test guidance

Start with the owning surface rather than `App.tsx` unless navigation or shared state is involved. Relevant focused tests include:

- `packages/app/src/lib/fileSearchSort.test.ts`
- `packages/app/src/lib/openFileTabs.test.ts`
- `packages/app/src/lib/taskOutputDocTarget.test.ts`
- `packages/app/src/lib/__tests__/fileRestoreState.test.ts`
- `packages/server/src/document-objects.test.ts`
- tests under `packages/server/src/fs/` and `packages/server/src/editor/`

Build the app and run server Vitest. Browser-check search, source switching, open/close/restore, save behavior, task return navigation, restricted results, and the responsive layout; utility tests do not cover the full cross-package workflow.
