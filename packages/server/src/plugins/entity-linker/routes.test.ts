import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginRouteContext } from '../registry';
import type { LoadedPlugin } from '../types';
import { registerPluginRoutes } from './routes';
import { recordEntityLinkerObservation, resetEntityLinkerState } from './state';

function createPlugin(): LoadedPlugin {
  return {
    id: 'entity-linker',
    name: 'Entity Linker',
    version: '0.1.0',
    kind: 'behavior',
    description: 'Linker plugin',
    capabilities: ['api.routes.register', 'tasks.events.observe'],
    hooks: ['task:created', 'task:updated'],
    enabled: true,
    settings: {
      entityBaseUrl: 'http://100.106.69.9:3000',
      rewriteAbsolutePaths: true,
      maxRecentEvents: 25,
    },
    directory: '/tmp/entity-linker',
    manifestPath: '/tmp/entity-linker/plugin.json',
    routes: [{ basePath: '/api/entity-linker', entry: './routes.ts' }],
    status: {
      loaded: true,
      registeredAt: new Date().toISOString(),
      routesMounted: ['/api/entity-linker'],
    },
  };
}

function createResponse() {
  return {
    json: vi.fn().mockReturnThis(),
  };
}

describe('entity-linker plugin routes', () => {
  beforeEach(() => {
    resetEntityLinkerState();
  });

  it('returns plugin status with observed task activity', () => {
    const plugin = createPlugin();
    const handlers: Record<string, (req: any, res: any) => any> = {};

    recordEntityLinkerObservation({ hook: 'task:created', payload: { taskId: 42 }, maxRecentEvents: 25 });
    recordEntityLinkerObservation({ hook: 'task:updated', payload: { task: { id: 99 } }, maxRecentEvents: 25 });

    registerPluginRoutes(
      {
        get: (route: string, handler: any) => {
          handlers[`GET ${route}`] = handler;
        },
      } as any,
      {
        app: {} as any,
        db: {} as any,
        hooks: {} as any,
        logger: console,
        plugin,
        registry: {
          get: (id: string) => (id === plugin.id ? plugin : undefined),
        } as any,
        router: {} as any,
        workspaceRoot: '/tmp',
      } as PluginRouteContext,
    );

    const response = createResponse();
    handlers['GET /status']({}, response);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin: expect.objectContaining({ id: 'entity-linker', enabled: true }),
        observedHooks: {
          'task:created': 1,
          'task:updated': 1,
        },
        totalObserved: 2,
      }),
    );
  });
});
