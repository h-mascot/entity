# Notes — Entity Bottom-Panel TUI MVP

## Constraints
- Strict scope: replace only the bottom Activity Stream panel.
- Do not modify mobile activity tab behavior or other activity surfaces.
- Source of truth repo is `~/Code/entity`.
- Requested spec file was not present locally, so implementation scope is derived from the user prompt.

## Current Integration Findings
- `packages/app/src/App.tsx` currently renders a placeholder under the bottom panel toggle.
- `packages/app/src/components/ActivityStream.tsx` remains in use by the mobile `activity` tab and must stay intact.
- `packages/app/src/hooks/useWebSocket.ts` already manages a shared app WebSocket connection against `runtime.wsUrl`.
- `packages/server/src/index.ts` already runs an HTTP server plus a `ws` server with a global client set.

## Runtime Findings
- `@xterm/xterm` and `@xterm/addon-fit` were installed successfully in `packages/app`.
- macOS has `/usr/bin/script`, which can provide a local pseudo-terminal wrapper without introducing a native PTY dependency.
- macOS also has `/usr/bin/ssh`, so SSH-backed targets can use host aliases with `ssh -tt`.

## MVP Direction
- Bottom panel gets a new dedicated terminal component.
- Server exposes allowlisted targets: `ada-gw`, `spock`, `scotty`, `mac`, `enterprise`.
- `ada-gw` uses a local shell session.
- Other targets use SSH-backed sessions.
- Single-session UI is acceptable for MVP, but data structures should leave room for multi-tab sessions later.

## Verification Results
- `cd packages/server && npx vitest run src/terminal.test.ts` passed.
- `cd packages/server && npm run build` passed.
- `npm --prefix packages/app run build` passed.
- `cd packages/server && npx vitest run` did not pass, but the failures are outside this feature:
  - `better-sqlite3` ABI mismatch in existing repository tests.
  - sandbox `EPERM` on tests that try to bind local servers.
  - preexisting unrelated assertion drift in `src/task-pagination.test.ts`.
  - preexisting route/test harness issues in docs/plugin/agent-api/swarm suites.
