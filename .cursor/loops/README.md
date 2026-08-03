# Entity agent loops

Recurring [Forward Future Loop Library](https://signals.forwardfuture.com/loop-library/)
loops adopted by Entity, per the decision in
[`docs/loop-library-adoption.md`](../../docs/loop-library-adoption.md).

Entity uses two reviewable documentation loops. Loop #001 runs OpenWiki against
the current source and opens a generated-wiki PR. Loop #008 uses a restricted
Cursor cloud agent for the changelog. Deterministic workflow steps own all
git/PR actions; neither loop merges its own output.

| Loop | Prompt | Permission profile | Workflow | Cadence |
|---|---|---|---|---|
| **#001 Entity OpenWiki** | [`openwiki/INSTRUCTIONS.md`](../../openwiki/INSTRUCTIONS.md) | Pinned OpenWiki + GitHub Copilot | [`.github/workflows/loop-docs-sweep.yml`](../../.github/workflows/loop-docs-sweep.yml) | After successful main deploy handoff + weekly + manual |
| **#008 Nightly changelog** | [`008-nightly-changelog.md`](008-nightly-changelog.md) | [`permissions/nightly-changelog.cli.json`](permissions/nightly-changelog.cli.json) | [`.github/workflows/loop-nightly-changelog.yml`](../../.github/workflows/loop-nightly-changelog.yml) | Nightly (05:07 UTC) + manual |

`#025 The fresh-clone loop` from the adoption shortlist is intentionally **not**
set up here (deferred), matching the current scope.

## Activation

Loop #001 runs after each successful `main` CI/deploy handoff using GitHub Copilot
and the short-lived workflow `GITHUB_TOKEN`; no model-provider secret is needed.
Set optional repository variable `ENTITY_OPENWIKI_MODEL` to override
`gpt-5.4-mini`. Its weekly schedule remains controlled by
`ENTITY_LOOPS_ENABLED=true`; manual runs are always available.

Loop #008 still requires repository secret `CURSOR_API_KEY`. Optional variable
`ENTITY_LOOP_MODEL` overrides its default model.

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

# Generate or verify the Entity feature wiki locally:
npm run docs:wiki:update
npm run docs:wiki:verify
```

## Retirement

- **#001** — retire after two consecutive runs find no actionable drift, or once
  `scripts/update-docs.sh` is extended to reconcile prose docs.
- **#008** — retire/fold in if a hosted release-notes system takes over user
  communication.
