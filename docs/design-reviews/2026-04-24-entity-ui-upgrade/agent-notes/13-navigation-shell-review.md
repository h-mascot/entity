# Navigation Shell Review

## Screens Reviewed

- `actual/01-files.png`
- `actual/02-agents.png`
- `actual/03-tasks.png`
- `actual/04-services.png`
- `actual/05-chat.png`
- `actual/06-admin.png`
- `actual/07-docs-view.png`
- `actual/08-agent-detail.png`
- `actual/09-task-detail.png`

## What Works

- The primary top navigation is stable across Files, Agents, Tasks, Services, Chat, and Admin. The repeated Entity mark plus section pills gives the app a reliable global anchor.
- Active section styling is clear enough at a glance: the blue outline/fill treatment distinguishes the current first-level area without changing layout.
- The shell already supports operational density. Tasks, Files, Admin, and Services can expose many controls without losing the basic page frame.
- The left rail pattern is useful where the view has a persistent working set: Files sources, Tasks recent activity, Agents crew cards, Services shortcuts, and Admin settings all benefit from a secondary navigation surface.
- Detail overlays preserve task board context in `09-task-detail.png`, which is valuable for orientation when editing a task from Kanban.
- The bottom Terminal / Add to Dock strip is consistently placed in app views, so it can become a predictable utility zone if its behavior is formalized.

## Main Shell Problems

- Secondary navigation is inconsistent by view. Files uses a document status/context bar plus source rail; Tasks uses mode tabs and filters; Services uses a page subtitle and admin buttons; Admin uses both left settings nav and top-right tabs; Docs replaces the entire app shell with a different header.
- The top bar is visually quiet but under-informative. It shows location, but not workspace, current source, selected object, online state, or whether the user is in a document/detail context.
- Context bars compete with each other. Files has "No file selected" plus disabled editor controls; Agents has "Agents online" plus Crew plus Focus/Watch; Tasks has mode tabs, filters, recent activity, and counts; Admin has top tabs and left nav. These are all useful individually, but they do not follow one system.
- Left rails vary too much in purpose and density. Sometimes the rail is navigation, sometimes filters, sometimes recent activity, sometimes selected-object detail. That makes it hard to predict whether clicking a rail item changes scope, opens detail, filters the page, or performs an action.
- The bottom utility strip consumes persistent vertical space even when Terminal is collapsed and no dock action is relevant. In sparse views like Chat and Services it reads as chrome debt rather than useful infrastructure.
- Detail and document views break global navigation expectations. `07-docs-view.png` removes the Entity app nav entirely; `09-task-detail.png` dims the board but keeps the underlying shell visible. These should feel like deliberate view modes, not separate products.
- Icon use is uneven. The bolt mark, source icons, status dots, link icons, bell, blue status dot, plus, collapse chevron, and close buttons are recognizable in isolation, but there is no obvious icon grammar for nav, status, source, action, and utility.

## Recommendations

- Define a three-layer shell contract:
  - Global bar: Entity brand, first-level nav, global status/notifications/user controls.
  - Context bar: page-specific scope, mode, filters, and primary actions.
  - Work area: optional left rail, main content, optional detail drawer/modal, optional utility dock.
- Keep the global bar identical across every first-level app route and document/detail route. Docs should still show Entity Home/back controls, but it should not discard the global shell unless it is intentionally a full-screen reader mode.
- Give each route one clear context-bar pattern:
  - Files: selected source/file state, search, essential filters, file actions only after selection.
  - Agents: online count, crew scope, focus/watch controls.
  - Tasks: board mode tabs, counts, filters, create task.
  - Services: registry scope, view toggle, refresh/load state.
  - Admin: settings section tabs or left nav, not both competing at the same hierarchy.
- Standardize left rail ownership. Use the rail for persistent scope navigation only; put transient filters and view actions in the context bar. Recent Activity can remain in Tasks, but it should be labeled as an activity rail and behave consistently with selectable rows.
- Introduce consistent rail widths and collapse behavior. Files/Tasks/Agents/Services/Admin rails should share the same base width, same collapsed width, same collapse affordance, and same border treatment.
- Reduce always-visible disabled controls. In Files, disabled Editing / Interact Mode / Edit / Split / History / Share controls make the shell feel inactive. Hide or move unavailable document controls until a file is selected.
- Convert top-right status controls into a coherent cluster. Bell, blue dot, Focus, Watch, refresh, loading, and admin shortcuts should use consistent sizes, spacing, labels, and tooltip behavior.
- Promote icon grammar:
  - Navigation icons are optional but consistent if introduced.
  - Status dots should always mean state and use the same size/color rules.
  - Source icons should stay attached to source names.
  - Utility/action icons should have labels when space allows and accessible names when icon-only.
- Revisit the bottom utility strip. Make Terminal/Dock a collapsible utility drawer with meaningful open/closed states, and hide the Add to Dock action when the current route has nothing dockable.
- Treat task detail as a right-side inspector or full modal consistently. The current detail surface is useful, but the selected task title starts too close to the top and the dimmed board retains too much visual competition.
- Give loading and empty states the same shell posture as loaded states. Agents, Chat, and Services should not feel like different layout systems just because content is loading or empty.

## Density Guidance

- Preserve high information density for Tasks and Files, but make chrome density predictable. The current task board is dense in a productive way; the surrounding bars need clearer grouping and fewer same-weight controls.
- Use compact controls in context bars, not large cards. Services and Admin already show that page bodies can breathe; the shell should remain tight and operational.
- Keep card radius and border weight consistent across rails, cards, tabs, inputs, and drawers. The screenshots mix soft panels, pill tabs, hard table headers, and modal surfaces in ways that slightly weaken the system feel.
- Align top edges: left rail content, main content, context controls, and first cards should start from a shared vertical rhythm after the context bar.
- Ensure all shell text survives truncation. Recent Activity rows, task titles behind the modal, file paths, source names, and agent names should use predictable ellipsis and not shift control placement.

## Priority Fixes

1. Create a single shell spec for global bar, context bar, left rail, content, detail surface, and bottom utility drawer.
2. Normalize secondary navigation so Files, Agents, Tasks, Services, Admin, Docs, and detail views keep the same global chrome.
3. Decide left rail purpose per route and remove duplicate controls from rails/context bars.
4. Hide disabled document/action controls until they are actionable.
5. Unify icon/status treatment and sizing across nav, source, state, and utility controls.
6. Make Terminal/Add to Dock contextual instead of permanently dominant.

## Acceptance Checks

- First-level routes keep identical global nav placement, sizing, active state, and right-side status cluster.
- Every route has exactly one context bar pattern and no duplicate secondary nav at the same hierarchy.
- Left rail collapse/expand behavior is consistent across Files, Agents, Tasks, Services, and Admin.
- Docs and task detail views preserve clear return/navigation paths without looking like unrelated apps.
- Icon-only controls have accessible labels, visible focus states, and consistent hover/active treatment.
- Bottom utility drawer can be collapsed without leaving confusing empty chrome, and route-specific actions only appear when relevant.
