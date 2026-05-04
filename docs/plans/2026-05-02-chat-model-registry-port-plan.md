# Chat Model Registry Port Plan

## Task
Finish Chat model selection so Entity shows real agent-scoped models from OpenClaw and Hermes instead of a static global list.

**MC Task:** not assigned
**Created:** 2026-05-02
**Agent:** Codex
**Status:** IN PROGRESS

## Context
The Enterprise-mounted repo at `/Volumes/enterprise/Code/Entity` contains a completed chat model registry context file and implementation. The Mac repo is the source of truth for normal Entity code changes, so this work ports the relevant implementation here without touching unrelated dirty files.

Key constraints:
- Use server-side agent-scoped model policy, not only UI filtering.
- Do not shell out to `openclaw models` on every Chat UI request.
- Keep local/Ollama models as availability metadata unless an agent policy allows them.
- Include Hermes/Book handling through env/config discovery.

## Dependencies
- [x] Entity context loaded from `docs/context/entity-context.md`
- [x] Enterprise plan found at `/Volumes/enterprise/Code/Entity/docs/plans/2026-05-01-chat-model-registry-codex-context.md`
- [x] Existing Mac dirty tree inspected before touching chat files
- [x] Registry implementation ported before route wiring
- [x] Route wiring complete before app UI model loading changes
- [x] Tests complete before reporting done

## Plan

- [x] Step 1: Port backend chat model registry and tests
  - **Files:** `packages/server/src/routes/chat-model-registry.ts`, `packages/server/src/routes/chat-model-registry.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/routes/chat-model-registry.test.ts`
- [x] Step 2: Wire `/api/chat/models` and `/api/chat/send` to server-side registry validation
  - **Files:** `packages/server/src/routes/chat.ts`
  - **Verify:** `cd packages/server && npx vitest run src/routes/chat-model-registry.test.ts`
- [x] Step 3: Update Chat UI to load models for the selected agent/channel
  - **Files:** `packages/app/src/hooks/useChat.ts`, `packages/app/src/components/Chat/MessageInput.tsx`, `packages/app/src/components/Chat/ChatOfflineProvider.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 4: Run server and app verification
  - **Files:** same as above
  - **Verify:** `cd packages/server && npm run build && npx vitest run`, `npm --prefix packages/app run build`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 21:48 | Context | done | Loaded Mac context and Enterprise implementation plan |
| 21:48 | Plan | in progress | Active plan created before edits |
| 21:50 | Step 1 | done | Registry test passed locally |
| 21:56 | Step 3 | done | App build passed after fixing existing Docs TTS provider option type |
| 21:58 | Step 4 | done | Registry tests 9/9, server build passed, app build passed |
| 21:58 | Live read | done | Ada/OpenClaw: 114 models from openclaw-config; Book/Hermes: 53 models from hermes-config |

## Files Touched
- `docs/plans/2026-05-02-chat-model-registry-port-plan.md` — created — compaction-safe execution plan
- `docs/plans/ACTIVE_PLAN.md` — updated — active copy of this plan
- `packages/server/src/routes/chat-model-registry.ts` — created — agent-scoped model registry
- `packages/server/src/routes/chat-model-registry.test.ts` — created — registry tests
- `packages/server/src/routes/chat.ts` — modified — model route and send validation wiring
- `packages/app/src/hooks/useChat.ts` — modified — model option state and loading
- `packages/app/src/components/Chat/MessageInput.tsx` — modified — scoped dropdown display
- `packages/app/src/components/Chat/ChatOfflineProvider.tsx` — modified — dynamic model lookup
- `packages/app/src/App.tsx` — modified — fixes existing Docs TTS option type so app build can pass

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step without reverting unrelated dirty files.
5. Verify with the commands listed above before reporting done.

## Done
- [x] All steps complete
- [x] Tests pass
- [x] ACTIVE_PLAN.md updated with final checkpoint
