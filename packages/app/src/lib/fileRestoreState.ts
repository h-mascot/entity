
export type WorkspaceTab = 'files' | 'agents' | 'tasks' | 'services' | 'chat' | 'admin';

export const VALID_WORKSPACE_TABS: readonly WorkspaceTab[] = ['files', 'agents', 'tasks', 'services', 'chat', 'admin'];
export const VALID_FILE_WORKSPACE_TABS: readonly WorkspaceTab[] = ['files', 'tasks'];

export interface InitialFileRestoreStateInput {
  pathname: string;
  search: string;
  lastFilePath: string | null;
  savedSidebarTab: string | null;
  savedFileWorkspaceTab: string | null;
  savedEditMode: string | null;
}

export interface InitialFileRestoreState {
  hasRestoredFile: boolean;
  sidebarTab: WorkspaceTab;
  editMode: boolean;
}

export function extractTaskRouteId(pathname: string): number | null {
  const taskMatch = pathname.match(/^\/task\/(\d+)/);
  if (!taskMatch) {
    return null;
  }

  const taskId = Number(taskMatch[1]);
  return Number.isFinite(taskId) ? taskId : null;
}

export function getInitialFileRestoreState(input: InitialFileRestoreStateInput): InitialFileRestoreState {
  const routeTaskId = extractTaskRouteId(input.pathname);
  if (routeTaskId !== null) {
    return {
      hasRestoredFile: false,
      sidebarTab: 'tasks',
      editMode: false,
    };
  }

  const params = new URLSearchParams(input.search);
  const hasRestoredFile = Boolean(params.get('file') || input.lastFilePath);
  const savedFileWorkspaceTab = input.savedFileWorkspaceTab as WorkspaceTab | null;
  const savedSidebarTab = input.savedSidebarTab as WorkspaceTab | null;

  if (hasRestoredFile) {
    const restoredSidebarTab =
      savedFileWorkspaceTab && VALID_FILE_WORKSPACE_TABS.includes(savedFileWorkspaceTab)
        ? savedFileWorkspaceTab
        : 'files';

    return {
      hasRestoredFile,
      sidebarTab: restoredSidebarTab,
      editMode: input.savedEditMode === 'true',
    };
  }

  if (savedSidebarTab && VALID_WORKSPACE_TABS.includes(savedSidebarTab)) {
    return {
      hasRestoredFile,
      sidebarTab: savedSidebarTab,
      editMode: false,
    };
  }

  return {
    hasRestoredFile,
    sidebarTab: 'files',
    editMode: false,
  };
}
