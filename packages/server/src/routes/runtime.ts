import type { Express } from "express";

interface RegisterActivityRoutesDeps {
  activityRepository: any;
}

interface RegisterDbModeRoutesDeps {
  normalizeDbMode: (value: unknown) => unknown;
  taskSyncLayer: any;
}

interface RegisterFeatureRuntimeRoutesDeps {
  agentNativeEditorEnabled: boolean;
  fsMultiSourceEnabled: boolean;
}

export function registerActivityRoutes(app: Express, prefix: "" | "/api", deps: RegisterActivityRoutesDeps): void {
  const { activityRepository } = deps;
  const base = `${prefix}/activities`;

  app.get(base, (req, res) => {
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    try {
      const activities = activityRepository.listActivities(limit);
      res.json({ activities });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });
}

export function registerDbModeRoutes(app: Express, prefix: "" | "/api", deps: RegisterDbModeRoutesDeps): void {
  const { normalizeDbMode, taskSyncLayer } = deps;
  const base = `${prefix}/db-mode`;

  app.get(base, (_req, res) => {
    res.json({
      mode: taskSyncLayer.getMode(),
      cloudConfigured: taskSyncLayer.hasCloudAdapter(),
    });
  });

  app.post(base, (req, res) => {
    const mode = normalizeDbMode(req.body?.mode ?? null);
    if (!mode && req.body?.mode !== null) {
      return res
        .status(400)
        .json({ error: "mode must be LOCAL, CLOUD, or null" });
    }

    taskSyncLayer.setMode(mode);
    return res.json({
      mode: taskSyncLayer.getMode(),
      cloudConfigured: taskSyncLayer.hasCloudAdapter(),
    });
  });
}

export function registerRuntimeRoutes(app: Express, prefix: "" | "/api", deps: RegisterFeatureRuntimeRoutesDeps): void {
  const { agentNativeEditorEnabled: AGENT_NATIVE_EDITOR_ENABLED, fsMultiSourceEnabled: FS_MULTISOURCE_ENABLED } = deps;
  const base = `${prefix}/runtime`;

  app.get(base, (_req, res) => {
    res.json({
      features: {
        fsMultiSourceEnabled: FS_MULTISOURCE_ENABLED,
        agentNativeEditorEnabled: AGENT_NATIVE_EDITOR_ENABLED,
      },
    });
  });
}


