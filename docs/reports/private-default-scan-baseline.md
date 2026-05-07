# Private Default Scan Baseline

Generated: 2026-05-07T11:47:10.485Z

Scanned files: 286
Findings: 154
Errors: 0
Warnings: 154

This is the baseline guardrail for Entity portability work. It intentionally reports current hardcoded private defaults without failing by default. Use `npm run scan:private-defaults -- --enforce` when the allowlist has been tightened enough to block regressions.

## Findings by file

### docs/config/gpt-55-instant-default-evaluation.md

- L6 [warn] enterprise-agent-name: `Scope: Entity Ada/Main-style OpenClaw agents when live OpenClaw model policy is unavailable`
- L18 [warn] enterprise-agent-name: `- It only applies when Entity cannot resolve configured models and falls back to its built-in Ada/OpenClaw policy.`

### entity.config.example.yaml

- L51 [warn] enterprise-agent-name: `#   # Geordi Swarm dispatch — Codex host and Mac home path for tilde expansion`

### packages/app/src/App.tsx

- L1284 [warn] enterprise-agent-name: `['Worker', 'Scotty lane · Mac · ~/Code/entity'],`
- L2179 [warn] enterprise-agent-name: `? 'Ada'`
- L2181 [warn] enterprise-agent-name: `? 'Spock'`
- L2183 [warn] enterprise-agent-name: `? 'Scotty'`
- L3874 [warn] enterprise-name: `{ value: 'kitz', label: 'Kitz', hint: 'Enterprise gradient dark' },`
- L4373 [warn] enterprise-name: `Live operational registry for Entity runtime services, linked plugins, and Enterprise tooling.`
- L4393 [warn] enterprise-name: `Open Enterprise Crew Admin`
- L4581 [warn] enterprise-agent-name: `<option value="Ada">Ada</option>`
- L4582 [warn] enterprise-agent-name: `<option value="Spock">Spock</option>`
- L4583 [warn] enterprise-agent-name: `<option value="Scotty">Scotty</option>`
- L4808 [warn] enterprise-agent-name: `<span className="text-purple-400">Ada {formatAuthorshipBadgePercent(authorshipStats.ada)}%</span>`
- L4811 [warn] enterprise-agent-name: `<span className="text-blue-400">Spock {formatAuthorshipBadgePercent(authorshipStats.spock)}%</span>`
- L4814 [warn] enterprise-agent-name: `<span className="text-green-400">Scotty {formatAuthorshipBadgePercent(authorshipStats.scotty)}%</span>`

### packages/app/src/components/CodeMirrorEditor.tsx

- L88 [warn] enterprise-agent-name: `const agents = ['Ada', 'Spock', 'Scotty'] as const;`

### packages/app/src/components/CursorAvatars.tsx

- L95 [warn] enterprise-agent-name: `return 'Ada';`
- L97 [warn] enterprise-agent-name: `return 'Spock';`
- L99 [warn] enterprise-agent-name: `return 'Scotty';`

### packages/app/src/components/NewCommentPopover.tsx

- L121 [warn] enterprise-agent-name: `Mentions ready: type @Ada, @Spock, @Scotty`

### packages/app/src/components/OnboardingFlow.tsx

- L128 [warn] enterprise-name: `{ id: 'kitz', title: 'Kitz', hint: 'Enterprise gradient dark' },`

### packages/app/src/components/PresenceChips.tsx

- L118 [warn] enterprise-agent-name: `return 'Ada';`
- L120 [warn] enterprise-agent-name: `return 'Spock';`
- L122 [warn] enterprise-agent-name: `return 'Scotty';`

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

### packages/app/src/lib/userProfile.ts

- L14 [warn] henry-name: `displayName: 'Henry',`

### packages/app/src/stores/pluginStore.ts

- L281 [warn] enterprise-agent-name: `acp: { url: 'https://github.com/h-mascot/geordi', label: 'Geordi/ACP' },`

### packages/db/src/index.ts

- L1013 [warn] clawd-workspace-name: `['tasks-mc-sh', 'tasks', 'mc.sh', 'script', '~/clawd/scripts/mc.sh', 1, 'Mission Control CLI'],`

### packages/server/src/__tests__/agent-registry-routes.test.ts

