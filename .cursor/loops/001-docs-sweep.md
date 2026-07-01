<!--
Loop #001 — The docs sweep (Forward Future Loop Library)
Category: Engineering | Adopted: 2026-07-01 | Trigger: weekly + manual
Authority: read the whole repo; edit Markdown docs only; NO git/network/deploy.
Success: docs reconcile with the implementation and a reviewable PR is opened,
         or "no drift found" is recorded.
Budget: one pass per run, capped at a single PR.
Retire: after two consecutive no-drift runs, or once update-docs.sh reconciles prose.
This whole file is the prompt passed to `cursor-agent` by
.github/workflows/loop-docs-sweep.yml. Keep it operational and specific.
-->

# Loop 001 — Docs sweep

You are running the **docs sweep** loop for the Entity repository. Your job is to
make the project's documentation match the **current implementation**, then hand
off a reviewable change. This is a low-risk, high-frequency maintenance pass.

## Hard boundaries (a restricted-autonomy CI run)

- **Only edit Markdown documentation:** `README.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, and files under `docs/**` or any other `*.md`.
- **Never edit source, config, or tooling:** no `packages/**` code, `scripts/**`,
  `.github/**`, `package.json`, lockfiles, `*.yml`, `*.ts(x)`, `*.env*`.
- **Never run git, `gh`, npm, curl, or any network/deploy command, and never
  commit or push.** A separate deterministic CI step opens the pull request.
- Do **not** touch runtime state, the SQLite DB, or anything under
  `.cursor/run-state/`.

## Method

1. Read the docs above and compare each concrete, checkable claim against the
   code that backs it — dependencies and scripts in `package.json`, workspace
   layout under `packages/`, server routes, env vars, and run/build/test
   commands.
2. Fix **only real, verifiable drift**. Prefer the smallest edit that makes the
   doc true. Do not rewrite for style, reorganize, or invent content.
3. Preserve each document's voice, headings, and intentional history/examples.
4. Cross-check that docs agree with each other (e.g. `README.md` vs `AGENTS.md`
   on the frontend stack).

## Known drift classes to check

- **Frontend stack:** claims must match `packages/app/package.json`. The app is
  **Vite + React** (has `vite`, `@vitejs/plugin-react`; no `next` dependency).
  Flag any doc that still calls it "Next.js".
- **Commands:** documented `npm run` scripts must exist in `package.json`.
- **Package roles:** the `packages/*` and `electron/` descriptions must match the
  real manifests (`mobile` = Expo, `desktop` = legacy wrapper over `electron/`).
- **Ports / URLs / env vars:** must match what setup, dev, and the server use.

## Output

- Apply the fixes directly to the Markdown files.
- Print a short, plain-language summary to stdout: each file changed, the drift
  it fixed, and the code evidence (file + reason). If you find **no** actionable
  drift, change nothing and print `NO DRIFT FOUND` with the checks you ran.

Keep the diff focused and high-signal — a reviewer should be able to trust every
line without re-verifying the whole repo.
