# Private Default Scan Baseline

Generated: 2026-05-01T02:20:08.447Z

Scanned files: 262
Findings: 247
Errors: 16
Warnings: 231

This is the baseline guardrail for Entity portability work. It intentionally reports current hardcoded private defaults without failing by default. Use `npm run scan:private-defaults -- --enforce` when the allowlist has been tightened enough to block regressions.

## Findings by file

### README.md

- L39 [warn] enterprise-name: `[Henry](https://henrymascot.com) and the [Enterprise Crew](https://github.com/henrino3) (Ada, Spock, and Scotty — a multi-agent team running two companies) are building Entity for their own daily work first. The goal is simple: **make the h`
- L39 [warn] henry-name: `[Henry](https://henrymascot.com) and the [Enterprise Crew](https://github.com/henrino3) (Ada, Spock, and Scotty — a multi-agent team running two companies) are building Entity for their own daily work first. The goal is simple: **make the h`
- L39 [warn] enterprise-agent-name: `[Henry](https://henrymascot.com) and the [Enterprise Crew](https://github.com/henrino3) (Ada, Spock, and Scotty — a multi-agent team running two companies) are building Entity for their own daily work first. The goal is simple: **make the h`
- L69 [warn] enterprise-agent-name: `- **Doc Hub** — Unified file browser across 4 sources (Vault, Ada, Spock, Zora) — 4,699 files indexed`
- L77 [warn] enterprise-agent-name: `- **Plugin foundations** — internal plugin architecture, manifest/schema proposal, and build guide for Entity-native extensions like Geordi Swarm and Entity Linker`
- L140 [warn] enterprise-name: `Entity is built by the **Enterprise Crew** — a production multi-agent system running two companies.`
- L144 [warn] enterprise-agent-name: `| **Ada** 🔮 | Brain — orchestration, BD/sales, strategy | Claude Opus |`
- L145 [warn] enterprise-agent-name: `| **Spock** 🖖 | Research & operations | Kimi |`
- L146 [warn] enterprise-agent-name: `| **Scotty** 🔧 | Builder — code, automation, infrastructure | Sonnet |`
- L147 [warn] enterprise-agent-name: `| **Geordi** 👷 | Builder (Mac) — Codex-powered implementation | GPT-5.3 Codex |`
- L148 [warn] enterprise-agent-name: `| **Zora** 🌌 | Knowledge manager & content creator | Gemini Flash |`
- L151 [warn] henry-name: `**Human:** [Henry Mascot](https://henrymascot.com) — product, vision, direction.`
- L153 [warn] henry-name: `The agents use Entity daily. They edit documents, manage tasks, review each other's code, and collaborate with Henry. Entity isn't a demo — it's how we actually work.`
- L174 [warn] enterprise-name: `Entity now includes an internal plugin docs pack for Henry + the Enterprise Crew:`
- L174 [warn] henry-name: `Entity now includes an internal plugin docs pack for Henry + the Enterprise Crew:`
- L180 [warn] enterprise-agent-name: `- \`docs/ENTITY-PLUGIN-MANIFEST.example.json\` — example manifest using Geordi Swarm`
- L184 [warn] enterprise-agent-name: `- **Geordi Swarm** — Entity-native product/module plugin`
- L197 [warn] enterprise-name: `**[henrymascot.com](https://henrymascot.com)** · **[Enterprise Crew](https://github.com/henrino3)**`

### deploy.sh

