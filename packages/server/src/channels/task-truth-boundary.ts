/**
 * CH-A-04 / THE-920 — Channel adapters must never become alternate task truth stores.
 *
 * Grill Q48: channels are intake/notification adapters over Entity work state.
 * The host/task service remains the only writer of task truth.
 *
 * Adapters may only:
 *   - parseIntake → host-applied proposals
 *   - notifyStatus ← status notifications
 *
 * This module owns the host apply path and architecture-scan helpers that prove
 * adapter production sources do not open a parallel task repository.
 */

import type { ActivityEventAppendInput } from '../activity-events';
import type {
  ChannelIntakeParseResult,
  ChannelIntakeTaskProposal,
} from './types';

/** Canonical owner of task rows / ActivityEvent persistence. */
export const CHANNEL_TASK_TRUTH_OWNER = 'host_task_service' as const;

/** Roles adapters are allowed to perform. */
export const CHANNEL_ADAPTER_ALLOWED_ROLES = [
  'intake_proposal',
  'status_notification',
] as const;

export type ChannelAdapterAllowedRole = (typeof CHANNEL_ADAPTER_ALLOWED_ROLES)[number];

/**
 * Public ChannelAdapter surface keys. Extra persist/write methods are a
 * truth-store smell and fail the architecture guard.
 */
export const CHANNEL_ADAPTER_ALLOWED_SURFACE_KEYS = [
  'id',
  'kind',
  'displayName',
  'enabled',
  'getAvailability',
  'parseIntake',
  'notifyStatus',
] as const;

/** Method names that would make an adapter an alternate task truth store. */
export const CHANNEL_ADAPTER_FORBIDDEN_TRUTH_METHODS = [
  'createTask',
  'updateTask',
  'deleteTask',
  'persistTask',
  'saveTask',
  'writeTask',
  'storeTask',
  'upsertTask',
  'applyIntake',
  'commitIntake',
  'writeActivityEvent',
  'appendActivityEvent',
  'persistActivity',
] as const;

export interface ChannelAdapterTruthStoreViolation {
  code: string;
  message: string;
  fileName?: string;
  line?: number;
}

export interface ChannelIntakeHostWriters {
  /**
   * Host-owned task create. Adapters must not call repository APIs directly;
   * they return ChannelIntakeTaskProposal for this writer to apply.
   */
  createTask: (
    proposal: ChannelIntakeTaskProposal,
  ) => Promise<{ id: number }> | { id: number };
  /**
   * Host-owned ActivityEvent append. Adapters only propose the event payload.
   */
  appendActivity: (
    taskId: number,
    event: ActivityEventAppendInput,
  ) => Promise<unknown> | unknown;
}

export type ApplyChannelIntakeResult =
  | {
      ok: true;
      taskId: number | null;
      createdTask: boolean;
      activityAppended: boolean;
      truthOwner: typeof CHANNEL_TASK_TRUTH_OWNER;
      warnings: Array<{ code: string; message: string }>;
    }
  | {
      ok: false;
      code: string;
      message: string;
      degraded: true;
      truthOwner: typeof CHANNEL_TASK_TRUTH_OWNER;
      warnings: Array<{ code: string; message: string }>;
    };

