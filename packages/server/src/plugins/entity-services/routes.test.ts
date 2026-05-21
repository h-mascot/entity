import { describe, expect, it, vi } from 'vitest';
import type { LoadedPlugin } from '../types';
import { buildServicesRegistry, registerPluginRoutes } from './routes';

function createLoadedPlugin(overrides: Partial<LoadedPlugin> = {}): LoadedPlugin {
  return {
    id: 'entity-services',
    name: 'Entity Services',
    version: '0.1.0',
    kind: 'integration',
    description: 'Services registry',
    capabilities: ['api.routes.register'],
    hooks: [],
    settings: {
      requestTimeoutMs: 1000,
      entityBaseUrl: 'http://entity.local',
      externalAdminUrl: '',
      externalAdminName: 'External Admin',
      services: [],
      discoverGatewayServices: false,
      discoverMacServices: false,
    },
    manifestPath: '/tmp/entity-services/plugin.json',
    directory: '/tmp/entity-services',
    enabled: true,
    routes: [{ basePath: '/api/entity-services', entry: './routes.ts' }],
    status: {
      loaded: true,
      registeredAt: new Date().toISOString(),
      routesMounted: ['/api/entity-services'],
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

describe('entity-services routes', () => {
  it('builds a registry payload with live service summaries', async () => {
    const entityServices = createLoadedPlugin({
      settings: {
        ...createLoadedPlugin().settings,
        services: [
          {
            id: 'ops-docs',
            name: 'Ops Docs',
            url: 'http://docs.local',
            healthUrl: 'http://docs.local/health',
            category: 'Knowledge',
            tags: ['docs'],
          },
        ],
      },
    });
    const entityLinker = createLoadedPlugin({
      id: 'entity-linker',
      name: 'Entity Linker',
      kind: 'behavior',
      enabled: true,
      routes: [{ basePath: '/api/entity-linker', entry: './routes.ts' }],
      status: {
        loaded: true,
        registeredAt: new Date().toISOString(),
        routesMounted: ['/api/entity-linker'],
      },
    });

    const registry = {
      get: (id: string) => {
        if (id === entityServices.id) return entityServices;
        if (id === entityLinker.id) return entityLinker;
        return undefined;
      },
    };

    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'http://docs.local/health') {
        return new Response('ok', { status: 200 });
      }

      return new Response('ok', { status: 200 });
    });

    const payload = await buildServicesRegistry(
      {
        plugin: entityServices,
        registry,
      } as any,
      fetchImpl as any,
    );

    expect(payload.services).toHaveLength(2);
    expect(payload.summary.operational).toBe(2);

    const linker = payload.services.find((service) => service.id === 'entity-linker');
    expect(linker).toMatchObject({
      status: 'operational',
      link: { url: 'http://entity.local/api/entity-linker/status', external: true },
    });

    const docs = payload.services.find((service) => service.id === 'ops-docs');
    expect(docs).toMatchObject({
      serviceType: 'external-http',
      status: 'operational',
      visibility: 'managed',
      relevanceReason: 'Configured service definition',
      family: { key: 'ops-docs', name: 'Ops Docs', memberCount: 1 },
      link: { url: 'http://docs.local', external: true },
    });

    expect(linker).toMatchObject({
      visibility: 'managed',
      relevanceReason: 'Entity-managed plugin',
      family: { key: 'entity-linker', name: 'Entity Linker', memberCount: 1 },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://docs.local/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reports disabled or unreachable services as offline', async () => {
    const entityServices = createLoadedPlugin({
      settings: {
        ...createLoadedPlugin().settings,
        services: [
          {
            id: 'ops-docs',
            name: 'Ops Docs',
            url: 'http://docs.local',
            healthUrl: 'http://docs.local/health',
          },
        ],
      },
    });
    const entityLinker = createLoadedPlugin({
      id: 'entity-linker',
      name: 'Entity Linker',
      enabled: false,
      status: {
        loaded: true,
        registeredAt: new Date().toISOString(),
        routesMounted: [],
      },
    });

    const payload = await buildServicesRegistry(
      {
        plugin: entityServices,
        registry: {
          get: (id: string) => {
            if (id === entityServices.id) return entityServices;
            if (id === entityLinker.id) return entityLinker;
            return undefined;
          },
        },
      } as any,
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      }) as any,
    );

    expect(payload.summary.offline).toBe(2);
    expect(payload.services.every((service) => service.status === 'offline')).toBe(true);
  });

  it('prefers the live request host over stale tailnet service URLs', async () => {
    const entityServices = createLoadedPlugin({
      settings: {
        ...createLoadedPlugin().settings,
        entityBaseUrl: 'http://100.106.69.9:3000',
        externalAdminUrl: '',
        services: [],
        discoverGatewayServices: false,
        discoverMacServices: false,
      },
    });
    const entityLinker = createLoadedPlugin({
      id: 'entity-linker',
      name: 'Entity Linker',
      enabled: true,
    });

    const payload = await buildServicesRegistry(
      {
        plugin: entityServices,
        registry: {
          get: (id: string) => {
            if (id === entityServices.id) return entityServices;
            if (id === entityLinker.id) return entityLinker;
            return undefined;
          },
        },
      } as any,
      vi.fn(async () => new Response('ok', { status: 200 })) as any,
      'http://100.104.229.62:3000',
    );

    const linker = payload.services.find((service) => service.id === 'entity-linker');

    expect(linker?.link.url).toBe('http://100.104.229.62:3000/api/entity-linker/status');
    expect(payload.services.some((service) => service.id.includes('enterprise'))).toBe(false);
  });

  it('registers registry endpoints', async () => {
    const entityServices = createLoadedPlugin();
    const handlers: Record<string, (req: any, res: any) => Promise<any>> = {};

    registerPluginRoutes(
      {
        get: (route: string, handler: any) => {
          handlers[`GET ${route}`] = handler;
        },
      } as any,
      {
        plugin: entityServices,
        registry: {
          get: (id: string) => (id === entityServices.id ? entityServices : undefined),
        },
      } as any,
    );

    const response = createResponse();
    await handlers['GET /registry']({}, response);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin: expect.objectContaining({ id: 'entity-services' }),
        services: expect.any(Array),
      }),
    );
  });
});
