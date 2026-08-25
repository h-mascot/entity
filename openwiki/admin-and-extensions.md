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
- `packages/app/src/components/document-integrations/ProviderSettings.tsx` and `packages/app/src/components/settings/DocsSettings.tsx` for document-provider settings and destination policy controls.
- `packages/server/src/routes/document-integrations.ts`, `packages/server/src/document-providers/*`, and `packages/db/src/document-integrations.ts` for provider-neutral document integration routing, adapter selection, and persistence.
- `packages/app/src/components/settings/FileSourcesSettings.tsx` and `packages/app/src/hooks/useFileSources.ts` for the Admin file-source form, source testing, sync actions, enable/disable toggles, and status feedback.
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

That bootstrap path now persists the chosen principal binding as `accessControl.apiPrincipalId`, and `packages/server/src/principals/admin-identity.ts` treats that persisted binding as server-trusted on later requests so the resolver fails closed instead of falling back to a different active principal. `packages/server/src/config/admin-settings-store.ts` supports a partial PATCH for that single field, and `packages/server/src/config/routes.ts` uses it so the users-and-roles flow can save the bootstrap binding without resending unrelated settings. `packages/app/src/components/settings/UsersAndRolesSettings.tsx` creates the first principal, persists the admin binding, grants `admin`, clears the admin runtime-settings cache, and then reloads the principal list. This is the canonical description of the first-admin bootstrap flow; the quickstart should only link here rather than repeat the details.

Admin settings themselves are now stored through a dedicated settings store and routed through the admin config endpoints, so save/reset behavior is persisted rather than purely derived from the UI session. `packages/app/src/components/settings/AdminSettingsForm.tsx` loads a section, edits the draft locally, and saves or resets through `/api/admin/settings/:section`; `packages/app/src/components/settings/UsersAndRolesSettings.tsx` manages the principals list, bootstrap admin creation, disable flow, and grant editing through `/api/admin/principals`. The same admin binding also matters for file-source access because `packages/app/src/hooks/useFileSources.ts` and the authenticated file-source routes rely on admin-request credentials when reading protected sources.

## File sources and docs settings

File source configuration is one of the most important Admin responsibilities because it determines what the Files / Doc Hub surface can browse.

`packages/db/src/file-sources.ts` stores source type, auth type, base path, base URL, health, enabled state, and sync metadata. `packages/app/src/components/settings/FileSourcesSettings.tsx` exposes the current Admin editing flow: operators can add a source, choose the source type, supply either a base path or base URL, attach an auth type plus secret reference, and set a manifest path for `http-markdown` sources. The same panel shows per-source health, sync timestamps, and the result of the `test` and `sync` actions, and `packages/app/src/hooks/useFileSources.ts` backs those actions with `/api/sources` and `/api/fs/sources` fallbacks.

`packages/server/src/fs/adapters/registry.ts` is the fail-closed adapter switch. Local, Docsify, and HTTP-markdown sources use real adapters; `github`, `s3`, and `custom` still route through placeholder adapters that save configuration but reject validation and operational calls with a not-implemented error, so the Admin UI cannot report a fake healthy connection for an unsupported source type. That boundary is asserted in `packages/server/src/fs/routes-sources.test.ts`, which checks that placeholder source tests persist `health: error` after a failed connectivity check.

