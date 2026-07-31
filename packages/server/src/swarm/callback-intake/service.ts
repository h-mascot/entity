/**
 * EEPC-A-03 — Callback intake orchestration (validate → map → optional ActivityEvent append).
 */

import { mapValidatedCallbackToActivityRecord } from './map';
import type {
  CallbackIntakeDependencies,
  CallbackIntakeResult,
} from './types';
import { validateExecutionCallback } from './validate';

export function createExecutionCallbackIntakeService(deps: CallbackIntakeDependencies) {
  return {
    async intake(input: unknown): Promise<CallbackIntakeResult> {
      const validated = validateExecutionCallback(input, deps);
      if (!validated.ok) {
        return {
          ok: false,
          status: validated.status,
          code: validated.code,
          message: validated.message,
          issues: validated.issues,
        };
      }

      const record = mapValidatedCallbackToActivityRecord(validated);

      if (record.taskId != null && deps.appendTaskEvent) {
        const appended = await deps.appendTaskEvent(record.taskId, record.appendInput);
        if (!appended.ok) {
          return {
            ok: false,
            status: appended.status,
            code: appended.code,
            message: appended.message,
            issues: [
              {
                path: 'taskId',
                code: appended.code,
                message: appended.message,
              },
            ],
          };
        }
        record.persisted = true;
      }

      return {
        ok: true,
        record,
        status: record.persisted ? 201 : 202,
      };
    },
  };
}

export type ExecutionCallbackIntakeService = ReturnType<typeof createExecutionCallbackIntakeService>;
