import type { PluginRuntimeContext } from '../registry';

function extractTaskId(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directTaskId = record.taskId;
  if (typeof directTaskId === 'number' && Number.isFinite(directTaskId)) {
    return directTaskId;
  }

  const task = record.task;
  if (task && typeof task === 'object') {
    const taskId = (task as Record<string, unknown>).id;
    if (typeof taskId === 'number' && Number.isFinite(taskId)) {
      return taskId;
    }
  }

  return null;
}

export function registerPlugin({ hooks, logger, plugin }: PluginRuntimeContext): void {
  const observedHooks = plugin.hooks.length > 0 ? plugin.hooks : ['task:created', 'task:updated', 'task:moved'];

  for (const hookName of observedHooks) {
    hooks.on(hookName, plugin.id, (payload) => {
      const taskId = extractTaskId(payload);
      logger.info(
        `[Plugin:${plugin.id}] observed ${hookName}${typeof taskId === 'number' ? ` for task #${taskId}` : ''}`,
      );
    });
  }
}

export default registerPlugin;
