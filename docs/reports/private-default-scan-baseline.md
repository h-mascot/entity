# Private Default Scan Baseline

Generated: 2026-05-06T22:12:50.520Z

Scanned files: 239
Findings: 161
Errors: 0
Warnings: 161

This is the baseline guardrail for Entity portability work. It intentionally reports current hardcoded private defaults without failing by default. Use `npm run scan:private-defaults -- --enforce` when the allowlist has been tightened enough to block regressions.

## Findings by file

### docs/config/gpt-55-instant-default-evaluation.md

- L6 [warn] enterprise-agent-name: `Scope: Entity Ada/Main-style OpenClaw agents when live OpenClaw model policy is unavailable`
- L18 [warn] enterprise-agent-name: `- It only applies when Entity cannot resolve configured models and falls back to its built-in Ada/OpenClaw policy.`

### packages/app/src/App.tsx

- L96 [warn] tailnet-ip-100: `const ENTERPRISE_ADMIN_URL = 'http://100.104.229.62:3000';`
- L1284 [warn] enterprise-agent-name: `['Worker', 'Scotty lane · MascotM3 · ~/Code/entity'],`
- L2179 [warn] enterprise-agent-name: `? 'Ada'`
- L2181 [warn] enterprise-agent-name: `? 'Spock'`
- L2183 [warn] enterprise-agent-name: `? 'Scotty'`
- L3872 [warn] enterprise-name: `{ value: 'kitz', label: 'Kitz', hint: 'Enterprise gradient dark' },`
- L4371 [warn] enterprise-name: `Live operational registry for Entity runtime services, linked plugins, and Enterprise tooling.`
- L4390 [warn] enterprise-name: `Open Enterprise Crew Admin`
- L4575 [warn] enterprise-agent-name: `<option value="Ada">Ada</option>`
- L4576 [warn] enterprise-agent-name: `<option value="Spock">Spock</option>`
- L4577 [warn] enterprise-agent-name: `<option value="Scotty">Scotty</option>`
- L4790 [warn] enterprise-agent-name: `<span className="text-purple-400">Ada {formatAuthorshipBadgePercent(authorshipStats.ada)}%</span>`
- L4793 [warn] enterprise-agent-name: `<span className="text-blue-400">Spock {formatAuthorshipBadgePercent(authorshipStats.spock)}%</span>`
- L4796 [warn] enterprise-agent-name: `<span className="text-green-400">Scotty {formatAuthorshipBadgePercent(authorshipStats.scotty)}%</span>`

### packages/app/src/components/BottomTerminalPanel.tsx

- L62 [warn] enterprise-agent-name: `description: 'SSH session to the Spock host alias',`
- L70 [warn] enterprise-agent-name: `description: 'SSH session to the Scotty host alias',`

### packages/app/src/components/Chat/ChatOfflineProvider.tsx

- L187 [warn] tailnet-ip-100: `const response = await fetchWithTimeout('http://100.86.150.96:11434/api/tags', { method: 'GET' }, 3500);`
- L221 [warn] tailnet-ip-100: `'http://100.86.150.96:11434/v1/chat/completions',`

### packages/app/src/components/CodeMirrorEditor.tsx

- L88 [warn] enterprise-agent-name: `const agents = ['Ada', 'Spock', 'Scotty'] as const;`

### packages/app/src/components/CursorAvatars.tsx

- L95 [warn] enterprise-agent-name: `return 'Ada';`
- L97 [warn] enterprise-agent-name: `return 'Spock';`
- L99 [warn] enterprise-agent-name: `return 'Scotty';`

### packages/app/src/components/NewCommentPopover.tsx

- L121 [warn] enterprise-agent-name: `Mentions ready: type @Ada, @Spock, @Scotty`

### packages/app/src/components/OnboardingFlow.tsx

- L121 [warn] enterprise-name: `{ id: 'kitz', title: 'Kitz', hint: 'Enterprise gradient dark' },`

### packages/app/src/components/PresenceChips.tsx

