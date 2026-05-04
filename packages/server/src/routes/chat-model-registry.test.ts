import { describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { ChatModelRegistry, normalizeChatModel, type ChatModelOption } from './chat-model-registry';

const localInventory: ChatModelOption[] = [
  {
    id: 'ollama/qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B',
    provider: 'ollama',
    isLocal: true,
    local: true,
    available: true,
    source: 'discovered',
  },
];

describe('chat model registry', () => {
  it('normalizes model IDs and marks local providers as local', () => {
    expect(normalizeChatModel('ollama/qwen2.5-coder:7b', 'test')).toMatchObject({
      id: 'ollama/qwen2.5-coder:7b',
      provider: 'ollama',
      isLocal: true,
      allowed: true,
    });
    expect(normalizeChatModel({ id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet' }, 'test')).toMatchObject({
      id: 'anthropic/claude-sonnet-4-6',
      provider: 'anthropic',
      isLocal: false,
      available: true,
    });
  });

  it('returns models scoped to the selected agent and keeps local inventory as metadata', async () => {
    const registry = new ChatModelRegistry({
      env: {
        ENTITY_CHAT_AGENT_MODELS_JSON: JSON.stringify({
          ada: {
            defaultModel: 'anthropic/claude-sonnet-4-6',
            models: ['anthropic/claude-sonnet-4-6', 'ollama/qwen2.5-coder:7b'],
          },
          book: {
            defaultModel: 'openrouter/anthropic/claude-sonnet-4',
            models: ['openrouter/anthropic/claude-sonnet-4'],
          },
        }),
      },
      localInventory: async () => localInventory,
      now: () => new Date('2026-05-01T15:00:00.000Z'),
    });

    const ada = await registry.buildResponse(['ada']);
    expect(ada.agent).toBe('ada');
    expect(ada.defaultModel).toBe('anthropic/claude-sonnet-4-6');
    expect(ada.models?.map((model) => model.id)).toEqual(['anthropic/claude-sonnet-4-6', 'ollama/qwen2.5-coder:7b']);
    expect(ada.local.map((model) => model.id)).toEqual(['ollama/qwen2.5-coder:7b']);
    expect(ada.localInventory.map((model) => model.id)).toEqual(['ollama/qwen2.5-coder:7b']);

    const book = await registry.buildResponse(['book']);
    expect(book.models?.map((model) => model.id)).toEqual(['openrouter/anthropic/claude-sonnet-4']);
    expect(book.local.map((model) => model.id)).toEqual([]);
  });

  it('loads OpenClaw models through the gateway env and auth token before using fallback models', async () => {
    const seen: Array<{ url: string; auth?: string }> = [];
    const dir = await mkdtemp(path.join(tmpdir(), 'openclaw-empty-home-'));
    const registry = new ChatModelRegistry({
      env: {
        OPENCLAW_HOME: dir,
        OPENCLAW_CLI: '/no/such/openclaw',
        OPENCLAW: 'http://openclaw.test',
        OPENCLAW_GATEWAY_TOKEN: 'test-token',
      },
      localInventory: async () => [],
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        const endpoint = url.toString();
        seen.push({ url: endpoint, auth: init?.headers ? (init.headers as Record<string, string>).Authorization : undefined });
        if (endpoint === 'http://openclaw.test/v1/models?agent=ada') {
          return new Response(JSON.stringify({
            object: 'list',
            data: [
              { id: 'openclaw/default', object: 'model' },
              { id: 'openclaw/main', object: 'model' },
            ],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch,
      now: () => new Date('2026-05-01T15:00:00.000Z'),
    });

    const ada = await registry.buildResponse(['ada']);
    expect(ada.source).toBe('openclaw');
    expect(ada.models?.map((model) => model.id)).toEqual(['openclaw/default', 'openclaw/main']);
    expect(seen.some((entry) => entry.url === 'http://openclaw.test/v1/models?agent=ada')).toBe(true);
    expect(new Set(seen.map((entry) => entry.auth))).toEqual(new Set(['Bearer test-token']));
  });

  it('loads OpenClaw configured provider models directly from config files without CLI startup', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'openclaw-config-test-'));
    const agentDir = path.join(dir, 'agents', 'ada', 'agent');
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(dir, 'openclaw.json'), JSON.stringify({
      agents: { defaults: { model: { primary: 'zai/glm-5.1' } } },
      models: {
        providers: {
          zai: { models: [{ id: 'glm-5.1', name: 'GLM 5.1' }] },
          moonshot: { models: [{ id: 'kimi-k2.6', name: 'Kimi K2.6' }] },
          'enterprise-local': { models: [{ id: 'mlx-community/Qwen3.6-35B-A3B-4bit', name: 'Qwen 3.6' }] },
        },
      },
    }));
    await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        anthropic: { models: [{ id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }] },
      },
    }));
    const runtimeDir = path.join(dir, 'plugin-runtime-deps', 'openclaw-test', 'node_modules', '@mariozechner', 'pi-ai', 'dist');
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(path.join(agentDir, 'auth-profiles.json'), JSON.stringify({
      current: { google: 'google:api-key' },
      profiles: { 'google:api-key': { provider: 'google' } },
    }));
    await writeFile(path.join(runtimeDir, 'models.generated.js'), `export const MODELS = {
      google: {
        'gemini-3.1-pro': { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', provider: 'google' }
      }
    };`);

    const registry = new ChatModelRegistry({
      env: { OPENCLAW_HOME: dir },
      openClawCommand: '/no/such/openclaw',
      localInventory: async () => [],
      now: () => new Date('2026-05-01T15:00:00.000Z'),
    });

    const ada = await registry.buildResponse(['ada']);
    expect(ada.source).toBe('openclaw-config');
    expect(ada.defaultModel).toBe('zai/glm-5.1');
    expect(ada.models?.map((model) => model.id)).toEqual([
      'anthropic/claude-opus-4-5',
      'zai/glm-5.1',
      'moonshot/kimi-k2.6',
      'enterprise-local/mlx-community/Qwen3.6-35B-A3B-4bit',
      'google/gemini-3.1-pro',
    ]);
    expect(ada.models?.find((model) => model.id === 'moonshot/kimi-k2.6')?.isLocal).toBe(false);
    expect(ada.models?.find((model) => model.id === 'google/gemini-3.1-pro')?.source).toBe('openclaw-config');
  });

  it('loads Ada models from the OpenClaw models CLI as the primary OpenClaw source', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'openclaw-models-test-'));
    const command = path.join(dir, 'openclaw-fixture.js');
    await writeFile(command, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.join(' ') === 'models --agent ada list --json') {
  console.log(JSON.stringify({ models: [
    { key: 'zai/glm-5.1', name: 'GLM 5.1', local: false, available: false, tags: ['default'] },
    { key: 'enterprise-local/mlx-community/Qwen3.6-35B-A3B-4bit', name: 'Qwen 3.6 35B A3B 4bit (Enterprise MLX)', local: true, available: true, tags: ['configured'] }
  ] }));
  process.exit(0);
}
if (args.join(' ') === 'models --agent ada status --json') {
  console.log(JSON.stringify({ resolvedDefault: 'zai/glm-5.1' }));
  process.exit(0);
}
process.exit(1);
`);
    await chmod(command, 0o755);

    const registry = new ChatModelRegistry({
      env: { OPENCLAW_HOME: dir },
      openClawCommand: command,
      localInventory: async () => [],
      now: () => new Date('2026-05-01T15:00:00.000Z'),
    });

    const ada = await registry.buildResponse(['ada']);
    expect(ada.source).toBe('openclaw-cli');
    expect(ada.defaultModel).toBe('zai/glm-5.1');
    expect(ada.models?.map((model) => model.id)).toEqual([
      'zai/glm-5.1',
      'enterprise-local/mlx-community/Qwen3.6-35B-A3B-4bit',
    ]);
    expect(ada.models?.find((model) => model.id === 'enterprise-local/mlx-community/Qwen3.6-35B-A3B-4bit')?.available).toBe(true);
  });

  it('returns per-agent policy for all-agents requests instead of a merged global dropdown list', async () => {
    const registry = new ChatModelRegistry({
      env: {
        ENTITY_CHAT_AGENT_MODELS_JSON: JSON.stringify({
          ada: { models: ['anthropic/claude-sonnet-4-6'] },
          book: { models: ['openrouter/anthropic/claude-sonnet-4'] },
        }),
      },
      localInventory: async () => [],
      now: () => new Date('2026-05-01T15:00:00.000Z'),
    });

    const response = await registry.buildResponse(['ada', 'book']);
    expect(response.models).toBeUndefined();
    expect(Object.keys(response.agents ?? {})).toEqual(['ada', 'book']);
    expect(response.cloud).toEqual([]);
  });

  it('loads Book models from Hermes provider config', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hermes-config-test-'));
    const configPath = path.join(dir, 'config.yaml');
    await writeFile(configPath, `model:
  provider: minimax
  default: MiniMax-M2.7
