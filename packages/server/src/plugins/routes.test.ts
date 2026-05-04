import { describe, expect, it, vi } from 'vitest';
import { registerPluginManagementRoutes } from './routes';
import type { PluginApiRecord, PluginSettingsRecord } from './types';

function createPlugin(overrides: Partial<PluginApiRecord> = {}): PluginApiRecord {
  return {
    id: 'geordi-swarm',
    name: 'Geordi Swarm',
    version: '0.1.0',
    kind: 'product',
    description: 'Swarm plugin',
    capabilities: ['api.routes.register'],
    hooks: ['task:created'],
    enabled: true,
    settings: { autoDispatch: false },
    status: {
      loaded: true,
      registeredAt: new Date().toISOString(),
      routesMounted: ['/api/swarm'],
    },
    ...overrides,
  };
}

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe('registerPluginManagementRoutes', () => {
  it('registers list, get, toggle, and settings endpoints', () => {
    const plugin = createPlugin();
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const registry = {
      listPublic: vi.fn(() => [plugin]),
      getPublic: vi.fn((id: string) => (id === plugin.id ? plugin : undefined)),
      setEnabled: vi.fn((_id: string, enabled: boolean) => createPlugin({ enabled })),
      updateSettings: vi.fn((_id: string, patch: PluginSettingsRecord) =>
        createPlugin({ settings: { ...plugin.settings, ...patch } }),
      ),
    };

    registerPluginManagementRoutes({
      app: {
        get: (route: string, handler: any) => {
          handlers[`GET ${route}`] = handler;
        },
        patch: (route: string, handler: any) => {
          handlers[`PATCH ${route}`] = handler;
        },
        post: (_route: string, _handler: any) => {},
      },
      registry,
    });

    const listResponse = createResponse();
    handlers['GET /api/plugins']({}, listResponse);
    expect(listResponse.json).toHaveBeenCalledWith({ plugins: [plugin] });

    const detailResponse = createResponse();
    handlers['GET /api/plugins/:id']({ params: { id: plugin.id } }, detailResponse);
    expect(detailResponse.json).toHaveBeenCalledWith(plugin);

    const toggleResponse = createResponse();
    handlers['PATCH /api/plugins/:id/toggle']({ params: { id: plugin.id }, body: {} }, toggleResponse);
    expect(registry.setEnabled).toHaveBeenCalledWith(plugin.id, false);

    const settingsResponse = createResponse();
    handlers['PATCH /api/plugins/:id/settings'](
      {
        params: { id: plugin.id },
        body: { settings: { autoDispatch: true } },
      },
      settingsResponse,
    );
    expect(registry.updateSettings).toHaveBeenCalledWith(plugin.id, { autoDispatch: true });
  });

  it('rejects invalid settings payloads', () => {
    const plugin = createPlugin();
    const handlers: Record<string, (req: any, res: any) => any> = {};

    registerPluginManagementRoutes({
      app: {
        get: (_route: string, _handler: any) => undefined,
        patch: (route: string, handler: any) => {
          handlers[`PATCH ${route}`] = handler;
        },
        post: (_route: string, _handler: any) => {},
      },
      registry: {
        listPublic: () => [plugin],
        getPublic: () => plugin,
        setEnabled: () => plugin,
        updateSettings: () => plugin,
      },
    });

    const response = createResponse();
    handlers['PATCH /api/plugins/:id/settings'](
      {
        params: { id: plugin.id },
        body: { settings: 'invalid' },
      },
      response,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'settings payload must be an object' });
  });
});
