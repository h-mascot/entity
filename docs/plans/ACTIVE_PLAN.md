# OpenWiki HTML presentation plan

## Task

Publish deterministic HTML presentation pages for Entity's canonical OpenWiki Markdown and make them the primary read-only Entity Wiki source.

**MC Task:** Discord #entity Docs request 1534269109636694166
**Created:** 2026-08-04
**Agent:** EntityBuilder
**Status:** IN PROGRESS

## Context

Henry prefers the generated OpenWiki documents as HTML rather than visible Markdown/frontmatter. Markdown must remain canonical for source control and agents. HTML must be deterministic, script-free, read-only, freshness-verified, shipped through the normal source → GitHub → sandbox workflow, and browser-tested. Production promotion requires separate approval.

## Plan

- [x] Inspect current main and architecture.
- [ ] Add and run RED tests.
- [ ] Implement renderer, verification, source config, and deployment wiring.
- [ ] Generate/audit HTML output and run focused/full gates.
- [ ] Review, commit, PR, CI, merge, and deploy exact main to sandbox.
- [ ] Browser/API verify, publish evidence, update LIVE.

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-08-04 | Inspection | ✅ | Clean isolated worktree at current main. |
| 2026-08-04 | RED | ⏳ | Tests being written before implementation. |

## Files Touched

- `docs/plans/2026-08-04-openwiki-html-presentation-plan.md`
- `docs/plans/ACTIVE_PLAN.md`

## Resume Instructions

Use `/Users/enterprise/Code/entity-openwiki-html-20260804`; preserve dirty canonical source. Read the dated full plan, inspect diff, continue first unchecked step. Production requires explicit approval.
