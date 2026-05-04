# Chat Agent Model Registry Plan

## Goal
Implement agent-scoped chat model selection so Chat pulls allowed model lists from agent runtimes/config rather than exposing one global model list. Local models remain availability metadata and are only selectable when allowed by the selected agent.

## Steps
- [x] Backend contract and tests: agent model registry, local inventory metadata, server-side enforcement.
  - Verify: `cd packages/server && npx vitest run src/routes/chat-model-registry.test.ts`
- [x] Wire `/api/chat/models` and `/api/chat/send` to agent-scoped registry.
  - Verify: targeted server tests and `npm --prefix packages/server run build`
- [x] Update Chat UI to request models for selected agent/all agents and avoid stale global options.
  - Verify: `npm --prefix packages/app run build`
- [x] Run full gates and deploy.
  - Verify: `npm run ctrl:full`, `./deploy.sh`
- [x] Browser-test one agent and capture video/screenshot proof.
  - Verify: browser loaded Chat, selected agent, model dropdown scoped, message sent/responded or fallback captured.

## Files Touched
- `packages/server/src/routes/chat.ts`
- `packages/server/src/routes/chat-model-registry.ts`
- `packages/server/src/routes/chat-model-registry.test.ts`
- `packages/app/src/hooks/useChat.ts`
- `packages/app/src/components/Chat/MessageInput.tsx`

## Resume Notes
Start by inspecting current `git status`, then continue at first unchecked step. Do not commit generated `dist`.