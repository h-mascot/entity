import type { Router } from 'express';
import type { PluginRouteContext } from '../registry';
import { getEntityLinkerState } from './state';

export function registerPluginRoutes(router: Router, context: PluginRouteContext): void {
  router.get('/status', (_req, res) => {
    const currentPlugin = context.registry.get(context.plugin.id) ?? context.plugin;
    const state = getEntityLinkerState();

    return res.json({
      plugin: {
        id: currentPlugin.id,
        name: currentPlugin.name,
        enabled: currentPlugin.enabled,
        kind: currentPlugin.kind,
        settings: currentPlugin.settings,
      },
      observedHooks: state.byHook,
      recentEvents: state.recent,
      totalObserved: state.totalObserved,
      routesMounted: currentPlugin.status.routesMounted,
    });
  });
}

export default registerPluginRoutes;
