export function buildFileLoadKey(sourceId: string | null, filePath: string): string {
  return JSON.stringify([sourceId, filePath]);
}
