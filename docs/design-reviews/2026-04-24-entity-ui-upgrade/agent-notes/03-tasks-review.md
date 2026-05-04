# 03 Tasks Review

Artifacts reviewed:
- `actual/03-tasks.png`
- `actual/09-task-detail.png`
- `metadata/03-tasks.json`
- `metadata/09-task-detail.json`
- `metadata/visual-validation-all.json`

## Current Findings

### Kanban Density
- Board density is high but workable for an operator screen: four columns, activity rail, and bottom terminal fit in 1440x1000 without blank dead space.
- The left activity rail competes with the task board. It is useful context, but it should collapse or narrow before the kanban columns lose card width.
- Column counts are visible and useful (`Backlog 50`, `Todo 70`, `Doing 10`, `Review 19`), but the board summary pills (`436 tasks`, `10 active`, `56 blocked`) need stronger hierarchy as board-level status.
- Vertical scroll is doing most of the work. Preserve compact cards, but add clearer column headers/sticky headers so status remains legible while scrolling.

### Filters/Search
- Assignee, priority, and project filters are present and appropriately compact.
- Global search is too visually quiet for a primary triage tool, and its placeholder truncates at the right edge in the capture. Give it a stable wider width or responsive priority over less frequent controls.
- Add visible active-filter chips or a reset summary when filters are engaged; the current all-state reads fine, but filtered state will be easy to miss.
- The refresh and plus icon buttons need tooltips/labels in QA; their affordance is recognizable but not self-documenting enough for repeated board operations.

### Task Cards
- Cards carry the right information set: id, title, description excerpt, output count, project/category, assignee, priority, and age.
- The current card text hierarchy is tight. Long titles wrap hard and description excerpts compete with badges; consider one stronger title line plus a muted two-line excerpt cap.
- Status dots are useful but underexplained. Use consistent status color mapping across column header, card dot, and blocked/active summary.
- The `Tags` button appears on nearly every card but has low specificity. If it opens tag editing, make it an icon button with tooltip or move it into a card action row to reduce repeated visual noise.
- Output counts are strong operational signals. Keep them visible, but make the click target explicit so users know they can jump to evidence/artifacts.

### Detail Affordances
- The task detail overlay keeps board context visible, which is good for fast triage.
- The detail title is clipped/overlapped at the top-left in the capture (`test ripple task`). Add top padding or constrain the panel start below the app chrome.
- Primary actions are clear (`Continue work`, `Follow-up`, close), but the title collision makes the panel feel unfinished.
- Metadata fields are useful and editable, but the first row is dense. Keep field widths stable so assignee, due date, priority, column, and model do not jump when values change.
- Output, projects, dependencies, and attachments are all present. Add clearer empty-state affordances for "No output yet" and "No attachments yet" so users can tell whether they are read-only status or drop/add zones.

## QA Notes

- Actual Tasks capture passed basic visual validation: dimensions 1440x1000, visual nonblank, broad luminance/color range.
- Actual Task Detail capture passed the same visual validation, but manual review catches the title/header overlap that automated checks miss.
- Metadata text confirms the expected controls are present: Kanban/Strategic/Insights/Swarm tabs, assignee/priority/project filters, refresh, search, plus action, recent activity, and task card content.
- Generated comparison artifacts are incomplete for this screen: `set-1/03-tasks.png` and `set-2/03-tasks.png` are both missing in `visual-validation-all.json`.

## Acceptance Checks

### Set 1
- `set-1/03-tasks.png` exists, renders nonblank, and matches the 1440+ desktop framing used by the actual capture.
- Kanban keeps four columns visible with readable counts and no card text crossing column boundaries.
- Search and filters remain visible together; placeholder text does not truncate awkwardly.
- Cards show id, title, key excerpt, assignee, priority, age, project/category, and output evidence where available.
- Opening a task detail keeps the board context visible without clipping the title or primary actions.

### Set 2
- `set-2/03-tasks.png` exists, renders nonblank, and includes the same board states needed for comparison.
- Density is at least as efficient as the actual board while improving scan hierarchy for active/blocked work.
- Filter/search states are distinguishable from default state and include a clear reset path.
- Card actions are explicit enough for tags/output/detail navigation without adding repeated button clutter.
- Detail view preserves editable fields, output, projects, dependencies, and attachments with clear empty states and no header overlap.
