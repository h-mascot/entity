export type WorkspaceTab = 'files' | 'agents' | 'tasks' | 'services' | 'chat' | 'admin';
export type WorkspaceModuleId = Exclude<WorkspaceTab, 'admin'> | 'terminal';
export type WorkspaceNavigationGroupId = 'workspace' | 'work' | 'team' | 'admin';

export type WorkspaceModuleVisibility = Record<WorkspaceModuleId, boolean> & {
  admin: true;
};

export interface WorkspaceNavigationTab {
  id: WorkspaceTab;
  label: string;
}

export interface WorkspaceNavigationGroup {
  id: WorkspaceNavigationGroupId;
  label: string;
  tabs: WorkspaceNavigationTab[];
}

export const DEFAULT_WORKSPACE_MODULE_VISIBILITY: WorkspaceModuleVisibility = {
  files: true,
  tasks: true,
  agents: true,
  services: true,
  chat: true,
  terminal: true,
  admin: true,
};

const NAVIGATION_GROUPS: readonly WorkspaceNavigationGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    tabs: [
      { id: 'files', label: 'Files' },
      { id: 'chat', label: 'Chat' },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    tabs: [
      { id: 'tasks', label: 'Tasks' },
      { id: 'services', label: 'Services' },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    tabs: [{ id: 'agents', label: 'Agents' }],
  },
  {
    id: 'admin',
    label: 'Admin',
    tabs: [{ id: 'admin', label: 'Admin' }],
  },
] as const;

export function normalizeWorkspaceModuleVisibility(value: unknown): WorkspaceModuleVisibility {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    files: typeof record.files === 'boolean' ? record.files : true,
    tasks: typeof record.tasks === 'boolean' ? record.tasks : true,
    agents: typeof record.agents === 'boolean' ? record.agents : true,
    services: typeof record.services === 'boolean' ? record.services : true,
    chat: typeof record.chat === 'boolean' ? record.chat : true,
    terminal: typeof record.terminal === 'boolean' ? record.terminal : true,
    admin: true,
  };
}

export function isWorkspaceTabVisible(
  tab: WorkspaceTab,
  visibility: WorkspaceModuleVisibility,
): boolean {
  return tab === 'admin' || visibility[tab];
}

export function getVisibleWorkspaceTabs(visibility: WorkspaceModuleVisibility): WorkspaceTab[] {
  return NAVIGATION_GROUPS.flatMap((group) => group.tabs)
    .map((tab) => tab.id)
    .filter((tab) => isWorkspaceTabVisible(tab, visibility));
}

export function getFirstVisibleWorkspaceTab(visibility: WorkspaceModuleVisibility): WorkspaceTab {
  return getVisibleWorkspaceTabs(visibility)[0] ?? 'admin';
}

export function resolveVisibleWorkspaceTab(
  requestedTab: WorkspaceTab,
  visibility: WorkspaceModuleVisibility,
): WorkspaceTab {
  return isWorkspaceTabVisible(requestedTab, visibility)
    ? requestedTab
    : getFirstVisibleWorkspaceTab(visibility);
}

export function buildVisibleWorkspaceFallbackUrl(
  currentUrl: string,
  fallbackTab: WorkspaceTab,
): string {
  const nextUrl = new URL(currentUrl);
  nextUrl.pathname = '/';
  nextUrl.searchParams.delete('tab');
  if (fallbackTab !== 'files') {
    nextUrl.searchParams.set('tab', fallbackTab);
  }
  return nextUrl.toString();
}

export function shouldApplyWorkspaceNavigationSettingsResponse(
  requestRevision: number,
  currentRevision: number,
): boolean {
  return requestRevision === currentRevision;
}

export function getNavigationGroups(
  visibility: WorkspaceModuleVisibility,
): WorkspaceNavigationGroup[] {
  return NAVIGATION_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => isWorkspaceTabVisible(tab.id, visibility)),
  })).filter((group) => group.tabs.length > 0);
}

export function resolveWorkspaceGroup(tab: WorkspaceTab): WorkspaceNavigationGroupId {
  return NAVIGATION_GROUPS.find((group) => group.tabs.some((candidate) => candidate.id === tab))?.id ?? 'admin';
}
