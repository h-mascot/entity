import { Router, type Request, type Response } from 'express';
import {
  createPrincipalRepository,
  GRANT_ROLES,
  PRINCIPAL_TYPES,
  type CreatePrincipalGrantInput,
  type CreatePrincipalInput,
  type PrincipalRepository,
  type UpdatePrincipalGrantInput,
  type UpdatePrincipalInput,
} from '../../../db/src/principals';
import { parseGrantSensitivityCategories } from '../../../db/src/principals';
import { createRequireAdminPrincipal } from '../middleware/admin-auth';
import { resolveTrustedAdminPrincipalId } from '../principals/admin-identity';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readActor(req: Request, repo: PrincipalRepository): string {
  return resolveTrustedAdminPrincipalId(req, repo) || 'admin-local';
}

function serializePrincipal(repo: PrincipalRepository, id: string) {
  const principal = repo.getPrincipal(id);
  if (!principal) return null;
  const grants = repo.listGrantsForPrincipal(id).map((grant) => ({
    ...grant,
    sensitivity_categories: parseGrantSensitivityCategories(grant),
  }));
  return { ...principal, grants };
}

function parseCreatePrincipal(body: unknown): CreatePrincipalInput {
  if (!isRecord(body)) throw new Error('body must be an object');
  const principalType = readString(body.principal_type);
  const displayName = readString(body.display_name);
  if (!displayName) throw new Error('display_name is required');
  if (principalType && !PRINCIPAL_TYPES.includes(principalType as CreatePrincipalInput['principal_type'])) {
    throw new Error('invalid principal_type');
  }
  return {
    id: readString(body.id),
    principal_type: (principalType as CreatePrincipalInput['principal_type']) ?? 'human',
    display_name: displayName,
    handle: readString(body.handle) ?? null,
    email: readString(body.email) ?? null,
    metadata_json: typeof body.metadata_json === 'string' ? body.metadata_json : JSON.stringify(body.metadata_json ?? {}),
  };
}

function parseUpdatePrincipal(body: unknown): UpdatePrincipalInput {
  if (!isRecord(body)) throw new Error('body must be an object');
  const patch: UpdatePrincipalInput = {};
  if ('display_name' in body) {
    const displayName = readString(body.display_name);
    if (!displayName) throw new Error('display_name must be a non-empty string');
    patch.display_name = displayName;
  }
  if ('handle' in body) patch.handle = readString(body.handle) ?? null;
  if ('email' in body) patch.email = readString(body.email) ?? null;
  if ('metadata_json' in body) {
    patch.metadata_json = typeof body.metadata_json === 'string'
      ? body.metadata_json
      : JSON.stringify(body.metadata_json ?? {});
  }
  return patch;
}

function parseCreateGrant(body: unknown, principalId: string): CreatePrincipalGrantInput {
  if (!isRecord(body)) throw new Error('body must be an object');
  const role = readString(body.role);
  if (!role || !GRANT_ROLES.includes(role as CreatePrincipalGrantInput['role'])) {
    throw new Error('role is required');
  }
  const sensitivity = Array.isArray(body.sensitivity_categories)
    ? body.sensitivity_categories.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  const projectId = typeof body.project_id === 'number'
    ? body.project_id
    : typeof body.project_id === 'string' && body.project_id.trim()
      ? Number(body.project_id)
      : undefined;
  if (projectId !== undefined && (!Number.isInteger(projectId) || projectId < 1)) {
    throw new Error('project_id must be a positive integer');
  }
  return {
    principal_id: principalId,
    role: role as CreatePrincipalGrantInput['role'],
    org_id: readString(body.org_id) ?? null,
    team_id: readString(body.team_id) ?? null,
    project_id: projectId ?? null,
    sensitivity_categories: sensitivity,
  };
}

