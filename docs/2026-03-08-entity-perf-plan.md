# Entity Performance Plan

This plan file was reconstructed during Phase 2b implementation because the referenced document was not present in the repository worktree.

## Progress

- [x] Phase 2b - Replace MC runtime `renderTasks` and `createTaskElement` with React components.
  Visible kanban rendering now comes from React `TaskCard` and `KanbanColumn` components backed by the shared task store, while the legacy ops fragment remains hidden for runtime compatibility until Phase 3.
- [x] Phase 2c - Virtual scrolling for backlog column.
  Backlog now renders in 50-task increments with a `Show more` control, and highlighted backlog tasks auto-expand into view when selected from elsewhere in the app.
- [x] Phase 3a - Remove MC runtime polling.
  `MC-SOURCE.html` no longer schedules the legacy `loadTasks` interval, leaving task refreshes to the React task store and websocket flow.
- [x] Phase 3b - Remove `useMCData` runtime injection.
  `useMCData` now ports only the retained Mission Control CSS instead of injecting legacy scripts or intercepting `window.fetch`.
- [x] Phase 3c - Delete `MC-SOURCE.html` runtime dependency.
  `mcSourcePort.ts` now serves a local CSS-only port, and the remaining Mission Control wrapper components no longer inject legacy HTML fragments.
- [x] Phase 3d - Add pagination for done/backlog.
  `GET /api/tasks` now accepts `limit` and `offset`, returns pagination metadata, and defaults list responses to 100 tasks.
