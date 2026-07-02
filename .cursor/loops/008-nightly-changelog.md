<!--
Loop #008 — The nightly changelog (Forward Future Loop Library)
Category: Engineering | Adopted: 2026-07-01 | Trigger: nightly + manual
Authority: read the repo + the prepared window file; edit CHANGELOG.md only;
           NO git/network/deploy.
Success: every user/operator-relevant change in the window is captured, or a
         "No user-facing changes" line is recorded.
Budget: one CHANGELOG.md update per run.
Retire: fold in if a hosted release-notes system takes over user communication.
This whole file is the prompt passed to `cursor-agent` by
.github/workflows/loop-nightly-changelog.yml. A deterministic step runs
`scripts/changelog-window.mjs` first and writes `.loop-cache/changelog-window.md`.
-->

# Loop 008 — Nightly changelog

You are running the **nightly changelog** loop for the Entity repository. Your
job is to turn the merged work from the window into a short, honest,
user- and operator-facing changelog entry.

## Hard boundaries (a restricted-autonomy CI run)

- **Only edit `CHANGELOG.md`** at the repo root. Edit nothing else.
- **Never run git, `gh`, npm, curl, or any network/deploy command, and never
  commit or push.** A separate deterministic CI step opens the pull request.

## Inputs

- `.loop-cache/changelog-window.md` — the commits in this window, already grouped
  (Added / Changed / Fixed / Removed / Documentation / Internal). Treat this as
  raw material, not final copy.
- The existing `CHANGELOG.md` and its established format.

## Method

1. Read the window file and the current `CHANGELOG.md`.
2. Add a new `## YYYY-MM-DD` section at the **top of the entry list** (directly
   below the file's intro, above older dated sections), dated for this run's
   window end. If a section for that date already exists, **update it in place**
   rather than adding a duplicate.
3. Under it, group items into `### Added`, `### Changed`, `### Fixed`,
   `### Removed`, `### Documentation` — omit any group with no entries.
4. Write for a human reader: describe the user- or operator-visible effect, not
   the commit. Collapse many related commits into one clear bullet. Reference PR
   or issue ids (`#NN`, `THE-NN`) when they add value.
5. **Skip internal churn** (chore/ci/refactor/test/style, and internal-only
   plan/proof commits) unless it changes user- or operator-visible behavior.
6. If nothing user- or operator-facing shipped in the window, add the dated
   section with a single `- No user-facing changes.` line.

## Output

- Apply the edit to `CHANGELOG.md`.
- Print a short summary to stdout: the date section written and how many
  user-facing items it captured versus commits skipped as internal.

Never invent a change that is not in the window, and never overstate scope.
