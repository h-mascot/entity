# Entity Phase 2 ClickClack Operations

ClickClack is optional collaboration context around Entity work objects. Entity owns tasks, docs/files, proof trails, review receipts, search, and ObjectRef links. ClickClack owns chat primitives: workspaces, channels, threads, messages, and composer behavior.

## Local And Cloud Modes

- Local development can run without the ClickClack sidecar. Use `ENTITY_CLICKCLACK_SIDECAR=0` for core Entity work when the sidecar checkout is absent.
- The default Entity server still serves task, docs/files, proof/review, search, and ObjectRef APIs when ClickClack is disabled or unreachable.
- Cloud workspaces may not have the ClickClack checkout. Treat that as a valid degraded state, not a setup failure for core Entity.
- If a sidecar is available locally, proxy it through Entity under `/clickclack/*` for UI assets and `/api/clickclack/*` for API calls. Do not expose ClickClack routes as Entity source-of-truth state.

## Proxy And Bridge Paths

- Proxy path: Entity rewrites `/clickclack/*` and `/api/clickclack/*` to the configured ClickClack base URL. The proxy rewrites ClickClack app links back into the embedded Entity namespace.
- Bridge path: Entity may mirror compatibility chat sends into ClickClack through the bridge. Entity stores local chat messages first so a bridge failure can return a degraded response without dropping Entity state.
- Readiness path: `/api/chat/clickclack/readiness` reports `live`, `staged`, `degraded`, `unavailable`, or `not_configured` using the contract in `docs/adr/2026-06-24-clickclack-readiness-contract.md`.
- ObjectRef path: Entity-owned ObjectRef links remain in Entity storage and are permission-filtered before display.

## Degraded Behavior

ClickClack degraded or unavailable states must be visible but not load-bearing:

- Task detail still renders canonical task, proof, docs, and review sections.
- Document objects and evidence artifacts remain writable and readable through Entity APIs.
- Search remains an Entity route and must not require ClickClack readiness.
- Chat sends can return a degraded response when bridge mirroring fails, while preserving local Entity chat state.
- Proxy failures return explicit proxy failure responses instead of masking the outage as successful chat state.

## Smoke Commands

Run focused ClickClack checks:

```bash
cd packages/server && npx vitest run src/clickclack/proxy.test.ts src/clickclack/bridge.test.ts src/routes/chat-clickclack.test.ts src/routes/chat-degraded-core-flows.test.ts
```

Run the full Entity Phase 2 proof gate:

```bash
bash scripts/proof/entity-phase-2-smoke.sh
npm run build
cd packages/server && npm run build && npx vitest run
```

For UI-facing ClickClack work, add browser/DOM proof that degraded readiness is visible while task proof/review/docs remain usable.
