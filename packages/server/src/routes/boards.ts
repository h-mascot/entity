import { Router, type Request, type Response } from 'express';
import {
  createBoardRepository,
  isBoardView,
  isBoardTemplate,
  normalizeBoardFilterConfig,
  type BoardRepository,
  type BoardView,
  type BoardFilterConfig,
  type CreateBoardInput,
  type BoardScope,
} from '../../../db/src/boards';
import { DEFAULT_WORKSPACE_ORG_ID, DEFAULT_WORKSPACE_TEAM_ID } from '../../../db/src';

/**
 * Boards API — `/api/boards`.
 *
 * Customizable board surface replacing the fixed Tasks peer tabs. General and
 * Analytics are required defaults (seeded idempotently). Swarm is NOT a board —
 * see the task-detail "Run with agents" capability (BRD-004).
 */
export function createBoardsRouter(repository?: BoardRepository): Router {
  const router = Router();

  // Ensure the boards schema exists on the shared entity DB up front (idempotent).
  // Scope is still resolved per request below; this only guarantees the table.
  if (!repository) {
    createBoardRepository();
  }

  // When no repository is injected, resolve a request-derived org/team scope
  // (x-entity-org-id / x-entity-team-id, defaulting to the configured workspace)
  // per request so boards are tenant-scoped and cross-tenant access fails closed.
  function repoFor(req: Request): BoardRepository {
    if (repository) return repository;
    const orgId = readScopeHeader(req.header('x-entity-org-id')) ?? DEFAULT_WORKSPACE_ORG_ID;
    const teamId = readScopeHeader(req.header('x-entity-team-id')) ?? DEFAULT_WORKSPACE_TEAM_ID;
    const scope: BoardScope = { orgId, teamId };
    return createBoardRepository(scope);
  }

  router.get('/', (req: Request, res: Response) => {
    const boards = repoFor(req);
    boards.seedDefaults();
    res.json({ boards: boards.listBoards() });
  });

  router.post('/', (req: Request, res: Response) => {
    const boards = repoFor(req);
    const body = (req.body ?? {}) as {
      name?: unknown;
      template?: unknown;
      view?: unknown;
      filter_config?: unknown;
      key?: unknown;
    };

    let input: CreateBoardInput;
    try {
      input = buildCreateInput(body);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    try {
      const created = boards.createBoard(input);
      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const boards = repoFor(req);
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'board id must be a positive integer' });
      return;
    }

    const body = (req.body ?? {}) as {
      name?: unknown;
      view?: unknown;
      filter_config?: unknown;
    };

    let updates: { name?: string; view?: BoardView; filter_config?: BoardFilterConfig };
    try {
      updates = buildUpdateInput(body);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    try {
      const updated = boards.updateBoard(id, updates);
      if (!updated) {
        res.status(404).json({ error: 'board not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/reorder', (req: Request, res: Response) => {
    const boards = repoFor(req);
    const body = (req.body ?? {}) as { ids?: unknown };
    if (!Array.isArray(body.ids) || !body.ids.every((id) => Number.isInteger(Number(id)) && Number(id) > 0)) {
      res.status(400).json({ error: 'ids must be an array of positive integers' });
      return;
    }
    const ids = (body.ids as Array<number | string>).map((id) => Number(id));
    res.json({ boards: boards.reorderBoards(ids) });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const boards = repoFor(req);
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'board id must be a positive integer' });
      return;
    }
    try {
      const deleted = boards.deleteBoard(id);
      res.status(deleted ? 204 : 404).end();
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  });

  return router;
}

function readScopeHeader(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseId(raw: string | undefined): number | null {
  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function buildCreateInput(body: {
  name?: unknown;
  template?: unknown;
  view?: unknown;
  filter_config?: unknown;
  key?: unknown;
}): CreateBoardInput {
  if (typeof body.name !== 'string') {
    throw new Error('board name is required');
  }
  const input: CreateBoardInput = { name: body.name };

  if (body.template !== undefined) {
    if (!isBoardTemplate(body.template)) {
      throw new Error('unknown board template');
    }
    input.template = body.template;
  }
  if (body.view !== undefined) {
    if (!isBoardView(body.view)) {
      throw new Error('unknown board view');
    }
    input.view = body.view;
  }
  if (body.filter_config !== undefined) {
    input.filter_config = normalizeBoardFilterConfig(body.filter_config);
  }
  if (typeof body.key === 'string') {
    input.key = body.key;
  }
  return input;
}

function buildUpdateInput(body: {
  name?: unknown;
  view?: unknown;
  filter_config?: unknown;
}): { name?: string; view?: BoardView; filter_config?: BoardFilterConfig } {
  const updates: { name?: string; view?: BoardView; filter_config?: BoardFilterConfig } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      throw new Error('board name must be a string');
    }
    updates.name = body.name;
  }
  if (body.view !== undefined) {
    if (!isBoardView(body.view)) {
      throw new Error('unknown board view');
    }
    updates.view = body.view;
  }
  if (body.filter_config !== undefined) {
    updates.filter_config = normalizeBoardFilterConfig(body.filter_config);
  }
  return updates;
}
