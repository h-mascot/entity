---
type: Configuration Surface
title: Admin and extensions
description: Admin-controlled workspace configuration for Entity. Covers file sources, effective config, agent registry settings, Task Master settings, voice, docs settings, plugin slots, and extension boards.
tags: [entity, admin, plugins, services, configuration, voice, docs]
---

# Admin and extensions

The Admin surface is where Entity exposes behavior that operators can tune without editing application code. It combines local configuration views with plugin and service extension points.

The main source seams are:

- `packages/app/src/views/AdminView.tsx` for the top-level Admin navigation.
- `packages/app/src/components/settings/*` for file sources, effective config, docs, voice, and agent registry settings.
- `packages/app/src/components/plugins/*` for plugin admin and slot rendering.
- `packages/app/src/components/EntityServicesBoard.tsx` and `packages/app/src/components/plugins/services/ServicesPage.tsx` for services.
- `packages/server/src/routes/worktype-registry.ts`, `packages/server/src/routes/chat-model-registry.ts`, and `packages/server/src/routes/runtime.ts` for backend registries and runtime configuration.
- `entity.config.example.yaml` for the default local configuration shape.
- `packages/server/src/routes/legacy-files.ts` for legacy workspace mutation guards that now reject writes, creates, deletes, and moves into nested read-only local sources while still serving reads.

## What operators can configure

- Login requirement and theme-related workspace behavior.
- User profile defaults.
- Task archive visibility and Task Master settings.
- File sources and their authentication mode.
- Docs access and docs TTS settings.
- Agent registry data.
- Plugin surfaces and service integrations.
- Voice provider settings.
- The effective config that the app is actually using.
- Principals, scoped grants, and bootstrap admin access.

## Users, roles, and bootstrap access

The Admin surface now includes a **Users & roles** section labeled **Principals and scoped grants**. It lets operators list principals, create a principal, disable a principal, and add or revoke grants from that principal. The UI exposes the principal types `human`, `agent`, and `service_account`, plus the grant roles `viewer`, `contributor`, `manager`, and `admin`.

The recent server changes make that section behave like a true control plane instead of a loose settings panel. `packages/server/src/routes/principals.ts` now exposes principal CRUD plus grant CRUD under `/api/admin`, and the server serializes grant sensitivity categories back to the UI so scoped access can be inspected consistently. `packages/server/src/principals/admin-identity.ts` resolves the trusted admin identity from stored access-control settings, `ENTITY_API_PRINCIPAL_ID`, a direct request header when the store is empty, or the local fallback principal. `packages/server/src/middleware/admin-auth.ts` then enforces the resulting trust boundary: the first principal may bootstrap itself, the last global admin cannot be disabled, disabled principals are rejected, and non-local callers need API auth and an active global admin grant.

There is still a deliberate local compatibility path for legacy setups. On localhost, when API auth is off and compatibility is enabled, header-based access such as `x-entity-role: admin` can still open admin functionality. That path is intentionally retained for local and migration use, but it is not the primary authorization model.

Admin settings themselves are stored through a dedicated settings store and routed through the admin config endpoints, so save/reset behavior is persisted rather than purely derived from the UI session. The React Admin shell now also loads runtime admin settings from `/api/runtime/admin-settings`, which is how it picks up onboarding and access-control flags without hardcoding them into the view.

### Business onboarding

The Admin view now has a dedicated **Business onboarding** section backed by `packages/app/src/components/BusinessOnboardingFlow.tsx` and `packages/server/src/routes/business-onboarding.ts`. That flow walks through workspace fork, org identity, domain selection, mission drafting, blueprint generation, and agent assignment.

The router persists the onboarding blueprint and related dry-run receipts through the settings store, and it depends on injected task and workspace repositories rather than a loose global default. The UI mirrors that contract by loading `/api/runtime/admin-settings` first, then calling `/onboarding/business/catalog`, `/onboarding/business/start`, `/onboarding/business/provision`, and `/onboarding/business/confirm` through the runtime API base.

The flow is intentionally domain-oriented: the built-in catalog includes claims, engineering/devops, product, sales/BD, marketing, finance, customer success, people ops, health business, AI ops, and other. Some domains have named agent mappings such as Atlas, Mafa, Kashy, and Sabi, which means the onboarding blueprint can pre-associate work with existing agent identities when the registry matches.

If you change the onboarding flow, check the runtime settings loader, the business onboarding router, and the Admin view together so the UI, config, and persistence stay aligned.

## File sources and docs settings

File source configuration is one of the most important Admin responsibilities because it determines what the Files / Doc Hub surface can browse.

`packages/db/src/file-sources.ts` stores source type, auth type, base path, base URL, health, enabled state, and sync metadata. `packages/server/src/config/effective.ts` reconstructs persisted file-source capabilities into the effective config so Admin consumers report the Entity Wiki local source as read-only consistently. `packages/server/src/fs/adapters/http-markdown.ts` adds a remote read-only source kind that can read text or, through `readRaw`, return binary payload metadata without allowing writes. `packages/server/src/fs/routes-sources.ts` also blocks deletion of config-managed local sources and keeps the trusted `entity.config.yaml` read-only marker on updates, preventing an API delete/recreate sequence from weakening that policy or swapping the configured source type to something like `http-markdown`. New local source registrations inherit read-only policy when their root overlaps any protected read-only local root, so the Admin file-source UI cannot use same-root, parent, or child aliases to bypass the trusted wiki source boundary. `entity.config.example.yaml` shows the default local file sources and how they are bound to the assistant agent.

Docs settings are separate because document serving and TTS behavior are handled through their own controls and server routes. That split keeps browsing, document access, and audio playback from collapsing into one configuration bucket.

## Plugin and service extension points

Entity supports plugin slots in the UI, and the Admin view hosts a plugin admin panel. This is how the app can render extension-owned subviews or top-level surfaces without hardcoding every integration into the main shell.

Services are another extension seam. The source includes a services page and an entity-services board, plus config in `entity.config.example.yaml` showing an `entity-services` plugin block with discovery flags and service lists.

## Agent registry and Task Master settings

The Admin area is not just for infrastructure. It also controls human-facing workspace behavior such as agent registry settings and Task Master-related preferences. That is important because the task board, agent dashboard, and automation surfaces are all coupled through shared configuration.

## Change notes for future agents

When changing Admin or extensions, read the config example, the Admin view, and the relevant server registries together. If a setting affects file browsing, task behavior, or model selection, document the source of truth and the fallback path.

Good checkpoints are:

1. `entity.config.example.yaml` for the baseline config shape.
2. `packages/app/src/views/AdminView.tsx` for surfaced settings.
3. `packages/app/src/components/plugins/*` and `packages/app/src/components/settings/*` for specific controls.
4. `packages/server/src/routes/runtime.ts` and registry routes for backend-backed choices.