- L11 [error] enterprise-ssh-target: `PROD_HOST="${ENTITY_PROD_HOST:-enterprise@100.104.229.62}"`
- L11 [warn] tailnet-ip-100: `PROD_HOST="${ENTITY_PROD_HOST:-enterprise@100.104.229.62}"`
- L12 [warn] tailnet-ip-100: `PROD_HTTP_HOST="${ENTITY_PROD_HTTP_HOST:-100.104.229.62}"`
- L13 [error] enterprise-user-path: `ENTITY_DIR="${ENTITY_PROD_DIR:-/Users/enterprise/Services/entity}"`
- L143 [error] henry-home-path: `ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; lsof -i :3000 -t 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 2; cd '${ENTITY_DIR}' && PORT=3000 WORKSPACE=/home/henrymascot/clawd nohup node packages/server/dist/server/src/`
- L143 [warn] clawd-workspace-name: `ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; lsof -i :3000 -t 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 2; cd '${ENTITY_DIR}' && PORT=3000 WORKSPACE=/home/henrymascot/clawd nohup node packages/server/dist/server/src/`

### dev.sh

- L4 [warn] tailnet-ip-100: `export ENTITY_CLOUD_API_BASE=http://100.106.69.9:3000`

### packages/app/src/App.tsx

- L87 [warn] tailnet-ip-100: `const ENTERPRISE_ADMIN_URL = 'http://100.104.229.62:3000';`
- L267 [warn] henry-name: `type MCAssigneeFilter = 'all' | 'Ada' | 'Spock' | 'Scotty' | 'Henry';`
- L267 [warn] enterprise-agent-name: `type MCAssigneeFilter = 'all' | 'Ada' | 'Spock' | 'Scotty' | 'Henry';`
- L1138 [warn] henry-name: `const [loginUsername, setLoginUsername] = useState<string>(() => readAuthSession()?.username ?? 'Henry');`
- L1818 [warn] enterprise-agent-name: `? 'Ada'`
- L1820 [warn] enterprise-agent-name: `? 'Spock'`
- L1822 [warn] enterprise-agent-name: `? 'Scotty'`
- L2295 [warn] henry-name: `author: 'Henry',`
- L2537 [warn] henry-name: `const username = loginUsername.trim() || 'Henry';`
- L3485 [warn] enterprise-name: `{ value: 'kitz', label: 'Kitz', hint: 'Enterprise gradient dark' },`
- L3849 [warn] enterprise-agent-name: `<option value="Ada">Ada</option>`
- L3850 [warn] enterprise-agent-name: `<option value="Spock">Spock</option>`
- L3851 [warn] enterprise-agent-name: `<option value="Scotty">Scotty</option>`
- L3852 [warn] henry-name: `<option value="Henry">Henry</option>`
- L4064 [warn] enterprise-agent-name: `<span className="text-purple-400">Ada {formatAuthorshipBadgePercent(authorshipStats.ada)}%</span>`
- L4067 [warn] enterprise-agent-name: `<span className="text-blue-400">Spock {formatAuthorshipBadgePercent(authorshipStats.spock)}%</span>`
- L4070 [warn] enterprise-agent-name: `<span className="text-green-400">Scotty {formatAuthorshipBadgePercent(authorshipStats.scotty)}%</span>`

### packages/app/src/components/BottomTerminalPanel.tsx

- L62 [warn] enterprise-agent-name: `description: 'SSH session to the Spock host alias',`
- L70 [warn] enterprise-agent-name: `description: 'SSH session to the Scotty host alias',`

### packages/app/src/components/Chat/ChatOfflineProvider.tsx

- L170 [warn] tailnet-ip-100: `const response = await fetchWithTimeout('http://100.86.150.96:11434/api/tags', { method: 'GET' }, 3500);`
- L204 [warn] tailnet-ip-100: `'http://100.86.150.96:11434/v1/chat/completions',`

### packages/app/src/components/Chat/MessageBubble.tsx

- L46 [warn] henry-name: `if (sender === 'user') return 'Henry';`

### packages/app/src/components/CodeMirrorEditor.tsx

- L88 [warn] enterprise-agent-name: `const agents = ['Ada', 'Spock', 'Scotty'] as const;`

### packages/app/src/components/CursorAvatars.tsx

- L95 [warn] enterprise-agent-name: `return 'Ada';`
- L97 [warn] enterprise-agent-name: `return 'Spock';`
- L99 [warn] enterprise-agent-name: `return 'Scotty';`