- L23 [warn] enterprise-agent-name: `name: 'Book',`

### packages/server/src/__tests__/db-repositories.test.ts

- L143 [warn] enterprise-agent-name: `assignee: 'Ada',`
- L159 [warn] enterprise-agent-name: `expect(task.assignee).toBe('Ada');`
- L182 [warn] enterprise-agent-name: `agent_name: 'Ada',`
- L187 [warn] enterprise-agent-name: `expect(activity.agent_name).toBe('Ada');`
- L246 [warn] enterprise-agent-name: `author: 'Spock',`
- L250 [warn] enterprise-agent-name: `expect(comment.author).toBe('Spock');`
- L435 [warn] enterprise-agent-name: `const entry = dbMod.addTaskHistory(task.id, 'column', 'backlog', 'doing', 'Ada');`
- L439 [warn] enterprise-agent-name: `expect(entry.changed_by).toBe('Ada');`

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

### packages/server/src/agent/agent-display.test.ts

- L11 [warn] enterprise-agent-name: `name: "Book",`
- L32 [warn] enterprise-agent-name: `name: "Book",`

### packages/server/src/agent/events.test.ts

- L17 [warn] enterprise-agent-name: `assignee: 'Geordi',`
- L120 [warn] enterprise-agent-name: `'Geordi',`

### packages/server/src/agent/review-policy.test.ts

- L25 [warn] enterprise-agent-name: `assignee: 'Geordi',`
- L186 [warn] tailnet-ip-100: `'Changed packages/server/src/routes/docs.ts and verified the docs endpoint at http://100.106.69.9:3000/docs/entity/recovery.md successfully.',`

### packages/server/src/agent/tools.test.ts

- L22 [warn] enterprise-agent-name: `assignee: 'Geordi',`
- L47 [warn] enterprise-agent-name: `agent_name: 'Geordi',`

### packages/server/src/config/effective.test.ts

- L8 [warn] enterprise-name: `it('uses safe public defaults without private Enterprise values', () => {`
- L17 [warn] tailnet-ip-100: `expect(serialized).not.toContain('100.104.229.62');`
- L18 [warn] enterprise-agent-name: `expect(serialized).not.toContain('Ada');`

### packages/server/src/index.ts

- L160 [warn] clawd-workspace-name: `const DEFAULT_WORK_ROOT = path.join(HOME_DIR, "clawd");`
- L1527 [warn] henry-name: `author: author || "Henry",`
- L5366 [warn] henry-name: `assignee: "Henry",`
- L5373 [warn] enterprise-agent-name: `assignee: "Ada",`
- L5380 [warn] enterprise-agent-name: `assignee: "Spock",`
- L5572 [warn] clawd-workspace-name: `process.env.ENTITY_WORKSPACE_SPOCK || path.join(HOME_DIR, "clawd-spock"),`
- L5574 [warn] clawd-workspace-name: `process.env.ENTITY_WORKSPACE_SCOTTY || path.join(HOME_DIR, "clawd-scotty"),`

### packages/server/src/plugins/entity-linker/routes.test.ts

- L18 [warn] tailnet-ip-100: `entityBaseUrl: 'http://100.106.69.9:3000',`

### packages/server/src/plugins/entity-services/plugin.json

- L6 [warn] enterprise-name: `"description": "Operational services registry for Entity, Enterprise tooling, and adjacent runtime services.",`

### packages/server/src/plugins/entity-services/routes.test.ts

- L98 [warn] enterprise-name: `family: { key: 'enterprise-crew-admin', name: 'Enterprise Crew Admin', memberCount: 1 },`
- L151 [warn] tailnet-ip-100: `entityBaseUrl: 'http://100.106.69.9:3000',`
- L152 [warn] tailnet-ip-100: `enterpriseAdminUrl: 'http://100.106.69.9:3002',`
- L175 [warn] tailnet-ip-100: `'http://100.104.229.62:3000',`
- L181 [warn] tailnet-ip-100: `expect(linker?.link.url).toBe('http://100.104.229.62:3000/api/entity-linker/status');`
- L182 [warn] tailnet-ip-100: `expect(enterprise?.link.url).toBe('http://100.104.229.62:3002');`

### packages/server/src/plugins/entity-services/routes.ts