providers:
  minimax:
    base_url: https://api.minimax.io/anthropic
    models:
    - MiniMax-M2.7
    - MiniMax-M2.5
  openrouter:
    base_url: https://openrouter.ai/api/v1
    models:
    - anthropic/claude-sonnet-4
  ollama:
    base_url: http://100.104.229.62:11434/v1
    models:
    - qwen2.5-coder:7b
`);

    const registry = new ChatModelRegistry({
      env: { HERMES_CONFIG_PATH: configPath },
      localInventory: async () => [],
      now: () => new Date('2026-05-01T15:00:00.000Z'),
    });

    const book = await registry.buildResponse(['book']);
    expect(book.source).toBe('hermes-config');
    expect(book.defaultModel).toBe('minimax/MiniMax-M2.7');
    expect(book.models?.map((model) => model.id)).toEqual([
      'minimax/MiniMax-M2.7',
      'minimax/MiniMax-M2.5',
      'openrouter/anthropic/claude-sonnet-4',
      'ollama/qwen2.5-coder:7b',
    ]);
    expect(book.models?.find((model) => model.id === 'ollama/qwen2.5-coder:7b')?.isLocal).toBe(true);
  });

  it('enforces agent model policy server-side', async () => {
    const registry = new ChatModelRegistry({
      env: {
        ENTITY_CHAT_AGENT_MODELS_JSON: JSON.stringify({
          ada: { models: ['anthropic/claude-sonnet-4-6'] },
          book: { models: ['openrouter/anthropic/claude-sonnet-4'] },
        }),
      },
      localInventory: async () => [],
    });

    await expect(registry.resolveModelForAgent('ada', 'anthropic/claude-sonnet-4-6')).resolves.toMatchObject({ ok: true });
    await expect(registry.resolveModelForAgent('ada', 'openrouter/anthropic/claude-sonnet-4')).resolves.toMatchObject({
      ok: false,
      message: 'ada cannot use model openrouter/anthropic/claude-sonnet-4.',
    });
  });

  it('rejects allowed local models when they are not available on this runtime', async () => {
    const registry = new ChatModelRegistry({
      env: {
        ENTITY_CHAT_AGENT_MODELS_JSON: JSON.stringify({
          ada: { models: ['ollama/qwen2.5-coder:7b'] },
        }),
      },
      localInventory: async () => [],
    });

    await expect(registry.resolveModelForAgent('ada', 'ollama/qwen2.5-coder:7b')).resolves.toMatchObject({
      ok: false,
      message: 'ada can use ollama/qwen2.5-coder:7b, but that local model is not available on this runtime.',
    });
  });
});