- L118 [warn] enterprise-agent-name: `return 'Ada';`
- L120 [warn] enterprise-agent-name: `return 'Spock';`
- L122 [warn] enterprise-agent-name: `return 'Scotty';`

### packages/app/src/components/editor/AuthorshipStatsPanel.tsx

- L15 [warn] enterprise-agent-name: `{ id: 'ada', label: 'Ada', color: '#a855f7' },`
- L16 [warn] enterprise-agent-name: `{ id: 'spock', label: 'Spock', color: '#3b82f6' },`
- L17 [warn] enterprise-agent-name: `{ id: 'scotty', label: 'Scotty', color: '#22c55e' },`

### packages/app/src/components/mission-control/MCCreateTaskModal.tsx

- L7 [warn] enterprise-agent-name: `const AGENT_ASSIGNEE_OPTIONS = ['Ada', 'Spock', 'Scotty'] as const;`

### packages/app/src/components/mission-control/TaskDetailPanel.tsx

- L18 [warn] enterprise-agent-name: `const AGENT_ASSIGNEE_OPTIONS = ['Ada', 'Spock', 'Scotty'] as const;`
- L570 [warn] clawd-workspace-name: `String.raw\`(?:https?:\/\/[^\s<>()]+|\/(?:docs|task|tasks)\/[^\s<>()]+|(?:docs|notes|output|memory|workspace|projects|zora|spock)\/[^\s<>()]+\.${TASK_OUTPUT_DOCUMENT_EXT}(?:[?#][^\s<>()]+)?|(?:~|\/(?:Users|home)\/[^\s<>()]+)\/clawd(?:-[^\/\s`
- L635 [warn] clawd-workspace-name: `{ root: 'output', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/output\/(.+)$/i },`
- L636 [warn] clawd-workspace-name: `{ root: 'memory', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/memory\/(.+)$/i },`
- L637 [warn] clawd-workspace-name: `{ root: 'projects', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/projects\/(.+)$/i },`
- L638 [warn] clawd-workspace-name: `{ root: 'zora', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd-zora\/output\/(.+)$/i },`
- L639 [warn] clawd-workspace-name: `{ root: 'spock', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd-spock\/output\/(.+)$/i },`
- L640 [warn] clawd-workspace-name: `{ root: 'workspace', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/(.+)$/i },`

### packages/app/src/hooks/useActivityStream.ts

- L104 [warn] enterprise-agent-name: `{ name: 'Ada', emoji: '🔮' },`
- L105 [warn] enterprise-agent-name: `{ name: 'Spock', emoji: '🖖' },`
- L106 [warn] enterprise-agent-name: `{ name: 'Scotty', emoji: '🔧' },`

### packages/app/src/hooks/useSwarmBoard.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — React Hook`

### packages/app/src/lib/agentRegistry.ts

- L12 [warn] enterprise-agent-name: `{ id: 'main', slug: 'ada', name: 'Ada', emoji: '🔮', avatarUrl: '/agent-avatars/ada.jpg', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm', 'plugins'] },`
- L13 [warn] enterprise-agent-name: `{ id: 'spock', slug: 'spock', name: 'Spock', emoji: '🖖', avatarUrl: '/agent-avatars/spock.jpg', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },`
- L14 [warn] enterprise-agent-name: `{ id: 'scotty', slug: 'scotty', name: 'Scotty', emoji: '🔧', avatarUrl: '/agent-avatars/scotty.jpg', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm'] },`
- L15 [warn] enterprise-agent-name: `{ id: 'geordi', slug: 'geordi', name: 'Geordi', emoji: '👷', avatarUrl: '/agent-avatars/geordi.png', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm', 'plugins'] },`
- L16 [warn] enterprise-agent-name: `{ id: 'zora', slug: 'zora', name: 'Zora', emoji: '🌌', avatarUrl: '/agent-avatars/zora.jpg', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },`
- L17 [warn] enterprise-agent-name: `{ id: 'midas', slug: 'midas', name: 'Midas', emoji: '✨', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'plugins'] },`
- L18 [warn] enterprise-agent-name: `{ id: 'uhura', slug: 'uhura', name: 'Uhura', emoji: '📡', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },`
- L19 [warn] enterprise-agent-name: `{ id: 'book', slug: 'book', name: 'Book', emoji: '📚', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },`

