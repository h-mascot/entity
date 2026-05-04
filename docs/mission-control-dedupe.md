# Mission Control task dedupe + merge flow

## What shipped

### 1) Active-task dedupe on create/update

- Exact normalized-title dedupe for active tasks (`todo`, `doing`, `review`, or `blocked=true`; excludes `done` and `archived=true`).
- Fuzzy similarity scoring (token overlap + character bigrams) for near-duplicates.
- Both create and update can be blocked with `409` when duplicates are detected.

### 2) Duplicate warning response

When a duplicate is detected, API returns:

- `error`
- `message`
- `duplicateType` (`exact` | `fuzzy`)
- `duplicates[]` with id/name/column/score metadata
- `allowCreateAnyway: true`

This enables UI pre-create warning flow and manual override.

### 3) Create-anyway override

Accepted request flags:

- `create_anyway: true`
- `dedupe_override: true`
- `createAnyway: true`

If any is true, create/update proceeds despite duplicate candidates.

### 4) Merge flow

`POST /api/tasks/:id/merge` with body `{ "sourceTaskId": <id> }`

- merges duplicate source into target
- writes merge audit note to target with source context
- copies source comments into target
- archives source (`archived=true`, `column=done`) and annotates blocker reason
- logs activity + emits task update hook

## Files touched

- `packages/server/src/task-dedupe.ts`
- `packages/server/src/index.ts`
- `packages/server/src/__tests__/task-dedupe.test.ts`
- `packages/app/src/lib/http.ts`
