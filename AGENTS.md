# Entity — Agent Guidelines

## Working Style: Maximize Parallelism

- Use as many parallel sub-agents / tool calls as possible. When work is independent, launch it concurrently rather than sequentially.
- For exploration, fan out multiple read-only `explore` sub-agents at once (one per subsystem/area).
- For implementation, parallelize edits that touch **non-overlapping files**; serialize edits to the same shared file (e.g. `packages/server/src/index.ts`, large components) to avoid clobbering.
- Batch independent shell/read/search calls into a single round instead of one-at-a-time.
- Default to parallel; only fall back to sequential when there is a true data dependency between steps.

## Project Structure

Monorepo with npm workspaces:
- `packages/app` — Next.js frontend
- `packages/server` — Express + TypeScript backend
- `packages/db` — SQLite database layer
- `packages/mobile` — Expo mobile app
- `packages/desktop` — Electron wrapper
- `electron/` — Electron build config

## Build, Test, and Development Commands

- Install deps: `npm install` (from root)
- Build app: `npm --prefix packages/app run build`
- Build server: `cd packages/server && npm run build`
- **Run tests: `cd packages/server && npx vitest run`**
- Run specific test: `cd packages/server && npx vitest run src/fs/classify.test.ts`
- Dev server: `cd packages/server && npm run dev`

## Close the Loop Protocol

**Browser verification is mandatory for anything user-facing.**
- Always test everything you build or change in the browser when it affects UI, routes, docs rendering, TTS/audio controls, or user workflows.
- Use the Browser Use plugin/in-app browser for local routes such as `localhost`, `127.0.0.1`, `::1`, or `file://`.
- Do not call user-facing work done from build/tests alone when browser verification is possible.
- If browser verification cannot run, report the exact blocker and the alternate evidence used.

**After writing ANY code in `packages/server/`:**
1. Write or update colocated test (`source.test.ts` next to `source.ts`)
2. Run `cd packages/server && npx vitest run`
3. If tests fail → fix code → rerun
4. Only report "done" when tests pass
5. Never commit with failing tests

**Full gate before commit:**
```bash
cd packages/server && npm run build && npx vitest run
```

## Test Conventions

- **Colocated:** `utils.test.ts` lives next to `utils.ts`
- **Runner:** Vitest
- **Focus:** Pure logic, validation, security, data transformation
- **Don't test:** UI components, external API calls (mock them), database ops (mock)
- **Always test:** Boundary values (0, 1, max, empty, null), error paths, security checks

## Anti-Redundancy

- Before creating helpers/utilities, search for existing ones
- Import from original source — no re-export wrapper files
- Extract shared test fixtures into `test-helpers.ts` when reused

## Coding Style

- TypeScript strict mode
- Keep files under ~500 LOC
- Meaningful variable names
- Brief comments for non-obvious logic

## Database

- SQLite via better-sqlite3
- DB file: `packages/db/entity-tasks.db` — **NEVER overwrite in production**
- Production DB is on ada-gateway, dev DB is on Mac
- Always use `deploy.sh` for deployments (never manual rsync)

## Deployment

- **Source of truth is Mac (`~/Code/entity`)**
- **Canonical delivery flow:** Mac changes -> git push -> GitHub Actions CTRL Gate -> Deploy -> Notify
- **No direct code edits on ada-gateway for Entity** (runtime mirror only; emergency recovery only)
- **ALWAYS use pipeline delivery for normal changes**
- Never rsync without `--exclude='*.db'`
- Never git checkout/stash on ada-gateway (overwrites production DB)

## Guardrail

If an agent is running on ada-gateway and the task is an Entity code change, STOP.
Do one of these instead:
1. SSH to Mac and change `~/Code/entity` there
2. Use a coding agent against the Mac source repo
3. Commit and push so GitHub Actions handles deploy

Do not make the "quick local edit" mistake. That is drift.
---

## 🔄 Plan-Driven Execution & Compaction Recovery

**Context:** AI agents lose memory after context compaction. Plans on disk survive. Chat memory doesn't.

### Rule: Multi-Step Tasks Need Plans
If a task has >2 steps or will take >10 minutes, create a plan BEFORE executing.

### How To
1. Copy `docs/plans/PLAN_TEMPLATE.md` to `docs/plans/YYYY-MM-DD-<slug>-plan.md`
2. Fill in steps, dependencies, verify commands
3. Copy to `docs/plans/ACTIVE_PLAN.md`
4. Execute from ACTIVE_PLAN.md — check off steps as you go

