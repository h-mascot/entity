import { useEffect, useMemo } from 'react';
import { usePluginStore } from '../../stores/pluginStore';
import { resolvePluginComponent } from './componentRegistry';

interface PluginTopLevelSlotProps {
  apiBase?: string;
  pluginId: string | null;
}

export default function PluginTopLevelSlot({ apiBase = '', pluginId }: PluginTopLevelSlotProps) {
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
          candidate.mountPoint.type === 'top-level-tab',
      ) ?? null,
    [pluginId, plugins],
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
            This top-level plugin is disabled, missing, or no longer registered in the current runtime.
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
      <Component plugin={plugin} apiBase={apiBase} />
    </div>
  );
}
