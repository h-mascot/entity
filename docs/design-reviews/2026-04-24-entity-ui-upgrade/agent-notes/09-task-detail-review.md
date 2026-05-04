# 09 Task Detail Review

Artifacts reviewed:
- `actual/09-task-detail.png`
- `metadata/09-task-detail.json`
- `metadata/visual-validation-all.json`

## Source Observations

- Actual capture is visually valid at 1440x1000 and opens `/task/462`.
- Task state is visible but scattered: Task #462, title `test ripple task`, assignee Ada, priority P2, column Backlog, model Default, estimate blank, time spent 0, blocked unchecked, due date blank, created/updated Apr 11 2026.
- The selected title text is highlighted in blue in the capture, which makes the header look accidental and weakens the first read of the task.
- The detail panel preserves core edit fields, but it reads as one long form rather than an execution view. High-frequency state fields, evidence, and next action need stronger grouping.
- Output is present as an empty state plus an input row, but output/docs links are not distinguishable. There is no visible docs-link treatment, link preview, normalized path display, or open/copy affordance.
- Recent activity is only visible behind the detail overlay in the left rail. The detail view itself does not show task-local logs, activity, or comments, so auditability depends on background context.
- Edit actions exist but are unevenly prioritized: Continue work and Follow-up are clear in the header, close is visible, but save actions are small, disabled-looking, and split across Output, Dependencies, and Attachments.

## Recommendations

### Task State

- Promote status, priority, assignee, blocked state, due date, and updated time into a compact state bar directly under the title. Keep the editable selects, but make the read state scannable before the form controls.
- Treat blocked as a first-class state, not just a checkbox. Show blocked/not blocked with a status chip and expose blocker text inline when present.
- Remove accidental text-selection styling from title captures and ensure the title wraps cleanly without overlapping header actions.

### Output And Docs Links

- Split Output into two clear zones: latest evidence/output and linked docs. Empty states should say what can be added without adding instructional clutter.
- Render docs links as durable rows with document title/path, source type, timestamp, and explicit open/copy actions. Raw local paths, home-relative paths, and already-normalized Entity docs URLs should look consistent.
- Keep paste/save for new output close to the output input, but make Save visibly disabled only when there is no content and explain the disabled state via tooltip or subtle helper text.

### Logs, Activity, And Comments

- Add task-local tabs or a segmented control for Details, Activity, Comments, and Evidence. The current left rail activity is useful globally but too far away for task audit.
- Activity rows should distinguish comments, task updates, agent actions, status changes, and output additions. Use compact icons/chips instead of repeated uppercase labels.
- Comments need a visible empty state and composer in the task detail surface, with author/time metadata preserved for review and follow-up.

### Edit Actions

- Keep Continue work and Follow-up as primary header actions, but group secondary actions behind a small menu: archive, duplicate, copy link, delete, and raw/debug view.
- Make field-level save behavior consistent. Either autosave with saved/dirty indicators or use one sticky Save changes action for task metadata, with separate explicit saves only for output/comments.
- Dependencies, projects, and attachments need stronger add affordances and validation states. Failed attachment URL/path validation should be visible before submit.

## QA Notes

- Verify keyboard flow from title through state fields, description, output, project search, dependencies, and attachments without focus traps.
- Test long title, long markdown description, many output links, no output, many attachments, blocked with long blocker text, and a task with active comments.
- Confirm activity and comments remain readable at 1440x1000 and smaller laptop widths without hiding the task state.
- Check that task docs links open the same destination from the task card, task detail, and docs view.
- Confirm generated concepts do not lose the underlying board context, but the focused detail should not depend on the dimmed board to explain state.

## Acceptance Checks

### Set 1

- `set-1/09-task-detail.png` exists, renders nonblank, and uses the same Task #462 state for comparison.
- Header shows title, task ID, column/status, assignee, priority, blocked state, and updated time without accidental text selection or overlap.
- Output and docs links are separate, readable, and include open/copy affordances plus clear empty states.
- Task-local activity and comments are visible or one click away inside the detail surface, not only in the global left rail.
- Edit actions have a clear hierarchy: primary work actions, consistent save behavior, and secondary actions grouped without clutter.

### Set 2

- `set-2/09-task-detail.png` exists, renders nonblank, and covers the same state, output, docs-link, activity, comments, and edit-action requirements.
- The redesign improves density and scan speed without turning the task detail into a marketing-style page or hiding operational controls.
- Link normalization is represented visually for docs URLs, local paths, and empty output states.
- Logs/activity/comments preserve audit metadata: actor, event type, timestamp, and related evidence link when available.
- Acceptance includes regression checks for both empty and populated output/docs/comment states.