### packages/app/src/components/EntityServicesBoard.tsx

- L244 [warn] enterprise-agent-name: `Auto-discovered services from Ada Gateway and MascotM3, plus known Entity runtime surfaces.`

### packages/app/src/components/NewCommentPopover.tsx

- L121 [warn] enterprise-agent-name: `Mentions ready: type @Ada, @Spock, @Scotty`

### packages/app/src/components/PresenceChips.tsx

- L118 [warn] enterprise-agent-name: `return 'Ada';`
- L120 [warn] enterprise-agent-name: `return 'Spock';`
- L122 [warn] enterprise-agent-name: `return 'Scotty';`

### packages/app/src/components/UnifiedFileDashboard.tsx

- L134 [warn] henry-name: `<option value="henry">Henry</option>`

### packages/app/src/components/editor/AuthorshipStatsPanel.tsx

- L15 [warn] enterprise-agent-name: `{ id: 'ada', label: 'Ada', color: '#a855f7' },`
- L16 [warn] enterprise-agent-name: `{ id: 'spock', label: 'Spock', color: '#3b82f6' },`
- L17 [warn] enterprise-agent-name: `{ id: 'scotty', label: 'Scotty', color: '#22c55e' },`

### packages/app/src/components/mission-control/MCCreateTaskModal.tsx

- L6 [warn] henry-name: `const ASSIGNEE_OPTIONS = ['Ada', 'Spock', 'Scotty', 'Henry', 'Unassigned'] as const;`
- L6 [warn] enterprise-agent-name: `const ASSIGNEE_OPTIONS = ['Ada', 'Spock', 'Scotty', 'Henry', 'Unassigned'] as const;`

### packages/app/src/components/mission-control/TaskDetailPanel.tsx

- L17 [warn] henry-name: `const ASSIGNEE_OPTIONS = ['Ada', 'Spock', 'Scotty', 'Henry', 'Unassigned'] as const;`
- L17 [warn] enterprise-agent-name: `const ASSIGNEE_OPTIONS = ['Ada', 'Spock', 'Scotty', 'Henry', 'Unassigned'] as const;`
- L19 [warn] henry-name: `const DEFAULT_AUTHOR = 'Henry';`
- L570 [warn] clawd-workspace-name: `String.raw\`(?:https?:\/\/[^\s<>()]+|\/(?:docs|task|tasks)\/[^\s<>()]+|(?:docs|notes|output|memory|workspace|projects|zora|spock)\/[^\s<>()]+\.${TASK_OUTPUT_DOCUMENT_EXT}(?:[?#][^\s<>()]+)?|(?:~|\/(?:Users|home)\/[^\s<>()]+)\/clawd(?:-[^\/\s`
- L635 [warn] clawd-workspace-name: `{ root: 'output', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/output\/(.+)$/i },`
- L636 [warn] clawd-workspace-name: `{ root: 'memory', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/memory\/(.+)$/i },`
- L637 [warn] clawd-workspace-name: `{ root: 'projects', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/projects\/(.+)$/i },`
- L638 [warn] clawd-workspace-name: `{ root: 'zora', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd-zora\/output\/(.+)$/i },`
- L639 [warn] clawd-workspace-name: `{ root: 'spock', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd-spock\/output\/(.+)$/i },`
- L640 [warn] clawd-workspace-name: `{ root: 'workspace', pattern: /^(?:~|\/(?:Users|home)\/[^/]+)\/clawd\/(.+)$/i },`

### packages/app/src/hooks/useActivityStream.ts

- L103 [warn] enterprise-agent-name: `{ name: 'Ada', emoji: '🔮' },`
- L104 [warn] enterprise-agent-name: `{ name: 'Spock', emoji: '🖖' },`
- L105 [warn] enterprise-agent-name: `{ name: 'Scotty', emoji: '🔧' },`

### packages/app/src/hooks/useSwarmBoard.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — React Hook`

### packages/app/src/hooks/useTaskBoard.ts

