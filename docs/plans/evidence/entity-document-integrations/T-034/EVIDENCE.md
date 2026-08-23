# T-034 — Provider administration UX evidence

Reviewed base: `b7bf804b872c2cc6933a2f8c711ee42028a1a1ea`

## Scope

Implemented only the named app paths:

- `packages/app/src/components/settings/DocsSettings.tsx`
- `packages/app/src/components/document-integrations/ProviderSettings.tsx`
- `packages/app/src/components/document-integrations/ProviderSettings.test.ts`

The named server path `packages/server/src/routes/document-integrations.ts` was reviewed and explicitly ruled out: its existing provider-neutral API already exposes typed, fail-closed capability, destination, write-policy, confirmation, and degraded-state behavior; T-034's administration surface is a readout/staged UX and does not require a server route change. No same-issue architectural seam justified touching it.

The UX shows connection health, exact destination policy, explicit write mode, authorization evidence, diagnostics, and local Office readiness. Write status remains locked unless independent capability/authorization/destination gates are proven. It never displays credentials or raw tokens, and confirmation is explicitly not treated as a write switch.

## Verification

- `git diff --check` — PASS (exit 0).
- `npm --prefix packages/app run build` — PASS (exit 0; Vite build completed; existing chunk-size warnings only).
- `cd packages/server && npm run build` — PASS (exit 0).
- `npm --prefix packages/app test -- --test-name-pattern='local Office readiness'` — BLOCKED/FAIL (exit 1). The app's Node test harness failed to load the existing TypeScript test environment across the suite, including the new test, with a ts-node/Node v26 loader exception; this was not a behavioral assertion failure. The build/typecheck passed.
- `cd packages/server && npx vitest run src/routes/document-integrations.test.ts` — BLOCKED/FAIL (exit 1). The repository's native `better-sqlite3` binding is unavailable for the current Node runtime (`Could not locate the bindings file`), causing 55 setup failures; one pure test passed. No server code changed.
- Browser verification — BLOCKED: no runnable local server/browser verification surface was available in this isolated worker session. App production build is the alternate UI evidence.

No credentials, tokens, tenant secrets, document contents, or operator-specific absolute paths are included in this evidence.

Final commit SHA: to be filled after the single focused commit.
