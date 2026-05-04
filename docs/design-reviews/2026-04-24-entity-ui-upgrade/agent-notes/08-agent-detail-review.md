# 08 Agent Detail Review

Artifacts reviewed:
- `actual/08-agent-detail.png`
- `metadata/08-agent-detail.json`

## Current Findings

The current Agent Detail state is not yet a usable single-agent workspace. The left rail shows the crew list with useful identity, owner, grants, capabilities, runtime, status dot, and active work, but the main pane only renders "Loading agent dashboard..." plus skeleton cards. A reviewer cannot validate health, output, activity, queue, or status behavior from the detail area.

## Recommendations

- Make the selected agent the dominant focus. The detail header should show agent name, avatar, owner, runtime/host, online/offline status, watch/focus state, and current assignment without requiring the user to parse the crew rail.
- Keep the crew rail for fast switching, but reduce per-card diagnostic density once an agent is selected. Detailed grants, caps, runtime, and active work should be repeated or expanded in the main pane.
- Add first-class tabs for `Health`, `Output`, and `Activity`. The current skeleton stack should become purposeful panels, not generic placeholders.
- Health should summarize status, runtime, host, last heartbeat, active task, recent errors, permissions/capability grants, and any degraded/offline reason.
- Output should show the latest agent artifacts, task outputs, docs/files links, logs, and empty/error states. It needs timestamps and source task references so output is auditable.
- Activity should show a chronological feed of task starts/completions, comments, tool actions, handoffs, failures, and recovery events. Use compact rows with severity/status markers.
- Add a queue section or tab-adjacent panel for assigned, running, blocked, and completed work. Queue items should expose task title, priority, age, owner/requester, and next action.
- Status controls should be explicit and stable: focus/watch toggles, pause/resume or handoff where supported, and a clear distinction between global crew status and selected-agent status.

## QA Notes

- Validate the loaded state, not only the skeleton state. The current actual screenshot is a loading fallback, so generated designs must prove the detail view works with real agent data.
- Check that the active agent remains identifiable when scrolling the crew list and when switching tabs in the detail pane.
- Verify tab state persistence: switching between Health, Output, and Activity should not lose selected agent, queue filters, or watch/focus state.
- Confirm queue rows and output links handle long task names such as "Entity DB Split -- Per-Domain..." without clipping critical actions.
- Test empty, degraded, offline, and active-working states. The UI should not collapse to unknown/unknown as the primary status when richer runtime metadata is available.
- Ensure bottom Terminal/Add to Dock chrome does not cover detail actions or queue controls at the 1440x1000 capture size.

## Acceptance Checks - Set 1

- `set-1/08-agent-detail.png` exists, renders nonblank, and is visually comparable against `actual/08-agent-detail.png`.
- The selected agent is the clear subject of the main pane, with name, status, runtime/host, owner, capabilities, and current work visible without depending on the rail.
- Health, Output, and Activity tabs are present and have distinct selected/unselected states.
- Queue information is visible for the selected agent, including at least active and pending/blocked work states.
- Status, focus, and watch controls are visible and clearly scoped to either the selected agent or the whole crew.
- Long names, task titles, output links, and activity rows fit without overlapping the rail, header, or bottom terminal chrome.

## Acceptance Checks - Set 2

- `set-2/08-agent-detail.png` exists, renders nonblank, and covers the same single-agent workflows as Set 1.
- The redesign may reorganize the page, but it must preserve single-agent focus, Health/Output/Activity navigation, queue visibility, and status controls.
- Health includes enough operational signals for triage: heartbeat/freshness, runtime/host, active task, degraded/offline state, and recent error or warning count.
- Output is auditable back to tasks/docs/files, with timestamps and clear empty/error/loading states.
- Activity is scannable as a timeline and separates routine events from failures, handoffs, and operator actions.
- The crew rail remains useful for switching agents without competing with the selected-agent detail surface.