### packages/app/src/lib/userProfile.ts

- L14 [warn] henry-name: `displayName: 'Henry',`

### packages/app/src/stores/pluginStore.ts

- L281 [warn] enterprise-agent-name: `acp: { url: 'https://github.com/h-mascot/geordi', label: 'Geordi/ACP' },`

### packages/db/src/index.ts

- L1013 [warn] clawd-workspace-name: `['tasks-mc-sh', 'tasks', 'mc.sh', 'script', '~/clawd/scripts/mc.sh', 1, 'Mission Control CLI'],`

### packages/server/src/agent/agent-capability-card.ts

- L55 [warn] henry-name: `geordi: 'Henry Mascot',`
- L164 [warn] henry-name: `return 'Henry Mascot';`

### packages/server/src/index.ts

- L160 [warn] clawd-workspace-name: `const DEFAULT_WORK_ROOT = path.join(HOME_DIR, "clawd");`
- L1527 [warn] henry-name: `author: author || "Henry",`
- L5366 [warn] henry-name: `assignee: "Henry",`
- L5373 [warn] enterprise-agent-name: `assignee: "Ada",`
- L5380 [warn] enterprise-agent-name: `assignee: "Spock",`
- L5572 [warn] clawd-workspace-name: `process.env.ENTITY_WORKSPACE_SPOCK || path.join(HOME_DIR, "clawd-spock"),`
- L5574 [warn] clawd-workspace-name: `process.env.ENTITY_WORKSPACE_SCOTTY || path.join(HOME_DIR, "clawd-scotty"),`

### packages/server/src/plugins/entity-linker/plugin.json

- L20 [warn] tailnet-ip-100: `"entityBaseUrl": "http://100.106.69.9:3000",`

### packages/server/src/plugins/entity-services/plugin.json

- L6 [warn] enterprise-name: `"description": "Operational services registry for Entity, Enterprise tooling, and adjacent runtime services.",`
- L27 [warn] tailnet-ip-100: `"entityBaseUrl": "http://100.106.69.9:3000",`
- L28 [warn] tailnet-ip-100: `"enterpriseAdminUrl": "http://100.104.229.62:3000",`
- L29 [warn] tailnet-ip-100: `"n8nBaseUrl": "http://100.106.69.9:5678",`
- L30 [warn] tailnet-ip-100: `"vaultwardenBaseUrl": "http://100.106.69.9:8222"`

### packages/server/src/plugins/entity-services/routes.ts

- L142 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:3000',`
- L143 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:3000/api/tasks'],`
- L146 [warn] enterprise-name: `name: 'Enterprise Crew Admin',`
- L150 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:3002',`
- L151 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:3002/api/health', 'http://100.106.69.9:3002/health'],`
- L158 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:5678',`
- L159 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:5678/healthz', 'http://100.106.69.9:5678/healthz/readiness'],`
- L194 [warn] enterprise-agent-name: `name: 'Ada Workspace Web Server',`
- L197 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:3030',`
- L199 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:3030'],`
- L205 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:8788',`
- L207 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:8788'],`
- L213 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:8789',`
- L215 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:8789'],`
- L221 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:7777',`
- L223 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:7777'],`
- L226 [warn] enterprise-agent-name: `name: 'Geordi ACP Adapter',`
- L228 [warn] enterprise-agent-name: `description: 'ACP adapter for Geordi on the Mac.',`
- L229 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:8100',`
- L231 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:8100'],`
- L237 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:3001',`
- L239 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:3001'],`
- L245 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:4747',`
- L247 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:4747'],`
- L253 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:8765',`
- L255 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:8765'],`
- L261 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:8881',`
- L263 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:8881'],`
- L269 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:7000',`
- L271 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:7000'],`
- L277 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:5000',`
- L279 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:5000'],`
- L662 [warn] enterprise-name: `name: 'Enterprise Crew Admin',`
- L672 [warn] enterprise-name: `host: 'Enterprise',`
- L802 [warn] enterprise-agent-name: `host: 'Ada Gateway',`
- L833 [warn] enterprise-agent-name: `host: definition.host ?? 'Ada Gateway',`
- L964 [warn] enterprise-agent-name: `label: 'Ada Gateway',`
- L971 [warn] tailnet-ip-100: `sshTarget: readStringSetting(currentPlugin.settings, 'macDiscoverySshTarget', 'henrymascot@100.86.150.96'),`
- L972 [warn] tailnet-ip-100: `publicHost: '100.86.150.96',`

