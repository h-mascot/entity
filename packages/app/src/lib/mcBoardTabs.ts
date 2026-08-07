export const BUILTIN_MC_BOARD_TABS = [
  'kanban',
  'engineering',
  'strategic',
  'insights',
] as const;

export type BuiltInMCBoardTab = (typeof BUILTIN_MC_BOARD_TABS)[number];
export type MCBoardTab = BuiltInMCBoardTab | string;

export interface TaskModulePluginLike {
  id: string;
}

const TASK_EXECUTION_PLUGIN_IDS = new Set(['geordi-swarm']);

/**
 * Execution-only task plugins are capabilities inside task detail, not peers in
 * customizable board navigation. Filtering them here also prevents a stale
 * persisted plugin id from restoring the legacy standalone view.
 */
export function selectTaskBoardNavigationPlugins<T extends TaskModulePluginLike>(plugins: readonly T[]): T[] {
  return plugins.filter((plugin) => !TASK_EXECUTION_PLUGIN_IDS.has(plugin.id));
}

const MC_BOARD_TAB_LABELS: Record<BuiltInMCBoardTab, string> = {
  kanban: 'Kanban',
  engineering: 'Engineering',
  strategic: 'Strategic',
  insights: 'Insights',
};

export function isBuiltInMCBoardTab(value: string): value is BuiltInMCBoardTab {
  return (BUILTIN_MC_BOARD_TABS as readonly string[]).includes(value);
}

export function getMCBoardTabLabel(tab: BuiltInMCBoardTab): string {
  return MC_BOARD_TAB_LABELS[tab];
}

export function isMobileMCBoardTabActive(
  currentTab: MCBoardTab,
  candidateTab: Extract<BuiltInMCBoardTab, 'kanban' | 'engineering'>,
): boolean {
  return currentTab === candidateTab;
}

export function normalizeStoredMCBoardTab(value: string | null): MCBoardTab {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return 'kanban';
  }

  return normalized === 'ops' ? 'kanban' : normalized;
}
