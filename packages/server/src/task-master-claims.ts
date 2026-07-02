import { Router } from 'express';
import {
  ACTIVITY_EVENT_PAYLOAD_VERSION,
  type ActivityRecord,
  type ActivityRepository,
  type ClaimTaskForTaskMasterInput,
  type TaskMasterClaimRecord,
  type TaskMasterClaimResult,
  type TaskRecord,
} from '../../db/src';
import type { TaskSyncLayer } from '../../db/src/task-sync';
import { asyncHandler } from './middleware/async-handler';

export interface TaskMasterClaimResponse {
  status: TaskMasterClaimResult['status'];
  claimed: boolean;
  task?: TaskRecord;
  previousTask?: TaskRecord;
  claim?: TaskMasterClaimRecord;
  activityEvent?: ActivityRecord;
  reason?: string;
}

export interface TaskMasterClaimService {
  claimTask: (taskId: number, input?: ClaimTaskForTaskMasterInput) => Promise<TaskMasterClaimResponse>;
}

interface TaskMasterClaimServiceDependencies {
  taskSyncLayer: Pick<TaskSyncLayer, 'claimTaskForTaskMaster'>;
  activityRepository: ActivityRepository;
}

function parseMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata?.trim()) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readRoutingPolicyReasonChain(task: TaskRecord | undefined): Array<Record<string, unknown>> | undefined {
  const metadata = parseMetadata(task?.metadata);
  const projection = metadata.routing_policy_projection;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return undefined;
  }
  const reasonChain = (projection as { reason_chain?: unknown }).reason_chain;
  return Array.isArray(reasonChain) ? reasonChain.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
  ) : undefined;
}

function createClaimActivity(
  activityRepository: ActivityRepository,
  result: TaskMasterClaimResult & {
    status: 'claimed';
    task: TaskRecord;
    previousTask: TaskRecord;
    claim: TaskMasterClaimRecord;
  },
): ActivityRecord {
  const task = result.task;
  const previousTask = result.previousTask;
  const claim = result.claim;
  return activityRepository.createActivity({
    source: 'task',
    type: 'task_updated',
    activity_event_type: 'taskmaster_claimed',
    activity_event_schema_status: 'structured',
    activity_event_payload: {
      version: ACTIVITY_EVENT_PAYLOAD_VERSION,
      actor_principal_id: claim.taskmaster_principal_id,
      actor_type: 'agent',
      task_id: task.id,
      object_refs: [{ object_type: 'task', object_id: String(task.id), link_role: 'origin' }],
      previous_state: previousTask.column,
      new_state: task.column,
      reason: claim.policy_reason,
      policy_reason_chain: readRoutingPolicyReasonChain(task),
      data: {
        claim,
        previous_assignee: previousTask.assignee,
        previous_executor_principal_id: previousTask.executor_principal_id ?? null,
        previous_assignment_state: previousTask.assignment_state ?? null,
        current_executor_principal_id: task.executor_principal_id ?? null,
        current_assignment_state: task.assignment_state ?? null,
      },
    },
    action: 'Task Master claimed task',
    description: `Task Master claimed unassigned policy-drivable work: ${task.name}.`,
    agent_name: claim.taskmaster_principal_id,
    task_id: task.id,
    task_column: task.column,
    metadata: JSON.stringify({
      taskName: task.name,
      claim_request_id: claim.claim_request_id,
      previous_assignment_state: claim.previous_assignment_state,
    }),
  });
}

function statusCodeForClaim(status: TaskMasterClaimResult['status']): number {
  switch (status) {
    case 'not_found':
      return 404;
    case 'not_claimable':
      return 409;
    case 'claimed':
      return 201;
    case 'already_claimed':
    default:
      return 200;
  }
}

export function createTaskMasterClaimService(
  dependencies: TaskMasterClaimServiceDependencies,
): TaskMasterClaimService {
  const { taskSyncLayer, activityRepository } = dependencies;
  return {
    async claimTask(taskId, input = {}) {
      if (!Number.isInteger(taskId) || taskId < 1) {
        return {
          status: 'not_found',
          claimed: false,
          reason: 'task not found',
        };
      }

      const result = await taskSyncLayer.claimTaskForTaskMaster(taskId, input);
      if (result.status !== 'claimed') {
        return result;
      }

      if (!result.task || !result.previousTask || !result.claim) {
        return {
          status: 'not_claimable',
          claimed: false,
          task: result.task,
          previousTask: result.previousTask,
          reason: 'claim transition did not return audit details',
        };
      }

      const activityEvent = createClaimActivity(activityRepository, {
        ...result,
        status: 'claimed',
        task: result.task,
        previousTask: result.previousTask,
        claim: result.claim,
      });
      return {
        ...result,
        activityEvent,
      };
    },
  };
}

export function createTaskMasterClaimRouter(service: TaskMasterClaimService): Router {
  const router = Router();

  router.post('/tasks/:id/claim', asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const result = await service.claimTask(taskId, {
      taskmaster_principal_id:
        typeof body.taskmaster_principal_id === 'string'
          ? body.taskmaster_principal_id
          : typeof body.taskmasterPrincipalId === 'string'
            ? body.taskmasterPrincipalId
            : undefined,
      claimed_at:
        typeof body.claimed_at === 'string'
          ? body.claimed_at
          : typeof body.claimedAt === 'string'
            ? body.claimedAt
            : undefined,
      claim_request_id:
        typeof body.claim_request_id === 'string'
          ? body.claim_request_id
          : typeof body.claimRequestId === 'string'
            ? body.claimRequestId
            : undefined,
      policy_reason:
        typeof body.policy_reason === 'string'
          ? body.policy_reason
          : typeof body.policyReason === 'string'
            ? body.policyReason
            : undefined,
    });

    return res.status(statusCodeForClaim(result.status)).json(result);
  }));

  return router;
}