### packages/server/src/plugins/geordi-swarm/plugin.json

- L3 [warn] enterprise-agent-name: `"name": "Geordi Swarm",`

### packages/server/src/plugins/geordi-swarm/routes.ts

- L68 [warn] tailnet-ip-100: `const MAC_HOST = '100.86.150.96';`

### packages/server/src/routes/chat.ts

- L295 [warn] henry-name: `'Reply directly to Henry. Be concise, useful, and do not mention transport/runtime details.',`
- L315 [warn] henry-name: `'Reply directly to Henry on behalf of the selected agents.',`
- L664 [warn] tailnet-ip-100: `const ollamaBaseUrl = (process.env.ENTITY_OLLAMA_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? 'http://100.86.150.96:11434').replace(/\/+$/, '');`

### packages/server/src/routes/docs.ts

- L11 [warn] clawd-workspace-name: `const DEFAULT_CLAWD_ROOT = path.join(HOME_DIR, 'clawd');`
- L58 [warn] clawd-workspace-name: `zora: [path.join(HOME_DIR, 'clawd-zora', 'output')],`
- L59 [warn] clawd-workspace-name: `spock: [path.join(HOME_DIR, 'clawd-spock', 'output')],`

### packages/server/src/routes/search.ts

- L196 [warn] tailnet-ip-100: `const sshTarget = typeof sshTargetEnv === 'string' ? sshTargetEnv.trim() : 'henrymascot@100.86.150.96';`

### packages/server/src/swarm/ARCHITECTURE.md

- L1 [warn] enterprise-agent-name: `# Geordi Swarm — Architecture`
- L5 [warn] enterprise-agent-name: `Geordi Swarm is a soft-plugin for Entity that dispatches build jobs to`
- L25 [warn] enterprise-agent-name: `- Dispatches to Geordi ACP adapter on Mac (Codex/Claude Code)`
- L27 [warn] tailnet-ip-100: `- Env: \`ACP_BASE_URL\` (default: \`http://100.86.150.96:8100\`)`

### packages/server/src/swarm/db.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Database Layer`

### packages/server/src/swarm/dispatcher.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm - Dispatcher`

### packages/server/src/swarm/index.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Module Entry Point`

### packages/server/src/swarm/provider-registry.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Provider Registry (Singleton)`

### packages/server/src/swarm/providers/acp.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — ACP Provider`
- L4 [warn] enterprise-agent-name: `* Wraps the existing Geordi ACP adapter running on Mac.`
- L16 [warn] tailnet-ip-100: `const ACP_BASE = process.env.ACP_BASE_URL || 'http://100.86.150.96:8100';`
- L30 [warn] enterprise-agent-name: `readonly label = 'Geordi (ACP/Codex on Mac)';`

### packages/server/src/swarm/providers/interface.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Provider Interface`

### packages/server/src/swarm/providers/symphony.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Symphony Provider`
- L20 [warn] tailnet-ip-100: `*   SYMPHONY_API_URL  — Symphony's dashboard URL for health checks (e.g. http://100.86.150.96:8200)`

### packages/server/src/swarm/routes.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — API Routes`

### packages/server/src/swarm/types.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Core Types`

### packages/server/src/task-output-links.ts

- L87 [warn] clawd-workspace-name: `/(?:~|\/(?:Users|home)\/[^/\s)]+)\/clawd(-zora|-spock|-scotty)?\/([^\s)]+)/gi,`

### packages/server/src/terminal.ts

