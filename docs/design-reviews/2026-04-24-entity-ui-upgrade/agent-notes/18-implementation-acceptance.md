# Implementation Acceptance Criteria

## Scope

These criteria are for a future Entity UI implementation pass based on the screenshot review artifacts in `docs/design-reviews/2026-04-24-entity-ui-upgrade/`.

Acceptance should prove that the redesign improves hierarchy, spacing, legibility, density, action grouping, icon clarity, and scan speed while preserving the current Entity workflows. Do not accept a change only because it resembles a generated concept image; accept it because it works in the live app and passes the checks below.

## Browser Visual Checks

- Capture the same nine canonical views used by this design pass: Files, Agents, Tasks, Services, Chat, Admin, Docs view, Agent detail, and Task detail.
- Compare live captures against the current screenshots and accepted design notes at desktop size `1440x1000`.
- Also check at least one compact desktop width around `1280px` and one mobile/narrow width around `390px`; the app does not need to become a mobile-first product, but controls must not overlap, clip, or become unreachable.
- The global shell must keep stable placement across all first-level routes: primary navigation, active route state, right-side status cluster, and route-level action area should not jump between views.
- Detail views must still feel like Entity, not separate standalone pages; they need a clear path back to the related object list.
- Empty, loading, error, and stale-data states must be visually distinct from normal content and must not collapse panel heights in a way that causes layout jumps.
- Icon-only buttons must have recognizable hover, active, disabled, and focused states. Icons should not become decorative noise; if an icon does not clarify the action, pair it with text or remove it.
- Dark theme contrast should be checked in real browser rendering, not just static PNGs. Low-contrast gray-on-gray metadata, timestamps, pills, and borders are likely failure points.
- Run the existing visual artifact validator for review evidence when evaluating screenshots:

```bash
node docs/design-reviews/2026-04-24-entity-ui-upgrade/visual-validate.cjs --include-generated
```

## Functional Non-Regression

- Navigation between Files, Agents, Tasks, Services, Chat, Admin, Docs view, Agent detail, and Task detail must continue to work without full-page dead ends.
- Existing object selection behavior must remain intact: selecting a file, agent, task, service, document, or detail object should update the expected panel without losing unrelated state.
- Current task and agent status signals must remain visible. A cleaner layout must not hide running, failed, blocked, stale, or completed states behind hover-only UI.
- Existing document/task output links must remain clickable and must open the same target as before the redesign.
- Filters, sorting, tabs, split panes, history panels, share actions, edit/view modes, and route-specific primary actions must keep their current behavior unless a product decision explicitly changes them.
- Chat input, send behavior, transcript scrollback, and tool/result rendering must keep working. Visual polish must not reduce the usable text area below the current practical capacity.
- Services and admin controls that affect runtime state must preserve confirmation, disabled, and pending states. High-impact actions should not become visually equivalent to passive navigation.
- Keyboard and pointer interactions must both work for route changes, list selection, drawer toggles, tab changes, and modal/dialog dismissal.
- No implementation should introduce calls to image generation or external design APIs as part of normal app runtime.

## Accessibility Checks

- Every interactive control has an accessible name. Icon-only buttons need `aria-label` or equivalent visible text.
- Focus order follows the visual reading order: shell navigation, route context controls, primary content, side/detail panels, then secondary utilities.
- Focus outlines must be visible against the dark UI and must not be clipped by overflow-hidden containers.
- Text contrast should meet WCAG AA for normal body text and operational metadata wherever feasible. Critical state text must not rely on color alone.
- Status indicators need text, labels, or accessible descriptions, not color-only dots.
- Form fields and chat inputs need clear labels or accessible names, visible focus, and error messaging tied to the relevant field.
- Buttons and list rows should have practical hit targets. Dense UI is acceptable; tiny, hard-to-target controls are not.
- Reduced-motion preferences should be respected for transitions, drawers, hover reveals, and activity indicators.
- The UI should remain usable at browser zoom levels up to `200%` without hiding primary navigation or critical actions.

## Density Checks

- The redesign should increase scan speed, not simply add larger cards. Repeated operational lists should remain dense enough to compare multiple objects without excessive scrolling.
- Preserve the operational command-surface posture: restrained, information-rich, and local-first. Avoid marketing-style hero sections, decorative cards, large empty bands, and oversized typography inside tool surfaces.
- Each view should have one clear hierarchy: route title/context, primary object list or workspace, selected object/detail panel, then utilities. Avoid multiple competing header bars.
- Cards should be used for repeated items or genuinely framed tools only. Do not nest cards inside cards.
- Metadata rows should be compact and aligned: source, owner, timestamp, status, and evidence links should be easy to scan across rows.
- Route-specific controls should be grouped near the content they affect. Global controls should not appear inside local panels unless they are explicitly scoped there.
- Empty space is acceptable when it separates functional regions; it is not acceptable when it reduces the number of visible tasks, agents, files, or services without improving comprehension.
- Long titles, file paths, task outputs, and generated names must truncate or wrap predictably without pushing controls offscreen.

## Release Gate

- Capture before/after screenshots for the nine canonical views and attach them to the implementation review.
- Run the app build for changed frontend code:

```bash
npm --prefix packages/app run build
```

- If any server code changes are included, follow the project server gate:

```bash
cd packages/server && npm run build && npx vitest run
```

- Manually smoke-test the major workflows in browser: route navigation, object selection, detail opening, docs link opening, chat send, filter/sort changes, drawer/panel toggles, and disabled/pending action states.
- Do not accept the pass if the implementation only improves one screenshot while making another route less consistent, less accessible, or less dense.
