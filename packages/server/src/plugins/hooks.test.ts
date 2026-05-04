import { describe, expect, it, vi } from 'vitest';
import { PluginHookEmitter } from './hooks';

describe('PluginHookEmitter', () => {
  it('emits async handlers and removes plugin handlers', async () => {
    const emitter = new PluginHookEmitter();
    const firstHandler = vi.fn(async () => undefined);
    const secondHandler = vi.fn(async () => undefined);

    emitter.on('task:created', 'plugin-a', firstHandler);
    emitter.on('task:created', 'plugin-b', secondHandler);

    await emitter.emit('task:created', { taskId: 42 });
    expect(firstHandler).toHaveBeenCalledWith({ taskId: 42 });
    expect(secondHandler).toHaveBeenCalledWith({ taskId: 42 });

    emitter.remove('plugin-a');
    await emitter.emit('task:created', { taskId: 99 });

    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(2);
  });
});
