# THE-857 / WP1-A-02 — Workplane URL state schema

**Decision:** IMPLEMENTED (schema + unit tests; no route wiring)
**Date:** 2026-07-30
**Worktree:** `/Users/enterprise/Code/entity-the-857-wp1-a-02`
**Depends on:** THE-856 / WP1-A-01 (`WorkplanePanelId`, `WORKPLANE_PANEL_SEAM_MAP`)
**Route/shell:** not implemented (THE-858)

## Purpose

Define the stable Q36 deep-link contract for a single-task Workplane:

| Field | Role |
| --- | --- |
| `taskId` | Required positive integer; path `/workplane/:taskId` |
| `activePanel` | One of THE-856 Q33 panel ids; default `task_summary` |
| `selectedProof` | Optional safe proof/artifact token; omitted when null |
| `returnContext` | Optional return-to board/detail/tasks surface for THE-860 |

## Module

`packages/app/src/lib/workplaneUrlState.ts`

| Export | Use |
| --- | --- |
| `WorkplaneUrlState` / `WorkplaneReturnContext` | Typed state for THE-858..THE-861 |
| `WORKPLANE_PATH_PREFIX` / `WORKPLANE_URL_QUERY_KEYS` | Stable path + query keys |
| `WORKPLANE_PANEL_IDS` / `DEFAULT_WORKPLANE_PANEL` | Panel enum alignment with seams |
| `parseWorkplaneUrlState` | Restore from `pathname` + `search` |
| `serializeWorkplaneUrlState` | Emit relative deep link |
| `normalizeWorkplaneUrlState` | Drop invalid optionals; keep task id |
| `createDefaultWorkplaneUrlState` | Launch defaults |
| `roundTripWorkplaneUrlState` | Refresh/deep-link helper |

## URL shape

```
/workplane/42
/workplane/42?panel=proof_bundle&proof=receipt:phase2_abc
/workplane/42?panel=files_docs&return=detail&returnTask=42&returnPath=/task/42
/workplane/42?return=board&returnBoard=entity-engineering&returnPath=/tasks
```

Query keys:

- `panel` — `WorkplanePanelId` (omitted when default)
- `proof` — selected proof/artifact id
- `return` — `board` \| `detail` \| `tasks`
- `returnBoard` — optional board/tab key
- `returnTask` — optional task id
- `returnPath` — safe relative restore path (`/task/:id`, `/tasks`, `/workplane/...`)

## Invalid-state policy

- Non-`/workplane/:positiveInt` paths → `null` (not a Workplane)
- Invalid `panel` → default `task_summary` (task id preserved)
- Invalid `proof` / return tokens / open-redirect paths → dropped (`null` / omitted)
- Never coerce unknown panels/proofs into “healthy” invented values
- No secrets, tokens, or absolute external URLs in the schema

## Non-goals honored

- No App route registration or shell container (THE-858)
- No Open Workplane CTA (THE-859)
- No Mission Control redesign
- No production mutation / secrets exposure

## Consumers

1. THE-858 — Workplane route + shell reads/writes this state
2. THE-859 — Open Workplane serializes launch state from task detail
3. THE-860 — Return navigation uses `returnContext`
4. THE-861 — Refresh restore via `parseWorkplaneUrlState`
