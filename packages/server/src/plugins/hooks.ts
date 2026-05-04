export type PluginHookHandler = (payload: unknown) => void | Promise<void>;

interface RegisteredHookHandler {
  pluginId: string;
  handler: PluginHookHandler;
}

export class PluginHookEmitter {
  private readonly handlers = new Map<string, RegisteredHookHandler[]>();

  constructor(
    private readonly logger: Pick<Console, 'warn'> = console,
  ) {}

  on(hook: string, pluginId: string, handler: PluginHookHandler): void {
    const existing = this.handlers.get(hook) ?? [];
    existing.push({ pluginId, handler });
    this.handlers.set(hook, existing);
  }

  async emit(hook: string, payload: unknown): Promise<void> {
    const handlers = this.handlers.get(hook);
    if (!handlers || handlers.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      handlers.map(async ({ handler }) => {
        await handler(payload);
      }),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const pluginId = handlers[index]?.pluginId ?? 'unknown';
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.warn(`[Plugins] Hook "${hook}" failed for ${pluginId}: ${message}`);
      }
    });
  }

  remove(pluginId: string): void {
    for (const [hook, handlers] of this.handlers.entries()) {
      const filtered = handlers.filter((entry) => entry.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.handlers.delete(hook);
        continue;
      }
      this.handlers.set(hook, filtered);
    }
  }
}
