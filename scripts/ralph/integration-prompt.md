# Entity × Mission Control Integration

You are building the unified Entity app that combines:
- **Entity** — AI-native workspace (file editor, agent monitoring, activity stream)
- **Mission Control** — Kanban task board (tasks, activities, SQLite DB)

## Project Structure
- `packages/app/src/` - React frontend (Vite + React 19)
- `packages/app/src/components/` - UI components (ActivityStream.tsx exists)
- `packages/app/src/hooks/` - React hooks (useActivityStream.ts exists)
- `packages/server/` - Express + WebSocket server
- `packages/db/` - SQLite database layer (create this)
- `electron/` - Electron desktop app (create this)
- `packages/mobile/` - Expo mobile app (existing, enhance it)

## Tech Stack
- React 19 + TypeScript
- CodeMirror 6 (editor)
- Tailwind CSS
- WebSocket (ws)
- Express + better-sqlite3
- Electron 34
- Expo SDK 52

## Color Scheme (Mission Control)
```css
:root {
  --bg-primary: #000000;
  --bg-secondary: #111111;
  --bg-tertiary: #1a1a1a;
  --border-primary: #222222;
  --border-secondary: #333333;
  --text-primary: #ffffff;
  --text-secondary: #e0e0e0;
  --text-muted: #888888;
  --accent: #00aaff;
  --accent-dim: #006699;
  --success: #00ff88;
  --error: #ff4444;
}
```

## Rules
1. Use TypeScript for all new files
2. Use Tailwind CSS for styling with CSS variables above
3. Keep components small and focused
4. Use Zustand for state management
5. All new components go in `packages/app/src/components/`
6. All new hooks go in `packages/app/src/hooks/`
7. Server code goes in `packages/server/`
8. DB layer goes in `packages/db/`
9. Electron code goes in `electron/`
10. Use existing patterns from App.tsx for API calls

## Data Sources
- Copy task data from `~/Code/mission-control/tasks.db` to Entity DB
- Port API from `~/Code/mission-control/server.js`
- Reuse Entity's ActivityStream.tsx for unified activity

## Task
Read scripts/ralph/integration-prd.json, find the FIRST story with passes: false, implement it, test that the app builds successfully (npm run build in packages/app), then mark the story as passes: true in integration-prd.json.

After implementation, update scripts/ralph/progress.txt with what you learned.