`packages/server/src/config/effective.ts` reconstructs persisted file-source capabilities into the effective config so Admin consumers report the Entity Wiki local source as read-only consistently. `packages/server/src/fs/adapters/http-markdown.ts` adds a remote read-only source kind that can read text or, through `readRaw`, return binary payload metadata without allowing writes. `packages/server/src/fs/routes-sources.ts` also blocks deletion of config-managed local sources and keeps the trusted `entity.config.yaml` read-only marker on updates, preventing an API delete/recreate sequence from weakening that policy or swapping the configured source type to something like `http-markdown`. New local source registrations inherit read-only policy when their root overlaps any protected read-only local root, so the Admin file-source UI cannot use same-root, parent, or child aliases to bypass the trusted wiki source boundary. The latest config bootstrap now points the `entity-wiki` source at `basePath: ./openwiki-html`, and `scripts/entity-wiki-config-migrate.mjs` exists to migrate older configs to that presentation path while preserving a backup. `scripts/entity-openwiki-html.mjs` and `packages/app/scripts/entity-openwiki-html-lib.mjs` render the presentation tree, while `packages/server/src/fs/classify.ts` and `packages/server/src/fs/index-runner.ts` strip HTML wrappers, decode entities, and derive previews for indexing so generated pages remain searchable without storing markup as document content. The new `packages/app/src/lib/htmlPreviewPolicy.ts` keeps `entity-wiki` in a static, scriptless HTML sandbox and leaves other HTML sources on the interactive sandbox, and the file-viewer, document editor, and mobile shell consume that policy so the Admin file-source choice directly changes how generated wiki pages are previewed. That policy relies on the server-level CSP in `packages/server/src/security.ts`, which keeps static Entity Wiki previews scriptless while still allowing fragment navigation through blob-backed iframe URLs. `entity.config.example.yaml` still shows the default local file sources and how they are bound to the assistant agent. That path also matters to [Files and documents](features/files-and-docs.md) because the user-facing file browser reads the same configured sources and honors the same read-only and preview boundaries. This page also owns the operator-facing service refresh boundary: `packages/app/src/components/entityServicesRefresh.ts` polls without forcing repeated refreshes, `packages/app/src/components/entityServicesState.ts` maps the backend into discovery status labels, and the registry routes accept `refresh=1` or `refresh=true` while serving usable stale data as `state: 'refreshing'` with `partial: true` during revalidation. Recent source changes also hardened the first-admin bootstrap path: `accessControl.apiPrincipalId` is now saved as the server-trusted bootstrap binding, `packages/server/src/principals/admin-identity.ts` resolves that binding on later requests, and `packages/server/src/config/admin-settings-store.ts` plus `packages/server/src/config/routes.ts` let the UI persist that single field without resending the rest of the settings payload. The `Users & roles` flow in `packages/app/src/components/settings/UsersAndRolesSettings.tsx` now creates the first principal, persists the binding, grants `admin`, clears the admin runtime-settings cache, and reloads the principal list, so the bootstrap state described above is no longer UI-only. The same admin/source boundary now also matters to [Runtime and release](runtime-and-release.md), because `scripts/entity-wiki-config-migrate.mjs` is the release-time bootstrap migration that keeps `entity-wiki` pointed at `./openwiki-html` and aligned with the generated HTML presentation tree. Finally, `packages/server/src/fs/routes-sources.ts` now blocks delete/recreate and same-root alias tricks against config-managed read-only local roots, which is why the Admin file-source controls and the trusted `entity-wiki` source are documented together here instead of as separate concerns.
Docs settings are separate because document serving and TTS behavior are handled through their own controls and server routes. That split keeps browsing, document access, and audio playback from collapsing into one configuration bucket.

## Plugin and service extension points

Entity supports plugin slots in the UI, and the Admin view hosts a plugin admin panel. This is how the app can render extension-owned subviews or top-level surfaces without hardcoding every integration into the main shell.

Services are another extension seam. The source includes a services page and an `EntityServicesBoard`, but only the board is registered as the active plugin component. Config in `entity.config.example.yaml` shows an `entity-services` plugin block with discovery flags and service lists. The board surfaces a fast internal snapshot while host discovery finishes, and the helper in `packages/app/src/components/entityServicesRefresh.ts` polls without forcing repeated refreshes once discovery is already underway. `packages/app/src/components/entityServicesState.ts` maps that backend state into Discovery in progress, Discovery failed, or Discovery complete labels so operators can tell partial discovery from a finished registry refresh. The registry routes now accept `refresh=1` or `refresh=true` on the `/`, `/status`, and `/registry` handlers, rate-limit sequential forced refreshes to one per registry TTL, and preserve usable stale data as `state: 'refreshing'` with `partial: true` while revalidation continues rather than replacing the view with a blank skeleton. That same service surface is now documented as the active operator view in [Configuration, Admin, Plugins, and Services](platform/configuration-and-plugins.md), including the fact that the registry can return a bounded stale snapshot while a fresh discovery pass is still running.