- L742 [warn] henry-name: `user: 'Henry',`
- L846 [warn] henry-name: `body: JSON.stringify({ column, user: 'Henry' }),`

### packages/app/src/lib/agentRegistry.ts

- L14 [warn] enterprise-agent-name: `{ id: 'main', slug: 'ada', name: 'Ada', emoji: '🔮', avatarUrl: '/agent-avatars/ada.jpg', model: 'Opus 4.6', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm', 'plugins'] },`
- L15 [warn] enterprise-agent-name: `{ id: 'spock', slug: 'spock', name: 'Spock', emoji: '🖖', avatarUrl: '/agent-avatars/spock.jpg', model: 'Kimi', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },`
- L16 [warn] enterprise-agent-name: `{ id: 'scotty', slug: 'scotty', name: 'Scotty', emoji: '🔧', avatarUrl: '/agent-avatars/scotty.jpg', model: 'Sonnet', gateway: 'Pi', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm'] },`
- L17 [warn] enterprise-agent-name: `{ id: 'geordi', slug: 'geordi', name: 'Geordi', emoji: '👷', avatarUrl: '/agent-avatars/geordi.png', model: 'GPT-5.3 Codex', gateway: 'MascotM3', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'swarm', 'plugins'] },`
- L18 [warn] enterprise-agent-name: `{ id: 'zora', slug: 'zora', name: 'Zora', emoji: '🌌', avatarUrl: '/agent-avatars/zora.jpg', model: 'Gemini Flash', gateway: 'MascotM3', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },`
- L19 [warn] enterprise-agent-name: `{ id: 'midas', slug: 'midas', name: 'Midas', emoji: '✨', avatarUrl: '/agent-avatars/midas.png', model: 'GPT-5.3 Codex', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs', 'plugins'] },`
- L20 [warn] enterprise-agent-name: `{ id: 'uhura', slug: 'uhura', name: 'Uhura', emoji: '📡', avatarUrl: '/agent-avatars/uhura.png', model: 'Gemini Flash', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },`
- L21 [warn] enterprise-agent-name: `{ id: 'book', slug: 'book', name: 'Book', emoji: '📚', avatarUrl: '/agent-avatars/book.png', model: 'Gemini Flash', gateway: 'ada-gateway', status: 'online', modules: ['chat', 'tasks', 'files', 'docs'] },`

### packages/db/src/index.ts

- L996 [warn] clawd-workspace-name: `['tasks-mc-sh', 'tasks', 'mc.sh', 'script', '~/clawd/scripts/mc.sh', 1, 'Mission Control CLI'],`

### packages/server/src/__tests__/db-repositories.test.ts

- L143 [warn] enterprise-agent-name: `assignee: 'Ada',`
- L159 [warn] enterprise-agent-name: `expect(task.assignee).toBe('Ada');`
- L182 [warn] enterprise-agent-name: `agent_name: 'Ada',`
- L187 [warn] enterprise-agent-name: `expect(activity.agent_name).toBe('Ada');`
- L246 [warn] enterprise-agent-name: `author: 'Spock',`
- L250 [warn] enterprise-agent-name: `expect(comment.author).toBe('Spock');`
- L435 [warn] enterprise-agent-name: `const entry = dbMod.addTaskHistory(task.id, 'column', 'backlog', 'doing', 'Ada');`
- L439 [warn] enterprise-agent-name: `expect(entry.changed_by).toBe('Ada');`

### packages/server/src/__tests__/routes-docs.test.ts

- L63 [warn] clawd-workspace-name: `const outputRoot = path.join(os.homedir(), 'clawd', 'output');`
- L90 [warn] clawd-workspace-name: `const outputRoot = path.join(os.homedir(), 'clawd', 'output');`

### packages/server/src/__tests__/task-dedupe.test.ts

- L11 [warn] enterprise-agent-name: `assignee: 'Ada',`

### packages/server/src/__tests__/task-output-links.test.ts

