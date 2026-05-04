# 02 Agents Review

Source reviewed:
- `actual/02-agents.png`
- `metadata/02-agents.json`
- `prompts/set-1-02-agents.txt`

## What The View Must Preserve

- Keep the existing Entity shell: dark operational console, top tab navigation, notification/status icons, bottom terminal bar, and install/dock affordance.
- Preserve the Agents tab mental model: a left crew/agent rail plus a larger right-side dashboard/workspace.
- Keep the top operational status row visible: `Agents online`, `Crew`, `Focus`, and `Watch` are important global state controls.
- Preserve loading states. The skeleton dashboard is useful, but it needs a clearer relationship to the agent list and final loaded content.
- Preserve agent identity and health concepts from the metadata/detail capture: agent name, online dot, owner/registry grants, capabilities, scope, runtime, current work, host/source, activity, queue, and output.
- Keep the first viewport usable and dense. This should remain an ops surface, not a hero/marketing page.

## What Should Be Clearer

- The current screenshot reads as two unrelated empty regions: `Loading agents...` in the rail and `Loading agent dashboard...` in the main area. Make it obvious whether they are loading independently or whether the dashboard depends on selecting/loading an agent.
- `Agents online: 0/0` plus an empty skeleton looks like a disconnected backend rather than a normal loading state. Add explicit state language such as loading, offline, no agents registered, or failed to connect.
- `Crew` is styled like a primary action but behaves like a mode/filter. It should read as a segmented control or scope selector.
- `Focus: none` and `Watch: Off` should be grouped as monitoring controls, not isolated pills floating at the far right.
- The left rail should advertise its purpose. Add a compact rail header such as `Crew agents`, with count and optional search/filter once data loads.
- The main dashboard skeleton should imply final structure: health summary, active work, recent output/activity, queue, and alerts. Current placeholder blocks do not communicate what will appear there.
- The collapse affordance `«` at the bottom of the rail is too low-signal. Use a standard sidebar collapse icon button with tooltip and preserve a predictable hit area.
- Metadata shows possible loaded content bleeding from files/docs filters into the Agents view. The redesigned view should avoid mixing file-library filters and document cards into the core Agents dashboard unless they are explicitly scoped as agent output.

## Controls: More, Fewer, Reorganized

- Reorganize the status row into three groups: fleet state (`Agents online`, health/error count), scope (`Crew` or selected team), and monitoring controls (`Focus`, `Watch`).
- Add a compact agent search/filter in the left rail only when agents are loaded. Keep it small: search, status filter, and maybe host/runtime filter are enough.
- Add one primary contextual action for the selected agent or fleet, such as `Start` or `Resume`, but do not duplicate `Start` controls across repeated cards without context.
- Reduce pill noise inside agent cards. Capabilities, scope, grants, and runtime should be scannable but grouped with labels and overflow, not a pile of equal-weight chips.
- Convert online/offline into consistent status badges with text plus color, not color-only dots.
- Keep terminal controls in the bottom bar, but ensure `Terminal` and `Show` read as one control group.
- Do not add decorative metrics, large hero text, or non-operational controls. Every new control should help monitor, focus, start/stop, inspect, or filter agents.

## Acceptance Checks - Set 1

- At 1536x1024 and 1440x1000, the Agents view keeps the top nav, status row, left agent rail, main dashboard, and bottom terminal bar visible without overlap.
- Loading state has explicit labels for both the agent rail and dashboard, and the user can tell whether data is loading, empty, offline, or failed.
- `Agents online`, `Crew`, `Focus`, and `Watch` remain present, but are grouped by function and no longer feel like unrelated floating pills.
- Agent cards, when populated, show name, status, owner/role, runtime/host, current work, and capabilities without clipped text or chip clutter.
- The main area presents recognizable dashboard sections for health, activity/output, queue, and recent work instead of generic skeleton blocks only.
- The design stays a restrained dark ops console: high contrast, compact density, no hero section, no decorative background effects, no nested cards.

## Acceptance Checks - Set 2

- Preserve the same workflows as Set 1 while allowing a stronger reorganization: fleet overview first, selected-agent detail second, activity/output third.
- The left rail remains a navigation surface, not a second dashboard. It should support scan/select/filter, while detailed diagnostics live in the main pane.
- Monitoring controls support clear states: focus target selected/unselected, watch on/off, online/offline/degraded agents, and empty/offline fleet state.
- Any added controls are justified by this view's job: monitor agent state, registry, activity, focus, health, queue, and work output.
- Loaded content from files/docs does not leak into the Agents view unless labeled as agent output and tied to a specific agent or fleet event.
- QA can compare empty/loading, loaded, and agent-detail states and confirm the same navigation and control placement across all three.
