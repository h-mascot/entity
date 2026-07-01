# Loop Library Adoption Decision

**Date:** 2026-07-01
**Method:** Loop Library #057 "The Loop Hiring Manager" applied to this repository.
**Source catalog:** Forward Future Loop Library — https://signals.forwardfuture.com/loop-library/ (catalog updated 2026-06-26, 70 published loops).
**Scope:** Decide which published loops Entity should adopt. This is a recommendation only. Nothing here installs, schedules, or runs a loop; adoption and any trial require maintainer approval.

---

## TL;DR

Entity already runs a mature, home-grown loop portfolio (autonomous build loops, an enforced release gate, plan-driven restartable handoffs, adversarial review, and a private-default scan). Most engineering-review and orchestration loops in the catalog are therefore **already covered** and would only duplicate working process.

The real gaps are in **keeping the public-facing surface honest as the product ships fast**: documentation drift, unverified fresh-clone onboarding, and no user-facing changelog.

**Adopt (shortlist of 3):**

1. **#001 The docs sweep** — *recommended first manual trial.* — ✅ **set up**
2. **#025 The fresh-clone loop.** — ⏸️ deferred (not in current scope)
3. **#008 The nightly changelog loop.** — ✅ **set up**

**Foundational fix first (not a loop):** wire the server Vitest suite into CI. See "Prerequisite" below.

---

## Adoption status — loops #001 and #008 set up (2026-07-01)

Loops **#001 (docs sweep)** and **#008 (nightly changelog)** are now set up as
opt-in Cursor cloud-agent automations. `#025` remains deferred.

- **Automation:** each loop is a committed prompt + restricted CLI permission
  profile under [`.cursor/loops/`](../.cursor/loops/README.md), run by a scheduled
  GitHub Actions workflow that launches `cursor-agent` in restricted-autonomy
  mode (the agent only edits files; a deterministic step opens the PR).
  - `#001` → [`.github/workflows/loop-docs-sweep.yml`](../.github/workflows/loop-docs-sweep.yml) (weekly + manual).
  - `#008` → [`.github/workflows/loop-nightly-changelog.yml`](../.github/workflows/loop-nightly-changelog.yml) (nightly + manual), fed by the deterministic `scripts/changelog-window.mjs`.
- **Opt-in:** merging changes nothing on a schedule. Activate by adding the
  `CURSOR_API_KEY` secret and setting `ENTITY_LOOPS_ENABLED=true`; manual
  `workflow_dispatch` trials work with just the key. See the loops README.
- **First manual trial performed in this PR:**
  - `#001` fixed the concrete drift below — `AGENTS.md` "Project Structure" now
    reads `packages/app — Vite + React frontend` (was "Next.js"), matching
    `packages/app/package.json` and `README.md`.
  - `#008` seeded `CHANGELOG.md` from the ~2 weeks of history preceding the run.

---

## What Entity already has (adopted loops, informal)

The catalog's premise is "recurring outcomes that lack reliable ownership, a repeatable process, or proof of completion." Entity has already built repeatable processes for most engineering loops:

| Existing mechanism | Evidence | Catalog loops this already covers |
|---|---|---|
| **Autonomous build loops ("Ralph")** — PRD-driven, bounded iterations, build-to-verify, auto-commit | `scripts/ralph/run-integration-ralph.sh`, `scripts/ralph/run-mc-agent-native-editor.sh` (`MAX_LOOPS=5`, PRD JSON with `passes` flags, `codex exec --full-auto`) | #027 autonomy-loop builder-reviewer, #020 Loop Harness |
| **Enforced release gate (CTRL)** | `.github/workflows/main.yml` (build + `scan:private-defaults --enforce`), `scripts/ctrl-gate-runner.sh`, `.ctrlrc.json` pre-push hook | #013 stale-safe batch release, #015 post-release baseline (partial) |
| **Adversarial review ("autoreview" + "thermo-nuclear review")** | `docs/plans/ACTIVE_PLAN.md` checkpoints show iterative review→fix cycles; git log: "Harden document review dispatch", "Close document responder thermonuclear findings", "Resolve closure review blockers" | #019 Clodex, #024 devil's-advocate, #034 multi-LLM convergence |
| **Completion contract / proof gate** | `.project-gate.json` (`proofCommands`, `uiProofRequiredFor`, `highRiskScopes`, `failStop`, book-review gate), `scripts/proof/*` | #028 Codex completion-contract, #051 next-action confidence check |
| **Plan-driven execution + restartable handoff** | `docs/plans/PLAN_TEMPLATE.md`, `docs/plans/ACTIVE_PLAN.md` ("Resume Instructions", "Compaction Recovery" in `AGENTS.md`), 119 plan files | #066 restartable handoff, #047 Living Story |
| **Repo/agent maintenance skills** | `skills/entity-mc/` (`mc-health-check.sh`, `mc-stall-check.sh`, `mc-auto-pull.sh`, `mc-assign-model.sh`) | #030 five-minute repository maintainer |
| **Public-readiness / secret + private-default scan** | `scripts/scan-private-defaults.mjs`, `docs/reports/private-default-scan-baseline.md` (enforced in CI) | #032 promise-to-proof (secrets half only), #048 Groundtruth (partial) |
| **Docs auto-refresh (partial)** | `scripts/update-docs.sh` (codemap, timeline, sessions-log, todo, decisions) | #001 docs sweep (partial — see gap below) |

