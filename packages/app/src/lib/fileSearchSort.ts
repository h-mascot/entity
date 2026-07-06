/** Sorting for Unified File Dashboard search results. */

export type FileResultSort = 'relevance' | 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'type';

export const FILE_SORT_OPTIONS: Array<{ id: FileResultSort; label: string }> = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name-asc', label: 'Name A–Z' },
  { id: 'name-desc', label: 'Name Z–A' },
  { id: 'type', label: 'Type' },
];

export interface SortableFileResult {
  title?: string | null;
  path?: string | null;
  type?: string | null;
  modifiedAt?: string | null;
  updatedAt?: string | null;
}

function resultTimestamp(result: SortableFileResult): number {
  const dateValue = result.modifiedAt ?? result.updatedAt;
  if (!dateValue) return 0;
  const parsed = Date.parse(dateValue);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resultName(result: SortableFileResult): string {
  return (result.title || result.path || '').toLowerCase();
}

/** 'relevance' preserves the server's ranking; everything else is a stable client-side sort. */
export function sortSearchResults<T extends SortableFileResult>(results: readonly T[], sort: FileResultSort): T[] {
  if (sort === 'relevance') {
    return [...results];
  }

  return [...results].sort((a, b) => {
    switch (sort) {
      case 'newest':
        return resultTimestamp(b) - resultTimestamp(a);
      case 'oldest':
        return resultTimestamp(a) - resultTimestamp(b);
      case 'name-asc':
        return resultName(a).localeCompare(resultName(b));
      case 'name-desc':
        return resultName(b).localeCompare(resultName(a));
      case 'type':
        return (a.type || '').localeCompare(b.type || '') || resultName(a).localeCompare(resultName(b));
      default:
        return 0;
    }
  });
}
