export type QuickSwitcherTargetPane = 'left' | 'right';

/**
 * Select the organization used by Quick Switcher search and selection.
 * A right pane inherits the left scope only while it has no own scope.
 */
export function resolveQuickSwitcherOrgId(
  targetPane: QuickSwitcherTargetPane,
  rightPaneOrgId: string | null | undefined,
  currentFileOrgId: string | null | undefined,
): string | undefined {
  const current = currentFileOrgId?.trim() || undefined;
  if (targetPane !== 'right') return current;
  return rightPaneOrgId?.trim() || current;
}
