# 06 Admin Review

## Source Observations

- Actual capture: `actual/06-admin.png`, 1440x1000, visually valid.
- Metadata: Admin view at `/`, headings only report `Login`, while visible UI is the Admin control center. This suggests the page title/semantic heading model is behind the visual state.
- Current Admin UI exposes top-level tabs for `General`, `Mission Control`, `Integrations`, `Plugins`, and `Openclaw`, plus a left settings menu with `Task Master` included. General currently combines login, session, theme, and file-source configuration.

## Recommendations

- Settings IA: keep the left settings list as the primary section switcher, but avoid duplicating it with the top tab row unless the two controls have distinct jobs. Prefer one clear section navigation model with selected state, brief subtitle, and a compact breadcrumb like `Admin / General`.
- Settings IA: split `General` into clearer zones: `Access`, `Appearance`, and `File Sources`. File sources are operational integrations, so they should either live under `Integrations` or be labeled as `Local file sources` inside General.
- Security/login affordances: `Require login` needs a stronger risk state. Show current enforcement, who is signed in, session age, and whether refresh is required before the setting takes effect.
- Security/login affordances: replace the ambiguous `Off` pill with an explicit toggle row: `Require login: Off`, `Applies after refresh`, and a primary `Apply / Refresh now` action. Session should show `No active session` with a disabled/secondary sign-out affordance rather than an empty card.
- Integrations: the configured source list is useful, but repeated `Disable / Test / Edit / Delete` actions create noise. Use status, path, last test result, and a compact action menu with `Test` as the visible primary action.
- Integrations: show source type and trust boundary more clearly. Local paths like `/Users/...` and `/home/...` should indicate host/context, especially because Entity spans Mac and gateway environments.
- Plugins: plugins need runtime state, version/source, enabled scope, and failure/audit affordances. Use the same status language as Services where possible so users do not have to relearn health semantics.
- Plugins: separate registry management from runtime toggles. A plugin can be installed, enabled, running, unhealthy, or blocked; the UI should not collapse those states into a single enabled/disabled badge.

## QA Notes

- Verify Admin has a real visible and semantic heading such as `Admin control center`, not only `Login` in captured metadata.
- Check that selected states are distinguishable for top nav, Admin tabs, left settings items, theme option, source status, and disabled source rows.
- Confirm all destructive actions (`Delete`, disabling security, disabling a source/plugin) require confirmation or clearly show the consequence before execution.
- Confirm keyboard focus order moves from shell nav to Admin section nav to content cards, and that repeated source row actions are reachable without trapping focus.
- Check mobile/narrow width behavior: Admin should collapse navigation predictably and keep security controls, source status, and primary actions readable without overlap.

## Acceptance Checks - Set 1: Polished Evolution

- Preserves the current shell and workflows: top app nav, Admin area, section navigation, login/session/theme controls, add source form, and configured source list are all still recognizable.
- Improves hierarchy without changing the mental model: `Access`, `Appearance`, and source management read as distinct groups; primary actions are visually stronger than repeated secondary actions.
- Security state is explicit: login requirement, session state, refresh requirement, and any disabled state are readable at a glance.
- Integrations and plugins use consistent operational status chips, include test/health affordances, and avoid repeated button clutter.
- Visual style stays dense, dark, restrained, and app-like: no marketing hero, no decorative background, no nested card stacks, no oversized display type.

## Acceptance Checks - Set 2: Alternate IA Direction

- Provides a stronger IA than the current capture: one clear Admin navigation system, a structured command/context bar, and sharper separation between overview, configuration, and audit/detail zones.
- Integrations and plugins are elevated from settings rows into operational management surfaces with registry/source metadata, runtime status, test results, and scoped actions.
- Security/login is treated as a first-class admin concern with visible enforcement state, current session details, and clear apply/refresh behavior.
- Keeps operational density: more structure should not become a landing page or sparse dashboard; all current workflows must remain reachable in the first viewport.
- Cross-view consistency holds with Files/Services conventions: source labels, plugin health, enabled/disabled states, and action menus should use shared language and visual treatment.
