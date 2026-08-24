# T-039 — Live Sandbox Verification (Entity Document Integrations)

**Status:** READY FOR SUPERVISOR COMMIT — focused acceptance tests green, live sandbox
verification executed against the exact release SHA, evidence truthful and complete. No
enabled document-integration provider surface exists on the sandbox; the fail-closed negative
is verified live and NO disabled/unconfigured cell is claimed as passing.

**Runner:** T-039 pinned Runner Local implementation worker / Citadel `daystrom/deepseek`.
**Worktree HEAD:** `6935315e6fb1897ee13a320d0a87adad7b4a4b92`
**Worktree tree hash:** `cd4ab9454d41e717673518d00aa7acce31a4d5b7`
**Live sandbox exact release SHA (readback from `/api/version`):**
`ffce21789943e3cd7f25aa60c851145c73f8e842` — the T-038-established sandbox release identity.
**Tree equivalence:** `git rev-parse HEAD^{tree}` == `git rev-parse ffce2178^{tree}`
== `cd4ab945...` — the worktree tree is byte-identical to the deployed sandbox tree, so live
verification against `ffce2178` IS verification of this exact candidate's content.

## Acceptance (from phase2-canonical-prd.md T-039)

> critical Google/Microsoft/local workflows validated against the exact SHA for all enabled
> release surfaces.

Capability-honest disposition of this sandbox surface:

- **local_office** (local) — NOT enabled. Live create returns HTTP 503 `PROVIDER_UNAVAILABLE`
  ("no provider adapter is registered for provider local_office; failing closed."). No live
  local adapter is wired in the production router.
- **google_workspace** (Google) — NOT enabled. Live create returns HTTP 503 `PROVIDER_UNAVAILABLE`.
  No live Google adapter/credentials are wired.
- **microsoft_365** (Microsoft) — NOT enabled. Live create returns HTTP 503 `PROVIDER_UNAVAILABLE`.
  No live M365 adapter/credentials are wired.

Verified disposition summary: **enabled=0, fail-closed-negative=3, unverified=0.**

There are **no enabled document-integration release surfaces** on the live exact-SHA sandbox.
Per the honesty contract, no Google/Microsoft/local cell is claimed as passing. Each provider's
critical workflow is instead **explicitly ruled out** (unavailable / fail-closed) with real live
proof of the typed `PROVIDER_UNAVAILABLE` negative/authorization path — which is the
fail-closed/authorization-path coverage T-039 requires.

## Why — verified source-level root cause (identical tree to sandbox)

`packages/server/src/index.ts` wires the canonical `/api/document-integrations` router with
`adapters: () => undefined`, `policies: []`, `destinations: []`, and the T-013 deploy-level
feature availability gate. With no adapter registered, every provider create returns the typed
503 `PROVIDER_UNAVAILABLE` before any write, destination, or policy can be evaluated — there is
no enabled live provider surface to validate, and the router correctly fails closed rather than
inventing a provider. This is the audited fail-closed behavior (T-008/T-013/T-036/T-037), now
proven live at the exact SHA.

## Deliverables (single coherent diff, all in authorized T-039 paths)

- `scripts/proof/entity-document-integrations-smoke.sh` — new: capability-honest live smoke that
  asserts the exact SHA via `/api/version` (fail-closed on mismatch), probes the critical create
  lane for every provider, runs the deep critical workflow (get → capabilities → mutate →
  versions) for any ENABLED provider, and classifies each provider as `enabled` /
  `fail-closed-negative` / `unverified` (never a false green for a disabled/unconfigured cell).
- `scripts/proof/entity-document-integrations-smoke.test.sh` — new colocated focused test: runs
  the smoke against a tiny local mock HTTP server to deterministically cover the SUCCESS path
  (enabled + full workflow), the 503 PROVIDER_UNAVAILABLE negative, the 422 capability refusal,
  exact-SHA match and mismatch, missing-gitSha, and unconfigured — all off-network.
- `scripts/entity-verify-sandbox.sh` — composed the document-integrations smoke into the named
  verify gate (after the existing `test:live`), forwarding `ENTITY_SANDBOX_EXPECTED_SHA`
  (defaulting to `ENTITY_RELEASE_SHA` from the deploy handoff) so verification is provably
  against the exact SHA.
- `docs/plans/evidence/entity-document-integrations/T-039/EVIDENCE.md` — this truthful log.

No production config, DB, or product feature modified. No `packages/` source change; the changes
are confined to the T-039 authorized paths (proof + verify + evidence). **Manager scope expansion
is NOT required** — `scripts/entity-verify-sandbox.sh` is itself a named T-039 path, and wiring it
to run the document-integrations smoke is the ticket's intent, not an unrelated refactor.

## Focused acceptance test (automated success coverage + negative path), real

