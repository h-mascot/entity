import type { PluginRuntimeContext } from '../registry';
import { recordEntityLinkerObservation } from './state';

export function registerPlugin({ hooks, logger, plugin }: PluginRuntimeContext): void {
  const observedHooks = plugin.hooks.length > 0 ? plugin.hooks : ['task:created', 'task:updated', 'task:moved'];
  const maxRecentEvents = plugin.settings.maxRecentEvents;

  for (const hookName of observedHooks) {
    hooks.on(hookName, plugin.id, (payload) => {
      const observation = recordEntityLinkerObservation({
        hook: hookName,
        payload,
        maxRecentEvents,
      });

      logger.info(
        `[Plugin:${plugin.id}] observed ${hookName}${typeof observation.taskId === 'number' ? ` for task #${observation.taskId}` : ''}`,
      );
    });
  }
}

export default registerPlugin;