function parseUpdateGrant(body: unknown): UpdatePrincipalGrantInput {
  if (!isRecord(body)) throw new Error('body must be an object');
  const patch: UpdatePrincipalGrantInput = {};
  if ('role' in body) {
    const role = readString(body.role);
    if (!role || !(GRANT_ROLES as readonly string[]).includes(role)) {
      throw new Error('invalid role');
    }
    patch.role = role as UpdatePrincipalGrantInput['role'];
  }
  if ('org_id' in body) patch.org_id = readString(body.org_id) ?? null;
  if ('team_id' in body) patch.team_id = readString(body.team_id) ?? null;
  if ('project_id' in body) {
    const projectId = typeof body.project_id === 'number'
      ? body.project_id
      : typeof body.project_id === 'string' && body.project_id.trim()
        ? Number(body.project_id)
        : null;
    if (projectId !== null && (!Number.isInteger(projectId) || projectId < 1)) {
      throw new Error('project_id must be a positive integer');
    }
    patch.project_id = projectId;
  }
  if ('sensitivity_categories' in body) {
    if (!Array.isArray(body.sensitivity_categories)) throw new Error('sensitivity_categories must be an array');
    patch.sensitivity_categories = body.sensitivity_categories.filter((entry): entry is string => typeof entry === 'string');
  }
  return patch;
}

export function createPrincipalsRouter(deps: { repo?: PrincipalRepository; skipAdminAuth?: boolean } = {}): Router {
  const router = Router();
  const repo = deps.repo ?? createPrincipalRepository();

  if (!deps.skipAdminAuth) {
    router.use(createRequireAdminPrincipal(repo));
  }

  router.get('/principals', (_req, res) => {
    const principals = repo.listPrincipals({ includeDisabled: true }).map((principal) => ({
      ...principal,
      grants: repo.listGrantsForPrincipal(principal.id).map((grant) => ({
        ...grant,
        sensitivity_categories: parseGrantSensitivityCategories(grant),
      })),
    }));
    res.json({ principals });
  });

  router.post('/principals', (req, res) => {
    try {
      const input = parseCreatePrincipal(req.body);
      input.created_by = readActor(req, repo);
      const created = repo.createPrincipal(input);
      res.status(201).json(serializePrincipal(repo, created.id));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'invalid principal payload' });
    }
  });

  router.get('/principals/:id', (req, res) => {
    const principal = serializePrincipal(repo, req.params.id);
    if (!principal) {
      res.status(404).json({ error: 'principal not found' });
      return;
    }
    res.json(principal);
  });

  router.patch('/principals/:id', (req, res) => {
    try {
      const patch = parseUpdatePrincipal(req.body);
      patch.updated_by = readActor(req, repo);
      const updated = repo.updatePrincipal(req.params.id, patch);
      if (!updated) {
        res.status(404).json({ error: 'principal not found' });
        return;
      }
      res.json(serializePrincipal(repo, updated.id));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'invalid principal patch' });
    }
  });

  router.post('/principals/:id/disable', (req, res) => {
    const updated = repo.disablePrincipal(req.params.id, readActor(req, repo));
    if (!updated) {
      res.status(404).json({ error: 'principal not found' });
      return;
    }
    res.json(serializePrincipal(repo, updated.id));
  });

  router.post('/principals/:id/grants', (req, res) => {
    try {
      const principal = repo.getPrincipal(req.params.id);
      if (!principal) {
        res.status(404).json({ error: 'principal not found' });
        return;
      }
      const input = parseCreateGrant(req.body, principal.id);
      input.created_by = readActor(req, repo);
      const grant = repo.createGrant(input);
      res.status(201).json({
        ...grant,
        sensitivity_categories: parseGrantSensitivityCategories(grant),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'invalid grant payload' });
    }
  });

  router.patch('/principals/:principalId/grants/:grantId', (req, res) => {
    try {
      const grant = repo.getGrant(req.params.grantId);
      if (!grant || grant.principal_id !== req.params.principalId) {
        res.status(404).json({ error: 'grant not found' });
        return;
      }
      const patch = parseUpdateGrant(req.body);
      patch.updated_by = readActor(req, repo);
      const updated = repo.updateGrant(grant.id, patch);
      res.json({
        ...updated,
        sensitivity_categories: parseGrantSensitivityCategories(updated!),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'invalid grant patch' });
    }
  });

  router.delete('/principals/:principalId/grants/:grantId', (req, res) => {
    const grant = repo.getGrant(req.params.grantId);
    if (!grant || grant.principal_id !== req.params.principalId) {
      res.status(404).json({ error: 'grant not found' });
      return;
    }
    repo.revokeGrant(grant.id);
    res.status(204).end();
  });

  return router;
}

export function registerPrincipalRoutes(app: { use: (path: string, router: Router) => void }): void {
  app.use('/api/admin', createPrincipalsRouter());
}
