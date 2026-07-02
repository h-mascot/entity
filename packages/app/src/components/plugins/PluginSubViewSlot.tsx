import { Suspense, useEffect, useMemo } from 'react';
import { usePluginStore } from '../../stores/pluginStore';
import { resolvePluginComponent } from './componentRegistry';

interface PluginSubViewSlotProps {
  apiBase?: string;
  module: string;
  pluginId: string | null;
}

export default function PluginSubViewSlot({ apiBase = '', module, pluginId }: PluginSubViewSlotProps) {
  const plugins = usePluginStore((state) => state.plugins);
  const initialized = usePluginStore((state) => state.initialized);
  const loading = usePluginStore((state) => state.loading);
  const fetchPlugins = usePluginStore((state) => state.fetchPlugins);

  useEffect(() => {
    if (!initialized && !loading) {
      void fetchPlugins(apiBase);
    }
  }, [apiBase, fetchPlugins, initialized, loading]);

  const plugin = useMemo(
    () =>
      plugins.find(
        (candidate) =>
          candidate.id === pluginId &&
          candidate.enabled &&
          candidate.mountPoint.type === 'module-sub-view' &&
          candidate.mountPoint.module === module,
      ) ?? null,
    [module, pluginId, plugins],
  );

  if (!pluginId) {
    return null;
  }

  if (!plugin) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6">
        <div className="mc-shell-card max-w-xl border border-[var(--border-secondary)] p-5 text-center">
          <div className="text-sm font-medium text-[var(--text-primary)]">Plugin view unavailable</div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            This plugin is disabled, missing, or no longer registered for the {module} module.
          </div>
        </div>
      </div>
    );
  }

  const Component = resolvePluginComponent(plugin.component);
  if (!Component) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6">
        <div className="mc-shell-card max-w-xl border border-[var(--border-secondary)] p-5 text-center">
          <div className="text-sm font-medium text-[var(--text-primary)]">{plugin.label}</div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            The UI component "{plugin.component}" is not registered in the app bundle.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto">
      <Suspense fallback={null}>
        <Component plugin={plugin} apiBase={apiBase} />
      </Suspense>
    </div>
  );
}
