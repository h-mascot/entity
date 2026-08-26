import type { Express, RequestHandler } from 'express';
import type {
  AdminReportFilterInput,
  AdminReportRepository,
} from '../../../db/src/admin-reports';

interface RegisterAdminReportRoutesDeps {
  reportRepository: AdminReportRepository;
  authorizeAccess?: RequestHandler;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseAdminReportQuery(query: Record<string, unknown>): AdminReportFilterInput {
  const actor = readString(query.actor ?? query.userId ?? query.user_id ?? query.user);
  const filters: AdminReportFilterInput = {
    orgId: readString(query.orgId ?? query.org_id),
    teamId: readString(query.teamId ?? query.team_id),
    actor,
    source: readString(query.source),
    type: readString(query.type),
    taskId: readNumber(query.taskId ?? query.task_id),
    from: readString(query.from),
    to: readString(query.to),
    model: readString(query.model),
    status: readString(query.status) as AdminReportFilterInput['status'],
    limit: readNumber(query.limit),
    offset: readNumber(query.offset),
  };

  if (filters.taskId !== undefined && !Number.isInteger(filters.taskId)) {
    delete filters.taskId;
  }
  if (filters.status !== undefined && !['active', 'disabled', 'all'].includes(filters.status)) {
    delete filters.status;
  }
  return filters;
}

function registerReportGet(
  app: Express,
  path: string,
  handler: (filters: AdminReportFilterInput) => unknown,
  authorize?: RequestHandler,
): void {
  const middlewares = authorize ? [authorize] : [];
  app.get(path, ...middlewares, (req, res) => {
    try {
      res.json(handler(parseAdminReportQuery(req.query as Record<string, unknown>)));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'report unavailable';
      res.status(500).json({ error: message });
    }
  });
}

export function registerAdminReportRoutes(
  app: Express,
  prefix: '' | '/api' | '/api/admin',
  deps: RegisterAdminReportRoutesDeps,
): void {
  const { reportRepository, authorizeAccess } = deps;
  registerReportGet(
    app,
    `${prefix}/usage-report`,
    (filters) => reportRepository.getUsageReport(filters),
  );
  registerReportGet(
    app,
    `${prefix}/audit-report`,
    (filters) => reportRepository.getAuditReport(filters),
  );
  registerReportGet(
    app,
    `${prefix}/access-report`,
    (filters) => reportRepository.getAccessReport(filters),
    authorizeAccess,
  );

  // Resource-shaped aliases make the surface discoverable without removing the
  // short report names used by the existing Admin UI and integrations.
  registerReportGet(
    app,
    `${prefix}/reports/usage`,
    (filters) => reportRepository.getUsageReport(filters),
  );
  registerReportGet(
    app,
    `${prefix}/reports/audit`,
    (filters) => reportRepository.getAuditReport(filters),
  );
  registerReportGet(
    app,
    `${prefix}/reports/access`,
    (filters) => reportRepository.getAccessReport(filters),
    authorizeAccess,
  );
}
