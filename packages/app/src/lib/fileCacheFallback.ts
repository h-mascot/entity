export function shouldUseOfflineFileCache(status: number | null): boolean {
  return status === null || status >= 500;
}
