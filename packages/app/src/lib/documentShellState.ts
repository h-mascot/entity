export interface DocumentShellCollapseState {
  left: boolean;
  right: boolean;
}

export function getDocumentShellCollapseState(fileKey: string | null): DocumentShellCollapseState {
  const collapsed = Boolean(fileKey);
  return { left: collapsed, right: collapsed };
}
