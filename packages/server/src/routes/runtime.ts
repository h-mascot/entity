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
  devDocumentsToken?: string | null;
  shouldExposeDevDocumentsToken?: () => boolean;
}

const ACTIVITY_FILTER_KEYS = [
  "orgId",
  "teamId",
  "actor",
  "source",
  "type",
  "taskId",
  "from",
  "to",
] as const;

function parseActivityFilterQuery(query: Record<string, unknown>): {
  filters: Record<string, string | number>;
  hasFilters: boolean;
  limit: number;
  offset: number;
} {
  const filters: Record<string, string | number> = {};
  let hasFilters = false;

  for (const key of ACTIVITY_FILTER_KEYS) {
    const raw = query[key];
    if (typeof raw !== "string" || raw.trim() === "") {
      continue;
    }
    if (key === "taskId") {
      const taskId = Number(raw);
      if (Number.isInteger(taskId)) {
        filters.taskId = taskId;
        hasFilters = true;
      }
      continue;
    }
    filters[key] = raw.trim();
    hasFilters = true;
  }

  const actorAlias = query.userId ?? query.user_id ?? query.user;
  if (!filters.actor && typeof actorAlias === "string" && actorAlias.trim()) {
    filters.actor = actorAlias.trim();
    hasFilters = true;
  }

  const limitRaw = Number(query.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
  const offsetRaw = Number(query.offset ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;
  const hasPagination = typeof query.offset !== "undefined";

  return { filters, hasFilters: hasFilters || hasPagination, limit, offset };
}

export function registerActivityRoutes(app: Express, prefix: "" | "/api", deps: RegisterActivityRoutesDeps): void {
  const { activityRepository } = deps;
  const base = `${prefix}/activities`;
  const reportBase = `${prefix}/activity-report`;

  app.get(base, (req, res) => {
    const { filters, hasFilters, limit, offset } = parseActivityFilterQuery(
      req.query as Record<string, unknown>
    );

    try {
      if (hasFilters) {
        const result = activityRepository.listActivitiesFiltered({ ...filters, limit, offset });
        res.json({ activities: result.activities, total: result.total });
        return;
      }
      const activities = activityRepository.listActivities(limit);
      res.json({ activities });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.get(reportBase, (req, res) => {
    const { filters, limit, offset } = parseActivityFilterQuery(
      req.query as Record<string, unknown>
    );

    try {
      const report = activityRepository.getActivityReport({ ...filters, limit, offset });
      res.json(report);
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
  const {
    agentNativeEditorEnabled: AGENT_NATIVE_EDITOR_ENABLED,
    fsMultiSourceEnabled: FS_MULTISOURCE_ENABLED,
    devDocumentsToken,
    shouldExposeDevDocumentsToken = () => Boolean(devDocumentsToken),
  } = deps;
  const base = `${prefix}/runtime`;

  app.get(base, (_req, res) => {
    const gatedDevDocumentsToken = devDocumentsToken && shouldExposeDevDocumentsToken()
      ? devDocumentsToken
      : null;
    res.json({
      features: {
        fsMultiSourceEnabled: FS_MULTISOURCE_ENABLED,
        agentNativeEditorEnabled: AGENT_NATIVE_EDITOR_ENABLED,
      },
      ...(gatedDevDocumentsToken ? { devDocumentsToken: gatedDevDocumentsToken } : {}),
    });
  });
}


