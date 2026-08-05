/**
 * Task handoffs HTTP routes — Curacel pilot capability C-8, adapted to main.
 *
 * Ported from curacel-readiness-runner but re-grounded on current main's trust
 * model: bearer-token authentication is enforced globally by the API auth
 * middleware (no per-request membership principal exists on main), the actor
 * is read from the X-Entity-Actor / X-Agent-Name header or request body, and
 * the tenant boundary is enforced by the org-scoped handoff repository —
 * every read/transition is keyed on the source task's own org_id (never a
 * caller-supplied org header), and create() rejects edges whose tasks belong
 * to different organizations.
 *
 * Target-agent eligibility is a pluggable dependency so the route stays
 * decoupled from main's agent registry; the index.ts wiring supplies a real
 * implementation. A no-op default keeps the route usable in tests.
 */

import { Router, type Request, type Response } from 'express';
import type {
  TaskHandoffRepository,
  TaskHandoffStatus,
  TaskRecord,
} from '../../../db/src';
import { asyncHandler } from '../middleware/async-handler';
import {
  authorizeTaskOperation,
  resolveRequestActorId,
} from '../principals/request-context';

export interface TaskHandoffRouterDependencies {
  handoffRepo: TaskHandoffRepository;
  taskStore: {
    getTask: (taskId: number) => TaskRecord | undefined | Promise<TaskRecord | undefined>;
  };
  /**
   * Optional target-agent eligibility check. When provided, creating a
   * handoff requires the agent to be eligible for the target task's scope.
   * Implemented by the route wiring (e.g. against the agent registry); the
   * route itself never trusts a caller-supplied org header.
   */
  resolveTargetAgent?: (
    context: { orgId: string; teamId: string | null; agentId: string },
  ) => boolean | Promise<boolean>;
  /** Optional scoped WebSocket refresh hook. */
  broadcast?: (data: unknown, scope: { org_id: string; team_id?: string | null }) => void;
  defaultActor?: string;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  return normalized.length <= max ? normalized : null;
}

function readActor(req: Request, fallback: string): string {
  // Server-resolved actor for customer principals (Terra B2); header/body
  // actor convention preserved only for the trusted service/admin path.
  return resolveRequestActorId(req, fallback);
}

function errorStatus(message: string): number {
  const normalized = message.toLowerCase();
  if (normalized.includes('not found')) return 404;
  if (
    normalized.includes('already exists') ||
    normalized.includes('cycle') ||
    normalized.includes('changed') ||
    normalized.includes('transition') ||
    normalized.includes('terminal') ||
    normalized.includes('reason')
  ) {
    return 409;
  }
  return 400;
}

