# Entity Admin Module Visibility and Navigation Plan

Date: 2026-08-07
Branch: `feat/admin-module-navigation-20260807`
Base: `origin/main` at `91d54e4cc92f6f7bf809c8c13c516c58ab6c481f`
Sandbox target: `http://sandbox.entity`
Production: no promotion without Henry's explicit approval

## Goal

Let administrators hide optional workspace modules from Entity's UI, make user access management obvious, remove the OpenClaw Admin destination, and replace flat navigation with grouped primary destinations plus contextual tabs.

## Product contract

### Top navigation

- `Workspace`: Files, Chat
- `Work`: Tasks, Services
- `Team`: Agents
- `Admin`: administration
- The active group is visible in the primary row; enabled modules in that group are shown as contextual tabs.
- Admin is always present and cannot be disabled.

### Module visibility

Persist `admin.navigation` with booleans for:
- Files
- Tasks
- Agents
- Services
- Chat
- Terminal

Defaults are visible for backward compatibility. Hiding a module removes its navigation/tab and prevents the Terminal panel from mounting. If the current module becomes hidden, the UI moves to the first visible workspace module, falling back to Admin. Visibility is presentation only; authorization remains under Users & Access.

### Admin information architecture

- Workspace: General, Profile, Modules
- People: Users & Access, Agents
- Work: Tasks, Workplanes, Engineering, Strategic Roadmap, Business Onboarding
- Content: Docs, Search, Channels, Voice
- System: Integrations, Plugins, Task Master

The OpenClaw embedded Admin destination is removed. OpenClaw connection status may remain within Integrations.

## Acceptance criteria

- [ ] Admin → Modules loads persisted visibility settings.
- [ ] Turning off Chat, saving, and reloading removes Chat from navigation.
- [ ] Turning off Terminal removes the bottom Terminal panel/handle.
- [ ] Re-enabling modules restores them after save/reload.
- [ ] Admin remains accessible regardless of settings.
- [ ] A hidden active module safely redirects to the first enabled module or Admin.
- [ ] Users & Access is an explicit Admin destination and renders principal/grant management.
- [ ] OpenClaw is absent from every Admin menu, collapsed rail, and contextual tab.
- [ ] Top navigation uses four grouped destinations with contextual tabs for enabled child modules.
- [ ] Desktop and mobile/tablet navigation remain usable.
- [ ] Focused tests, app build, server tests, `ctrl:gate`, review, sandbox deployment, and browser QA pass.

## Execution

- [ ] RED: add server schema/default/route tests for `admin.navigation` and app navigation-model tests.
- [ ] GREEN: add settings schema/API and pure navigation model.
- [ ] Add Modules Admin UI and App state hydration/update behavior.
- [ ] Replace flat top navigation and Admin list with grouped navigation.
- [ ] Remove OpenClaw Admin section and dead iframe state/props.
- [ ] Run focused tests and builds.
- [ ] Run review and full gate.
- [ ] Commit, push, PR, merge after CI, deploy current merged SHA to sandbox.
- [ ] Verify actual sandbox release identity and browser interactions.

## Files touched

To be updated during implementation.

## Resume

Start from the first unchecked execution item. Preserve the dirty canonical checkout; use only `/Users/enterprise/Code/entity-admin-module-navigation-20260807`.