- L47 [warn] clawd-workspace-name: `expect(normalizeTaskOutputLinks('/Users/operator/clawd/output/a.md', BASE)).toBe(\`${BASE}/docs/output/a.md\`);`
- L48 [warn] clawd-workspace-name: `expect(normalizeTaskOutputLinks('/home/operator/clawd-spock/output/a.md', BASE)).toBe(\`${BASE}/docs/spock/a.md\`);`
- L49 [warn] clawd-workspace-name: `expect(normalizeTaskOutputLinks('/home/operator/clawd-zora/output/a.md', BASE)).toBe(\`${BASE}/docs/zora/a.md\`);`
- L52 [warn] clawd-workspace-name: `it('rewrites home-relative clawd paths', () => {`
- L53 [warn] clawd-workspace-name: `const result = normalizeTaskOutputLinks('Artifacts: ~/clawd/output/a.md ~/clawd/projects/entity/spec.md', BASE);`

### packages/server/src/agent/agent-capability-card.test.ts

- L57 [warn] henry-name: `'{"modules":["tasks","docs"],"owner":"Henry Mascot","verification":"Registry + grants","permissions":["approve"]}',`
- L63 [warn] henry-name: `expect(card.ownerLabel).toBe('Henry Mascot');`

### packages/server/src/agent/agent-capability-card.ts

- L55 [warn] henry-name: `geordi: 'Henry Mascot',`
- L164 [warn] henry-name: `return 'Henry Mascot';`

### packages/server/src/agent/events.test.ts

- L17 [warn] enterprise-agent-name: `assignee: 'Geordi',`
- L105 [error] henry-home-path: `reasons: ['File not found at /home/henrymascot/clawd/output/review-hygiene.md.'],`
- L105 [warn] clawd-workspace-name: `reasons: ['File not found at /home/henrymascot/clawd/output/review-hygiene.md.'],`
- L120 [warn] enterprise-agent-name: `'Geordi',`

### packages/server/src/agent/review-policy.test.ts

- L25 [warn] enterprise-agent-name: `assignee: 'Geordi',`
- L135 [error] henry-home-path: `? 'File not found at /home/henrymascot/clawd/output/task-master-review.md.'`
- L135 [warn] clawd-workspace-name: `? 'File not found at /home/henrymascot/clawd/output/task-master-review.md.'`

### packages/server/src/agent/tools.test.ts

- L22 [warn] enterprise-agent-name: `assignee: 'Geordi',`
- L47 [warn] enterprise-agent-name: `agent_name: 'Geordi',`

### packages/server/src/config/effective.test.ts

- L8 [warn] enterprise-name: `it('uses safe public defaults without private Enterprise values', () => {`
- L13 [error] enterprise-user-path: `expect(serialized).not.toContain('/Users/enterprise');`
- L14 [error] henry-home-path: `expect(serialized).not.toContain('/home/henrymascot');`
- L15 [warn] tailnet-ip-100: `expect(serialized).not.toContain('100.104.229.62');`
- L16 [warn] enterprise-agent-name: `expect(serialized).not.toContain('Ada');`

### packages/server/src/fs/classify.test.ts

- L64 [warn] enterprise-agent-name: `const result = classifyFile('ada/notes.md', 'Ada generated this');`
- L69 [warn] enterprise-agent-name: `const result = classifyFile('research/spock-analysis.md', 'Spock research');`
- L74 [warn] enterprise-agent-name: `const result = classifyFile('builds/scotty-build.md', 'Scotty built this');`
- L79 [warn] henry-name: `const result = classifyFile('notes/henry-notes.md', 'Henry wrote this');`
- L84 [warn] enterprise-agent-name: `const result = classifyFile('notes/zora-log.md', 'Zora generated this');`
- L89 [warn] enterprise-agent-name: `const result = classifyFile('notes/geordi-build.md', 'Geordi notes');`
- L94 [warn] enterprise-agent-name: `const result = classifyFile('notes/midas-assistant.md', 'Midas run output');`

