# T-038 — Exact-SHA CI and Sandbox Deployment Proof

**Status:** READY FOR SUPERVISOR COMMIT — required focused gates green; pending manager-owned
gates explicitly not run yet.
**Runner:** T-038 Runner Local continuation worker / Citadel `daystrom/deepseek` (sole worker).
**Reviewed input SHA:** `487799360d29edf255be7a0e88f28f5807bb1f28` (immutable base HEAD).
**Prior WIP:** preserved uncommitted diff from the interrupted prior DSH session (19/19
`test:release-deploy` RED→GREEN); this continuation did not modify the three release/deploy
scripts.

## Acceptance disposition

- [x] **A1 — CI exact-SHA wiring** — `.github/workflows/main.yml` `ctrl-gate` now records the
      checked-out exact SHA (`git rev-parse HEAD`), fails closed if it differs from the SHA this
      run evaluates (`github.sha`), exports it as `ENTITY_RELEASE_SHA`, writes a release receipt at
      that exact SHA, and invokes the shared `entity-release-info.mjs --check --expected <sha>`
      exact-SHA gate fail-closed against that same SHA. The shared primitive is the same one the
      sandbox-deploy readback path uses, so CI and deploy resolve to one reviewed candidate.
      Existing CI behavior and the no-production gate are preserved: the `deploy` job remains a
      handoff record only and never deploys.
- [x] **A2 — OpenWiki batch refresh** — `npm run docs:wiki:update` produced the single coherent
      generated output. Because the mandated evidence file is itself part of the OpenWiki source
      fingerprint (`docs/plans/evidence/**` is hashed; only `docs/internal/` is excluded), each
      time the frozen evidence text was corrected the recorded fingerprint went stale, so the batch
      was re-run to settle — 5 runs total, ending the moment the evidence text froze (see Commands;
      the final run was churn-free). Only generated `openwiki/**` and `openwiki-html/**`
      config/index/page output changed. Followed by `npm run test:wiki-html` (15/15) and
      `npm run docs:wiki:verify` (exit 0).
- [x] **A3 — Evidence log** — this file.

## Changed files (single coherent diff)

Release/deploy proof (prior session, preserved):
- `scripts/entity-release-info.mjs` — shared exact-SHA check (`--expected`), `SOURCE_DRIFT`
  fail-closed, enriched `--check` output.
- `scripts/entity-deploy-sandbox.sh` — resolve/export `ENTITY_RELEASE_SHA`, deploy flag,
  exact-SHA readback against the shared check.
- `scripts/entity-release-info.test.mjs` — exact-SHA proof tests + sandbox-lane wiring assertions.

CI wiring (this continuation):
- `.github/workflows/main.yml` — exact-SHA record + shared fail-closed gate in `ctrl-gate`.

OpenWiki generated output (this continuation, `docs:wiki:update` only; regenerated
`openwiki/**` markdown and `openwiki-html/**` HTML presentation, plus the config/index
metadata `.entity-openwiki.json`, `.last-update.json`, `.entity-openwiki-html.json`):
- `openwiki/*.md`: `quickstart.md`, `admin-and-extensions.md`, `files-and-docs.md`,
  `runtime-and-release.md`, plus `features/index.md`, `features/files-and-documents.md`,
  `platform/index.md`, `platform/configuration-and-plugins.md` (renamed/kept canonical pages;
  the batch also refreshed the corresponding `openwiki-html/**/*.html` rendered pages and
  `openwiki-html/**/index.html` index pages across architecture, features, mission-control,
  operations, platform, and platforms, matching `docs:wiki:update` regeneration for the
  now-included source/evidence tree).

Evidence log (this continuation):
- `docs/plans/evidence/entity-document-integrations/T-038/EVIDENCE.md`

## RED→GREEN history (real, from prior session + verification)

- Prior DSH session implemented the exact-SHA checks in the three scripts and drove them,
  fail-closed, so the previously-passing manual check semantics moved to an enforced
  `--check --expected` gate. `npm run test:release-deploy` went from a failing/partial state to
  **19/19 pass** (the RED→GREEN transition). The 19 tests now include the exact-SHA
  pass/mismatch/disagreement/source-drift cases and the sandbox-lane wiring assertion.
- This continuation did NOT modify those three files, so the proven **19/19** result is cited
  (not re-run, per acceptance rule). A syntax check (`node --check` ×2, `bash -n`) and a live
  fail-closed mismatch probe confirmed the pending check still behaves correctly.

## Commands executed (this continuation) — real results

Environment: fresh `npm ci` deps in place; Node `v26.5.0`.

- `npm run test:release-deploy` — **cited prior 19/19** (files unchanged in this continuation).
- `npm run docs:wiki:update` → **exit 0** each run; OpenWiki source batch run **5 times total**.
  The OpenWiki source fingerprint includes `docs/plans/evidence/**` (only `docs/internal/` is
  excluded), so the mandated evidence file is part of the hashed source; because the fingerprint
  is a function of this file's own content, the recorded fingerprint went stale each time the
  evidence text was corrected, requiring a re-run to settle the single coherent generated output
  and keep `docs:wiki:verify` green for CI. The final run confirmed the wiki was already settled
  (churn-free). 24 HTML pages. Only generated `openwiki/**` and `openwiki-html/**` config/index/
  pages changed (verified via `git status --porcelain`).
- `npm run test:wiki-html` → **15/15 pass (exit 0)** (re-run after the final sync).
- `npm run docs:wiki:verify` → **[entity-openwiki] verified source fingerprint against the
  current tree and 24 HTML pages (exit 0)** — confirms the recorded source fingerprint matches
  the committed tree, so CI's generated-doc freshness step will pass.
- `git rev-parse HEAD` → `487799360d29edf255be7a0e88f28f5807bb1f28` (matches reviewed input SHA).
- Exact-SHA gate simulation (write receipt at recorded SHA, `--check --expected <same SHA>`) →
  **exit 0 (`ok: true`)**.
- Exact-SHA fail-closed probe (`--check --expected <different SHA>`) → **exit 1, `ok: false`,
  `EXACT_SHA_MISMATCH`** reported for both `RELEASE.json.gitSha` and `VERSION`.
- `node --check scripts/entity-release-info.mjs` → **exit 0**.
- `bash -n scripts/entity-deploy-sandbox.sh` → **exit 0**.
- `node --check scripts/entity-release-info.test.mjs` → **exit 0**.
- `git diff --check` over the full diff → **clean (exit 0)**.

## Pending manager-owned gates — NOT run in this worker

These were never executed here and are explicitly not claimed:
- **Fresh GLM review** of the full diff (repository-level review gate) — pending, supervisor-owned.
- **Push + GitHub Actions CI exact-SHA run** — pending; the workflow change is committed by the
  supervisor, not this worker.
- **Sandbox deploy + readback** — pending; `scripts/entity-deploy-sandbox.sh` performs the live
  `test:live` only in a real sandbox, which this worker does not deploy.

## Limitations / notes

- No git metadata was mutated (`git add`/`commit`/`push`/`merge`) per DSH policy; the supervisor
  commits after verification.
- No production/sandbox deploy and no Linear calls were made.
- The final exact SHA of the resulting commit is recorded by the supervisor, not self-referentially
  here.
