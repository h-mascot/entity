#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { createRequire } = require('module');

const APP_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(APP_DIR, '..', '..');
const OUT_DIR = path.join(APP_DIR, 'artifacts', 'visual-smoke');
const BASE_URL = process.env.ENTITY_VISUAL_BASE_URL || 'http://127.0.0.1:5173';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RUNTIME_NODE_MODULES = path.join(
  process.env.HOME || '',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
);

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    if (fs.existsSync(RUNTIME_NODE_MODULES)) {
      return createRequire(path.join(RUNTIME_NODE_MODULES, 'noop.js'))('playwright');
    }
    throw new Error('Unable to load Playwright. Set NODE_PATH to a node_modules folder containing playwright.');
  }
}

function get(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode && response.statusCode < 500));
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await get(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function ensureServer() {
  if (await waitForServer(BASE_URL, 1200)) {
    return null;
  }

  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: APP_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });

  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    log += chunk.toString();
  });

  if (!(await waitForServer(BASE_URL, 20_000))) {
    child.kill('SIGTERM');
    throw new Error(`Vite dev server did not become ready at ${BASE_URL}.\n${log.slice(-2000)}`);
  }

  return child;
}

async function closeBrowserWithTimeout(browser) {
  let timeoutId;
  try {
    await Promise.race([
      browser.close(),
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, 3000);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

const viewSpecs = [
  {
    id: '01-files',
    tab: 'files',
    url: '/',
    labels: [/Unified File Dashboard/i, /Files/i],
    requiredLabels: [/Entity UI Build Report/i, /Entity MC Context/i],
  },
  {
    id: '02-agents',
    tab: 'agents',
    url: '/',
    labels: [/Agents|Fleet|Crew/i],
    requiredLabels: [/Ada/i, /Agent Fleet/i],
  },
  {
    id: '03-tasks',
    tab: 'tasks',
    url: '/',
    labels: [/Kanban|Operational Board|Backlog/i],
    requiredLabels: [/#462/i, /test ripple task/i],
  },
  {
    id: '04-services',
    tab: 'services',
    url: '/',
    labels: [/Operational services registry|Services/i],
    requiredLabels: [/Entity App/i, /OpenClaw Gateway/i],
  },
  {
    id: '05-chat',
    tab: 'chat',
    url: '/',
    labels: [/Chat|Mission Channels|Channel/i],
    requiredLabels: [/mission-control/i, /Visual smoke should verify/i],
  },
  {
    id: '06-admin',
    tab: 'admin',
    url: '/',
    labels: [/Admin|Control center|Require login/i],
    requiredLabels: [/Require login/i, /Configured Sources/i],
  },
  {
    id: '07-docs-view',
    tab: null,
    url: '/docs/memory/entity-mc-context.md',
    labels: [/Document|Entity MC Context|Entity Context/i],
    requiredLabels: [/Entity MC Context/i, /Purpose/i],
  },
  {
    id: '08-agent-detail',
    tab: 'agents',
    url: '/',
    setup: openAgentDetail,
    labels: [/Activity|Output|Health|Queue|Agent/i],
    requiredLabels: [/Agent Detail/i, /Edited docs view/i],
  },
  {
    id: '09-task-detail',
    tab: 'tasks',
    url: '/',
    setup: openTaskDetail,
    labels: [/Task #|Continue|Create follow-up task|Details/i],
    requiredLabels: [/Continue/i, /Evidence/i],
  },
];

const sampleTask = {
  id: 462,
  name: 'test ripple task',
  description: 'Visual smoke task used to verify the task detail surface renders with state, output, comments, and actions.',
  column: 'backlog',
  assignee: 'Ada',
  model: 'Default',
  archived: false,
  priority: 'P2',
  project: 'General',
  projects: [{ id: 1, name: 'General', color: null }],
  blocked: false,
  blocker_reason: null,
  due_at: null,
  due_date: null,
  recurring: false,
  progress_status: null,
  created_at: '2026-04-11T09:00:00.000Z',
  updated_at: '2026-04-24T18:30:00.000Z',
  created_by: 'Henry',
  metadata: JSON.stringify({ model: 'Default', project: 'General' }),
  output: 'Evidence: /docs/output/entity-ui-smoke.md\nDocs: ~/clawd/memory/entity-mc-context.md',
  output_links_count: 2,
  parent_task_id: null,
  subtask_count: 0,
  subtask_done_count: 0,
  activity: [
    {
      id: 1,
      agent_name: 'Ada',
      action: 'note',
      details: 'Visual smoke detail opened successfully.',
      created_at: '2026-04-24T18:40:00.000Z',
    },
  ],
  attachments: [],
  dependencies: [],
};

const now = '2026-04-24T18:45:00.000Z';

const sampleAgents = [
  {
    id: 'ada',
    name: 'Ada',
    emoji: '🔮',
    description: 'Frontend and product operator',
    model: 'Claude Opus 4.6',
    gateway: 'ada-gateway',
    capabilities: {
      ownerLabel: 'Entity',
      verificationLabel: 'Build + visual',
      identityLabel: 'Core operator',
      capabilityLabels: ['Mission Control', 'Files', 'Docs', 'Review'],
    },
  },
  {
    id: 'spock',
    name: 'Spock',
    emoji: '🖖',
    description: 'Reasoning and docs operator',
    model: 'GPT-5.3 Codex',
    gateway: 'ada-gateway',
    capabilities: {
      ownerLabel: 'Entity',
      verificationLabel: 'Docs',
      identityLabel: 'Runtime analyst',
      capabilityLabels: ['Chat', 'Mention', 'Assign'],
    },
  },
  {
    id: 'scotty',
    name: 'Scotty',
    emoji: '🛠️',
    description: 'Infrastructure operator',
    model: 'Kimi For Coding',
    gateway: 'mascot',
    capabilities: {
      ownerLabel: 'Platform',
      verificationLabel: 'Runtime',
      identityLabel: 'Service operator',
      capabilityLabels: ['Services', 'Deploy', 'Health'],
    },
  },
];

const sampleActivities = [
  {
    id: 'act-1',
    source: 'agent',
    type: 'file_edit',
    agentName: 'Ada',
    agentEmoji: '🔮',
    action: 'Edited docs view',
    description: 'Updated the markdown preview shell and right-side document actions.',
    timestamp: '2026-04-24T18:42:00.000Z',
    filePath: 'packages/app/src/components/MarkdownPreview.tsx',
  },
  {
    id: 'act-2',
    source: 'task',
    type: 'task_updated',
    agentName: 'Mission Control',
    agentEmoji: '⚡',
    action: 'Moved task',
    description: 'Task #462 changed from Doing to Review.',
    timestamp: '2026-04-24T18:39:00.000Z',
    taskId: 462,
    taskColumn: 'review',
  },
  {
    id: 'act-3',
    source: 'agent',
    type: 'tool_call',
    agentName: 'Spock',
    agentEmoji: '🖖',
    action: 'Ran verification',
    description: 'Captured visual smoke screenshots for the selected Entity views.',
    timestamp: '2026-04-24T18:34:00.000Z',
  },
];

const sampleSources = [
  {
    id: 'zora',
    displayName: 'Zora',
    type: 'local',
    baseUrl: null,
    basePath: '/Users/henrymascot/clawd-zora',
    authType: 'none',
    authRef: null,
    enabled: true,
    icon: '⚡',
    capabilities: 'read,write,search',
    health: 'ok',
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'vault',
    displayName: 'Vault',
    type: 'local',
    baseUrl: null,
    basePath: '/Users/henrymascot/clawd',
    authType: 'none',
    authRef: null,
    enabled: true,
    icon: '📓',
    capabilities: 'read,write,search',
    health: 'ok',
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  },
];

const sampleFiles = [
  {
    id: 'file-1',
    sourceId: 'zora',
    sourceName: 'Zora',
    path: 'output/2026-04-24-entity-ui-build.md',
    title: 'Entity UI Build Report',
    type: 'markdown',
    agent: 'Ada',
    origin: 'project-doc',
    isRecurring: false,
    recurringPattern: null,
    preview: 'Implemented selected dense ops-console styling across files, tasks, agents, services, admin, docs, and chat cleanup.',
    updatedAt: '2026-04-24T18:40:00.000Z',
    indexedAt: now,
  },
  {
    id: 'file-2',
    sourceId: 'vault',
    sourceName: 'Vault',
    path: 'memory/entity-mc-context.md',
    title: 'Entity MC Context',
    type: 'markdown',
    agent: 'Spock',
    origin: 'memory',
    isRecurring: false,
    recurringPattern: null,
    preview: 'Entity is the operational workspace for files, agents, tasks, services, chat, and admin.',
    updatedAt: '2026-04-24T17:55:00.000Z',
    indexedAt: now,
  },
  {
    id: 'file-3',
    sourceId: 'zora',
    sourceName: 'Zora',
    path: 'scripts/visual-smoke.cjs',
    title: 'Visual Smoke Script',
    type: 'script',
    agent: 'Scotty',
    origin: 'repo',
    isRecurring: false,
    recurringPattern: null,
    preview: 'Playwright smoke coverage for first and second level Entity views at 1440x1000.',
    updatedAt: '2026-04-24T18:30:00.000Z',
    indexedAt: now,
  },
];

const sampleDocsContent = `# Entity MC Context

## Purpose

Entity is the standard bootstrap skill for deploying Entity Mission Control helper tooling to crew agents without manual script copying.

It packages the working Mission Control helper runtime into one reusable, versioned bundle with a thin installer layer and per-agent manifests.

## Why it exists

Previous deployments relied on copying scripts by hand into agent homes, especially on Mac-hosted agents like Zora. That worked, but created drift risk, weak rollback, and awkward onboarding.

The replacement direction is:

- one canonical runtime
- one thin bootstrap/install skill
- tiny per-agent manifests
- idempotent install/update
- verification and rollback built in

## Architecture

Shared runtime services coordinate files, tasks, agents, services, chat, and admin operations. The UI should stay dense, operational, and optimized for repeat use.`;

const samplePlugins = [
  {
    id: 'entity-services',
    name: 'Entity Services',
    version: '1.0.0',
    kind: 'internal',
    description: 'Live operational registry for Entity runtime services, linked plugins, and Enterprise tooling.',
    capabilities: ['services.registry', 'health.read'],
    hooks: [],
    enabled: true,
    ui: {
      mountPoint: { type: 'top-level-tab' },
      label: 'Services',
      icon: '▦',
      component: 'EntityServicesBoard',
    },
    settings: {},
    routes: [{ basePath: '/api/entity-services' }],
    status: { loaded: true, registeredAt: now, routesMounted: ['/api/entity-services'] },
  },
];

const sampleServiceRegistry = {
  plugin: {
    id: 'entity-services',
    name: 'Entity Services',
    enabled: true,
    kind: 'internal',
    settings: {},
  },
  summary: { operational: 3, degraded: 1, offline: 0, unknown: 1 },
  checkedAt: now,
  services: [
    {
      id: 'entity-app',
      name: 'Entity App',
      serviceType: 'host-process',
      category: 'frontend',
      description: 'Next/Vite desktop app surface for Mission Control.',
      status: 'operational',
      health: { status: 'operational', message: 'Responding', checkedAt: now, endpoint: 'http://127.0.0.1:5173', latencyMs: 18, statusCode: 200 },
      link: { label: 'Open app', url: 'http://127.0.0.1:5173', external: true },
      tags: ['app', 'desktop', 'ui'],
      meta: { host: 'mac', source: 'visual-smoke', processName: 'vite', detectedTitle: 'Entity', detectedServerHeader: 'vite' },
    },
    {
      id: 'entity-server',
      name: 'Entity API',
      serviceType: 'host-process',
      category: 'backend',
      description: 'Express API for tasks, docs, files, chat, plugins, and agent status.',
      status: 'degraded',
      health: { status: 'degraded', message: 'Fallback data active', checkedAt: now, endpoint: 'http://127.0.0.1:3001/api/health', latencyMs: 84, statusCode: 200 },
      link: { label: 'Open API', url: 'http://127.0.0.1:3001', external: true },
      healthLink: { label: 'Health', url: 'http://127.0.0.1:3001/api/health', external: true },
      tags: ['api', 'tasks', 'docs'],
      meta: { host: 'mac', source: 'visual-smoke', processName: 'node', detectedTitle: 'Entity API', detectedServerHeader: 'express' },
    },
    {
      id: 'openclaw-gateway',
      name: 'OpenClaw Gateway',
      serviceType: 'external-http',
      category: 'agents',
      description: 'Agent gateway used by crew operators and task handoff.',
      status: 'operational',
      health: { status: 'operational', message: 'Gateway reachable', checkedAt: now, endpoint: 'http://ada-gateway/api/agents', latencyMs: 42, statusCode: 200 },
      link: { label: 'Gateway', url: 'http://ada-gateway', external: true },
      tags: ['agents', 'gateway', 'runtime'],
      meta: { host: 'ada-gateway', source: 'visual-smoke', processName: 'openclaw', detectedTitle: 'OpenClaw Gateway', detectedServerHeader: 'node' },
    },
  ],
};

const sampleChatCategories = [
  { id: 'cat-ops', name: 'Operations', emoji: '⚡', order: 1 },
  { id: 'cat-projects', name: 'Projects', emoji: '📁', order: 2 },
];

const sampleChatChannels = [
  {
    id: 'mission-control',
    name: 'mission-control',
    description: 'Crew coordination and execution updates',
    categoryId: 'cat-ops',
    order: 1,
    agents: ['ada', 'spock', 'scotty'],
    unreadCount: 2,
    lastMessageAt: '2026-04-24T18:43:00.000Z',
  },
  {
    id: 'ui-upgrade',
    name: 'ui-upgrade',
    description: 'Selected UI implementation pass',
    categoryId: 'cat-projects',
    order: 1,
    agents: ['ada'],
    unreadCount: 0,
    lastMessageAt: '2026-04-24T18:31:00.000Z',
  },
];

const sampleChatMessages = [
  {
    id: 'msg-1',
    channelId: 'mission-control',
    sender: 'ada',
    senderEmoji: '🔮',
    content: 'Files, tasks, and docs need to stay dense. Keep the actions visible and avoid hiding operational controls.',
    timestamp: '2026-04-24T18:35:00.000Z',
    createdAt: '2026-04-24T18:35:00.000Z',
    status: 'sent',
  },
  {
    id: 'msg-2',
    channelId: 'mission-control',
    sender: 'spock',
    senderEmoji: '🖖',
    content: 'Visual smoke should verify loaded states, not only empty or backend-error states.',
    timestamp: '2026-04-24T18:43:00.000Z',
    createdAt: '2026-04-24T18:43:00.000Z',
    status: 'sent',
  },
];

const sampleChatThreads = [
  {
    id: 'thread-1',
    channelId: 'mission-control',
    parentMessageId: 'msg-2',
    title: 'Visual smoke loaded states',
    lastMessageAt: '2026-04-24T18:43:00.000Z',
    messageCount: 1,
    messages: [],
  },
];

function fulfillJson(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installApiMocks(page) {
  const taskComments = [];
  page.__taskSmokeCounters = {
    comments: 0,
    activity: 0,
    sync: 0,
    subtasks: 0,
    taskPatch: 0,
    followUp: 0,
    projects: 0,
  };

  await page.route('**/api/agents/status', async (route) =>
    fulfillJson(route, {
      agents: sampleAgents.map((agent) => ({ id: agent.id, status: agent.id === 'scotty' ? 'offline' : 'online' })),
    })
  );

  await page.route('**/api/agents/focus', async (route) =>
    fulfillJson(route, {
      agents: [
        { id: 'ada', file: 'packages/app/src/components/UnifiedFileDashboard.tsx', lastModified: now },
        { id: 'spock', file: 'docs/context/entity-context.md', lastModified: '2026-04-24T18:38:00.000Z' },
      ],
    })
  );

  await page.route('**/api/agents', async (route) => fulfillJson(route, { agents: sampleAgents, list: sampleAgents }));
  await page.route('**/api/activities**', async (route) => fulfillJson(route, { activities: sampleActivities }));
  await page.route('**/api/activity/recent**', async (route) => fulfillJson(route, { activities: sampleActivities }));
  await page.route('**/api/agents/metrics**', async (route) =>
    fulfillJson(route, {
      system: { cpuPercent: 22, memUsedMb: 8142, memTotalMb: 32768, memPercent: 25, uptimeSeconds: 142400, loadAvg: 1.3 },
      gateway: { pid: 8842, cpuPercent: 3.4, memPercent: 2.1 },
      agents: {
        ada: { inputTokens: 12400, outputTokens: 4200, contextTokens: 48000, estimatedCost: 1.84 },
        spock: { inputTokens: 9300, outputTokens: 3100, contextTokens: 36000, estimatedCost: 1.22 },
        scotty: { inputTokens: 5100, outputTokens: 1900, contextTokens: 22000, estimatedCost: 0.74 },
      },
    })
  );
  await page.route('**/api/sources**', async (route) => fulfillJson(route, { sources: sampleSources }));
  await page.route('**/api/fs/sources**', async (route) => fulfillJson(route, { sources: sampleSources }));
  await page.route('**/api/fs/search**', async (route) => fulfillJson(route, { indexed: true, results: sampleFiles }));
  await page.route('**/api/fs/tree**', async (route) =>
    fulfillJson(route, {
      sourceId: 'zora',
      path: '',
      capabilities: { read: true, write: true, rename: true, delete: true, list: true, search: true },
      nodes: [
        { sourceId: 'zora', path: 'output', name: 'output', isDirectory: true, updatedAt: now },
        { sourceId: 'zora', path: 'scripts', name: 'scripts', isDirectory: true, updatedAt: now },
      ],
    })
  );
  await page.route('**/api/fs/file**', async (route) =>
    fulfillJson(route, {
      sourceId: 'vault',
      path: 'memory/entity-mc-context.md',
      content: sampleDocsContent,
      contentType: 'text/markdown',
      size: sampleDocsContent.length,
      isBinary: false,
      updatedAt: now,
      readOnly: false,
    })
  );

  await page.route('**/api/docs/**', async (route) =>
    fulfillJson(route, {
      content: sampleDocsContent,
      path: 'memory/entity-mc-context.md',
      filename: 'entity-mc-context.md',
    })
  );

  await page.route('**/api/plugins', async (route) => fulfillJson(route, { plugins: samplePlugins }));
  await page.route('**/api/entity-services/registry', async (route) => fulfillJson(route, sampleServiceRegistry));

  await page.route('**/api/chat/setup', async (route) =>
    fulfillJson(route, { categories: sampleChatCategories, channels: sampleChatChannels })
  );
  await page.route('**/api/chat/models', async (route) =>
    fulfillJson(route, {
      cloud: [{ id: 'openai-codex/gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'openai-codex' }],
      local: [{ id: 'ollama/qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', provider: 'ollama', isLocal: true }],
    })
  );
  await page.route(/\/api\/chat\/channels\/[^/]+\/messages(?:\?.*)?$/, async (route) => fulfillJson(route, { messages: sampleChatMessages }));
  await page.route(/\/api\/chat\/channels\/[^/]+\/threads(?:\?.*)?$/, async (route) => fulfillJson(route, { threads: sampleChatThreads }));
  await page.route(/\/api\/chat\/channels\/[^/]+\/read(?:\?.*)?$/, async (route) => fulfillJson(route, { success: true }));
  await page.route('**/api/chat/channels', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/chat/channels') return route.fallback();
    return fulfillJson(route, { categories: sampleChatCategories, channels: sampleChatChannels });
  });

  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      page.__taskSmokeCounters.followUp += 1;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ...sampleTask, id: 999, name: 'Follow-up: test ripple task' }),
      });
    }
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([sampleTask]) });
  });

  await page.route('**/api/tasks/462', async (route) => {
    if (route.request().method() === 'PATCH') {
      page.__taskSmokeCounters.taskPatch += 1;
      const body = route.request().postDataJSON?.() ?? {};
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...sampleTask, ...body, updated_at: now }),
      });
    }
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sampleTask) });
  });

  await page.route('**/api/tasks/462/projects', async (route) => {
    if (route.request().method() === 'POST') {
      page.__taskSmokeCounters.projects += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sampleTask.projects) });
    }
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sampleTask.projects) });
  });

  await page.route('**/api/tasks/462/comments', async (route) => {
    if (route.request().method() === 'POST') {
      page.__taskSmokeCounters.comments += 1;
      const body = route.request().postDataJSON?.() ?? {};
      const comment = {
        id: taskComments.length + 1,
        task_id: 462,
        body: body.body || 'Smoke comment',
        author: body.author || 'Henry',
        parent_id: body.parent_id ?? null,
        created_at: now,
      };
      taskComments.push(comment);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(comment),
      });
    }
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(taskComments) });
  });

  await page.route('**/api/tasks/462/activity', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    page.__taskSmokeCounters.activity += 1;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/api/tasks/462/subtasks/auto', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    page.__taskSmokeCounters.subtasks += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/api/tasks/462/sync-sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    page.__taskSmokeCounters.sync += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/api/projects**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sampleTask.projects) });
  });
}