### packages/server/src/fs/index.ts

- L30 [warn] enterprise-agent-name: `{ id: 'ada', display_name: 'Ada', base_path: \`${homeDir}/clawd\`, icon: '🔮' },`
- L30 [warn] clawd-workspace-name: `{ id: 'ada', display_name: 'Ada', base_path: \`${homeDir}/clawd\`, icon: '🔮' },`
- L31 [warn] enterprise-agent-name: `{ id: 'spock', display_name: 'Spock', base_path: \`${homeDir}/clawd-spock\`, icon: '🖖' },`
- L31 [warn] clawd-workspace-name: `{ id: 'spock', display_name: 'Spock', base_path: \`${homeDir}/clawd-spock\`, icon: '🖖' },`
- L32 [warn] enterprise-agent-name: `{ id: 'zora', display_name: 'Zora', base_path: \`${homeDir}/clawd-zora\`, icon: '🌌' },`
- L32 [warn] clawd-workspace-name: `{ id: 'zora', display_name: 'Zora', base_path: \`${homeDir}/clawd-zora\`, icon: '🌌' },`
- L54 [error] henry-home-path: `const looksLikeLegacyLinuxHome = currentBasePath.startsWith('/home/henrymascot/');`
- L55 [error] henry-home-path: `const expectedLegacyPath = \`/home/henrymascot/${src.base_path.split('/').pop()}\`;`

### packages/server/src/index.ts

- L99 [warn] clawd-workspace-name: `const DEFAULT_WORK_ROOT = path.join(HOME_DIR, 'clawd');`
- L1336 [warn] henry-name: `author: author || 'Henry',`
- L4512 [warn] henry-name: `assignee: 'Henry',`
- L4518 [warn] enterprise-agent-name: `assignee: 'Ada',`
- L4524 [warn] enterprise-agent-name: `assignee: 'Spock',`
- L4702 [warn] clawd-workspace-name: `spock: process.env.ENTITY_WORKSPACE_SPOCK || path.join(HOME_DIR, 'clawd-spock'),`
- L4703 [warn] clawd-workspace-name: `scotty: process.env.ENTITY_WORKSPACE_SCOTTY || path.join(HOME_DIR, 'clawd-scotty'),`

### packages/server/src/plugins/entity-linker/plugin.json

- L20 [warn] tailnet-ip-100: `"entityBaseUrl": "http://100.106.69.9:3000",`

### packages/server/src/plugins/entity-linker/routes.test.ts

- L18 [warn] tailnet-ip-100: `entityBaseUrl: 'http://100.106.69.9:3000',`

### packages/server/src/plugins/entity-services/routes.test.ts

- L190 [warn] enterprise-name: `expect(JSON.stringify(payload)).not.toMatch(/Enterprise|Ada Gateway|MascotM3|100\./);`
- L190 [warn] enterprise-agent-name: `expect(JSON.stringify(payload)).not.toMatch(/Enterprise|Ada Gateway|MascotM3|100\./);`

### packages/server/src/plugins/entity-services/routes.ts

- L145 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:3000',`
- L146 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:3000/api/tasks'],`
- L149 [warn] enterprise-name: `name: 'Enterprise Crew Admin',`
- L153 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:3002',`
- L154 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:3002/api/health', 'http://100.106.69.9:3002/health'],`
- L161 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:5678',`
- L162 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:5678/healthz', 'http://100.106.69.9:5678/healthz/readiness'],`
- L197 [warn] enterprise-agent-name: `name: 'Ada Workspace Web Server',`
- L200 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:3030',`
- L202 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:3030'],`
- L208 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:8788',`
- L210 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:8788'],`
- L216 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:8789',`
- L218 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:8789'],`
- L224 [warn] tailnet-ip-100: `publicUrl: 'http://100.106.69.9:7777',`
- L226 [warn] tailnet-ip-100: `healthUrls: ['http://100.106.69.9:7777'],`
- L229 [warn] enterprise-agent-name: `name: 'Geordi ACP Adapter',`
- L231 [warn] enterprise-agent-name: `description: 'ACP adapter for Geordi on the Mac.',`
- L232 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:8100',`
- L234 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:8100'],`
- L240 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:3001',`
- L242 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:3001'],`
- L248 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:4747',`
- L250 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:4747'],`
- L256 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:8765',`
- L258 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:8765'],`
- L264 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:8881',`
- L266 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:8881'],`
- L272 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:7000',`
- L274 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:7000'],`
- L280 [warn] tailnet-ip-100: `publicUrl: 'http://100.86.150.96:5000',`
- L282 [warn] tailnet-ip-100: `healthUrls: ['http://100.86.150.96:5000'],`