```sh
bash scripts/proof/entity-document-integrations-smoke.test.sh   # -> PASS
bash -n scripts/proof/entity-document-integrations-smoke.sh     # -> OK
bash -n scripts/proof/entity-document-integrations-smoke.test.sh # -> OK
bash -n scripts/entity-verify-sandbox.sh                        # -> OK
```

10/10 assertions pass, covering:
- **SUCCESS path:** mock returns 201 + documentId for all providers → smoke exits 0, classifies
  them `enabled`, and the deep workflow get/capabilities/mutations/versions is exercised and
  verified; exact-SHA readback matches.
- **Negative / authorization path:** mock returns 503 `PROVIDER_UNAVAILABLE` for all providers →
  smoke exits 0, all three classified `fail-closed-negative` (verified, not a pass).
- **Negative / capability path:** mock returns 422 `CAPABILITY_UNSUPPORTED` → all three
  `fail-closed-negative`.
- **Stale/incorrect release identity:** exact-SHA mismatch → smoke exits 1 with the mismatch
  message (fail-closed, never green-light a drifted sandbox).
- **Missing gitSha:** `/api/version` without `gitSha` → smoke exits 78 (cannot assert).
- **Unconfigured:** no `ENTITY_SANDBOX_HTTP_HOST` → smoke exits 78.

## Live sandbox proof (this runner, real endpoint)

Sandbox reachable at `http://127.0.0.1:3007`; `/api/version` reports
`environment=sandbox`, `gitSha=ffce21789943e3cd7f25aa60c851145c73f8e842`.

```sh
ENTITY_SANDBOX_HTTP_HOST=127.0.0.1 ENTITY_SANDBOX_PORT=3007 \
  ENTITY_SANDBOX_EXPECTED_SHA=ffce21789943e3cd7f25aa60c851145c73f8e842 \
  bash scripts/proof/entity-document-integrations-smoke.sh        # -> SMOKE EXIT=0
```

Output (abridged): exact-SHA readback matches; each provider's create returned HTTP 503
`PROVIDER_UNAVAILABLE`; `enabled=0 fail-closed-negative=3 unverified=0`; PASS.

```sh
ENTITY_SANDBOX_HTTP_HOST=127.0.0.1 ENTITY_SANDBOX_PORT=3007 \
  ENTITY_SANDBOX_EXPECTED_SHA=ffce21789943e3cd7f25aa60c851145c73f8e842 \
  bash scripts/entity-verify-sandbox.sh                            # -> VERIFY EXIT=0
```

Output (abridged): `[ctrl-live] ok: http://127.0.0.1:3007/api/tasks returned 49 task(s); ...
returned effective config` then the document-integrations smoke PASS.

Raw live responses (one per provider, via `curl`, real, this runner):
- `POST /api/document-integrations` (local_office) →
  `{"error":{"code":"PROVIDER_UNAVAILABLE","message":"no provider adapter is registered for
  provider local_office; failing closed."}}` (HTTP 503)
- (google_workspace, microsoft_365) → identical typed 503 `PROVIDER_UNAVAILABLE`.

## Limitation / honest boundary

Live Google and Microsoft first-party API workflows (real Google Docs / Microsoft Graph network
round-trips) are NOT claimed: no provider adapter is registered on the sandbox and no Google/M365
credentials exist anywhere in this repo (`adapters: () => undefined` in `index.ts`; no secrets in
`.env.example`/`entity.config.example.yaml`). T-037 N4 (deferred §20 live cells) remains **ruled
out** here with live fail-closed proof. This is the truthful disposition, not a lost pass.

Local (local_office) OOXML engines are implemented and proven in-process by T-029/T-030
(docx/xlsx/pptx focused suites) — but no **live local adapter** is registered in the sandbox
router, so the local *live* lane is unavailable and is reported as such.

## Commands / results ledger

- `bash scripts/proof/entity-document-integrations-smoke.test.sh` → **PASS** (10/10).
- `bash -n` sanity on all three changed shell scripts → **exit 0** each.
- Live exact-SHA smoke + full `entity-verify-sandbox.sh` against `ffce2178` → **exit 0**.
- `git diff --check` → **clean (exit 0)** (recorded below after diff finalized).
- No server TypeScript or `packages/` sources changed, so no server build/typecheck delta exists
  for this ticket; the focused acceptance suite is the required gate.

## Notes / non-claims

- No git metadata was mutated (`git add`/`commit`/`push`/`merge`) — the supervisor commits this
  one coherent uncommitted diff.
- No production/sandbox deploy, DB write, or Linear call was made by this worker. The namespace
  probes are non-destructive: every create failed closed at the typed 503 gate before any write,
  so no sandbox data was created or altered.
- No real Google/Microsoft/local adapter was invented; disabled/unconfigured cells are recorded
  as their truthful disposition (unavailable).