const FORBIDDEN_ADAPTER_SOURCE_RULES: Array<{
  code: string;
  message: string;
  pattern: RegExp;
}> = [
  {
    code: 'forbidden_createTask_call',
    message: 'Adapter source must not call createTask (host applies proposals)',
    pattern: /\bcreateTask\s*\(/,
  },
  {
    code: 'forbidden_updateTask_call',
    message: 'Adapter source must not call updateTask',
    pattern: /\bupdateTask\s*\(/,
  },
  {
    code: 'forbidden_deleteTask_call',
    message: 'Adapter source must not call deleteTask',
    pattern: /\bdeleteTask\s*\(/,
  },
  {
    code: 'forbidden_task_repository',
    message: 'Adapter source must not construct task repositories',
    pattern: /\bcreate(?:OrgScoped)?Task(?:Comment)?Repository\b/,
  },
  {
    code: 'forbidden_entity_database',
    message: 'Adapter source must not open the Entity database',
    pattern: /\bgetEntityDatabase\b/,
  },
  {
    code: 'forbidden_better_sqlite3',
    message: 'Adapter source must not import better-sqlite3',
    pattern: /better-sqlite3/,
  },
  {
    code: 'forbidden_sql_tasks_write',
    message: 'Adapter source must not issue SQL writes against tasks',
    pattern: /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+tasks\b/i,
  },
  {
    code: 'forbidden_appendTaskEvent_call',
    message: 'Adapter source must not call appendTaskEvent (host applies proposals)',
    pattern: /\bappendTaskEvent\s*\(/,
  },
  {
    code: 'forbidden_db_value_import',
    message:
      'Adapter source must not value-import db modules (import type for enums is allowed)',
    pattern:
      /(?:^|\n)\s*import\s+(?!type\b)[^;]*\bfrom\s+['"][^'"]*(?:\/db\/src|@entity\/db)['"]/m,
  },
];

/**
 * Production channel modules that are adapter/transport/registry code.
 * The host boundary module is excluded — it is the sole apply path.
 */
export const CHANNEL_ADAPTER_PRODUCTION_SOURCE_FILES = [
  'adapter.ts',
  'email-adapter.ts',
  'email-config.ts',
  'feature-flag.ts',
  'index.ts',
  'registry.ts',
  'router.ts',
  'sanitize.ts',
  'slack-reference-adapter.ts',
  'slack-transport.ts',
  'types.ts',
] as const;

export const CHANNEL_HOST_TRUTH_BOUNDARY_FILE = 'task-truth-boundary.ts';

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * Static architecture scan for a single channel source file.
 * Adapter/transport files must not open a parallel task truth path.
 */
export function scanChannelAdapterSourceForTruthStoreViolations(
  source: string,
  fileName: string,
  role: 'adapter' | 'host_boundary' = 'adapter',
): ChannelAdapterTruthStoreViolation[] {
  const violations: ChannelAdapterTruthStoreViolation[] = [];

  if (role === 'host_boundary') {
    if (!source.includes('CHANNEL_TASK_TRUTH_OWNER')) {
      violations.push({
        code: 'host_boundary_missing_owner_constant',
        message: 'Host boundary must declare CHANNEL_TASK_TRUTH_OWNER',
        fileName,
      });
    }
    if (!source.includes('applyChannelIntakeProposals')) {
      violations.push({
        code: 'host_boundary_missing_apply',
        message: 'Host boundary must export applyChannelIntakeProposals',
        fileName,
      });
    }
    return violations;
  }

  for (const rule of FORBIDDEN_ADAPTER_SOURCE_RULES) {
    const match = rule.pattern.exec(source);
    if (match && match.index !== undefined) {
      violations.push({
        code: rule.code,
        message: rule.message,
        fileName,
        line: lineNumberAt(source, match.index),
      });
    }
  }

  return violations;
}

/**
 * Runtime guard: adapters must not expose forbidden truth-store methods.
 * Descriptor/prototype own keys are checked; prototype chain builtins ignored.
 */
export function collectChannelAdapterTruthStoreMethodViolations(
  adapter: object,
): ChannelAdapterTruthStoreViolation[] {
  const keys = new Set<string>([
    ...Object.keys(adapter),
    ...Object.getOwnPropertyNames(adapter),
  ]);
  const violations: ChannelAdapterTruthStoreViolation[] = [];
  for (const forbidden of CHANNEL_ADAPTER_FORBIDDEN_TRUTH_METHODS) {
    if (keys.has(forbidden)) {
      violations.push({
        code: 'forbidden_adapter_truth_method',
        message: `Channel adapter exposes forbidden truth-store method "${forbidden}"`,
      });
    }
  }
  return violations;
}

export function assertChannelAdapterNotTaskTruthStore(adapter: object): void {
  const violations = collectChannelAdapterTruthStoreMethodViolations(adapter);
  if (violations.length > 0) {
    throw new Error(
      `channel_adapter_truth_store_forbidden:${violations.map((v) => v.code).join(',')}`,
    );
  }
}

/**
 * Host-only path that materializes intake proposals into Entity task truth.
 * Adapters must call this indirectly via host wiring — never write themselves.
 */
export async function applyChannelIntakeProposals(
  parseResult: ChannelIntakeParseResult,
  writers: ChannelIntakeHostWriters | null | undefined,
): Promise<ApplyChannelIntakeResult> {
  if (!parseResult.ok) {
    return {
      ok: false,
      code: parseResult.code,
      message: parseResult.message,
      degraded: true,
      truthOwner: CHANNEL_TASK_TRUTH_OWNER,
      warnings: parseResult.warnings,
    };
  }

  if (!writers || typeof writers.createTask !== 'function' || typeof writers.appendActivity !== 'function') {
    return {
      ok: false,
      code: 'host_writers_required',
      message:
        'Channel intake proposals require host task writers; adapters are not task truth stores',
      degraded: true,
      truthOwner: CHANNEL_TASK_TRUTH_OWNER,
      warnings: [
        {
          code: 'host_writers_required',
          message: 'Missing createTask/appendActivity host writers',
        },
      ],
    };
  }

  const warnings = [...parseResult.warnings];
  let taskId = parseResult.message.taskId ?? null;
  let createdTask = false;
  let activityAppended = false;

  if (parseResult.taskProposal) {
    const created = await writers.createTask(parseResult.taskProposal);
    if (!created || typeof created.id !== 'number' || !Number.isInteger(created.id) || created.id < 1) {
      return {
        ok: false,
        code: 'host_create_task_failed',
        message: 'Host createTask did not return a valid task id',
        degraded: true,
        truthOwner: CHANNEL_TASK_TRUTH_OWNER,
        warnings,
      };
    }
    taskId = created.id;
    createdTask = true;
  }

  if (parseResult.activityProposal) {
    const activityTaskId = parseResult.activityProposal.taskId ?? taskId;
    if (activityTaskId == null) {
      warnings.push({
        code: 'activity_awaiting_task_id',
        message: 'Activity proposal deferred until host assigns task id',
      });
    } else {
      await writers.appendActivity(activityTaskId, parseResult.activityProposal.event);
      activityAppended = true;
      taskId = activityTaskId;
    }
  }

  return {
    ok: true,
    taskId,
    createdTask,
    activityAppended,
    truthOwner: CHANNEL_TASK_TRUTH_OWNER,
    warnings,
  };
}