- L119 [warn] enterprise-agent-name: `description: 'SSH session to the Spock host alias',`
- L127 [warn] enterprise-agent-name: `description: 'SSH session to the Scotty host alias',`

### scripts/ctrl-deploy-path-check.sh

- L57 [warn] enterprise-name: `echo "[ctrl-deploy] skipped live deploy path check: deploy.mode=${DEPLOY_MODE}. Set an explicit ssh deploy profile/env for Enterprise gate."`

### scripts/ctrl-live-smoke.mjs

- L8 [warn] tailnet-ip-100: `const prodHost = process.env.ENTITY_PROD_HTTP_HOST || '100.104.229.62';`

### scripts/doctor.mjs

- L61 [warn] enterprise-name: `['Enterprise home path', /\/Users\/enterprise\b/],`
- L62 [warn] henry-name: `['Henry home path', /\/home\/henrymascot\b/],`
- L63 [warn] enterprise-name: `['Enterprise SSH target', /enterprise@[\w.-]+/i],`

### scripts/ralph/mc-agent-native-editor-prd.json

- L133 [warn] enterprise-agent-name: `"description": "Extend CodeMirrorEditor with authorship range decorations (Human/Ada/Spock/Scotty colors) and render an authorship stats panel in the app shell.",`
- L161 [warn] enterprise-agent-name: `"description": "Add follow glow classes for Ada/Spock/Scotty and pulse animation when followed agent is actively typing.",`
- L163 [warn] enterprise-agent-name: `"Ada/Spock/Scotty each have distinct glow color",`
- L245 [warn] enterprise-name: `"description": "Finalize parity API semantics for edit/comment/suggest/review/cursor operations and document tool mappings used by native Enterprise agents.",`

### scripts/ralph/prd.json

- L11 [warn] enterprise-agent-name: `"Mock data generates realistic agent activities for Ada, Spock, Scotty",`
- L21 [warn] enterprise-agent-name: `"description": "Create an ActivityStream component that renders as a panel (togglable bottom panel or sidebar tab). Each entry shows: agent emoji + name, action description, relative timestamp (e.g. '2s ago'), and an icon for the activity t`

### scripts/ralph/ralph-ane-016-020.md

- L54 [warn] enterprise-agent-name: `- Ada: purple (#a855f7)`
- L55 [warn] enterprise-agent-name: `- Spock: blue (#3b82f6)`
- L56 [warn] enterprise-agent-name: `- Scotty: green (#22c55e)`

### scripts/ralph/sidebar-final-prd.md

- L58 [warn] enterprise-agent-name: `{authorshipStats.ada > 0 && <span className="text-purple-400">Ada {authorshipStats.ada}%</span>}`
- L59 [warn] enterprise-agent-name: `{authorshipStats.spock > 0 && <span className="text-blue-400">Spock {authorshipStats.spock}%</span>}`
- L60 [warn] enterprise-agent-name: `{authorshipStats.scotty > 0 && <span className="text-green-400">Scotty {authorshipStats.scotty}%</span>}`

### scripts/ralph/sidebar-redesign-prd.md

- L68 [warn] enterprise-agent-name: `- Show authorship stats in a small toolbar badge/tooltip: "Ada 45% | Human 55%"`

### scripts/scan-private-defaults.mjs

- L48 [warn] enterprise-agent-name: `{ id: 'enterprise-agent-name', re: /\b(?:Ada|Spock|Scotty|Zora|Midas|Uhura|Geordi|Book)\b/g, severity: 'warn' },`
- L49 [warn] clawd-workspace-name: `{ id: 'clawd-workspace-name', re: /\bclawd(?:-[A-Za-z0-9_-]+)?\b/g, severity: 'warn' },`

### scripts/seed-agent-sources.sh

- L74 [warn] enterprise-agent-name: `declare -a SOURCE_NAMES=("Ada 🔮" "Spock 🖖" "Scotty 🔧" "Obsidian Vault")`
- L75 [warn] tailnet-ip-100: `declare -a SOURCE_URLS=("http://100.106.69.9:8788" "http://100.106.69.9:8789" "http://100.68.207.75:8788" "http://100.86.150.96:8787")`