async function withStableLocalStorage(page, tab) {
  await page.addInitScript((selectedTab) => {
    window.localStorage.setItem('entity.auth.login-required.v1', 'false');
    window.localStorage.setItem('entity.theme.v1', 'dark');
    window.localStorage.setItem('entity.sidebar.collapsed.v1', 'false');
    window.localStorage.setItem('entity.tasks.tab', 'kanban');
    if (selectedTab) {
      window.localStorage.setItem('entity.sidebar.tab', selectedTab);
    } else {
      window.localStorage.removeItem('entity.sidebar.tab');
    }
  }, tab || null);
}

async function waitForApp(page) {
  await page.waitForSelector('.entity-shell', { timeout: 20_000 });
  await page.waitForTimeout(1400);
}

async function openAgentDetail(page) {
  const adaCard = page.locator('button.entity-ops-row').filter({ hasText: /Ada/i }).first();
  if (await adaCard.count()) {
    await adaCard.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(900);
  }
}

async function openTaskDetail(page) {
  const task = page.locator('[data-testid="mc-react-kanban-board"] button, .board button, .task').filter({
    hasText: /Task #|MB-|fix|review|implement|test|workflow/i,
  }).first();
  if (await task.count()) {
    await task.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
  }

  await page.waitForSelector('[data-testid="task-detail-rail"]', { timeout: 5000 });
  const waitForCounter = async (name, previousValue = 0) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if ((page.__taskSmokeCounters?.[name] ?? 0) > previousValue) {
        await page.waitForTimeout(150);
        return;
      }
      await page.waitForTimeout(100);
    }
    throw new Error(`Task detail interaction did not call ${name}; counters=${JSON.stringify(page.__taskSmokeCounters)}`);
  };

  const taskPanel = page.locator('[data-testid="task-detail-panel"]');
  const selects = taskPanel.locator('select');
  let previousPatches = page.__taskSmokeCounters.taskPatch;
  await selects.nth(0).selectOption('Spock');
  await waitForCounter('taskPatch', previousPatches);

  previousPatches = page.__taskSmokeCounters.taskPatch;
  await taskPanel.locator('input[type="date"]').fill('2026-05-01');
  await waitForCounter('taskPatch', previousPatches);

  previousPatches = page.__taskSmokeCounters.taskPatch;
  await selects.nth(1).selectOption('P1');
  await waitForCounter('taskPatch', previousPatches);

  previousPatches = page.__taskSmokeCounters.taskPatch;
  await selects.nth(2).selectOption('doing');
  await waitForCounter('taskPatch', previousPatches);

  previousPatches = page.__taskSmokeCounters.taskPatch;
  await selects.nth(3).selectOption('');
  await waitForCounter('taskPatch', previousPatches);

  const numberInputs = taskPanel.locator('input[type="number"]');
  if (await numberInputs.count()) {
    throw new Error('Advanced estimate/time controls should be collapsed by default.');
  }
  await taskPanel.getByRole('button', { name: /Show estimate, time, blocker/i }).click({ timeout: 3000 });
  await page.waitForFunction(() => document.body.innerText.includes('ESTIMATE'), null, { timeout: 3000 });
  previousPatches = page.__taskSmokeCounters.taskPatch;
  await numberInputs.nth(0).fill('2.5');
  await numberInputs.nth(0).blur();
  await waitForCounter('taskPatch', previousPatches);

  previousPatches = page.__taskSmokeCounters.taskPatch;
  await numberInputs.nth(1).fill('1.25');
  await numberInputs.nth(1).blur();
  await waitForCounter('taskPatch', previousPatches);

  previousPatches = page.__taskSmokeCounters.taskPatch;
  await taskPanel.locator('input[type="checkbox"]').first().check();
  await waitForCounter('taskPatch', previousPatches);

  const previousProjects = page.__taskSmokeCounters.projects;
  await taskPanel.locator('button[aria-label="Remove General"]').click({ timeout: 3000 });
  await waitForCounter('projects', previousProjects);

  const commentsTab = page.locator('[data-testid="task-detail-rail"] button').filter({ hasText: /Comments/ }).first();
  await commentsTab.click({ timeout: 3000 });
  await page.waitForFunction(() => document.body.innerText.includes('Add a comment') || document.body.innerText.includes('No comments yet'), null, { timeout: 3000 });
  const commentInput = page.locator('input[placeholder="Add a comment..."]');
  await commentInput.click();
  await commentInput.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await commentInput.type('Smoke comment');
  await page.waitForFunction(() => {
    const input = document.querySelector('input[placeholder="Add a comment..."]');
    return input && input.value === 'Smoke comment';
  }, null, { timeout: 3000 });
  await page.waitForTimeout(100);
  const previousComments = page.__taskSmokeCounters.comments;
  const commentButton = page.locator('input[placeholder="Add a comment..."] + button');
  await page.waitForFunction(() => {
    const button = document.querySelector('input[placeholder="Add a comment..."] + button');
    return button && !button.disabled;
  }, null, { timeout: 3000 });
  await commentButton.click({ timeout: 3000 });
  await waitForCounter('comments', previousComments);

  const linksTab = page.locator('[data-testid="task-detail-rail"] button').filter({ hasText: /Links/ }).first();
  await linksTab.click({ timeout: 3000 });
  await page.waitForFunction(() => document.body.innerText.includes('Linked Evidence'), null, { timeout: 3000 });

  const activityTab = page.locator('[data-testid="task-detail-rail"] button').filter({ hasText: /Activity/ }).first();
  await activityTab.click({ timeout: 3000 });
  await page.waitForFunction(() => document.body.innerText.includes('Activity Log'), null, { timeout: 3000 });
  await page.locator('input[placeholder="Add a note or update..."]').fill('Smoke note');
  const previousActivityForNote = page.__taskSmokeCounters.activity;
  await page.locator('button').filter({ hasText: /^Add$/ }).click({ timeout: 3000 });
  await waitForCounter('activity', previousActivityForNote);

  const logsTab = page.locator('[data-testid="task-detail-rail"] button').filter({ hasText: /Logs/ }).first();
  await logsTab.click({ timeout: 3000 });
  await page.waitForFunction(() => document.body.innerText.includes('Technical activity'), null, { timeout: 3000 });
  const previousSync = page.__taskSmokeCounters.sync;
  await page.locator('button').filter({ hasText: /Sync/ }).click({ timeout: 3000 });
  await waitForCounter('sync', previousSync);

  const subtasksTab = page.locator('[data-testid="task-detail-rail"] button').filter({ hasText: /Subtasks/ }).first();
  await subtasksTab.click({ timeout: 3000 });
  await page.waitForFunction(() => document.body.innerText.includes('Subtasks'), null, { timeout: 3000 });
  const previousSubtasks = page.__taskSmokeCounters.subtasks;
  await page.locator('button').filter({ hasText: /Auto-generate subtasks|Auto-subtasks/ }).first().click({ timeout: 3000 });
  await waitForCounter('subtasks', previousSubtasks);

  const previousActivityForContinue = page.__taskSmokeCounters.activity;
  await page.locator('button').filter({ hasText: /^Continue$/ }).click({ timeout: 3000 });
  await waitForCounter('activity', previousActivityForContinue);
  const previousFollowUps = page.__taskSmokeCounters.followUp;
  await page.locator('button[aria-label="Create follow-up task"]').click({ timeout: 3000 });
  await waitForCounter('followUp', previousFollowUps);

  const outputEditor = page.locator('textarea[placeholder="Paste output, logs, or links..."]').first();
  await outputEditor.fill('Evidence: /docs/output/entity-ui-smoke.md\nDocs: ~/clawd/memory/entity-mc-context.md\nSmoke: /docs/output/task-detail-click-test.md');
  const previousPatchesForOutput = page.__taskSmokeCounters.taskPatch;
  await page.locator('button').filter({ hasText: /^Save$/ }).first().click({ timeout: 3000 });
  await waitForCounter('taskPatch', previousPatchesForOutput);

  await page.locator('input[placeholder="Task IDs (e.g. 1, 2, 3)"]').fill('460');
  const previousPatchesForDependencies = page.__taskSmokeCounters.taskPatch;
  await page.locator('input[placeholder="Task IDs (e.g. 1, 2, 3)"] + button, button').filter({ hasText: /^Save$/ }).last().click({ timeout: 3000 });
  await waitForCounter('taskPatch', previousPatchesForDependencies);

  await page.locator('input[placeholder="Name"]').fill('Smoke artifact');
  await page.locator('input[placeholder="URL or path"]').fill('/docs/output/task-detail-click-test.md');
  const previousPatchesForAttachment = page.__taskSmokeCounters.taskPatch;
  await page.locator('button').filter({ hasText: /^Attach$/ }).click({ timeout: 3000 });
  await waitForCounter('taskPatch', previousPatchesForAttachment);

  await activityTab.click({ timeout: 3000 });
  await page.waitForFunction(() => document.body.innerText.includes('Activity Log'), null, { timeout: 3000 });
  await page.waitForTimeout(2600);
}

