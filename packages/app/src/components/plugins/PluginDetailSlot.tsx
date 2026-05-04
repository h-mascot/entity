import { useEffect, useMemo } from 'react';
import { usePluginStore } from '../../stores/pluginStore';
import { resolvePluginComponent } from './componentRegistry';

interface PluginDetailSlotProps {
  apiBase?: string;
  entity?: unknown;
  module: string;
}

export default function PluginDetailSlot({ apiBase = '', entity, module }: PluginDetailSlotProps) {
  const plugins = usePluginStore((state) => state.plugins);
  const initialized = usePluginStore((state) => state.initialized);
  const loading = usePluginStore((state) => state.loading);
  const fetchPlugins = usePluginStore((state) => state.fetchPlugins);

  useEffect(() => {
    if (!initialized && !loading) {
      void fetchPlugins(apiBase);
    }
  }, [apiBase, fetchPlugins, initialized, loading]);

  const detailPlugins = useMemo(
    () =>
      plugins.filter(
        (plugin) =>
          plugin.enabled &&
          plugin.mountPoint.type === 'detail-panel-section' &&
          plugin.mountPoint.module === module,
      ),
    [module, plugins],
  );

  if (detailPlugins.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {detailPlugins.map((plugin) => {
        const Component = resolvePluginComponent(plugin.component);
        return (
          <section key={plugin.id}>
            {Component ? (
              <Component plugin={plugin} apiBase={apiBase} entity={entity} />
            ) : (
              <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-4">
                <div className="text-sm font-medium text-[var(--text-primary)]">{plugin.label}</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  The UI component "{plugin.component}" is not registered for this detail slot.
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
