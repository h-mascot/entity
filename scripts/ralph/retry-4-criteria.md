# Ralph Retry 4 - Pass Criteria

Date: 2026-02-07

## Pass 1 - Runtime Config
- [x] No hardcoded MC/OpenClaw/WebSocket host values in app runtime code.
- [x] App reads API/MC/OpenClaw/WS endpoints from a single runtime config module.
- [x] Vite env types include all new config vars.

## Pass 2 - Shared HTTP + Errors
- [x] Task/activity/sync hooks use a shared request utility.
- [x] Error parsing is consistent across those hooks.
- [x] Fallback endpoint behavior (`/api/*` then `/*`) is preserved.

## Pass 3 - UX Polish
- [x] Clear global status messaging when agents fail to load.
- [x] Activity stream has clearer empty/loading/error signals.
- [x] Top bars improve information hierarchy without changing core layout.

## Pass 4 - Desktop Consolidation
- [x] One canonical desktop packaging path is documented and wired in scripts.
- [x] Legacy `packages/desktop` scripts delegate to canonical `electron` package.
- [x] Root scripts continue to work unchanged.

## Final Verification
- [x] `npm --prefix packages/app run build` passes.
