import type { PluginApiRecord, PluginSettingsRecord } from './types';

interface PluginRegistryLike {
  getPublic: (id: string) => PluginApiRecord | undefined;
  listPublic: () => PluginApiRecord[];
  setEnabled: (id: string, enabled: boolean) => PluginApiRecord;
  updateSettings: (id: string, patch: PluginSettingsRecord) => PluginApiRecord;
}

interface PluginManagementRouteApp {
  get: (path: string, handler: (req: any, res: any) => unknown) => unknown;
  patch: (path: string, handler: (req: any, res: any) => unknown) => unknown;
  post: (path: string, handler: (req: any, res: any) => unknown) => unknown;
}

export interface PluginManagementRouteDependencies {
  app: PluginManagementRouteApp;
  registry: PluginRegistryLike;
  basePath?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toSettingsRecord(value: Record<string, unknown>): PluginSettingsRecord {
  return JSON.parse(JSON.stringify(value)) as PluginSettingsRecord;
}

export function registerPluginManagementRoutes({
  app,
  registry,
  basePath = '/api/plugins',
}: PluginManagementRouteDependencies): void {
  app.get(basePath, (_req, res) => {
    return res.json({ plugins: registry.listPublic() });
  });

  app.get(`${basePath}/:id`, (req, res) => {
    const plugin = registry.getPublic(req.params.id);
    if (!plugin) {
      return res.status(404).json({ error: 'plugin not found' });
    }

    return res.json(plugin);
  });

  app.patch(`${basePath}/:id/toggle`, (req, res) => {
    const existing = registry.getPublic(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'plugin not found' });
    }

    const explicitEnabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;
    const updated = registry.setEnabled(req.params.id, explicitEnabled ?? !existing.enabled);
    return res.json(updated);
  });

  app.patch(`${basePath}/:id/settings`, (req, res) => {
    const existing = registry.getPublic(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'plugin not found' });
    }

    const hasExplicitSettingsField = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'settings');
    const payload = hasExplicitSettingsField
      ? (isPlainObject(req.body?.settings) ? req.body.settings : null)
      : isPlainObject(req.body)
        ? req.body
        : null;

    if (!payload) {
      return res.status(400).json({ error: 'settings payload must be an object' });
    }

    const updated = registry.updateSettings(req.params.id, toSettingsRecord(payload));
    return res.json(updated);
  });

  // PATCH /api/plugins/:id/restart - Restart a plugin
  app.patch(`${basePath}/:id/restart`, async (req, res) => {
    const plugin = registry.getPublic(req.params.id);
    if (!plugin) {
      return res.status(404).json({ error: 'plugin not found' });
    }

    // For now, restart is a no-op that just confirms the plugin is still there
    // In a full implementation, this would unload and reload the plugin
    try {
      // Check if plugin is still valid/loaded
      const current = registry.getPublic(req.params.id);
      if (!current) {
        return res.status(404).json({ error: 'plugin not found after restart check' });
      }
      return res.json({ ok: true, plugin: current });
    } catch (error) {
      return res.status(500).json({ error: 'restart failed' });
    }
  });

  // POST /api/plugins/install - Install from GitHub URL
  app.post(`${basePath}/install`, async (req, res) => {
    const { url } = req.body ?? {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required and must be a string' });
    }

    // Basic GitHub URL validation
    const githubUrlPattern = /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\.git)?$/;
    if (!githubUrlPattern.test(url.trim())) {
      return res.status(400).json({ error: 'url must be a valid GitHub repository URL' });
    }

    // TODO: Implement actual git clone/pull logic
    // For now, return success and let the UI refresh to show the new plugin
    return res.status(501).json({
      error: 'Install from GitHub not yet implemented',
      hint: 'Clone the repository manually and place the plugin in the plugins directory',
    });
  });
}
