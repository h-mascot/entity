# Entity x eforge restore spec for coding agent

## Goal
Restore the missing Swarm x eforge integration in the Entity repo so the feature survives normal GitHub-based deploys and can self-verify end to end.

Work in the Enterprise checkout only as the delivery target for this spec file. The implementation source of truth for code remains the canonical Entity repo.

## Output location for this spec
Write/maintain this file at:
- `~/Code/entity/docs/context/eforge-restore-agent-spec.md`

## Product intent
Thread-derived direction:
- **Entity / Swarm is the front door**
- **eforge is the execution engine**
- missing work is **tight Swarm ↔ eforge integration**, not replacing Swarm with eforge

The restore target is not abstract architecture cleanup. It is concrete user-visible workflow restoration.

## Must restore

### 1. Swarm job → eforge monitor visibility
For any Swarm job where `provider === "eforge"`:
- show provider-specific UI in the job card and/or detail panel
- show run handle if present
- show current provider health/status where useful
- expose a clear clickable action such as:
  - `Open monitor`
  - `View build`
  - `Open in eforge`
- link target must come from real provider/server state, not a fake hardcoded path

### 2. Provider status/monitor API
Implement or restore a route equivalent to:
- `GET /api/swarm/providers/eforge/status`

Expected response shape should include at minimum:
- `available: boolean`
- `message: string`
- `monitorUrl` or `webUrl` when configured
- `apiUrl` when configured and safe to expose
- optional runtime/job info if cheaply available

This route must be usable by the frontend to:
- display eforge health
- determine whether a monitor link should render
- power click-through without guessing

### 3. Spec prep/edit flow before dispatch
Restore a user-visible prep step so Swarm users can edit the job spec before dispatching to eforge.

Minimum acceptable implementation:
- job detail panel shows editable spec field for the job
- user can save the edited spec
- dispatch uses the saved spec, not stale hidden data
- flow is visible in Swarm UI, not filesystem-only

Nice-to-have, not required:
- explicit “Prepare for eforge” affordance
- task-derived template generation

### 4. eforge config sanity
Support current real configuration rather than fantasy config.

At minimum:
- preserve current queue-based mode (`EFORGE_QUEUE_DIR`) if that is the active path
- support `EFORGE_API_URL` if present
- support `EFORGE_WEB_URL` for monitor click-through
- ensure server/provider logic behaves cleanly when only queue mode exists
- health and status responses must degrade gracefully when web/api URLs are absent

Do not block the whole feature just because OAuth/latest-model plumbing is incomplete.
But do structure the code so future provider auth/model config can be extended cleanly.

### 5. No frontend regression
While restoring this feature, do not break:
- Entity root route
- Swarm board rendering
- job detail panel
- provider dropdown / job creation flow

## Likely files to inspect
Frontend:
- `packages/app/src/components/SwarmBoard.tsx`
- related hooks/components used by Swarm board or job detail flow

Server:
- `packages/server/src/swarm/routes.ts`
- `packages/server/src/swarm/dispatcher.ts`
- `packages/server/src/swarm/providers/eforge.ts`
- `packages/server/src/swarm/providers/eforge-queue.ts`
- swarm DB update helpers if spec/run_handle fields need better exposure

Config/runtime:
- `packages/server/.env`
- any static serving / app boot files if frontend routing regresses

## Functional acceptance criteria
Implementation is only acceptable if all are true:

1. **eforge jobs are visibly distinct in Swarm**
- create or use an existing eforge job
- UI clearly shows it is an eforge job

2. **monitor link works when configured**
- if `EFORGE_WEB_URL` is configured, Swarm UI renders clickable monitor/build link
- clicking it opens the expected destination

3. **status endpoint works**
- `GET /api/swarm/providers/eforge/status` returns valid JSON
- response reflects actual env/config reality
- no 500 for normal unconfigured cases

4. **spec editing works before dispatch**
- edit job spec in UI
- save
- refresh/reopen detail
- edited spec persists
- dispatch uses edited spec content

5. **queue dispatch still works**
- dispatching an eforge job in queue mode writes expected queue artifact
- job state updates correctly in Swarm

6. **no root/UI regression**
- root app loads
- Swarm board loads
- detail panel opens
- no blank screen
- no fatal console error caused by the restore

## Self-verification requirements
The coding agent must self-verify and should not claim completion without evidence.

### A. Code verification
- run targeted tests if present
- run build for affected packages
- ensure frontend compiles
- ensure server compiles

Minimum expected commands, adjusted to actual repo scripts:
- frontend build
- server build
- targeted test(s) for swarm routes/provider logic if available

### B. API verification
Verify with live local/runtime requests:
- `GET /api/swarm/providers`
- `GET /api/swarm/providers/eforge/health`
- `GET /api/swarm/providers/eforge/status`
- relevant job fetch/update endpoints used by spec editing and dispatch

Must confirm:
- status route returns JSON
- no normal-path 500s
- response contains configured URL state correctly

### C. UI verification
The agent must personally verify in browser:
- Swarm board renders
- eforge job detail opens
- spec can be edited and saved
- eforge monitor/build link renders correctly when config exists
- no blank/white screen regression

### D. Dispatch verification
Agent must verify an actual eforge dispatch path:
- create or use test eforge job
- edit spec
- dispatch job
- confirm queue file written in configured queue dir or equivalent provider handoff succeeded
- confirm run handle / feedback / state visible in UI or API

### E. Evidence required in final handoff
The final report must include:
- files changed
- exact commands run
- test/build results
- API endpoints exercised and sample results
- screenshot(s) or equivalent browser proof path
- queue artifact path or dispatch evidence
- commit SHA if committed
- any remaining gaps explicitly labeled `NOT DONE`

## Constraints
- do not replace Swarm with a new architecture
- do not remove existing provider flows for ACP/Symphony
- do not hardcode fake monitor URLs
- do not mark complete based only on file edits or build success
- do not do runtime-only hotfix work and stop there
- if implementation touches runtime directly for recovery, backport to canonical repo before calling it complete

## Definition of done
Done means all of the following:
- feature implemented in canonical code path
- builds pass for touched surfaces
- API status route works
- UI spec editing works
- eforge monitor/build affordance works when configured
- dispatch path verified
- live/browser verification completed
- evidence captured

If any of those are missing, status is **NOT DONE**.
