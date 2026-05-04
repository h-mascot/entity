# Entity - MC Agent-Native Editor Build

You are implementing the MC Agent-Native Editor PRD in the Entity monorepo.

## Project Structure
- `packages/app/src/` - React frontend (Vite + TypeScript + CodeMirror)
- `packages/server/src/` - Express + WebSocket server
- `packages/db/src/` - SQLite repositories and schema bootstrap
- `docs/` - project memory and implementation artifacts

## Required Product Decisions (Locked)
1. Scope: Deliver P0 + P1 in one implementation stream.
2. Metadata persistence: SQLite is canonical for collaboration metadata.
3. Agent integration: real OpenClaw integration (no simulation-only mode).
4. Read-only source policy: allow collaboration overlays, block source text mutations.
5. Auth: support per-agent bearer tokens and service tokens.
6. Service token rule: `X-Entity-Actor` is mandatory and must map to known actor IDs.

## Rules
1. Implement exactly one story per loop: the first story with `passes: false`.
2. Keep changes additive and avoid regressing legacy file workflows.
3. For source mutations, enforce source capabilities using existing adapter infrastructure.
4. Never trust actor identity from request body; derive actor from auth middleware only.
5. Preserve strict TypeScript correctness.
6. Stay tightly scoped:
   - Only read/modify files necessary for the current story.
   - Do not open unrelated PRDs/specs (e.g. `PRD.md`, `INTEGRATION-SPEC.md`) unless explicitly required by acceptance criteria.
   - If you need product intent, use `docs/MC-AGENT-NATIVE-EDITOR.md` and/or `docs/MC-AGENT-NATIVE-EDITOR-BUILD-PLAN.md` only.
6. After implementing a story:
   - Run relevant build gates (at least package(s) touched; prefer db+server+app when uncertain).
   - Mark only that story `passes: true` in PRD JSON if acceptance criteria are satisfied.
   - Append a concise note to progress file.

## Validation Commands
- `npm --prefix packages/db run build`
- `npm --prefix packages/server run build`
- `npm --prefix packages/app run build`

## Quality Bar
- Do not claim story completion without passing acceptance criteria.
- Avoid placeholder behavior when the story requires end-to-end functionality.
- Keep interfaces typed and explicit.