### packages/server/src/plugins/geordi-swarm/plugin.json

- L3 [warn] enterprise-agent-name: `"name": "Geordi Swarm",`

### packages/server/src/plugins/geordi-swarm/routes.ts

- L68 [warn] tailnet-ip-100: `const MAC_HOST = '100.86.150.96';`
- L103 [error] henry-home-path: `const localRepo = job.repo.replace('~', process.env.HOME || '/home/henrymascot');`
- L113 [error] henry-home-path: `env: { ...process.env, HOME: process.env.HOME || '/home/henrymascot' },`

### packages/server/src/plugins/migrations.test.ts

- L39 [warn] enterprise-agent-name: `name: 'Geordi Swarm',`

### packages/server/src/plugins/registry.test.ts

- L19 [warn] enterprise-agent-name: `name: 'Geordi Swarm',`
- L129 [warn] enterprise-agent-name: `name: 'Geordi Swarm',`
- L160 [warn] tailnet-ip-100: `entityBaseUrl: 'http://100.106.69.9:3000',`
- L198 [warn] tailnet-ip-100: `entityBaseUrl: 'http://100.106.69.9:3000',`

### packages/server/src/plugins/routes.test.ts

- L8 [warn] enterprise-agent-name: `name: 'Geordi Swarm',`

### packages/server/src/routes/chat.ts

- L356 [warn] tailnet-ip-100: `const response = await fetch('http://100.86.150.96:11434/api/tags', { signal: withTimeout(5000) });`

### packages/server/src/routes/docs.test.ts

- L54 [warn] enterprise-name: `it('does not allow Henry/Enterprise-specific workspace paths as product defaults', () => {`
- L54 [warn] henry-name: `it('does not allow Henry/Enterprise-specific workspace paths as product defaults', () => {`
- L57 [warn] clawd-workspace-name: `const privateWorkspaceRoot = path.join('/Users', 'enterprise', 'clawd');`
- L67 [warn] clawd-workspace-name: `fs.writeFileSync(path.join(root, 'output', 'report.md'), '# Output Report\n\nLoaded from clawd output.');`
- L76 [warn] clawd-workspace-name: `expect(payload.content).toContain('Loaded from clawd output.');`

### packages/server/src/routes/docs.ts

- L11 [warn] clawd-workspace-name: `const DEFAULT_CLAWD_ROOT = path.join(HOME_DIR, 'clawd');`
- L58 [warn] clawd-workspace-name: `zora: [path.join(HOME_DIR, 'clawd-zora', 'output')],`
- L59 [warn] clawd-workspace-name: `spock: [path.join(HOME_DIR, 'clawd-spock', 'output')],`

### packages/server/src/routes/search.ts

- L196 [warn] tailnet-ip-100: `const sshTarget = typeof sshTargetEnv === 'string' ? sshTargetEnv.trim() : 'henrymascot@100.86.150.96';`

### packages/server/src/routes/tts.ts

- L358 [error] enterprise-user-path: `\`'/Users/enterprise/Library/Python/3.9/bin/edge-tts' --voice "${resolvedVoice}" --text "${sanitized.replace(/"/g, '\\"')}" --write-media "${tmpFile}"\`,`
- L549 [error] enterprise-user-path: `\`'/Users/enterprise/Library/Python/3.9/bin/edge-tts' --voice "${resolvedVoice}" --text "${truncatedText.replace(/"/g, '\\"')}" --write-media "${tmpFile}"\`,`

