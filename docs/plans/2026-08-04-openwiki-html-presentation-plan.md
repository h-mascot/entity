# OpenWiki HTML presentation plan

## Task

Publish deterministic HTML presentation pages for Entity's canonical OpenWiki Markdown and make them the primary read-only Entity Wiki source.

**MC Task:** Discord #entity Docs request 1534269109636694166
**Created:** 2026-08-04
**Agent:** EntityBuilder
**Status:** IN PROGRESS

## Context

Henry prefers the generated OpenWiki documents as HTML rather than visible Markdown/frontmatter. Markdown must remain canonical for source control and agents. HTML must be deterministic, script-free, read-only, freshness-verified, shipped through the normal source → GitHub → sandbox workflow, and browser-tested. Production promotion requires separate approval.

Layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Entity Doc Hub chrome                                        │
├──────────────────┬───────────────────────────────────────────┤
│ Wiki navigation  │ Page eyebrow / metadata                   │
│ grouped by area  │ H1                                        │
│ active page      │ description                               │
│                  │ rendered article / tables / code          │
│                  │ previous / next navigation                │
└──────────────────┴───────────────────────────────────────────┘
mobile: native details disclosure → article → previous/next
```

Design uses Entity's dark neutral shell with one cyan accent, Geist/system sans, restrained borders, no card spam, no animation dependency, semantic HTML, visible focus states, and responsive single-column fallback.

## Dependencies

- [x] Step 1 has no dependencies: current `origin/main` isolated at `4c9dd5c`.
- [ ] Step 2 depends on renderer tests existing and failing for the missing module.
- [ ] Step 3 depends on Step 2 RED proof.
- [ ] Step 4 depends on generated HTML being audited and committed.
- [ ] Step 5 depends on green focused/full gates and independent review.
- [ ] Step 6 depends on merged exact main and sandbox private source path update.

## Plan

- [x] Step 1: Inspect OpenWiki, Entity FS, HTML preview, config, CI, and deploy seams.
  - **Files:** read-only inspection
  - **Verify:** architecture notes in this plan and task transcript
- [ ] Step 2: Add RED behavioral and wiring tests.
  - **Files:** `scripts/entity-openwiki-html.test.mjs`, `scripts/entity-openwiki-lib.test.mjs`
  - **Verify:** `node --test scripts/entity-openwiki-html.test.mjs scripts/entity-openwiki-lib.test.mjs` fails for missing HTML renderer/wiring
- [ ] Step 3: Implement deterministic HTML rendering and verification.
  - **Files:** `packages/app/scripts/entity-openwiki-html-lib.mjs`, `scripts/entity-openwiki-html.mjs`, `scripts/entity-openwiki.mjs`, package scripts, `.openwikiignore`, generated `openwiki-html/`
  - **Verify:** focused tests pass; `npm run docs:wiki:render`; `npm run docs:wiki:verify`
- [ ] Step 4: Wire standard setup and immutable deployment.
  - **Files:** config examples, `scripts/entity-setup.js`, `deploy.sh`, tests
  - **Verify:** setup/deploy assertions; release hash changes with HTML content
- [ ] Step 5: Run full verification and reviews.
  - **Files:** final diff
  - **Verify:** focused tests, app/server builds, `npm run ctrl:full`, Web Interface review, Jeff Dean/Luke W/Ryan Singer review, Codex/independent review
- [ ] Step 6: Commit, push, PR, CI, merge, and deploy exact merged main to sandbox.
  - **Files:** GitHub PR and sandbox release
  - **Verify:** exact SHA/path/manifest/assets, source health/read-only 403, browser navigation/mobile route
- [ ] Step 7: Publish evidence and update Entity LIVE.
  - **Files:** EntityBuilder evidence, `memory/LIVE.md`, `memory/todo.md`
  - **Verify:** Entity-facing links return HTTP 200

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-08-04 | Step 1 | ✅ | Current main isolated; canonical worktree preserved dirty; deterministic mirror selected. |
| 2026-08-04 | Step 2 | ⏳ | Writing RED tests before production code. |

## Files Touched

- `docs/plans/2026-08-04-openwiki-html-presentation-plan.md` — created — durable implementation plan
- `docs/plans/ACTIVE_PLAN.md` — updated — compaction recovery

## Resume Instructions

1. Re-read this file fully.
2. Inspect `git status`, `git diff`, and current `origin/main`.
3. Continue from the first unchecked step.
4. Preserve `/Users/enterprise/Code/Entity`; use `/Users/enterprise/Code/entity-openwiki-html-20260804`.
5. Do not promote production without explicit approval.

## Done

- [ ] All steps complete
- [ ] Tests and reviews pass
- [ ] Exact merged main verified in sandbox browser/API
- [ ] Evidence and LIVE context published