- L510 [warn] enterprise-name: `name: 'Enterprise Crew Admin',`
- L520 [warn] enterprise-name: `host: 'Enterprise',`
- L650 [warn] enterprise-agent-name: `host: 'Ada Gateway',`
- L681 [warn] enterprise-agent-name: `host: definition.host ?? 'Ada Gateway',`
- L812 [warn] enterprise-agent-name: `label: 'Ada Gateway',`

### packages/server/src/plugins/geordi-swarm/plugin.json

- L3 [warn] enterprise-agent-name: `"name": "Geordi Swarm",`

### packages/server/src/plugins/migrations.test.ts

- L39 [warn] enterprise-agent-name: `name: 'Geordi Swarm',`

### packages/server/src/plugins/registry.test.ts

- L19 [warn] enterprise-agent-name: `name: 'Geordi Swarm',`
- L129 [warn] enterprise-agent-name: `name: 'Geordi Swarm',`
- L160 [warn] tailnet-ip-100: `entityBaseUrl: 'http://100.106.69.9:3000',`
- L198 [warn] tailnet-ip-100: `entityBaseUrl: 'http://100.106.69.9:3000',`

### packages/server/src/plugins/routes.test.ts

- L8 [warn] enterprise-agent-name: `name: 'Geordi Swarm',`

### packages/server/src/routes/chat-model-registry.test.ts

- L171 [warn] enterprise-agent-name: `it('loads Ada models from the OpenClaw models CLI as the primary OpenClaw source', async () => {`
- L179 [warn] enterprise-name: `{ key: 'enterprise-local/mlx-community/Qwen3.6-35B-A3B-4bit', name: 'Qwen 3.6 35B A3B 4bit (Enterprise MLX)', local: true, available: true, tags: ['configured'] }`
- L226 [warn] enterprise-agent-name: `it('loads Book models from Hermes provider config', async () => {`
- L243 [warn] tailnet-ip-100: `base_url: http://100.104.229.62:11434/v1`

### packages/server/src/routes/chat.test.ts

- L67 [warn] enterprise-agent-name: `finalAssistantVisibleText: 'Zora clean reply',`
- L68 [warn] enterprise-agent-name: `finalAssistantRawText: '<final>Zora clean reply</final>',`
- L73 [warn] enterprise-agent-name: `expect(parseOpenClawAgentOutput(raw)).toBe('Zora clean reply');`
- L100 [warn] enterprise-agent-name: `ada: 'Ada runtime reply',`
- L101 [warn] enterprise-agent-name: `zora: { content: 'Zora runtime reply' },`
- L102 [warn] enterprise-agent-name: `spock: '<final>Spock runtime reply</final>',`
- L112 [warn] enterprise-agent-name: `['ada', 'Ada runtime reply'],`
- L113 [warn] enterprise-agent-name: `['zora', 'Zora runtime reply'],`
- L114 [warn] enterprise-agent-name: `['spock', 'Spock runtime reply'],`

### packages/server/src/routes/chat.ts

- L295 [warn] henry-name: `'Reply directly to Henry. Be concise, useful, and do not mention transport/runtime details.',`
- L315 [warn] henry-name: `'Reply directly to Henry on behalf of the selected agents.',`

### packages/server/src/routes/docs.test.ts

- L54 [warn] enterprise-name: `it('does not allow Henry/Enterprise-specific workspace paths as product defaults', () => {`
- L54 [warn] henry-name: `it('does not allow Henry/Enterprise-specific workspace paths as product defaults', () => {`
- L57 [warn] clawd-workspace-name: `const privateWorkspaceRoot = path.join('/Users', 'enterprise', 'clawd');`
- L67 [warn] clawd-workspace-name: `fs.writeFileSync(path.join(root, 'output', 'report.md'), '# Output Report\n\nLoaded from clawd output.');`
- L76 [warn] clawd-workspace-name: `expect(payload.content).toContain('Loaded from clawd output.');`

### packages/server/src/routes/tts.test.ts

- L6 [warn] enterprise-agent-name: `const text = 'Hello "Ada"; rm -rf / && echo done';`

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
- L30 [warn] enterprise-agent-name: `readonly label = 'Geordi (ACP/Codex on Mac)';`

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