export function createTaskHandoffRouter(deps: TaskHandoffRouterDependencies): Router {
  const router = Router();
  const defaultActor = deps.defaultActor ?? 'system';

  const loadTask = async (taskId: number) => deps.taskStore.getTask(taskId);

  const emitRefresh = (
    source: Pick<TaskRecord, 'id' | 'org_id' | 'team_id'>,
    target: Pick<TaskRecord, 'id' | 'org_id' | 'team_id'>,
    handoffId: string,
  ) => {
    if (!deps.broadcast) return;
    const event = { type: 'task:handoff', handoffId, taskIds: [source.id, target.id] };
    deps.broadcast(event, { org_id: source.org_id ?? '', team_id: source.team_id });
    if ((target.team_id ?? null) !== (source.team_id ?? null)) {
      deps.broadcast(event, { org_id: target.org_id ?? '', team_id: target.team_id });
    }
  };

  router.get(
    '/tasks/:taskId/handoffs/chain',
    asyncHandler(async (req, res) => {
      const taskId = positiveInteger(req.params.taskId);
      if (!taskId) return res.status(400).json({ error: 'invalid task id' });
      const task = await loadTask(taskId);
      if (!task) return res.status(404).json({ error: 'task not found' });
      if (!authorizeTaskOperation(req, res, task, 'read')) return;
      try {
        const chain = deps.handoffRepo.getChain({
          orgId: task.org_id!,
          taskId,
          maxDepth: positiveInteger(req.query.maxDepth) ?? undefined,
          maxEdges: positiveInteger(req.query.maxEdges) ?? undefined,
        });
        return res.json({ chain });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load handoff chain';
        return res.status(errorStatus(message)).json({ error: message });
      }
    }),
  );

  router.get(
    '/tasks/:taskId/handoffs',
    asyncHandler(async (req, res) => {
      const taskId = positiveInteger(req.params.taskId);
      if (!taskId) return res.status(400).json({ error: 'invalid task id' });
      const task = await loadTask(taskId);
      if (!task) return res.status(404).json({ error: 'task not found' });
      if (!authorizeTaskOperation(req, res, task, 'read')) return;
      const handoffs = deps.handoffRepo.listForTask(task.org_id!, taskId);
      return res.json({ incoming: handoffs.incoming, outgoing: handoffs.outgoing });
    }),
  );

  router.post(
    '/tasks/:taskId/handoffs',
    asyncHandler(async (req, res) => {
      const sourceTaskId = positiveInteger(req.params.taskId);
      const targetTaskId = positiveInteger(req.body?.targetTaskId);
      const targetAgentId = text(req.body?.targetAgentId, 240);
      const reason =
        req.body?.reason == null || req.body.reason === '' ? null : text(req.body.reason, 500);
      if (!sourceTaskId || !targetTaskId || !targetAgentId) {
        return res.status(400).json({ error: 'targetTaskId and targetAgentId are required' });
      }
      if (req.body?.reason && !reason) return res.status(400).json({ error: 'reason is too long' });
      const [source, target] = await Promise.all([loadTask(sourceTaskId), loadTask(targetTaskId)]);
      if (!source) return res.status(404).json({ error: 'source task not found' });
      if (!target) return res.status(404).json({ error: 'target task not found' });
      // Tenant-authorize both endpoints before creating a cross-task edge (B3).
      if (!authorizeTaskOperation(req, res, source, 'handoff')) return;
      if (!authorizeTaskOperation(req, res, target, 'handoff')) return;
      if (source.org_id !== target.org_id) {
        return res.status(400).json({ error: 'handoff tasks must share an organization' });
      }
      if (deps.resolveTargetAgent) {
        const eligible = await deps.resolveTargetAgent({
          orgId: target.org_id!,
          teamId: target.team_id ?? null,
          agentId: targetAgentId,
        });
        if (!eligible) {
          return res.status(400).json({ error: 'target agent is outside the target task scope' });
        }
      }
      try {
        const handoff = deps.handoffRepo.create({
          sourceTaskId,
          targetTaskId,
          targetAgentId,
          reason,
          actorPrincipalId: readActor(req, defaultActor),
        });
        emitRefresh(source, target, handoff.id);
        return res.status(201).json({ handoff });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create handoff';
        return res.status(errorStatus(message)).json({ error: message });
      }
    }),
  );

  router.patch(
    '/tasks/:taskId/handoffs/:handoffId',
    asyncHandler(async (req, res) => {
      const taskId = positiveInteger(req.params.taskId);
      const expectedVersion = positiveInteger(req.body?.expectedVersion);
      const nextStatus = text(req.body?.status, 20) as TaskHandoffStatus | null;
      if (!taskId || !expectedVersion || !nextStatus) {
        return res.status(400).json({ error: 'status and expectedVersion are required' });
      }
      const pathTask = await loadTask(taskId);
      if (!pathTask) return res.status(404).json({ error: 'task not found' });
      if (!authorizeTaskOperation(req, res, pathTask, 'handoff')) return;
      const handoff = deps.handoffRepo.get(pathTask.org_id!, req.params.handoffId);
      if (!handoff || (handoff.source_task_id !== taskId && handoff.target_task_id !== taskId)) {
        return res.status(404).json({ error: 'handoff not found' });
      }
      // Tenant-authorize BOTH endpoints before mutating a cross-task edge
      // (B3). A caller scoped only to the path task must not transition a
      // handoff whose other endpoint lies outside its durable scope; reuse the
      // already-loaded path task when it matches an endpoint.
      const source =
        handoff.source_task_id === taskId ? pathTask : await loadTask(handoff.source_task_id);
      const target =
        handoff.target_task_id === taskId ? pathTask : await loadTask(handoff.target_task_id);
      if (!source || !target) return res.status(404).json({ error: 'task not found' });
      if (!authorizeTaskOperation(req, res, source, 'handoff')) return;
      if (!authorizeTaskOperation(req, res, target, 'handoff')) return;
      try {
        const updated = deps.handoffRepo.transition({
          orgId: handoff.org_id,
          handoffId: handoff.id,
          status: nextStatus,
          actorPrincipalId: readActor(req, defaultActor),
          expectedVersion,
          reason: req.body?.reason,
        });
        emitRefresh(source, target, updated.id);
        return res.json({ handoff: updated });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to update handoff';
        return res.status(errorStatus(message)).json({ error: message });
      }
    }),
  );

  return router;
}
