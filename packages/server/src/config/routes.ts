import type express from 'express';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { buildEffectiveConfig, deepMerge } from './effective';
import { EntityConfigSchema } from './schema';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from './settings-store';

export function registerConfigRoutes(app: express.Express): void {
  app.get('/api/config/effective', (_req, res) => {
    try {
      const db = getEntityDatabase(ensureAppSettingsTable);
      res.json(buildEffectiveConfig({ db, cwd: process.cwd() }));
    } catch (error) {
      res.status(500).json({
        error: 'Failed to build effective config',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.patch('/api/settings/config/runtime', (req, res) => {
    try {
      const patch = EntityConfigSchema.partial().parse(req.body ?? {});
      const db = getEntityDatabase(ensureAppSettingsTable);
      const current = (getSettingJson(db, 'config.runtime') ?? {}) as Record<string, unknown>;
      const next = deepMerge(current, patch) as Record<string, unknown>;
      setSettingJson(db, 'config.runtime', next, 'admin-ui');
      res.json(buildEffectiveConfig({ db, cwd: process.cwd() }));
    } catch (error) {
      res.status(400).json({
        error: 'Invalid runtime config patch',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