async function validatePage(page, spec) {
  const metrics = await page.evaluate(() => {
    const body = document.body;
    const text = body.innerText.replace(/\s+/g, ' ').trim();
    const rects = Array.from(document.querySelectorAll('body *'))
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 2 && rect.height > 2);
    const visibleArea = rects.reduce((sum, rect) => sum + Math.min(rect.width, window.innerWidth) * Math.min(rect.height, window.innerHeight), 0);
    return {
      text,
      textLength: text.length,
      visibleArea,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      title: document.title,
    };
  });

  const missing = spec.labels.filter((label) => !label.test(metrics.text));
  const missingRequired = (spec.requiredLabels ?? []).filter((label) => !label.test(metrics.text));
  const failures = [];
  if (metrics.textLength < 20) failures.push('body text is too short');
  if (metrics.visibleArea < 25_000) failures.push('visible UI area is too small');
  if (metrics.scrollWidth > metrics.innerWidth + 24) failures.push(`horizontal overflow ${metrics.scrollWidth}px > ${metrics.innerWidth}px`);
  if (missing.length === spec.labels.length) failures.push(`missing expected labels: ${spec.labels.map(String).join(', ')}`);
  if (missingRequired.length > 0) failures.push(`missing required loaded-state labels: ${missingRequired.map(String).join(', ')}`);
  if (/Request failed|Unable to load|unavailable|No channel selected/i.test(metrics.text)) {
    failures.push('unexpected error or unloaded-state text is visible');
  }

  if (spec.id === '09-task-detail') {
    const taskDetailStructure = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="task-detail-rail"]');
      const tabStrip = document.querySelector('[data-testid="task-detail-bottom-tabs"]');
      const panel = document.querySelector('[data-testid="task-detail-panel"]');
      const railRect = rail?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      return {
        hasRail: Boolean(rail),
        hasBottomTabs: Boolean(tabStrip),
        railIsRightAligned: Boolean(
          railRect &&
            panelRect &&
            railRect.width >= 64 &&
            Math.abs(railRect.right - panelRect.right) <= 2 &&
            railRect.top >= panelRect.top
        ),
      };
    });

    if (!taskDetailStructure.hasRail) failures.push('task detail selected reference rail is missing');
    if (!taskDetailStructure.railIsRightAligned) failures.push('task detail rail is not aligned to the right edge');
    if (taskDetailStructure.hasBottomTabs) failures.push('task detail still renders the non-reference bottom tab strip');
  }
  return { ...metrics, failures };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await ensureServer();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
  });
  const summary = [];

  try {
    for (const spec of viewSpecs) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      await installApiMocks(page);
      await withStableLocalStorage(page, spec.tab);
      await page.goto(new URL(spec.url, BASE_URL).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForApp(page);
      if (spec.setup) await spec.setup(page);
      const result = await validatePage(page, spec);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
      });
      await page.screenshot({
        path: path.join(OUT_DIR, `${spec.id}.png`),
        fullPage: false,
        animations: 'disabled',
      });
      summary.push({ id: spec.id, url: page.url(), failures: result.failures, textLength: result.textLength });
      await context.close();
    }
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    await closeBrowserWithTimeout(browser);
    if (server) server.kill('SIGTERM');
  }

  const failures = summary.filter((entry) => entry.failures.length > 0);
  if (failures.length > 0) {
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(summary, null, 2));
})();
