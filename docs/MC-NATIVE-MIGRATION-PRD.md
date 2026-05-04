# MC Native Migration PRD

**Goal:** Replace the 3,482-line `MC-SOURCE.html` vanilla JS blob with native React/TypeScript components.

**Why:** The HTML blob has no type safety, can't use React state/hooks, requires querySelector hacks inside React, and every fix needs a full rebuild. Today's 3 bugs (undefined agent names, raw error strings, aggressive loading indicator) all stem from this architecture.

**Approach:** Incremental — each day ships a working piece. `MCFragment` wrapper shrinks until deleted.

**Existing infrastructure to reuse:**
- `useTaskBoard` hook (443 lines) — full CRUD, Zustand store, typed `TaskBoardTask` interface
- `@dnd-kit/core` already installed
- Tailwind + CSS variables already match MC color scheme
- `useActivityStream` hook already fetches activity data
- API endpoints all exist (`/api/tasks`, `/api/tasks/:id/move`, `/api/activity/recent`)

---

## Day 1: Task Cards ✅→🔨
**Scope:** Replace `createTaskElement()` (lines 2438-2510) with `MCTaskCard.tsx`

**What to build:**
- `MCTaskCard.tsx` — renders a single task card with:
  - Task name, description (truncated), assignee pill, priority badge
  - Blocker status with `formatBlockerReason()` (human-readable errors)
  - Working indicator (only for non-passive recent activity)
  - Latest activity footer with correct `agent_name` field
  - Recurring badge, blocked badge
  - `draggable` attribute for DnD
- Props: `task: TaskBoardTask & { activity?: Activity[] }`
- Use existing CSS classes (`.task`, `.task-name`, `.task-desc`, `.task-meta`, `.assignee-pill`, `.priority-badge`, etc.)

**Functions migrated from MC-SOURCE.html:**
- `createTaskElement()` → `MCTaskCard.tsx`
- `hasRecentTaskActivity()` → `utils/taskHelpers.ts`
- `formatBlockerReason()` → `utils/taskHelpers.ts`
- `isTransientBlocker()` → `utils/taskHelpers.ts`
- `getTimeAgo()` → `utils/taskHelpers.ts`
- `statusClass()` → `utils/taskHelpers.ts`
- `formatDate()` → `utils/taskHelpers.ts`

**Estimated complexity:** Medium — mostly extracting existing logic into typed React. ~200 lines of new code.

**Done when:** Task cards render identically to current HTML, but from React component. The `MCOpsView` querySelector hacks for `.task` elements are removed.

---

## Day 2: Kanban Board + Drag-Drop
**Scope:** Replace `renderTasks()` (lines 2377-2437) + column layout with React kanban

**What to build:**
- `MCKanbanBoard.tsx` — renders columns (backlog, todo, doing, review, done)
  - Column headers with task counts
  - Uses `@dnd-kit/core` for drag-drop (replace raw addEventListener DnD)
  - Calls `useTaskBoard().moveTask()` on drop
  - Filters tasks by column
  - Global search filtering (replace querySelector hack in MCOpsView)
- `MCKanbanColumn.tsx` — single column wrapper
  - Column title, count badge
  - Scrollable task list
  - Drop zone styling

**Functions migrated:**
- `renderTasks()` → `MCKanbanBoard.tsx`
- Column filtering logic from `MCOpsView.tsx` effects → props/state
- Drag-drop from MCOpsView `setupDragDrop()` → `@dnd-kit` handlers
- `toggleRecurring()`, `toggleDueToday()` → filter state

**Estimated complexity:** Medium-High — DnD integration needs care. ~300 lines.

**Done when:** Kanban board is fully React, drag-drop works with `@dnd-kit`, search filtering works via React state not DOM manipulation.

---

## Day 3: Task Detail Modal
**Scope:** Replace `openTaskDetail()` (lines 2844-3300+) with React modal

**What to build:**
- `MCTaskDetail.tsx` — full task detail view:
  - Edit name, description, assignee, priority, column, due date
  - Activity log (with correct agent names)
  - Notes section (add/view notes)
  - Project assignment dropdown
  - Dependencies section
  - Blocker toggle + reason
  - Output field
  - Comments section
- `MCCreateTaskModal.tsx` — new task creation

**Functions migrated:**
- `openTaskDetail()`, `closeTaskDetail()` → modal state
- `renderDetailProjects()`, `renderProjectDropdown()` → React select
- `renderDependencies()` → React list
- Activity rendering within detail → reuse `ActivityStream` components
- All `apiFetch` calls within detail → `useTaskBoard` methods

**Estimated complexity:** High — lots of form fields and API interactions. ~500 lines.

**Done when:** Task detail opens/closes via React state, all fields editable, notes work.

---

## Day 4: Insights Dashboard + Metrics
**Scope:** Replace `renderSummary()`, `renderMetrics()`, `renderDashboardStats()`, `renderStrategic()`

**What to build:**
- `MCInsightsDashboard.tsx` — stats cards, charts, summary
- `MCMetricsPanel.tsx` — task metrics (by assignee, column, priority)
- `MCStrategicView.tsx` (real version) — roadmap items, strategic overview
- `MCActivityPanel.tsx` — recent activity feed (reuse `ActivityStream`)

**Functions migrated:**
- `renderSummary()`, `renderMetrics()`, `renderDashboardStats()` → dashboard components
- `renderStrategic()`, `renderActivityPanel()` → strategic view
- `loadRoadmaps()`, `openRoadmapItemDetail()` → hooks

**Estimated complexity:** Medium — mostly display components. ~400 lines.

---

## Day 5: Cleanup + Delete MC-SOURCE.html
**Scope:** Remove all HTML blob infrastructure

**What to delete:**
- `MC-SOURCE.html` (3,482 lines)
- `mcSourcePort.ts` (extraction/parsing logic)
- `MCFragment.tsx` (HTML injection wrapper)
- All `querySelector`/`MutationObserver` hacks in `MCOpsView.tsx`
- Raw `addEventListener` drag-drop setup

**What to clean up:**
- `MCOpsView.tsx` becomes a clean layout component (~50 lines)
- Remove `?raw` Vite import
- Fix any remaining references

**Done when:** `MC-SOURCE.html` is deleted, `git grep MCFragment` returns nothing, app builds and runs clean.

---

## Summary

| Day | Scope | Lines migrated | New React code | Complexity |
|-----|-------|---------------|----------------|------------|
| 1 | Task Cards | ~70 lines | ~200 lines | Medium |
| 2 | Kanban + DnD | ~100 lines | ~300 lines | Medium-High |
| 3 | Task Detail Modal | ~500 lines | ~500 lines | High |
| 4 | Insights + Metrics | ~200 lines | ~400 lines | Medium |
| 5 | Cleanup + Delete | ~3,482 deleted | ~50 lines | Low |

**Total: 5 days, ~1,450 lines of new typed React replacing 3,482 lines of untyped HTML**

---

*Created: 2026-02-18*