### packages/server/src/swarm/ARCHITECTURE.md

- L1 [warn] enterprise-agent-name: `# Geordi Swarm — Architecture`
- L5 [warn] enterprise-agent-name: `Geordi Swarm is a soft-plugin for Entity that dispatches build jobs to`
- L25 [warn] enterprise-agent-name: `- Dispatches to Geordi ACP adapter on Mac (Codex/Claude Code)`
- L27 [warn] tailnet-ip-100: `- Env: \`ACP_BASE_URL\` (default: \`http://100.86.150.96:8100\`)`

### packages/server/src/swarm/db.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Database Layer`

### packages/server/src/swarm/dispatcher.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm - Dispatcher`

### packages/server/src/swarm/e2e-integration.test.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm → Symphony E2E Integration Test`
- L57 [warn] enterprise-agent-name: `it('Phase 1: Entity creates a swarm job (simulating Geordi task creation)', async () => {`

### packages/server/src/swarm/index.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Module Entry Point`

### packages/server/src/swarm/provider-registry.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Provider Registry (Singleton)`

### packages/server/src/swarm/providers/acp.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — ACP Provider`
- L4 [warn] enterprise-agent-name: `* Wraps the existing Geordi ACP adapter running on Mac.`
- L16 [warn] tailnet-ip-100: `const ACP_BASE = process.env.ACP_BASE_URL || 'http://100.86.150.96:8100';`
- L30 [warn] enterprise-agent-name: `readonly label = 'Geordi (ACP/Codex on Mac)';`

### packages/server/src/swarm/providers/codex.ts

- L22 [error] enterprise-user-path: `process.env.CODEX_CODEX_HOME || '/Users/enterprise/.codex';`

### packages/server/src/swarm/providers/interface.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Provider Interface`

### packages/server/src/swarm/providers/symphony.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Symphony Provider`
- L20 [warn] tailnet-ip-100: `*   SYMPHONY_API_URL  — Symphony's dashboard URL for health checks (e.g. http://100.86.150.96:8200)`

### packages/server/src/swarm/routes.test.ts

- L133 [warn] enterprise-agent-name: `describe('Geordi Swarm tracker API', () => {`

### packages/server/src/swarm/routes.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — API Routes`

### packages/server/src/swarm/types.ts

- L2 [warn] enterprise-agent-name: `* Geordi Swarm — Core Types`

### packages/server/src/task-output-links.ts

- L87 [warn] clawd-workspace-name: `/(?:~|\/(?:Users|home)\/[^/\s)]+)\/clawd(-zora|-spock|-scotty)?\/([^\s)]+)/gi,`

### packages/server/src/terminal.ts

- L96 [warn] enterprise-agent-name: `description: 'SSH session to the Spock host alias',`
- L104 [warn] enterprise-agent-name: `description: 'SSH session to the Scotty host alias',`

### scripts/ctrl-deploy-path-check.sh

- L7 [error] enterprise-ssh-target: `PROD_HOST="${ENTITY_PROD_HOST:-enterprise@100.104.229.62}"`
- L7 [warn] tailnet-ip-100: `PROD_HOST="${ENTITY_PROD_HOST:-enterprise@100.104.229.62}"`
- L8 [warn] tailnet-ip-100: `PROD_HTTP_HOST="${ENTITY_PROD_HTTP_HOST:-100.104.229.62}"`
- L9 [error] enterprise-user-path: `ENTITY_DIR="${ENTITY_PROD_DIR:-/Users/enterprise/Services/entity}"`

### scripts/ctrl-live-smoke.mjs

- L8 [warn] tailnet-ip-100: `const prodHost = process.env.ENTITY_PROD_HTTP_HOST || '100.104.229.62';`

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