### Compaction Recovery (Mandatory)
If you lose context (session restart, compaction, new session):
1. Read `docs/plans/ACTIVE_PLAN.md`
2. Run `git status` and `git diff` to see current state
3. Check file existence for files in "Files Touched"
4. Find the **first unchecked step** `[ ]`
5. Continue from there — do NOT redo completed steps

### Plan Format Rules
- Every step: checkbox + verify command
- Dependencies: what must be true before each step starts
- Checkpoints: log time + status as you go
- Files touched: track every file created/modified
- Resume instructions: for the NEXT agent/session

### When NOT to Use Plans
- Single lookups, 1-2 step tasks, conversational Q&A
- Keep it simple — opt-in, not opinionated (Onur's rule)

---

## Cursor Cloud specific instructions

The deployment/`ada-gateway`/Mac-source guidance above is for the maintainer's private prod pipeline and does NOT apply in Cursor Cloud VMs. Here you develop and verify locally; do not attempt prod deploys.

### Services
- The only long-running process for the core product is the **server** (`packages/server`, Express + WebSocket). It listens on **port 3000** and also serves the built frontend from `packages/app/dist`, so there is no separate frontend process in the default run. `@entity/db` (SQLite via `better-sqlite3`) is an in-process library, not a daemon (DB file at `./data/entity.sqlite`).
- **ClickClack sidecar** (Go chat sidecar, port 3091) is OPTIONAL and only powers chat compatibility routing. It is NOT checked out in the cloud VM — `npm run setup` clones it to `/tmp/clickclack` from a remote, which is skipped here via `--skip-clickclack`. The core workspace (tasks/files/agents/board) works fully without it. Run the dev server with `ENTITY_CLICKCLACK_SIDECAR=0` to avoid sidecar restart noise.

### Run / build / test (caveats only; standard commands are in README.md and package.json)
- The startup script (`npm install` then `npm run setup -- --defaults --skip-clickclack`) recreates `entity.config.yaml` and `.env`, which are **gitignored** and absent on a fresh VM. `npm run dev` hard-fails without `entity.config.yaml`, so re-run setup if it's missing.
- You must `npm run build` before running: the server serves the prebuilt `packages/app/dist`, so UI changes are NOT reflected until you rebuild the frontend (`npm --prefix packages/app run build`). For a hot-reload UI loop, run Vite separately (see README "Frontend-only development", Vite on 5173 pointing at the server on 3000).
- Start the server directly with `ENTITY_CLICKCLACK_SIDECAR=0 PORT=3000 npm run dev`.
- No login is required in the default local config; an initial setup wizard appears on first UI load and can be skipped via "Skip setup".
- Server tests: `cd packages/server && npx vitest run` (colocated `*.test.ts`).
- `npm run doctor` reports the missing ClickClack checkout as FAIL and the server as unreachable when it isn't running — both are expected in the cloud VM and do not indicate a broken core setup.
- The root `npm test` / `npm run test:e2e` browser smoke uses an external `agent-browser` binary and a different topology (Vite on 5173, API on 3001); it is not the primary test path here — prefer the server Vitest suite plus manual browser verification on port 3000.

## Agent LLM provider (Azure / OpenAI-compatible)

The Task Master agent — and the task-comment `@mention` responder — generate text via `getTaskAgentLanguageModel()` in `packages/server/src/agent/settings.ts`. Configure it in the UI (Admin → Task Master) or `PATCH /api/agent/settings`.

- For **Azure OpenAI** (or any OpenAI-compatible endpoint), choose provider `openai-compatible`. It accepts a **Base URL** and sends both `Authorization: Bearer` and an `api-key` header (Azure auth).
- Base URL resolves from (in order): stored value → `OPENAI_BASE_URL` / `AZURE_OPENAI_BASE_URL` / `AZURE_OPENAI_ENDPOINT` env → provider default. Use the Azure `/openai/v1` surface, e.g. `https://<resource>.openai.azure.com/openai/v1`.
- API key resolves from the stored per-provider key or `AZURE_OPENAI_API_KEY` / `OPENAI_API_KEY` env.
- The **model id must be the Azure deployment name**, not a generic model name. List deployments with `curl -H "api-key: $AZURE_OPENAI_API_KEY" "<resource>.openai.azure.com/openai/deployments?api-version=2023-03-15-preview"`.
- Without a key, `@mention` replies still post a graceful "configure a model" message and task pickup still works; only the generated text is skipped.

**Cloud secret caveat:** newly added Secrets are injected into the VM environment, but a long-running dev server (or its tmux server) started *before* the secret was added will not see it. Restart the dev server in a shell/tmux session that has the secret in its environment (e.g. recreate the tmux server) so `process.env` picks it up.
