export function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return true;
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('enoent') ||
    normalized.includes('no such file') ||
    normalized.includes('does not exist') ||
    normalized.includes('not found') ||
    /(?:^|\D)404(?:\D|$)/.test(normalized)
  );
}
