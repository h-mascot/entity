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

Open `http://localhost:3000`. `npm run setup` creates local configuration, seeds the read-only Entity Wiki local file source at `./openwiki`, and normally prepares the optional ClickClack chat sidecar; use `npm run setup -- --skip-clickclack` when only the core workspace is needed. The Express server serves the built frontend, so rebuild `packages/app` after UI changes unless using the separate Vite development loop documented in `README.md`.

The default configuration is loopback-only and local-first. Do not expose it on a network without understanding the [security boundary](operations/security-and-release.md#network-and-authentication-boundary).

## What users can do

| Surface | Implemented capability | Important boundary |
|---|---|---|
| Files | Search and filter configured sources, browse trees, open tabs, read and edit source-backed files, and enter collaboration views | Multi-source home is controlled by `VITE_ENTITY_FS_MULTISOURCE`; cached reads can mask an unavailable source |
| Mission Control | Create, assign, move, filter, review, gate, comment on, and inspect tasks across Kanban, Insights, and Strategic views | A recorded handoff does not itself prove an agent runtime was dispatched |
| Agents | Inspect registry identity, focus, model/runtime metadata, work, health, metrics, and activity; invoke limited runtime controls when eligible | Registry failure degrades management details; safe controls require a bound Helm-managed runtime |
| Services | View plugin-supplied service families, health, latency, links, and degraded/offline states | The `entity-services` plugin and its compiled frontend mount must both be available |
| Chat | Use channel/thread UI and model-routing plumbing | ClickClack compatibility routing is optional and sidecar-dependent |
| Admin | Configure workspace behavior, file sources, Task Master, document credentials, plugins, TTS, integrations, agent registry, and presentation | Not every setting is hot-reloadable; bootstrap path changes require restart |

The [Files and documents](features/files-and-documents.md) experience connects source browsing to native document collaboration and task output links, and it now reflects the read-only local-source bootstrap path for the Entity Wiki source. [Mission Control](features/mission-control.md) owns execution planning, accountability, comments, reviews, gates, and handoff records. The [Agents and collaboration](features/agents-and-collaboration.md) surface joins registry data with health and activity rather than treating agents as transient chat sessions. [Runtime and release](runtime-and-release.md) is the canonical home for the hardened OpenWiki integration, release checks, and docs freshness rules, including the retry-setting passthrough and credential-free proxy handling added in the latest source update. Entity refreshes OpenWiki before sandbox shipping on the trusted Enterprise runner, and GitHub Actions verifies that committed generated docs remain fresh rather than regenerating them.

## How the system fits together

The React application uses state-driven tabs and hand-written history handling rather than a conventional router. It calls an Express/HTTP and WebSocket server, which composes core routes, SQLite repositories, file adapters, the editor subsystem, Task Master, plugins, and Swarm. Read [Runtime and data architecture](architecture/runtime-and-data.md) for the route families and persisted model.

[Execution and proof](platform/execution-and-proof.md) explains why Task Master automation, Swarm provider execution, Swarm proof, and canonical task receipts are separate concepts. [Configuration and plugins](platform/configuration-and-plugins.md) describes config precedence, Admin surfaces, model settings, plugin mounts, and Entity Services. [Security and release](operations/security-and-release.md) covers authentication, partial object authorization, testing, and the staged release contract.

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
6. For documentation automation, follow the local `docs:wiki:init`, `docs:wiki:update`, `docs:wiki:prepare`, and `docs:wiki:verify` commands surfaced in [Runtime and release](runtime-and-release.md); `docs:wiki:prepare` now skips regeneration when the wiki fingerprint is already fresh, so sandbox shipping only regenerates docs when the tracked source set actually changed, and `deploy.sh` verifies the exact source checkout before syncing.

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
- **Document collaboration schema detail** — `packages/db/src/document-collab.ts`; the initial Files page covers behavior and boundaries, while a full collaboration ER model is deferred.
- **Crews, roadmaps, and subscriptions** — relevant repositories and routes in `packages/db/src/index.ts` and server route modules; secondary to the core task/agent workflow in this first pass.
- **OpenWiki automation loop** — `scripts/entity-openwiki.mjs`, `scripts/entity-openwiki-lib.mjs`, `.github/workflows/loop-docs-sweep.yml`, `.github/workflows/main.yml`, `scripts/entity-deploy-sandbox.sh`, and `scripts/entity-promote-prod.sh`; now documented on [Runtime and release](runtime-and-release.md), which owns the generation, prepare, and verify flow plus the GitHub freshness boundary. The `prepare` path now checks generated-doc cleanliness first, skips generation when the wiki fingerprint is already fresh, and regenerates only when stale so timestamp churn does not block sandbox deploys. The launcher now also restricts provider credentials to the selected provider, with local Codex OAuth tokens translated only when the `openai-chatgpt` provider is used. `scripts/entity-release-check.sh` remains the fail-closed dirty-worktree guard that keeps deploys tied to the exact checked-out source, and `deploy.sh` now adds explicit config, fingerprint, database, backup, and restart gates before sync.
- **Config-managed file source deletion guard** — `packages/server/src/fs/routes-sources.ts` and `packages/server/src/fs/routes-sources.test.ts`; now reflected in [Files and documents](features/files-and-documents.md) and the configuration page, but the route-level test details are deferred because the core behavior is already covered.