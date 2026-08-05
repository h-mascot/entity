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
} from '../../../db/src/boards';
import { resolveTrustedTenantScope } from '../tenant-scope';

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

  // D4: resolve a TRUSTED org/team scope per request. Caller tenant headers are
  // honored only behind an explicit trusted-proxy opt-in; otherwise the scope
  // resolves to the configured workspace (fail closed), so no authenticated
  // caller can select another tenant by setting a header.
  function repoFor(req: Request): BoardRepository {
    if (repository) return repository;
    return createBoardRepository(resolveTrustedTenantScope(req));
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
