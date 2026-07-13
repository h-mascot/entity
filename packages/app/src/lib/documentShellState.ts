export interface DocumentShellCollapseState {
  left: boolean;
  right: boolean;
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
