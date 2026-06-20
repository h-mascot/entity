import { useCallback, useState } from 'react';
import type { TaskBoardTask, TaskColumn } from '../../hooks/useTaskBoard';

interface UseBoardSelectionArgs {
  tasks: TaskBoardTask[];
  onMoveTask: (taskId: number, column: TaskColumn) => Promise<unknown>;
  /** Called instead of moving when a Review task is bulk-moved to Done. */
  onNeedsReview: (task: TaskBoardTask) => void;
  /** Human label for a column, used in the partial-failure message. */
  formatColumnLabel?: (column: TaskColumn) => string;
}

export interface BoardSelection {
  selectedTaskIds: Set<number>;
  selectedCount: number;
  bulkColumn: TaskColumn;
  setBulkColumn: (column: TaskColumn) => void;
  bulkBusy: boolean;
  bulkError: string | null;
  toggle: (taskId: number) => void;
  clear: () => void;
  deselect: (taskId: number) => void;
  runBulkMove: () => Promise<void>;
}

/**
 * Owns multi-select state and the bulk-move action for the board. Bulk-moving a
 * Review task to Done is delegated to `onNeedsReview` (the review modal) rather
 * than failing the server's completion gate.
 */
export function useBoardSelection({
  tasks,
  onMoveTask,
  onNeedsReview,
  formatColumnLabel = (column) => column,
}: UseBoardSelectionArgs): BoardSelection {
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(() => new Set());
  const [bulkColumn, setBulkColumn] = useState<TaskColumn>('todo');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const toggle = useCallback((taskId: number) => {
    setBulkError(null);
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedTaskIds(new Set());
    setBulkError(null);
  }, []);

  const deselect = useCallback((taskId: number) => {
    setSelectedTaskIds((current) => {
      if (!current.has(taskId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
  }, []);

  const runBulkMove = useCallback(async () => {
    if (selectedTaskIds.size === 0 || bulkBusy) {
      return;
    }

    if (bulkColumn === 'done') {
      const reviewTask = tasks.find(
        (candidate) => selectedTaskIds.has(candidate.id) && candidate.column === 'review',
      );
      if (reviewTask) {
        onNeedsReview(reviewTask);
        return;
      }
    }

    const ids = Array.from(selectedTaskIds);
    setBulkBusy(true);
    setBulkError(null);
    const failures: number[] = [];
    for (const id of ids) {
      try {
        await onMoveTask(id, bulkColumn);
      } catch {
        failures.push(id);
      }
    }
    setBulkBusy(false);

    if (failures.length > 0) {
      setSelectedTaskIds(new Set(failures));
      setBulkError(
        `Moved ${ids.length - failures.length} of ${ids.length} task(s). ${failures.length} could not be moved to ${formatColumnLabel(bulkColumn)}.`,
      );
    } else {
      setSelectedTaskIds(new Set());
    }
  }, [tasks, onMoveTask, onNeedsReview, formatColumnLabel, selectedTaskIds, bulkColumn, bulkBusy]);

  return {
    selectedTaskIds,
    selectedCount: selectedTaskIds.size,
    bulkColumn,
    setBulkColumn,
    bulkBusy,
    bulkError,
    toggle,
    clear,
    deselect,
    runBulkMove,
  };
}
