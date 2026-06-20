import { useCallback, useState } from 'react';
import type { TaskBoardTask, TaskColumn, useTaskBoard } from '../../hooks/useTaskBoard';
import { toErrorMessage } from '../../lib/http';

type UpdateTaskFn = ReturnType<typeof useTaskBoard>['updateTask'];
import { readUserProfile } from '../../lib/userProfile';
import { buildReviewDecisionMetadata, reviewActionToDecision, type ReviewAction } from './reviewActions';

function parseMetadataRecord(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface ReviewCompletion {
  task: TaskBoardTask | null;
  busy: boolean;
  error: string | null;
  openForTask: (task: TaskBoardTask) => void;
  close: () => void;
  /** Applies the review decision; returns the affected task id on success, else null. */
  submit: (action: ReviewAction, note: string) => Promise<number | null>;
}

/**
 * Owns the board review modal: which task is being completed, the decision
 * submission (via the shared review-metadata builder), and busy/error state.
 * Completing with "accept_done" also moves the task to Done.
 */
export function useReviewCompletion(updateTask: UpdateTaskFn): ReviewCompletion {
  const [task, setTask] = useState<TaskBoardTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openForTask = useCallback((next: TaskBoardTask) => {
    setError(null);
    setTask(next);
  }, []);

  const close = useCallback(() => {
    setTask(null);
    setError(null);
  }, []);

  const submit = useCallback<ReviewCompletion['submit']>(
    async (action, note) => {
      if (!task) return null;
      const reviewer = readUserProfile().displayName || 'Henry';
      const metadata = buildReviewDecisionMetadata(parseMetadataRecord(task.metadata), {
        decision: reviewActionToDecision(action),
        reviewer,
        note,
        ensureReviewType: true,
      });

      setBusy(true);
      setError(null);
      try {
        const fields: { metadata: string; column?: TaskColumn } =
          action === 'accept_done' ? { metadata, column: 'done' } : { metadata };
        await updateTask(task.id, fields);
        setTask(null);
        return task.id;
      } catch (err) {
        setError(toErrorMessage(err, 'Could not update review.'));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [task, updateTask],
  );

  return { task, busy, error, openForTask, close, submit };
}
