# PR-A-09 — Run Now & Smoke Test Semantics

**Issue:** THE-741 / PR-A-09  
**Proof type:** Execution-path receipt  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`

## Finding summary

| Desired SuperSpec concept | Current Entity behavior |
| --- | --- |
| **Run Now** | Closest: Manual Trigger **“▶ Run All Checks”** → `POST /api/agent/trigger` with `{ event: "manual" }` |
| **Smoke Test** | **Does not exist** as a non-mutating provider connectivity check in Task Master UI/API |

## Run Now (current path)

**UI:** `TaskMasterSettings.trigger('manual')`  
**API:** `POST /api/agent/trigger` → `TaskAgent.trigger({ event: 'manual', taskId? })`

### Semantics (`agent/index.ts`)

When `ENTITY_AGENT_ENABLED` is false:

- Route returns **503** if disabled at HTTP layer (`agents.ts`), and class `trigger` returns empty summary if called directly.

When enabled and **no taskId** (UI path):

- Executes `runStaleScan('manual')` — **mutating**: may notify/escalate/comment/move tasks per stale policies; writes `agent_log`.

When enabled **with taskId** (API-only; UI does not send taskId):

- If review + has output → review handling
- If review + missing output → output-missing handling
- If active + no owner → ownership gap handling
- Else → stale scan

### Sibling UI triggers (also mutating)

| Button | Event | Behavior |
| --- | --- | --- |
| Review Check | `review_check` | Reviews tasks in `review` column (capped by `maxActionsPerScan`) |
| Stale Scan | `stale_scan` | Same stale scan path as scheduled tick |

Server also accepts `review_hygiene` and `ownership_check` (not exposed as TM settings buttons).

## Smoke Test (current path)

- No `/api/agent/smoke` or provider connectivity test endpoint.
- Doc Intelligence `ask` is a **live mutating generative call** (uses tokens; not a smoke).
- Swarm `/providers/:name/health` is unrelated execution health.
- Phrase “smoke test” appears in review-policy regex for *detecting evidence language in task text*, not as an action.

**Phase F implication (PR-F-10 / F-11):** must **introduce** a non-mutating Smoke Test distinct from Run Now; wire Run Now to the existing `trigger`/`runStaleScan` (or successor) path with idempotency — do not invent a parallel executor.

## Side-effect comparison

| Action | Mutates tasks? | Calls LLM? | Writes agent_log? | Touches secrets? |
| --- | --- | --- | --- | --- |
| Run All Checks (`manual`) | Yes (possible) | Yes (when actions need model) | Yes | Uses resolved key in-process |
| Review Check | Yes (possible) | Yes | Yes | Same |
| Stale Scan | Yes (possible) | Yes | Yes | Same |
| Desired Smoke Test | **No** | Minimal connectivity probe only | Health record only (future) | Resolve key; never return it |

## Acceptance

- [x] Execution-path receipt produced
- [x] OQ-013/014 answered by audit