**Conclusion:** the engineering/orchestration column of the catalog is largely saturated. Recommending those would be a duplicate hire.

---

## Gaps found (recurring outcome, no reliable owner or proof)

### Gap A — Documentation drifts as features land fast
- 366 markdown files under `docs/`; feature cadence is high (252 commits; rapid `THE-xx` Linear issues).
- `CONTRIBUTING.md` asks contributors to "update docs when setup, config, or behavior changes," but there is **no owned, repeatable audit** — it relies on per-PR discipline.
- `scripts/update-docs.sh` only regenerates a codemap/stats/log; it does not reconcile prose docs against the implementation, and it uses macOS-only `sed -i ''` so it is not portable.
- **Concrete drift already present:** `AGENTS.md` "Project Structure" says `packages/app — Next.js frontend`, but `packages/app` is a **Vite + React** app (`packages/app/package.json`: `"dev": "vite"`, `"build": "tsc && vite build"`, `vite`/`@vitejs/plugin-react` deps, no `next` dependency). `README.md` correctly says "Vite + React," so the two docs disagree.
- → Maps exactly to **#001 The docs sweep**.

### Gap B — Onboarding is README-driven but never verified from zero
- `README.md` states Entity is "transitioning from an internal workspace to a public project" — onboarding correctness is a stated product goal.
- Runtime config is gitignored (`.gitignore`: `/entity.config.yaml`, `.env`, `data/`) and `npm run dev` hard-fails without `entity.config.yaml` (per `AGENTS.md`). The happy path depends on `npm run setup` running correctly on a clean machine.
- `npm run doctor` verifies config/paths **after** setup, but nothing proves a brand-new clone reaches the documented ready state using only the README.
- → Maps exactly to **#025 The fresh-clone loop**.

### Gap C — No user-facing changelog despite frequent releases
- No `CHANGELOG` file exists anywhere in the repo.
- The product ships often (immutable sandbox releases: `feat: support immutable sandbox release switch`, release identity checks) and CI posts a Discord build ping, but there is **no human-readable record of what changed for users/operators**.
- → Maps exactly to **#008 The nightly changelog loop**.

---

## Prerequisite (not a loop — do this first)

**Wire the server Vitest suite into CI.** `packages/server` has ~79 colocated `*.test.ts` files and is the gate `AGENTS.md`/`CONTRIBUTING.md`/`.project-gate.json` treat as authoritative, yet `.github/workflows/main.yml` only runs `build`, `scan:private-defaults --enforce`, and `npm test` — where root `npm test` is the browser smoke that MVP mode skips (`npm test || echo "Tests skipped (MVP mode)"`). So the real test suite currently only runs via local discipline and the pre-push hook, never in CI.

This is a one-time config fix, not a recurring loop, but several loops below (and the existing autonomy loops) are only trustworthy once merged code is provably green. Recommended CI step: `cd packages/server && npm ci && npx vitest run`.

---

## Shortlist (adopt at most these three)

### 1. #001 — The docs sweep  ★ recommended first manual trial
- **Why:** Gap A. Highest recurrence, lowest risk, produces a reviewable PR, and there is already a concrete drift to fix (`AGENTS.md` "Next.js").
- **Trigger:** after each `THE-xx` epic/feature merge, or a fixed weekly cadence.
- **Inputs:** current `packages/*/src`, `README.md`, `AGENTS.md`, `docs/**`, `CONTRIBUTING.md`.
- **Authority:** read code + docs; open a PR. No production or runtime access.
- **Success check:** docs reconcile with implementation; a reviewable PR is opened; the known `AGENTS.md`/`README.md` frontend-stack disagreement is resolved.
- **Budget:** one pass per trigger; cap at a single PR per run.
- **Terminal states:** PR opened with fixes, or "no drift found" recorded.
- **Trial:** run once now against the current tree; judge the PR's signal-to-noise.
- **Retirement rule:** retire if two consecutive runs find no actionable drift, or if `update-docs.sh` is extended to cover prose reconciliation.

