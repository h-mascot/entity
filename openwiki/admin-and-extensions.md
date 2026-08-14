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

## Users and roles

The Admin surface now includes a **Users & roles** section labeled **Principals and scoped grants**. It lets operators list principals, create a principal, disable a principal, and add or revoke grants from that principal. The UI exposes the principal types `human`, `agent`, and `service_account`, plus the grant roles `viewer`, `contributor`, `manager`, and `admin`.

The first principal is special: when the store is empty, bootstrap access is allowed and creating that first principal auto-attaches an `admin` grant so the workspace can be initialized. After that bootstrap window closes, admin routes require a stored principal with an active admin grant. Disabled principals are rejected, and non-admin principals cannot reach the admin API. The backend guard in `packages/server/src/middleware/admin-auth.ts` resolves stored principals, requires an active admin grant, and only allows the localhost header compatibility fallback when API auth is off and the admin settings keep compatibility enabled.

That bootstrap path now persists the chosen principal binding as `accessControl.apiPrincipalId`, and `packages/server/src/principals/admin-identity.ts` treats that persisted binding as server-trusted on later requests so the resolver fails closed instead of falling back to a different active principal. `packages/server/src/config/admin-settings-store.ts` supports a partial PATCH for that single field, and `packages/server/src/config/routes.ts` uses it so the users-and-roles flow can save the bootstrap binding without resending unrelated settings. `packages/app/src/components/settings/UsersAndRolesSettings.tsx` creates the first principal, persists the admin binding, grants `admin`, clears the admin runtime-settings cache, and then reloads the principal list.

Admin settings themselves are now stored through a dedicated settings store and routed through the admin config endpoints, so save/reset behavior is persisted rather than purely derived from the UI session. `packages/app/src/components/settings/AdminSettingsForm.tsx` loads a section, edits the draft locally, and saves or resets through `/api/admin/settings/:section`; `packages/app/src/components/settings/UsersAndRolesSettings.tsx` manages the principals list, bootstrap admin creation, disable flow, and grant editing through `/api/admin/principals`. The same admin binding also matters for file-source access because `packages/app/src/hooks/useFileSources.ts` and the authenticated file-source routes rely on admin-request credentials when reading protected sources.

## File sources and docs settings

File source configuration is one of the most important Admin responsibilities because it determines what the Files / Doc Hub surface can browse.

`packages/db/src/file-sources.ts` stores source type, auth type, base path, base URL, health, enabled state, and sync metadata. `packages/server/src/config/effective.ts` reconstructs persisted file-source capabilities into the effective config so Admin consumers report the Entity Wiki local source as read-only consistently. `packages/server/src/fs/adapters/http-markdown.ts` adds a remote read-only source kind that can read text or, through `readRaw`, return binary payload metadata without allowing writes. `packages/server/src/fs/routes-sources.ts` also blocks deletion of config-managed local sources and keeps the trusted `entity.config.yaml` read-only marker on updates, preventing an API delete/recreate sequence from weakening that policy or swapping the configured source type to something like `http-markdown`. New local source registrations inherit read-only policy when their root overlaps any protected read-only local root, so the Admin file-source UI cannot use same-root, parent, or child aliases to bypass the trusted wiki source boundary. The latest config bootstrap now points the `entity-wiki` source at `basePath: ./openwiki-html`, and `scripts/entity-wiki-config-migrate.mjs` exists to migrate older configs to that presentation path while preserving a backup. `scripts/entity-openwiki-html.mjs` and `packages/app/scripts/entity-openwiki-html-lib.mjs` render the presentation tree, while `packages/server/src/fs/classify.ts` and `packages/server/src/fs/index-runner.ts` strip HTML wrappers, decode entities, and derive previews for indexing so generated pages remain searchable without storing markup as document content. The new `packages/app/src/lib/htmlPreviewPolicy.ts` keeps `entity-wiki` in a static, scriptless HTML sandbox and leaves other HTML sources on the interactive sandbox, and the file-viewer, document editor, and mobile shell consume that policy so the Admin file-source choice directly changes how generated wiki pages are previewed. That policy relies on the server-level CSP in `packages/server/src/security.ts`, which keeps static Entity Wiki previews scriptless while still allowing fragment navigation through blob-backed iframe URLs. `entity.config.example.yaml` still shows the default local file sources and how they are bound to the assistant agent. That path also matters to Files / Doc Hub because the user-facing [Workspace and files](features/workspace-and-files.md) experience reads the same configured sources and honors the same read-only boundaries.

Docs settings are separate because document serving and TTS behavior are handled through their own controls and server routes. That split keeps browsing, document access, and audio playback from collapsing into one configuration bucket.

## Plugin and service extension points

Entity supports plugin slots in the UI, and the Admin view hosts a plugin admin panel. This is how the app can render extension-owned subviews or top-level surfaces without hardcoding every integration into the main shell.

Services are another extension seam. The source includes a services page and an `EntityServicesBoard`, but only the board is registered as the active plugin component. Config in `entity.config.example.yaml` shows an `entity-services` plugin block with discovery flags and service lists. The board surfaces a fast internal snapshot while host discovery finishes, and the helper in `packages/app/src/components/entityServicesRefresh.ts` polls without forcing repeated refreshes once discovery is already underway. `packages/app/src/components/entityServicesState.ts` maps that backend state into Discovery in progress, Discovery failed, or Discovery complete labels so operators can tell partial discovery from a finished registry refresh. That same service surface is now documented as the active operator view in [Configuration, Admin, Plugins, and Services](platform/configuration-and-plugins.md), including the fact that the registry can return a bounded stale snapshot while a fresh discovery pass is still running.

## Agent registry and Task Master settings

The Admin area is not just for infrastructure. It also controls human-facing workspace behavior such as agent registry settings and Task Master-related preferences. That is important because the task board, agent dashboard, and automation surfaces are all coupled through shared configuration.

## Change notes for future agents

When changing Admin or extensions, read the config example, the Admin view, and the relevant server registries together. If a setting affects file browsing, task behavior, or model selection, document the source of truth and the fallback path.

Good checkpoints are:

1. `entity.config.example.yaml` for the baseline config shape.
2. `packages/app/src/views/AdminView.tsx` for surfaced settings.
3. `packages/app/src/components/plugins/*` and `packages/app/src/components/settings/*` for specific controls.
4. `packages/server/src/routes/runtime.ts` and registry routes for backend-backed choices.
