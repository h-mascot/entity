# T-038 — Exact-SHA CI and Sandbox Deployment Proof

**Status:** READY FOR SUPERVISOR COMMIT — repair diff is coherent and all required focused
gates are green; manager-owned reruns (CI, sandbox deploy) are explicitly NOT claimed here.
**Runner:** T-038 pinned Runner Local implementation worker / Citadel `daystrom/deepseek`.
**Clean base:** `81bd88041c3b17b912570b389288bfb9c90b4052` (exact clean base this worker started
at; working tree was clean before these edits).
**Final commit SHA:** NOT recorded here — the supervisor commits and records it; no commit/push/
CI/deploy rerun was performed by this worker.

## Scope of this repair (T-038)

One scoped repair after live CI + sandbox proof surfaced **two material blockers**. This diff
repairs exactly those blockers, plus the tightly-coupled post-restart readiness assumption, and
adds focused deterministic proof. Production config, DBs, and product features are untouched.

- **Blocker 1 — exact-SHA ambient leak.** GitHub Actions run **32730583420** failed because the
  workflow wrote `ENTITY_RELEASE_SHA` to `GITHUB_ENV`. That ambient value leaked into the later
  `entity-openwiki-lib.test.mjs` temporary-repository deploy test, where `deploy.sh` aborted on a
  spurious `ENTITY_RELEASE_SHA ... does not match configured source checkout` mismatch **before**
  reaching the intended branch-mismatch assertion. Reproduced deterministically at base by
  running the openwiki test with an ambient `ENTITY_RELEASE_SHA` set to the repo HEAD SHA: the
  `deploy rejects source subdirectories, dirty bypasses, and branch mismatches` test failed with
  `ENTITY_RELEASE_SHA ... does not match configured source checkout ...` instead of
  `does not match configured source branch`.
  - **Repair:** the exact-SHA gate stays **fail-closed** (`SOURCE_SHA` must equal `github.sha`,
    `exit 1` on mismatch), but the candidate SHA is now scoped to the gate step by removing the
    `>> "$GITHUB_ENV"` write. The value is passed inline to the shared
    `entity-release-info.mjs --check --expected <sha>` gate and is no longer emitted as a
    job-wide ambient variable, so unrelated later `node --test` steps are not contaminated.
  - **Regression proof:** new test `exact-SHA gate stays fail-closed without leaking
    ENTITY_RELEASE_SHA to later steps` asserts the fail-closed gate is present **and** that
    `ENTITY_RELEASE_SHA` is not written to `$GITHUB_ENV` (no `ENTITY_RELEASE_SHA ... GITHUB_ENV`
    in the workflow). Green with and without an ambient `ENTITY_RELEASE_SHA`.

- **Blocker 2 — native managed-storage broker omitted from deploy.** The allowed exact-SHA
  sandbox deploy built and synced the TypeScript server but did not compile/sync the required
  native managed-storage broker. The runtime crash-looped with **ENOENT** at
  `packages/server/dist/server/native/managed-storage-broker/.build/broker` (the path the compiled
  server resolves via `__dirname/../../native` from `dist/server/src/fs`). The manager manually
  built and installed the broker to restore sandbox health — a manual mitigation, not a durable
  deploy path.
  - **Repair:** the deployment path is now self-contained. `deploy.sh` invokes
    `scripts/build-managed-storage-broker.mjs` during the server build (before the server-dist
    sync), which compiles the native broker, runs its direct C tests, and **installs the
    executable to the runtime path** `packages/server/dist/server/native/managed-storage-broker/
    .build/broker`, which the existing server-dist rsync carries to the deployed runtime before
    restart. It fails closed on any compile/test/install error rather than shipping a broken lane.
  - **Deploy-contract coverage:** two new tests in `entity-release-info.test.mjs` —
    (1) `deploy self-contains the native managed-storage broker build and runtime install`
    asserts `deploy.sh` invokes the build after the server TS build and before the sync, and that
    the build tool installs the executable at the runtime path; (2) `native managed-storage broker
    build installs an executable at the deployed runtime path` actually runs the build and asserts
    the installed runtime artifact exists, is non-empty, and is executable (fail-closed).

- **Blocker 3 — blind post-restart assumption.** The `sleep 4` + single `/api/tasks` curl after
  restart produced a false `TASK COUNT DROPPED`/zero-task failure whenever a normal startup ran
  long, and masked the true crash reason. It is now a **bounded readiness poll** (default 20
  attempts × 2 s, `ENTITY_DEPLOY_READY_ATTEMPTS` overridable) against `/api/tasks`; it reports a
  real ready-timeout failure when the runtime never comes up (e.g. the missing-broker crash-loop),
  and does not produce a false zero-task failure on a normal slow startup. Task-count
  non-regression (`NEW_COUNT < TASK_COUNT` still aborts) and the exact-SHA readback remain
  fail-closed.

