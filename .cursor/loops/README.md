# Entity agent loops

Recurring [Forward Future Loop Library](https://signals.forwardfuture.com/loop-library/)
loops adopted by Entity, per the decision in
[`docs/loop-library-adoption.md`](../../docs/loop-library-adoption.md).

Each loop is a committed prompt + a restricted CLI permission profile, run by a
scheduled GitHub Actions workflow that launches a **Cursor cloud agent**
(`cursor-agent`) in restricted-autonomy mode: the agent only edits files, and a
deterministic workflow step performs all git/PR actions.

| Loop | Prompt | Permission profile | Workflow | Cadence |
|---|---|---|---|---|
| **#001 Docs sweep** | [`001-docs-sweep.md`](001-docs-sweep.md) | [`permissions/docs-sweep.cli.json`](permissions/docs-sweep.cli.json) | [`.github/workflows/loop-docs-sweep.yml`](../../.github/workflows/loop-docs-sweep.yml) | Weekly (Mon 06:17 UTC) + manual |
| **#008 Nightly changelog** | [`008-nightly-changelog.md`](008-nightly-changelog.md) | [`permissions/nightly-changelog.cli.json`](permissions/nightly-changelog.cli.json) | [`.github/workflows/loop-nightly-changelog.yml`](../../.github/workflows/loop-nightly-changelog.yml) | Nightly (05:07 UTC) + manual |

`#025 The fresh-clone loop` from the adoption shortlist is intentionally **not**
set up here (deferred), matching the current scope.

## Activation (opt-in)

Merging these files does **not** start any scheduled agent. To turn a loop on:

1. Add repository **secret** `CURSOR_API_KEY` (from the Cursor dashboard, ideally
   a service account key). Without it the workflow fails fast with a clear error.
2. Add repository **variable** `ENTITY_LOOPS_ENABLED = "true"` to enable the cron
   schedules. Until then, only manual `workflow_dispatch` runs execute.
3. Optional: repository **variable** `ENTITY_LOOP_MODEL` to override the agent
   model (default `gpt-5`).

Trigger a manual trial from the Actions tab ("Run workflow") before relying on
the schedule. Each run opens a normal PR on a `loops/<slug>-<timestamp>` branch —
review it like any other change; nothing merges automatically.

## Restricted autonomy

The agent never runs git, `gh`, npm, curl, or deploy commands (denied in each
`*.cli.json`) and can only write the files that loop is allowed to touch
(Markdown docs for #001, `CHANGELOG.md` for #008). The deterministic
`scripts/loops/open-loop-pr.sh` step owns branch/commit/push/PR using the
workflow's `GITHUB_TOKEN`.

## Local dry run

```bash
# Changelog window that #008 curates (safe, read-only; writes .loop-cache/):
node scripts/changelog-window.mjs --days 1 --out -

# The docs-sweep and changelog prompts are plain Markdown you can hand to
# `cursor-agent -p --force --model <model> "$(cat .cursor/loops/001-docs-sweep.md)"`.
```

## Retirement

- **#001** — retire after two consecutive runs find no actionable drift, or once
  `scripts/update-docs.sh` is extended to reconcile prose docs.
- **#008** — retire/fold in if a hosted release-notes system takes over user
  communication.
