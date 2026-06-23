import { Router, type Request, type Response } from 'express';
import {
  buildTaskHumanGateDecisionUpdates,
  buildTaskHumanGateRequestUpdates,
  buildTaskReviewDecisionUpdates,
  type ActivityRepository,
  type ReviewGateActorType,
  type TaskRecord,
  type UpdateTaskInput,
} from '../../../db/src';

export interface TaskReviewGateRouterDependencies {
  getTask: (taskId: number) => Promise<TaskRecord | undefined> | TaskRecord | undefined;
  updateTask: (taskId: number, updates: UpdateTaskInput) => Promise<TaskRecord | undefined> | TaskRecord | undefined;
  activityRepository?: Pick<ActivityRepository, 'createActivity'>;
  defaultActor?: string;
}

function parsePositiveTaskId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readActor(req: Request, fallback: string): string {
  const headerActor = req.header('X-Entity-Actor') ?? req.header('X-Agent-Name');
  if (typeof headerActor === 'string' && headerActor.trim()) {
    return headerActor.trim();
  }
  const body = req.body as Record<string, unknown> | undefined;
  const bodyActor = body?.actor_principal_id ?? body?.actorPrincipalId ?? body?.actor;
  return typeof bodyActor === 'string' && bodyActor.trim() ? bodyActor.trim() : fallback;
}

function readActorType(req: Request): ReviewGateActorType {
  const body = req.body as Record<string, unknown> | undefined;
  const raw = req.header('X-Entity-Actor-Type') ?? body?.actor_type ?? body?.actorType;
  return raw === 'human' || raw === 'agent' || raw === 'system' || raw === 'workflow' ? raw : 'unknown';
}

function readReason(req: Request): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  const raw = body?.reason ?? body?.note;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function logReviewGateActivity(
  dependencies: TaskReviewGateRouterDependencies,
  input: {
    task: TaskRecord;
    eventType: 'review_decision' | 'human_gate_requested' | 'human_gate_decision';
    action: string;
    description: string;
    actorPrincipalId: string;
    actorType?: ReviewGateActorType;
    data: Record<string, unknown>;
  },
) {
  dependencies.activityRepository?.createActivity({
    source: 'task',
    type: 'task_updated',
    activity_event_type: input.eventType,
    activity_event_schema_status: 'structured',
    activity_event_payload: {
      actor_principal_id: input.actorPrincipalId,
      actor_type: input.actorType ?? 'unknown',
      task_id: input.task.id,
      object_refs: [{ object_type: 'task', object_id: String(input.task.id), link_role: 'origin' }],
      data: input.data,
    },
    action: input.action,
    description: input.description,
    agent_name: input.actorPrincipalId,
    task_id: input.task.id,
    task_column: input.task.column,
    metadata: JSON.stringify(input.data),
  });
}

export function createTaskReviewGateRouter(dependencies: TaskReviewGateRouterDependencies): Router {
  const router = Router();
  const defaultActor = dependencies.defaultActor ?? 'Henry';

  async function getTaskOrRespond(req: Request, res: Response) {
    const taskId = parsePositiveTaskId(req.params.id);
    if (!taskId) {
      res.status(400).json({ error: 'invalid task id' });
      return null;
    }
    const task = await dependencies.getTask(taskId);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return null;
    }
    return task;
  }

  router.get('/:id/review', async (req, res) => {
    const task = await getTaskOrRespond(req, res);
    if (!task) return;
    res.json({
      review_required: Boolean(task.review_required),
      review_state: task.review_state ?? 'not_required',
    });
  });

  router.get('/:id/human-gate', async (req, res) => {
    const task = await getTaskOrRespond(req, res);
    if (!task) return;
    res.json({
      human_gate_required: Boolean(task.human_gate_required),
      human_gate_state: task.human_gate_state ?? 'not_required',
    });
  });

  async function applyReviewDecision(req: Request, res: Response, decision: 'accepted' | 'request_fix') {
    const task = await getTaskOrRespond(req, res);
    if (!task) return;
    const actor = readActor(req, defaultActor);
    const result = buildTaskReviewDecisionUpdates({
      task,
      actor_principal_id: actor,
      decision,
      reason: readReason(req),
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.code, message: result.message });
      return;
    }
    const updated = await dependencies.updateTask(task.id, result.updates);
    if (!updated) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    logReviewGateActivity(dependencies, {
      task: updated,
      eventType: 'review_decision',
      action: decision === 'accepted' ? 'Review accepted' : 'Review requested fixes',
      description: `${actor} recorded review decision ${decision}.`,
      actorPrincipalId: actor,
      data: {
        decision,
        reviewer_principal_id: result.reviewer_principal_id,
        reason: readReason(req),
      },
    });
    res.json({ task: updated, review: { decision, reviewer_principal_id: result.reviewer_principal_id } });
  }

  router.post('/:id/review/accept', (req, res) => applyReviewDecision(req, res, 'accepted'));
  router.post('/:id/review/request-fix', (req, res) => applyReviewDecision(req, res, 'request_fix'));

  router.post('/:id/human-gate/request', async (req, res) => {
    const task = await getTaskOrRespond(req, res);
    if (!task) return;
    const actor = readActor(req, defaultActor);
    const result = buildTaskHumanGateRequestUpdates({
      task,
      actor_principal_id: actor,
      reason: readReason(req),
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.code, message: result.message });
      return;
    }
    const updated = await dependencies.updateTask(task.id, result.updates);
    if (!updated) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    logReviewGateActivity(dependencies, {
      task: updated,
      eventType: 'human_gate_requested',
      action: 'Human gate requested',
      description: `${actor} requested a human gate.`,
      actorPrincipalId: actor,
      data: {
        decision: 'pending',
        approver_principal_id: result.approver_principal_id,
        reason: readReason(req),
      },
    });
    res.json({ task: updated, humanGate: { decision: 'pending', approver_principal_id: result.approver_principal_id } });
  });

  async function applyHumanGateDecision(req: Request, res: Response, decision: 'approved' | 'rejected') {
    const task = await getTaskOrRespond(req, res);
    if (!task) return;
    const actor = readActor(req, defaultActor);
    const actorType = readActorType(req);
    const result = buildTaskHumanGateDecisionUpdates({
      task,
      actor_principal_id: actor,
      actor_type: actorType,
      decision,
      reason: readReason(req),
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.code, message: result.message });
      return;
    }
    const updated = await dependencies.updateTask(task.id, result.updates);
    if (!updated) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    logReviewGateActivity(dependencies, {
      task: updated,
      eventType: 'human_gate_decision',
      action: decision === 'approved' ? 'Human gate approved' : 'Human gate rejected',
      description: `${actor} recorded human gate decision ${decision}.`,
      actorPrincipalId: actor,
      actorType,
      data: {
        decision,
        approver_principal_id: result.approver_principal_id,
        reason: readReason(req),
      },
    });
    res.json({ task: updated, humanGate: { decision, approver_principal_id: result.approver_principal_id } });
  }

  router.post('/:id/human-gate/approve', (req, res) => applyHumanGateDecision(req, res, 'approved'));
  router.post('/:id/human-gate/reject', (req, res) => applyHumanGateDecision(req, res, 'rejected'));

  return router;
}