### 2. #025 — The fresh-clone loop
- **Why:** Gap B. Directly serves the stated internal→public goal; onboarding breakage is invisible to insiders whose machines are already configured.
- **Trigger:** before any tag/public announcement; otherwise monthly.
- **Inputs:** the repo URL and `README.md` only; a disposable clean environment.
- **Authority:** clone into a throwaway environment; propose setup/README fixes via PR. Carry nothing between attempts.
- **Success check:** one uninterrupted fresh clone reaches the documented ready state (`npm run dev` serving `http://localhost:3000`) using only the README.
- **Budget:** a fixed number of clean-room attempts per run (e.g. 3).
- **Terminal states:** clean first-run success, stalled progress, or a blocker requiring a maintainer decision.
- **Trial:** run in a disposable cloud VM / container against `main`.
- **Retirement rule:** retire once the hosted/one-click deploy path (README roadmap) supersedes README-driven local onboarding.

### 3. #008 — The nightly changelog loop
- **Why:** Gap C. Zero current coverage; frequent releases; users/operators need a record.
- **Trigger:** nightly, or on each release/tag.
- **Inputs:** previous day's merged PRs, commits, and release identity info (`scripts/entity-release-info.mjs`).
- **Authority:** write to a `CHANGELOG.md`; open a PR. Never edit release history or deploy.
- **Success check:** every user-relevant change from the window is captured, or a "no user-facing change" entry is recorded.
- **Budget:** one changelog update per run.
- **Terminal states:** changelog updated and validated, or no-change recorded.
- **Trial:** generate a first `CHANGELOG.md` from the last ~14 days and review quality before scheduling.
- **Retirement rule:** retire/fold in if a hosted release-notes system takes over user communication.

---

## Rejected or already-covered (with reason)

| Loop(s) | Decision | Reason |
|---|---|---|
| #019 Clodex, #024 devil's-advocate, #027 autonomy-loop, #034 multi-LLM convergence | **Skip — already covered** | Autoreview + "thermo-nuclear" review + `.project-gate.json` book-review gate already implement adversarial builder/reviewer cycles (`ACTIVE_PLAN.md` checkpoints). Adopting a named loop duplicates working process. |
| #066 restartable handoff, #047 Living Story | **Skip — already covered** | `PLAN_TEMPLATE.md` + `ACTIVE_PLAN.md` "Resume Instructions" + compaction-recovery protocol in `AGENTS.md` already do this. |
| #030 five-minute maintainer | **Skip — already covered** | `skills/entity-mc/` health/stall/auto-pull/assign-model scripts cover recurring MC ops. |
| #013 stale-safe release, #012 repo cleanup, #028 completion-contract, #051 next-action check | **Skip — already covered** | CTRL gate, `.project-gate.json` (`failStop`, proof commands), and pre-push hooks already enforce these. |
| #032 promise-to-proof, #048 Groundtruth | **Defer** | Secret/private-default half is covered by `scan:private-defaults`; the marketing-promise/audit half is lower urgency than Gaps A–C and partly folded into #001/#025. |
| #005 100% coverage, #011 test-suite speed, #044 test stabilizer | **Defer — do the prerequisite instead** | The real issue is that CI doesn't run the existing suite (see Prerequisite), a config fix, not a recurring loop. Revisit after CI runs Vitest. |
| #010 full product eval, #036 UI/UX score, #040 accessibility | **Defer** | Valuable but heavy; per-change browser proof is already mandated by `.project-gate.json` (`uiProofRequiredFor`). Consider #036 for a single high-value flow later. |
| #056 dependency-CVE, #064 Dependabot triage | **Defer** | No Dependabot/scheduled dependency review configured today; not yet a recurring pain. |
| #065/#067 React Doctor, #018 podcast, #021 Boeing 747, #026 thumbnails, #042 Axelrod, #050 refund, #059 buyer interviews, #060 one-post-a-week, #061 LaTeX | **Not applicable** | Depend on external tools/domains outside Entity's current work (or are demos), no recurring gap here. |

---

## Recommended single manual trial

Run **#001 The docs sweep** once, now, against `main`. It is the safest, highest-frequency gap, is immediately runnable in a cloud VM, produces a reviewable PR, and already has a concrete finding to validate against (the `AGENTS.md` "Next.js" vs. Vite drift). Evaluate the PR's signal-to-noise before adopting on a cadence, and only then trial #025 and #008.

**No loop is installed, scheduled, or executed by this document. Adoption and trials await maintainer approval.**
