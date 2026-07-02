# Changelog

All notable, user- and operator-facing changes to Entity are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Entity is pre-1.0 and not yet versioned, so entries are grouped by date. Older
history lives in git.

This file was seeded by the nightly changelog loop (`#008`) from the ~2 weeks of
history preceding its first run. Going forward the loop appends a dated section
per run and skips internal-only churn (chore/ci/refactor) that users and
operators do not see.

## 2026-07-01 — Initial changelog (backfill of the preceding ~2 weeks)

### Added
- **Mission Control board:** clickable stat filters, bulk select and move,
  per-card hover checkbox, star/bookmark tasks with a starred filter, and
  assignee options limited to active agents and users (#8).
- **Review flow:** review-decision modal on review → done, with bulk
  Move-to-Done for review tasks routed through the modal.
- **Task comments:** @mention agents in task comments with live refresh;
  @mentioned agents can move tasks between columns from a comment.
- **Task Master agent:** Azure OpenAI / OpenAI-compatible custom base-URL
  provider support, plus a task-comment @mention responder.
- **Documents:** comments with agent replies, a collaboration sidebar,
  native markdown storage and versioning seams, and a receipt viewer with
  explicit missing-evidence states.
- **Files:** CSV/TSV rendered as tables with multiformat document support;
  permission-safe search envelopes with index visibility.
- **Notifications:** canonical inbox schema and inbox UI, routing policy, and an
  owner accountability inbox.
- **Google Docs (read-only):** metadata connector plus external-document preview
  UI, with restricted previews suppressed.
- **Releases:** immutable sandbox release switch and Entity release identity
  checks that emit `RELEASE.json` / `VERSION` (#12, #13).
- **Automation:** recurring agent loops — the docs sweep (`#001`) and this
  nightly changelog (`#008`) — set up as opt-in scheduled workflows.

### Fixed
- **Releases:** runtime dependencies are now bundled in release artifacts (#15)
  and immutable release staging was hardened (#14).
- **Mission Control:** board no longer blanks after navigation; task panel
  dismisses on scrim click and has an opaque background; viewing an output doc
  returns to the originating task; the review-completion gate only applies to
  review-gated tasks.
- **Onboarding:** the Help button is now functional.
- **Security:** closed token-auth gaps and a production DB fallback; removed an
  unused `/api/config` public allowlist entry.
- **Database:** deleting a task now purges its child rows so a recycled task id
  never inherits a previous task's comments, projects, or activity.

### Changed
- Delivered the Entity Phase 2 platform foundation (THE-21 … THE-95):
  org-scoped workspace hierarchy, a layered permission evaluator,
  Task Master routing / claim / nudge / owner-escalation, review and human
  gates, activity-event provenance, the document-artifact object schema, and
  phase-2 release observability, feature flags, and rollback tooling.

### Documentation
- Added the product Vision section and Cursor Cloud setup notes to `AGENTS.md`,
  documented Azure / OpenAI-compatible agent provider setup, and recorded the
  Loop Library adoption decision (`docs/loop-library-adoption.md`).
