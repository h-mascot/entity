export interface DocumentShellCollapseState {
  left: boolean;
  right: boolean;
}

export interface DesktopManualCopyState {
  documentIdentity: string;
  value: string | null;
}

export type DesktopManualCopyEvent =
  | { type: 'manual-required'; documentIdentity: string; value: string }
  | { type: 'document-changed'; documentIdentity: string };

export function reduceDesktopManualCopyState(
  state: DesktopManualCopyState,
  event: DesktopManualCopyEvent,
): DesktopManualCopyState {
  if (event.type === 'document-changed') {
    return {
      documentIdentity: event.documentIdentity,
      value: null,
    };
  }
  if (event.documentIdentity !== state.documentIdentity) {
    return state;
  }
  return {
    documentIdentity: state.documentIdentity,
    value: event.value,
  };
}

export function startDocHubFragmentTargetRetry<T>({
  findTarget,
  schedule,
  onFound,
  maxAttempts = 120,
}: {
  findTarget: () => T | null;
  schedule: (retry: () => void) => void;
  onFound: (target: T) => void;
  maxAttempts?: number;
}): () => void {
  let cancelled = false;
  let attempts = 0;

  const tryFindTarget = () => {
    if (cancelled) {
      return;
    }
    attempts += 1;
    const target = findTarget();
    if (target) {
      onFound(target);
      return;
    }
    if (attempts < maxAttempts) {
      schedule(tryFindTarget);
    }
  };

  tryFindTarget();
  return () => {
    cancelled = true;
  };
}

export type MobileDocHubToolId = 'intelligence' | 'comments' | 'share' | 'audio';
export type MobileDocHubActiveToolId = MobileDocHubToolId | 'convert';

export interface MobileManualShareState {
  documentIdentity: string | null;
  value: string | null;
  sheetSessionId?: string | null;
}

export type MobileManualShareEvent =
  | { type: 'manual-required'; documentIdentity: string; value: string; sheetSessionId?: string }
  | { type: 'sheet-opened'; sheetSessionId: string }
  | { type: 'sheet-dismissed' }
  | { type: 'document-changed'; documentIdentity: string | null };

export function buildMobileDocHubDocumentIdentity(
  sourceId: string | null,
  path: string,
): string {
  return JSON.stringify([sourceId, path]);
}

export function reduceMobileManualShareState(
  state: MobileManualShareState,
  event: MobileManualShareEvent,
): MobileManualShareState {
  if (event.type === 'manual-required') {
    if (
      event.sheetSessionId !== undefined
      && state.sheetSessionId !== event.sheetSessionId
    ) {
      return state;
    }
    return {
      ...state,
      documentIdentity: event.documentIdentity,
      value: event.value,
    };
  }
  if (event.type === 'sheet-opened') {
    return {
      ...state,
      value: null,
      sheetSessionId: event.sheetSessionId,
    };
  }
  if (event.type === 'document-changed') {
    const nextState: MobileManualShareState = {
      documentIdentity: event.documentIdentity,
      value: null,
    };
    if ('sheetSessionId' in state) {
      nextState.sheetSessionId = null;
    }
    return nextState;
  }
  const nextState: MobileManualShareState = {
    ...state,
    value: null,
  };
  if ('sheetSessionId' in state) {
    nextState.sheetSessionId = null;
  }
  return nextState;
}

export interface MobileDocHubToolsModel {
  trigger: {
    label: string;
    accessibleName: string;
    icon: string;
  };
  sheet: {
    kind: 'bottom-sheet';
    accessibleName: string;
    documentIdentity: {
      label: string;
      value: string;
    };
    actions: Array<{
      id: MobileDocHubToolId;
      label: string;
      accessibleName: string;
      icon: string;
      active: boolean;
    } & (
      | {
          availability: 'enabled';
          onSelect: () => void | Promise<void>;
        }
      | {
          availability: 'unavailable';
          unavailableReason: string;
        }
    )>;
  };
}

export function buildMobileDocHubToolsModel(
  documentPath: string,
  handlers: {
    intelligenceConvert?: () => void | Promise<void>;
    comments?: () => void | Promise<void>;
    share?: () => void | Promise<void>;
    audio?: () => void | Promise<void>;
  } = {},
  options: {
    activeTool?: MobileDocHubActiveToolId | null;
  } = {},
): MobileDocHubToolsModel {
  const isActive = (actionId: MobileDocHubToolId) => (
    actionId === 'intelligence'
      ? options.activeTool === 'intelligence' || options.activeTool === 'convert'
      : options.activeTool === actionId
  );

  return {
    trigger: {
      label: 'Tools',
      accessibleName: 'Open document tools',
      icon: '✦',
    },
    sheet: {
      kind: 'bottom-sheet',
      accessibleName: 'Document tools',
      documentIdentity: {
        label: 'Current document',
        value: documentPath,
      },
      actions: [
        handlers.intelligenceConvert
          ? {
              id: 'intelligence',
              label: 'Intelligence / Convert',
              accessibleName: 'Open Intelligence and Convert',
              icon: '✦',
              active: isActive('intelligence'),
              availability: 'enabled',
              onSelect: handlers.intelligenceConvert,
            }
          : {
              id: 'intelligence',
              label: 'Intelligence / Convert',
              accessibleName: 'Intelligence and Convert tools unavailable',
              icon: '✦',
              active: isActive('intelligence'),
              availability: 'unavailable',
              unavailableReason: 'Mobile Convert is being connected.',
            },
        handlers.comments
          ? {
              id: 'comments',
              label: 'Comments',
              accessibleName: 'Open document comments',
              icon: '◌',
              active: isActive('comments'),
              availability: 'enabled',
              onSelect: handlers.comments,
            }
          : {
              id: 'comments',
              label: 'Comments',
              accessibleName: 'Document comments unavailable',
              icon: '◌',
              active: isActive('comments'),
              availability: 'unavailable',
              unavailableReason: 'Comments are unavailable for this document.',
            },
        handlers.share
          ? {
              id: 'share',
              label: 'Share / Copy',
              accessibleName: 'Share or copy document link',
              icon: '↗',
              active: isActive('share'),
              availability: 'enabled',
              onSelect: handlers.share,
            }
          : {
              id: 'share',
              label: 'Share / Copy',
              accessibleName: 'Share or copy document link unavailable',
              icon: '↗',
              active: isActive('share'),
              availability: 'unavailable',
              unavailableReason: 'Sharing is unavailable for this document.',
            },
        handlers.audio
          ? {
              id: 'audio',
              label: 'Listen / Audio',
              accessibleName: 'Listen to current document',
              icon: '▶',
              active: isActive('audio'),
              availability: 'enabled',
              onSelect: handlers.audio,
            }
          : {
              id: 'audio',
              label: 'Listen / Audio',
              accessibleName: 'Listen to document unavailable',
              icon: '▶',
              active: isActive('audio'),
              availability: 'unavailable',
              unavailableReason: 'Audio is unavailable for this document.',
            },
      ],
    },
  };
}

export function getDocumentShellCollapseState(fileKey: string | null): DocumentShellCollapseState {
  const collapsed = Boolean(fileKey);
  return { left: collapsed, right: collapsed };
}

export function shouldShowDocumentRightRail(
  context: {
    agentNativeEditorEnabled: boolean;
    documentsReady: boolean;
  },
): boolean {
  // Intelligence, tasks, metadata, and notes remain useful without document
  // collaboration. Keep the rail mounted so Comments can explain why it is
  // unavailable instead of removing every document tool with it.
  return context.agentNativeEditorEnabled;
}