## Changed files (single coherent uncommitted diff — all in authorized scope)

- `.github/workflows/main.yml` — exact-SHA gate stays fail-closed; `ENTITY_RELEASE_SHA` is no
  longer written to `$GITHUB_ENV` (blocker 1).
- `deploy.sh` — build/install the native broker during the server build; bounded readiness poll
  replacing the blind sleep (blockers 2, 3).
- `scripts/build-managed-storage-broker.mjs` — compile+test the native broker and install the
  executable to the deployed runtime path (blocker 2).
- `packages/server/native/managed-storage-broker/.gitignore` — new: ignores the compiled `.build/`
  source-tree output so build artifacts are not committed.
- `scripts/entity-openwiki-lib.test.mjs` — new deterministic regression test for the ambient-leak
  fix (blocker 1).
- `scripts/entity-release-info.test.mjs` — new deploy-contract coverage proving the native broker
  build/sync is present and fail-closed (blocker 2).
- `docs/plans/evidence/entity-document-integrations/T-038/EVIDENCE.md` — this truthful log.

No production config, DB files, or product features were modified. `packages/server/native/
managed-storage-broker/.build/` is a gitignored (never-committed) build artifact.

## RED→GREEN / proof (real, this worker)

- **Blocker 1 reproduced** at base: `ENTITY_RELEASE_SHA="$(git rev-parse HEAD)" node --test
  scripts/entity-openwiki-lib.test.mjs` → the temporary-repo deploy test FAILED with the spurious
  `ENTITY_RELEASE_SHA ... does not match configured source checkout ...` (not the intended
  branch-mismatch assertion). After the fix, the same suite is **32/32 pass** both with and without
  the ambient variable (the regression test now asserts the workflow no longer emits it).
- `node --test scripts/entity-openwiki-lib.test.mjs` → **32/32 pass (exit 0)**.
- `npm run test:release-deploy` → **21/21 pass (exit 0)** — includes the two new blocker-2
  deploy-contract tests (the running one compiled the native broker, ran its direct C tests, and
  asserted the runtime install).
- Native broker build/direct tests: `node scripts/build-managed-storage-broker.mjs` → **exit 0**,
  `managed-storage-broker native core and IPC entrypoint: compile and direct tests passed`, and
  installed executable at `packages/server/dist/server/native/managed-storage-broker/.build/broker`
  (verified: regular file, non-empty, executable).
- `npm run test:wiki-html` → **15/15 pass (exit 0)**.
- Syntax checks: `bash -n deploy.sh`, `bash -n scripts/entity-deploy-sandbox.sh`,
  `node --check scripts/build-managed-storage-broker.mjs`, `node --test ...` all **exit 0**.
- `git diff --check` → **clean (exit 0)**.

## Pending manager-owned rerun gates — NOT run/claimed in this worker

- **Push + GitHub Actions CI rerun** of the repaired workflow (must confirm the failing run
  #32730583420 case now passes) — pending, supervisor-owned after commit.
- **Sandbox deploy + exact-SHA readback + `test:live`** rerun proving the self-contained broker
  lands at the runtime path and the sandbox serves a healthy task count without manual broker
  install — pending, supervisor-owned.
- **Fresh GLM review** of the full diff — pending, supervisor-owned.

## Limitations / notes

- No git metadata was mutated (`git add`/`commit`/`push`/`merge`) — the supervisor commits the one
  coherent uncommitted diff.
- No production/sandbox deploy, no DB write, and no Linear call was made by this worker.
- **Supervisor OpenWiki reconciliation:** the worker correctly left the generated wiki stale after
  changing fingerprinted release/deploy sources. Before commit, the manager expanded same-issue T-038
  scope to the required generated `openwiki/**` and `openwiki-html/**` outputs, ran one final
  `npm run docs:wiki:update`, then proved `test:wiki-html` **15/15** and
  `docs:wiki:verify` **exit 0**. After this evidence correction, the manager reran the update once
  more so the immutable external verifier receipt—not this source-controlled file—binds the final
  source fingerprint. This is the final CI-freshness reconciliation for the repaired source tree, not a worker claim.
- The final exact SHA of the resulting commit is recorded by the supervisor, not self-referentially
  here; CI/deploy reruns are not claimed because they were not performed.
