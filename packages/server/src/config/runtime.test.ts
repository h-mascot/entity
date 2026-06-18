import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBootstrapRuntimeEnv,
  buildConfigPluginSettings,
  buildConfiguredAgentHealthEndpoints,
  buildConfiguredAgentWorkspaces,
  loadRuntimeFileConfig,
} from './runtime';

const RUNTIME_ENV_KEYS = [
  'ENTITY_CONFIG',
  'ENTITY_TASK_DB_PATH',
  'WORKSPACE',
  'PORT',
  'ENTITY_PUBLIC_BASE_URL',
  'ENTITY_CLOUD_API_BASE',
  'VITE_ENTITY_API_BASE',
  'VITE_MC_ORIGIN',
  'VITE_ENTITY_WS_URL',
  'ENTITY_SERVER_LOG_PATH',
];

function clearRuntimeEnv() {
  for (const key of RUNTIME_ENV_KEYS) delete process.env[key];
}

function makeRepoFixture(configYaml: string) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-runtime-config-'));
  const cwd = path.join(repo, 'packages', 'server');
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(repo, 'entity.config.yaml'), configYaml);
  return { repo, cwd };
}

function makeRepoFixtureNoConfig() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-runtime-noconfig-'));
  const cwd = path.join(repo, 'packages', 'server');
  fs.mkdirSync(cwd, { recursive: true });
  return { repo, cwd };
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearRuntimeEnv();
});

describe('runtime config bootstrap', () => {
  it('loads entity.config.yaml from an ancestor of the server cwd', () => {
    clearRuntimeEnv();
    const { cwd } = makeRepoFixture(`
version: 1
profile:
  displayName: Portable Workspace
server:
  port: 4455
  databasePath: ./data/portable.sqlite
agents:
  - id: assistant
    name: Assistant
`);

    const config = loadRuntimeFileConfig(cwd);

    expect(config.profile.displayName).toBe('Portable Workspace');
    expect(config.server.port).toBe(4455);
    expect(config.server.databasePath).toBe('./data/portable.sqlite');
    expect(config.agents.map((agent) => agent.id)).toEqual(['assistant']);
  });

  it('normalizes legacy agent config entries without explicit ids', () => {
    clearRuntimeEnv();
    const { cwd } = makeRepoFixture(`
version: 1
agents:
  - name: assistant
    description: General purpose AI assistant
    model: local
    capabilities:
      - chat
      - code
`);

    const config = loadRuntimeFileConfig(cwd);

    expect(config.agents[0]).toMatchObject({
      id: 'assistant',
      name: 'assistant',
      role: 'General purpose AI assistant',
    });
  });

  it('exports bootstrap env from config without private defaults', () => {
    clearRuntimeEnv();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-runtime-home-'));
    vi.stubEnv('HOME', home);
    const { cwd, repo } = makeRepoFixture(`
version: 1
server:
  port: 4567
  workspaceRoot: "${'${HOME}'}/workspace"
  publicBaseUrl: http://localhost:4567
  apiBaseUrl: http://localhost:4567
  wsBaseUrl: ws://localhost:4567
  databasePath: ./data/runtime.sqlite
  logPath: ./logs/runtime.log
`);

    applyBootstrapRuntimeEnv(cwd);

    expect(process.env.ENTITY_CONFIG).toBe(path.join(repo, 'entity.config.yaml'));
    expect(process.env.ENTITY_TASK_DB_PATH).toBe(path.join(repo, 'data', 'runtime.sqlite'));
    expect(process.env.WORKSPACE).toBe(path.join(home, 'workspace'));
    expect(process.env.PORT).toBe('4567');
    expect(process.env.ENTITY_CLOUD_API_BASE).toBe('http://localhost:4567');
    expect(process.env.VITE_ENTITY_WS_URL).toBe('ws://localhost:4567');
    expect(process.env.ENTITY_SERVER_LOG_PATH).toBe(path.join(repo, 'logs', 'runtime.log'));
    expect(fs.existsSync(path.join(repo, 'data'))).toBe(true);
    expect(fs.existsSync(path.join(home, 'workspace'))).toBe(true);
  });

  it('does not set ENTITY_TASK_DB_PATH when no config file provides one, so the prod DB symlink wins', () => {
    // #given a deploy-like checkout with no entity.config.yaml and no DB env set
    clearRuntimeEnv();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-runtime-home-'));
    vi.stubEnv('HOME', home);
    const { cwd } = makeRepoFixtureNoConfig();

    // #when bootstrap runs on pure built-in defaults
    applyBootstrapRuntimeEnv(cwd);

    // #then the task DB path is left to the db package fallback (entity-tasks.db symlink),
    // not forced to a fresh ./data/entity.sqlite that would shadow the production DB
    expect(process.env.ENTITY_TASK_DB_PATH).toBeUndefined();
  });

  it('preserves an explicit ENTITY_TASK_DB_PATH env over default config', () => {
    // #given an explicit DB path in the environment and no config file
    clearRuntimeEnv();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-runtime-home-'));
    vi.stubEnv('HOME', home);
    const explicitDb = path.join(home, 'prod', 'prod.db');
    process.env.ENTITY_TASK_DB_PATH = explicitDb;
    const { cwd } = makeRepoFixtureNoConfig();

    // #when bootstrap runs
    applyBootstrapRuntimeEnv(cwd);

    // #then the explicit env path is kept
    expect(process.env.ENTITY_TASK_DB_PATH).toBe(explicitDb);
  });

  it('builds health endpoint and workspace maps from configured agents and file sources', () => {
    clearRuntimeEnv();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-runtime-home-'));
    vi.stubEnv('HOME', home);
    const { cwd } = makeRepoFixture(`
version: 1
server:
  workspaceRoot: "${'${HOME}'}/fallback-workspace"
agents:
  - id: assistant
    name: Assistant
    healthUrls:
      - http://localhost:7890/healthz
    gateway:
      type: http
      url: http://localhost:7890
  - id: builder
    name: Builder
    workspaceRoot: "${'${HOME}'}/builder-workspace"
    gateway:
      type: none
      url: null
  - id: disabled
    name: Disabled
    enabled: false
fileSources:
  - id: workspace
    displayName: Workspace
    type: local
    basePath: "${'${HOME}'}/assistant-workspace"
    agentBindings:
      - assistant
`);
    const config = loadRuntimeFileConfig(cwd);

    expect(buildConfiguredAgentHealthEndpoints(config)).toEqual({
      assistant: ['http://localhost:7890/healthz', 'http://localhost:7890/health'],
      builder: [],
    });
    expect(buildConfiguredAgentWorkspaces(config)).toEqual({
      assistant: path.join(home, 'assistant-workspace'),
      builder: path.join(home, 'builder-workspace'),
    });
  });

  it('maps top-level service catalog into entity-services plugin settings', () => {
    const settings = buildConfigPluginSettings({
      version: 1,
      services: [
        {
          id: 'docs',
          name: 'Docs',
          url: 'http://localhost:4310',
          healthUrl: 'http://localhost:4310/health',
          enabled: true,
        },
      ],
      plugins: {
        'entity-services': {
          settings: {
            externalAdminUrl: '',
            services: [
              {
                id: 'status',
                name: 'Status',
                url: 'http://localhost:4320',
                enabled: true,
              },
            ],
          },
        },
      },
    });

    expect(settings['entity-services']).toMatchObject({
      externalAdminUrl: '',
      services: [
        expect.objectContaining({ id: 'docs', url: 'http://localhost:4310' }),
        expect.objectContaining({ id: 'status', url: 'http://localhost:4320' }),
      ],
    });
  });
});
