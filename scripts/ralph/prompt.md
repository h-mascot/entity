# Entity - AI-Native Workspace

You are building features for Entity, an AI-native workspace app where humans watch AI agents work in real time.

## Project Structure
- `packages/app/src/` - React frontend (Vite + React 19)
- `packages/app/src/components/` - UI components
- `packages/app/src/hooks/` - React hooks
- `packages/server/` - Express + WebSocket server

## Tech Stack
- React 19 + TypeScript
- CodeMirror 6 (editor)
- Tailwind CSS
- WebSocket (ws)
- Express server

## Current State
The app has: FileTree, CodeMirrorEditor, MarkdownPreview, QuickSwitcher, useWebSocket hook.
Main app component: `packages/app/src/App.tsx`

## Rules
1. Use TypeScript for all new files
2. Use Tailwind CSS for styling (no CSS files)
3. Keep components small and focused
4. Use Zustand for state management if needed (install if not present)
5. All new components go in `packages/app/src/components/`
6. All new hooks go in `packages/app/src/hooks/`
7. Use existing patterns from App.tsx for API calls and WebSocket

## Task
Read prd.json, find the FIRST story with `passes: false`, implement it, test that the app builds successfully (`npm run build` in packages/app), then mark the story as `passes: true` in prd.json.

After implementation, update progress.txt with what you learned.
