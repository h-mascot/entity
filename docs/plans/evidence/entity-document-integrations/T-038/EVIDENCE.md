# T-038 — Exact-SHA CI and Sandbox Deployment Proof

**Status:** READY FOR SUPERVISOR COMMIT — repair diff is coherent and all required focused
gates are green; manager-owned reruns (CI, sandbox deploy) are explicitly NOT claimed here.
**Runner:** T-038 pinned Runner Local implementation worker / Citadel `daystrom/deepseek`.
**Base for this repair:** exact SHA `034127d6117c8f6de87b67492fd274b5b2dcf71d` (the reviewed
candidate this worker started at; working tree was clean before these edits).
**Final commit SHA:** NOT recorded here — the supervisor commits and records it; no
commit/push/CI/deploy rerun was performed by this worker.

## Scope of this repair (T-038 — second live-gate repair)

This is a **scoped follow-up repair** after the live gates reviewed/approved at exact SHA
`034127d` **failed on two material blockers**. The exact-SHA work itself stayed fail-closed and
correct; these two blockers are in the native broker build portability and the post-restart
readiness contract. Production config, DBs, and product features are untouched.

- **Blocker 1 (new) — Linux GCC rejects the native broker build.** GitHub Actions run
  **32736305747** failed `test:release-deploy` because Linux GCC's
  `-Werror=misleading-indentation` (enabled by the broker build's `-Wall -Werror`) rejects
  `packages/server/native/managed-storage-broker/managed_storage_broker.c` line 86
  (`if (n < 0) return map_errno(); *length = ...;` — a non-braced guard immediately followed
  by an unguarded statement at function-body level on the same line). macOS clang does not flag
  this, so the prior local proof was green while the Linux CI compiler was not.
  - **Repair:** the two **bare** same-line non-braced guard+statement patterns at function-body
    level (the reported line 86 in `msb_read`, and the structurally identical `msb_protocol_validate`
    one-liner that `-Werror` stops just before reporting) were rewritten with braced bodies and
    separate lines. This compiles **portably** under macOS clang and Linux GCC **without weakening**
    any warning flag (the broker still builds with `-Wall -Wextra -Werror -pedantic`, and is also
    verified with the explicit `-Werror=misleading-indentation`). The many other same-line compound
    statements that are wrapped in explicit `{ ... }` blocks are left untouched — GCC does not flag
    those (confirmed by the original file where lines before 86 with the same inner pattern were not
    reported).
  - **Proof:** `node scripts/build-managed-storage-broker.mjs` (compiles the core + test + IPC
    entrypoint, runs the direct C tests, installs the runtime executable) → exit 0; plus a
    `-fsyntax-only` compile of `managed_storage_broker.c` with the explicit
    `-Werror=misleading-indentation` → clean; plus Linux real-GCC verification (see proof section).

- **Blocker 2 (new) — readiness accepted a first-numeric zero response during hydration.** The
  real sandbox deploy at exact SHA `034127d` did install and run the broker and eventually
  preserved all 49 tasks, but deploy.sh's post-restart readiness poll accepted the **first
  NUMERIC** `/api/tasks` response (0) while the configured 49-task DB was still hydrating, then
  aborted with a false `TASK COUNT DROPPED` (`NEW_COUNT < TASK_COUNT`). The eventual recovery to
  49 tasks was real; the abort was a readiness false-negative.
  - **Repair:** readiness now continues polling until the count is **numeric AND at least the
    preflight TASK_COUNT** — a numeric-but-low response (still hydrating) is NOT readiness. The
    contract is factored into a small, deterministically testable helper
    `scripts/entity-readiness-poll.sh` that deploy.sh calls after restart with
    `PROD_BASE_URL` and the preflight `TASK_COUNT`. It still **fails closed** (non-zero) on a
    persistent crash (never a numeric count), a count that never reaches the preflight value
    (a persistent drop), or a deadline/timeout expiry — the old separate `TASK COUNT DROPPED`
    abort is subsumed by this fail-closed readiness gate and removed so a transient hydration dip
    can no longer abort.
  - **Deploy-contract coverage:** four focused determinisitc tests in
    `scripts/entity-release-info.test.mjs` drive the poll with a faked `curl` (no SSH/server):
    (1) hydration `0 → 0 → 49` reaches readiness and returns 49 (no false drop); (2) a persistent
    sub-preflight count fails closed; (3) a never-numeric API (crash) fails closed; (4) a
    deploy.sh source assertion that readiness routes through the helper passing the preflight
    TASK_COUNT and no longer breaks on first-numeric / reintroduces `TASK COUNT DROPPED`.

## Changed files (single coherent uncommitted diff — all in authorized scope)

- `packages/server/native/managed-storage-broker/managed_storage_broker.c` — fix the Linux GCC
  `-Werror=misleading-indentation` rejection by rewriting the two bare same-line guard+statement
  patterns with braced bodies / separate lines (blocker 1).
- `deploy.sh` — route post-restart readiness through the new poll contract (numeric AND >=
  preflight TASK_COUNT), failing closed on crash/drop/timeout (blocker 2).
- `scripts/entity-readiness-poll.sh` — new: the deterministic readiness-contract helper (blocker 2).
- `scripts/entity-release-info.test.mjs` — new: four focused readiness-contract regression tests
  (blocker 2).
- `docs/plans/evidence/entity-document-integrations/T-038/EVIDENCE.md` — this truthful log.

No production config, DB files, or product features were modified.

## RED→GREEN / proof (real, this worker)

- **Blocker 1 reproduced conceptually at base:** run 32736305747 on exact SHA `034127d` failed
  `test:release-deploy` on Linux GCC `-Werror=misleading-indentation` at `managed_storage_broker.c`
  line 86. The prior macOS-clang local build could not see it (clang does not flag the pattern), which
  is exactly the portability gap repaired.
- Native broker build/direct tests: `node scripts/build-managed-storage-broker.mjs` → **exit 0**,
  `managed-storage-broker native core and IPC entrypoint: compile and direct tests passed`, and
  installed executable at `packages/server/dist/server/native/managed-storage-broker/.build/broker`.
- `cc -std=c11 -D_GNU_SOURCE -Wall -Wextra -Werror -Werror=misleading-indentation -pedantic -I.
  -fsyntax-only managed_storage_broker.c` → **clean (exit 0)**.
- **Linux real-GCC cross-check:** compiled `managed_storage_broker.c` under the `gcc:13` container
  with the same `-Wall -Wextra -Werror -pedantic` flags the broker build uses → **clean (exit 0)**
  (see note below for availability).
- `npm run test:release-deploy` → **25/25 pass (exit 0)** — includes the four new blocker-2
  readiness tests and the native broker build/runtime-install tests.
- `npm run test:wiki-html` → **15/15 pass (exit 0)**.
- `node --test scripts/entity-openwiki-lib.test.mjs` → **32/32 pass (exit 0)**.
- Readiness contract exercised deterministically with a faked `curl`: hydration `0→0→49` → success
  (49, exit 0); persistent sub-preflight → fail closed (exit 1); never-numeric → fail closed (exit 1).
- Syntax checks: `bash -n deploy.sh`, `bash -n scripts/entity-readiness-poll.sh`,
  `node --check scripts/entity-release-info.test.mjs` all **exit 0**.
- `git diff --check` → **clean (exit 0)**.

## Pending manager-owned rerun gates — NOT run/claimed in this worker

- **Push + GitHub Actions CI rerun** of the repaired workflow (must confirm the failing run
  #32736305747 `test:release-deploy` / Linux GCC case now passes) — pending, supervisor-owned
  after commit.
- **Sandbox deploy + exact-SHA readback + `test:live` rerun** confirming readiness no longer
  false-positives on the first numeric 0 during hydration and still fails closed on a real crash
  or persistent drop — pending, supervisor-owned.
- **Fresh GLM review** of the full diff — pending, supervisor-owned.

## Limitations / notes

- No git metadata was mutated (`git add`/`commit`/`push`/`merge`) — the supervisor commits the one
  coherent uncommitted diff (including the new `scripts/entity-readiness-poll.sh`).
- No production/sandbox deploy, no DB write, and no Linear call was made by this worker.
- **Supervisor OpenWiki reconciliation:** the worker correctly left generation to the supervisor,
  but this follow-up changes fingerprinted release/deploy/native sources. Before commit, the manager
  ran `npm run docs:wiki:update`, then proved `test:wiki-html` **15/15** and
  `docs:wiki:verify` **exit 0** at the refreshed source fingerprint. Generated OpenWiki and HTML
  outputs are included under the previously recorded T-038 OpenWiki regeneration scope.
- Docker `gcc:13` was used only as a throwaway local cross-check of the C warning (no image or
  files persisted into the repo, and its availability is an environment detail, not a deliverable
  claim — the `-fsyntax-only` clang check above is the committed-reproducible proof).
- The final exact SHA of the resulting commit is recorded by the supervisor, not self-referentially
  here; CI/deploy reruns are not claimed because they were not performed.