## Chat management and operational controls

The Admin surface also owns several org-scoped chat management routes that now fail closed on ownership and mapping mismatches before any mutation is applied. `packages/server/src/routes/chat-noise-controls.ts` requires an admin principal and validates the channel through the authoritative channel scope before it will list cooldowns and mutes, dry-run an evaluation, create a channel-agent cooldown, or clear one. The latest hardening applies the same agent-mapping and org/team validation to cooldown deletion that creation already used, so an organization cannot clear a cooldown for an agent imported by another organization or outside the channel's team. The current Admin shell now also exposes a dedicated communication-controls surface through `packages/app/src/components/settings/CommunicationControlsSettings.tsx`, which loads organization, team, channel, category, agent-mapping, history-scope, cooldown, mute, and audit data together so operators can grant or revoke chat-history access, set per-channel cooldowns, mute channels or categories, and run a dry-run suppression evaluation from one place. That UI depends on the history and noise-control routes above, so the route-level validation and the admin panel are the same policy boundary rather than separate features. `packages/app/src/views/AdminView.tsx` lazy-loads that panel alongside `CuracelOperationsCenter`, and the curated operations route keeps org/team existence checks, review-policy gates, and raw-secret rejection at the server boundary before any operations record is written. `packages/app/src/lib/workspaceNavigation.ts` now groups the workspace tabs into Workspace, Work, Team, and Admin buckets, with Files and Chat sharing one group, Tasks and Services another, and Agents their own group before the Admin tab. That route family belongs with the rest of the admin controls because it is about operator policy, not user chat.

`packages/server/src/routes/chat-history-access.ts` uses the same admin-principal guard to manage channel history scopes and grants. The important change is that the channel's own org/team ownership is authoritative before a scope can be written: cross-org channels are forbidden, team-scoped channels must match the requested team exactly, and legacy unowned channels remain adoptable only when the existing scope check allows it. Grant assignment also checks that an imported agent belongs to the same org and, for team-scoped channels, that the agent is mapped to that team.

`packages/server/src/routes/agent-import.ts` now resolves referenced channels through the org-scoped lookup rather than a global channel lookup. That keeps imports from resolving a channel that belongs to another org or from silently discovering an unowned legacy channel. It also preserves the team boundary: if an imported agent references a team-scoped channel, the import must include that team in its own team set. The route’s tests in `packages/server/src/routes/agent-import.test.ts` cover the org-scoped lookup path, the `agent-import-options` shape, and the rejection cases for cross-org or wrong-team channel references, so this boundary belongs with the other admin-managed chat controls.

`packages/server/src/routes/curacel-operations.ts` is another admin-only management surface. It fronts the Curacel operations repository, but every mutation and execution-sample write now first proves the organization exists in the authoritative workspace repository and that any supplied team belongs to that org. The route family covers review policies, connector configuration, connector drafts, team dashboards, and execution samples, while rejecting raw secrets in request bodies and keeping review gates enforced at the server boundary.

## Agent registry and Task Master settings

The Admin area is not just for infrastructure. It also controls human-facing workspace behavior such as agent registry settings and Task Master-related preferences. That is important because the task board, agent dashboard, and automation surfaces are all coupled through shared configuration.

## Change notes for future agents

When changing Admin or extensions, read the config example, the Admin view, and the relevant server registries together. If a setting affects file browsing, task behavior, or model selection, document the source of truth and the fallback path.

Good checkpoints are:

1. `entity.config.example.yaml` for the baseline config shape.
2. `packages/app/src/views/AdminView.tsx` for surfaced settings.
3. `packages/app/src/components/plugins/*` and `packages/app/src/components/settings/*` for specific controls.
4. `packages/server/src/routes/runtime.ts` and registry routes for backend-backed choices.
