/** Pure helpers for the Doc Intelligence panel (linked tasks + related docs). */

export interface DocLinkedTaskCandidate {
  id: number;
  name: string;
  description?: string | null;
  output?: string | null;
  column?: string;
  assignee?: string;
}

function normalize(value: string): string {
  return value.toLowerCase();
}

export function docFilename(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function docFilenameStem(path: string): string {
  const filename = docFilename(path);
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
}

/**
 * Tasks reference documents as free text in name/description/output (often as
 * /docs/... links). A task is "linked" when it mentions the doc path or its
 * filename. Filename-only matches require a reasonably distinctive name to
 * avoid noise (e.g. "readme.md" appearing everywhere is accepted; "a.md" is not).
 */
export function findTasksReferencingDoc<T extends DocLinkedTaskCandidate>(
  tasks: readonly T[],
  docPath: string | null | undefined,
): T[] {
  const path = docPath?.trim();
  if (!path) {
    return [];
  }

  const normalizedPath = normalize(path);
  const filename = normalize(docFilename(path));
  const filenameDistinctive = filename.length >= 8;

  return tasks.filter((task) => {
    const haystack = normalize(
      [task.name, task.description ?? '', task.output ?? ''].join('\n'),
    );

    if (haystack.includes(normalizedPath)) {
      return true;
    }

    return filenameDistinctive && haystack.includes(filename);
  });
}

export interface RelatedDocResult {
  sourceId: string;
  path: string;
  sourceName?: string;
}

/**
 * Filters raw fs-search results into "related documents": excludes the current
 * document itself and de-duplicates by source+path.
 */
export function filterRelatedDocResults<T extends RelatedDocResult>(
  results: readonly T[],
  currentPath: string | null | undefined,
  limit = 8,
): T[] {
  const current = currentPath ? normalize(currentPath) : null;
  const seen = new Set<string>();
  const related: T[] = [];

  for (const result of results) {
    if (!result?.path) {
      continue;
    }
    if (current && normalize(result.path) === current) {
      continue;
    }
    const key = `${result.sourceId}::${result.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    related.push(result);
    if (related.length >= limit) {
      break;
    }
  }

  return related;
}
