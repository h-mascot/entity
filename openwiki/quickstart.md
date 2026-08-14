---
type: Product Guide
title: Entity Quickstart
description: Entry point to Entity, an AI-native workspace for files, tasks, agents, collaboration, execution providers, plugins, and operational proof.
tags: [entity, quickstart, product, engineering]
---

# Entity quickstart

Entity is a local-first, server-backed workspace where humans can inspect, steer, and review agent work. Its implemented product surfaces bring tasks, files, documents, agent state, activity, chat, services, plugins, and operational evidence into one React application. Source presence does **not** prove deployment rollout: `/api/version`, release metadata, sandbox validation, and deployment receipts remain authoritative for any live environment.

## Start locally

Prerequisites are Node.js 20+ and npm.

```bash
npm install
npm run setup
npm run build
npm run doctor
npm run dev
```

Open `http://localhost:3000`. `npm run setup` creates local configuration, seeds the read-only Entity Wiki local file source at `./openwiki-html`, and normally prepares the optional ClickClack chat sidecar; use `npm run setup -- --skip-clickclack` when only the core workspace is needed. The Express server serves the built frontend, so rebuild `packages/app` after UI changes unless using the separate Vite development loop documented in `README.md`.

The default configuration is loopback-only and local-first. Do not expose it on a network without understanding the [security boundary](operations/security-and-release.md#network-and-authentication-boundary).

## What users can do

| Surface | Implemented capability | Important boundary |
|---|---|---|
| Files | Search and filter configured sources, browse trees, open tabs, read and edit source-backed files, and enter collaboration views | Multi-source home is controlled by `VITE_ENTITY_FS_MULTISOURCE`; cached reads can mask an unavailable source |
| Mission Control | Create, assign, move, filter, review, gate, comment on, and inspect tasks across Kanban, Insights, and Strategic views | A recorded handoff does not itself prove an agent runtime was dispatched |
| Agents | Inspect registry identity, focus, model/runtime metadata, work, health, metrics, and activity; invoke limited runtime controls when eligible | Registry failure degrades management details; safe controls require a bound Helm-managed runtime |
| Services | View plugin-supplied service families, health, latency, links, and degraded/offline states | The `entity-services` plugin and its compiled frontend mount must both be available |
| Chat | Use channel/thread UI and model-routing plumbing | ClickClack compatibility routing is optional and sidecar-dependent |
| Admin | Configure workspace behavior, file sources, Task Master, document credentials, plugins, TTS, integrations, agent registry, presentation, and users & roles | Not every setting is hot-reloadable; bootstrap path changes require restart |

The [Files and documents](features/files-and-documents.md) experience connects source browsing to native document collaboration, task output links, and document conversion from writable local sources, and it now reflects the read-only local-source bootstrap path for the Entity Wiki source. [Mission Control](mission-control.md) owns execution planning, accountability, comments, reviews, gates, handoff records, and customizable board navigation. That navigation now excludes the `geordi-swarm` plugin only from the board list, while the task-detail `Run with agents` action and the `/swarm/*` execution routes remain part of Mission Control. The task-detail `Handoffs` section is also part of this surface and now merges local handoff history with Curacel incoming/outgoing records before showing rollback controls. The [Agents and activity](agents-and-activity.md) surface joins registry data with health and activity rather than treating agents as transient chat sessions. [Admin and extensions](admin-and-extensions.md) covers principals, scoped grants, file sources, settings, plugins, and services, including the server-trusted `accessControl.apiPrincipalId` binding used by the first-admin bootstrap flow. [Runtime and release](runtime-and-release.md) is the canonical home for the hardened OpenWiki integration, release checks, and docs freshness rules, including isolated credential-file HOME handling, supported-provider validation, complete shipped-source fingerprinting, HTML presentation rendering into `openwiki-html/`, scriptless static-preview fragment restoration for the Entity Wiki source, the `scripts/entity-wiki-config-migrate.mjs` bootstrap path update, exact clean-checkout identity checks, cross-platform remote Node discovery, truthful detached gateway branch identity checks against exact origin branch refs, credential-free proxy handling, JSON-over-stdin release metadata dispatch through `scripts/entity-release-info-stdin.mjs`, and guaranteed cleanup of the isolated HOME even when `pnpm install` or OpenWiki fails. Entity refreshes OpenWiki before sandbox shipping on the trusted Enterprise runner, and GitHub Actions verifies that committed generated docs remain fresh against the pull request head rather than the merge commit, including fork-aware head checkouts on pull requests. The generated wiki’s HTML presentation path is also guarded by `CodeMirrorFileViewer` reloading the same iframe source once after a deep-linked page loads, which keeps fragment navigation responsive inside the scriptless preview without widening the sandbox or replacing React-owned DOM.

## How the system fits together

The React application uses state-driven tabs and hand-written history handling rather than a conventional router. It calls an Express/HTTP and WebSocket server, which composes core routes, SQLite repositories, file adapters, the editor subsystem, Task Master, plugins, and Swarm. Read [Runtime and data architecture](architecture/runtime-and-data.md) for the route families and persisted model.

[Execution and proof](platform/execution-and-proof.md) explains why Task Master automation, Swarm provider execution, Swarm proof, and canonical task receipts are separate concepts. [Configuration and plugins](platform/configuration-and-plugins.md) describes config precedence, Admin surfaces, model settings, plugin mounts, and Entity Services. [Mission Control](mission-control.md) now also covers task handoffs, including the local-only `/api/tasks/:id/handoff` flow, scoped rollback, the mode-aware handoff history UI, and the target-principal authorization rules enforced by `packages/server/src/routes/tasks.ts`, `packages/db/src/handoffs.ts`, and `packages/db/src/principals.ts`. [Security and release](operations/security-and-release.md) covers authentication, stored-principal admin authorization, partial object authorization, testing, the preview CSP split for scriptless Entity Wiki HTML and interactive exports, and the staged release contract. [Runtime and release](runtime-and-release.md) is also the canonical home for the OpenWiki generation, prepare, verify, and remote release metadata flow, including the `scripts/entity-release-info-stdin.mjs` wrapper that carries JSON metadata over stdin and the `openwiki-html/` presentation tree plus its `scripts/entity-wiki-config-migrate.mjs` bootstrap path update and file-index HTML extraction support.

## Desktop and mobile

- `npm run desktop` starts the canonical Electron shell in `electron/`. It probes the configured Entity server, can start the local server from a development checkout, retries connection, and renders the same web workspace. `packages/desktop` is a legacy forwarding wrapper, not the canonical implementation.
- `cd packages/mobile && npx expo start` starts the Expo WebView shell. A physical phone needs a reachable LAN URL. The wrapper performs connectivity setup; product behavior remains in the responsive web frontend rather than native domain code.
- Recent git history added standalone Electron and Expo shells and then concentrated on responsive task, Files, chat, activity, and Admin behavior. This supports source-level availability, not store distribution or production rollout.

Both shells depend on the [server runtime](architecture/runtime-and-data.md); neither is an independent offline implementation of Entity.

## Where to start when changing Entity

1. Identify the owning product concept above, then follow its linked page to frontend, server, data, flags, and tests.
2. Inspect executable source before plans or issue text. `packages/app/src/App.tsx` is the cross-surface shell; `packages/server/src/index.ts` is the composition root; `packages/db/src/index.ts` owns much of the shared schema.
3. Preserve route and data compatibility: several APIs have both `/api/*` and legacy unprefixed mirrors.
4. Add or update focused server Vitest coverage for server changes. Build and browser-check user-facing changes.
5. Treat deployment status separately from implementation status; use the [release evidence flow](operations/security-and-release.md#release-and-rollout-truth).
6. For documentation automation, follow the local `docs:wiki:init`, `docs:wiki:update`, `docs:wiki:prepare`, and `docs:wiki:verify` commands surfaced in [Runtime and release](runtime-and-release.md); `docs:wiki:prepare` now skips regeneration when the wiki fingerprint is already fresh, so sandbox shipping only regenerates docs when the tracked source set actually changed, and `deploy.sh` verifies the exact source checkout before syncing. The fingerprint logic now also treats tracked source nested under `build` and `dist` path segments as shipped input, matching the finalized source-fingerprint tests and keeping release-gate coverage aligned with generated-doc verification.

## Verification commands

```bash
npm --prefix packages/app run build
npm --prefix packages/server run build
npm --prefix packages/server run test
npm run ctrl:gate
npm run test:e2e
```

`npm test` and `npm run test:e2e` invoke the browser smoke harness; server unit coverage is the Vitest workspace script. Browser verification is required by repository guidance for user-facing routes and workflows when available.

## Backlog

- **Chat and ClickClack deep dive** — `packages/server/src/routes/chat.ts`, `packages/server/src/clickclack/`, and chat components; deferred to keep the initial wiki focused on the required work-management domains.
- **Terminal, notifications, and operational status** — `packages/server/src/terminal.ts`, `routes/notifications.ts`, and `routes/operational-status.ts`; implemented supporting surfaces merit a later operations page.
- **Security headers and HTML preview policy** — `packages/server/src/security.ts` and `packages/server/src/security.test.ts`; the server now distinguishes scriptless Entity Wiki previews from interactive HTML previews at the CSP layer, and the security page owns that boundary in more detail.
- **Document collaboration schema detail** — `packages/db/src/document-collab.ts`; the initial Files page covers behavior and boundaries, while a full collaboration ER model is deferred.
- **Crews, roadmaps, and subscriptions** — relevant repositories and routes in `packages/db/src/index.ts` and server route modules; secondary to the core task/agent workflow in this first pass.
- **Task handoff authorization and persistence** — `packages/server/src/routes/tasks.ts`, `packages/db/src/handoffs.ts`, and `packages/db/src/principals.ts`; now covered in [Mission Control](mission-control.md), which owns the user-facing task-handoff workflow, the mode-aware history UI, and the local-only rollback rules.
- **OpenWiki automation loop** — `scripts/entity-openwiki.mjs`, `scripts/entity-openwiki-lib.mjs`, `scripts/entity-openwiki-html.mjs`, `packages/app/scripts/entity-openwiki-html-lib.mjs`, `scripts/entity-wiki-config-migrate.mjs`, `.github/workflows/loop-docs-sweep.yml`, `.github/workflows/main.yml`, `scripts/entity-deploy-sandbox.sh`, and `scripts/entity-promote-prod.sh`; now documented on [Runtime and release](runtime-and-release.md), which owns the generation, prepare, verify, render, and migration flow plus the GitHub freshness boundary. The `prepare` path now checks generated-doc cleanliness first, skips generation when the wiki fingerprint is already fresh, and regenerates only when stale so timestamp churn does not block sandbox deploys. `docs:wiki:render` produces the HTML presentation tree in `openwiki-html/`, and `scripts/entity-wiki-config-migrate.mjs` updates the `entity-wiki` source bootstrap to that tree while preserving a backup when it rewrites config. The launcher now isolates its credential-file HOME, restricts provider credentials to the selected provider, validates the requested provider against the supported set, and translates local Codex OAuth tokens only when the `openai-chatgpt` provider is used. `scripts/entity-release-check.sh` remains the fail-closed dirty-worktree guard that keeps deploys tied to the exact checked-out source, and `deploy.sh` now adds explicit config, exact-checkout, fingerprint, database, backup, and restart gates before sync while writing release/runtime metadata remotely only after the docs gate passes. `/.github/workflows/main.yml` now checks out the PR head after the merge-tree test phase and before `docs:wiki:verify`, including fork-aware head checkouts so the docs gate validates the exact pull-request tip. The webhook deployer and gateway pull deployer also now pass exact release identity through `ENTITY_RELEASE_SHA` and `ENTITY_RELEASE_BRANCH`, with the webhook path fetching `origin/main` durably before checkout. `scripts/entity-release-info-stdin.mjs` is the JSON-over-stdin wrapper that keeps metadata arguments data and delegates to `scripts/entity-release-info.mjs`, and the remote Node binary resolved by `deploy.sh` is reused for both metadata generation and fallback service restart, keeping the same validated executable across release-info writes and restart handling. The release manifest writer now records branch, git SHA, artifact hashes, and dist hashes for the shipped build outputs, so the release page is the canonical home for the new release-identity shape and remote metadata write flow. The generated wiki HTML preview now rebuilds its Blob URL on route-hash changes and reloads the same iframe node once after a deep-linked load, which keeps fragment navigation responsive inside the scriptless preview without expanding the sandbox. The matching test coverage in `scripts/entity-openwiki-html.test.mjs` now checks that the preview policy, render pipeline, and same-node reload behavior stay wired together, so the OpenWiki docs now point readers at the exact runtime seam that changed. This entrypoint remains the best starting place for the docs loop because it links the operational page and the feature pages that changed.
- **Config-managed file source deletion guard** — `packages/server/src/fs/routes-sources.ts` and `packages/server/src/fs/routes-sources.test.ts`; now reflected in [Workspace and files](features/workspace-and-files.md) and the configuration page, but the route-level test details are deferred because the core behavior is already covered.
- **OpenWiki HTML presentation and config migration** — `scripts/entity-openwiki-html.mjs`, `packages/app/scripts/entity-openwiki-html-lib.mjs`, `scripts/entity-wiki-config-migrate.mjs`, and `packages/server/src/fs/index-runner.ts`; the presentation tree is now a first-class docs artifact, its config bootstrap path moved from `./openwiki` to `./openwiki-html`, and the file index now extracts human-readable titles and previews from generated HTML. This run documents the release/runtime implications and the file-source path migration, so the dedicated files page is deferred.
- **File indexing and HTML extraction** — `packages/server/src/fs/classify.ts` and `packages/server/src/fs/index-runner.ts`; the indexer now strips HTML tags and entities before it derives titles and text for source entries, which keeps rendered wiki pages searchable without storing markup as content.
- **Workspace source path migration** — `entity.config.example.yaml`, `scripts/entity-wiki-config-migrate.mjs`, and the file-source UI in [Admin and extensions](admin-and-extensions.md); the sample `entity-wiki` source now points at `./openwiki-html`, and the migration script rewrites older configs to match that presentation tree.
- **HTML-aware file indexing** — `packages/server/src/fs/classify.ts` and `packages/server/src/fs/index-runner.ts`; the file indexer decodes HTML entities, strips markup, and uses the resulting text for titles and previews, so generated wiki pages remain searchable after they move into the presentation tree.
