import type { TaskRecord } from '../../db/src';

export const ACTIVE_DEDUPE_COLUMNS = new Set(['todo', 'doing', 'review']);

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
  'by',
  'at',
  'from',
  'task',
]);

export interface DedupeCandidate {
  task: TaskRecord;
  score: number;
  exact: boolean;
  normalizedTitle: string;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function normalizeTaskTitle(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTitle(normalizedTitle: string): string[] {
  return unique(
    normalizedTitle
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  );
}

function toBigrams(normalizedTitle: string): string[] {
  const compact = normalizedTitle.replace(/\s+/g, '');
  if (compact.length < 2) {
    return compact ? [compact] : [];
  }

  const grams: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.push(compact.slice(index, index + 2));
  }
  return grams;
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet.values()) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function diceSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftCounts = new Map<string, number>();
  for (const gram of left) {
    leftCounts.set(gram, (leftCounts.get(gram) ?? 0) + 1);
  }

  let overlap = 0;
  for (const gram of right) {
    const count = leftCounts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      leftCounts.set(gram, count - 1);
    }
  }

  return (2 * overlap) / (left.length + right.length);
}

function combinedTitleSimilarity(leftNormalized: string, rightNormalized: string): number {
  const tokenScore = jaccardSimilarity(tokenizeTitle(leftNormalized), tokenizeTitle(rightNormalized));
  const gramScore = diceSimilarity(toBigrams(leftNormalized), toBigrams(rightNormalized));
  const containsBoost =
    leftNormalized.length >= 12 &&
    rightNormalized.length >= 12 &&
    (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized))
      ? 0.12
      : 0;

  return Math.min(1, Math.max(tokenScore, gramScore) + containsBoost);
}

export function isTaskActiveForDedupe(task: Pick<TaskRecord, 'archived' | 'column' | 'blocked'>): boolean {
  if (task.archived) {
    return false;
  }

  if (task.column === 'done') {
    return false;
  }

  if (task.blocked) {
    return true;
  }

  return ACTIVE_DEDUPE_COLUMNS.has(task.column);
}

export function findTaskDuplicateCandidates(
  title: string,
  tasks: readonly TaskRecord[],
  options: { fuzzyThreshold?: number; excludeTaskId?: number } = {}
): DedupeCandidate[] {
  const normalizedInput = normalizeTaskTitle(title);
  if (!normalizedInput) {
    return [];
  }

  const fuzzyThreshold = typeof options.fuzzyThreshold === 'number' ? options.fuzzyThreshold : 0.72;

  const candidates: DedupeCandidate[] = [];
  for (const task of tasks) {
    if (!isTaskActiveForDedupe(task)) {
      continue;
    }

    if (typeof options.excludeTaskId === 'number' && task.id === options.excludeTaskId) {
      continue;
    }

    const normalizedTaskTitle = normalizeTaskTitle(task.name ?? '');
    if (!normalizedTaskTitle) {
      continue;
    }

    const exact = normalizedTaskTitle === normalizedInput;
    const score = exact ? 1 : combinedTitleSimilarity(normalizedInput, normalizedTaskTitle);
    if (!exact && score < fuzzyThreshold) {
      continue;
    }

    candidates.push({
      task,
      score,
      exact,
      normalizedTitle: normalizedTaskTitle,
    });
  }

  return candidates.sort((left, right) => {
    if (left.exact !== right.exact) {
      return left.exact ? -1 : 1;
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    return right.task.id - left.task.id;
  });
}

function asSingleLine(input: string): string {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function buildMergeAuditNote(source: TaskRecord, target: TaskRecord): string {
  const lines = [`🔀 Merged duplicate task #${source.id} (${source.name}) into #${target.id} (${target.name}).`];

  if (source.description?.trim()) {
    lines.push(`- Source description: ${asSingleLine(source.description).slice(0, 600)}`);
  }

  if (source.brief?.trim()) {
    lines.push(`- Source brief: ${asSingleLine(source.brief).slice(0, 400)}`);
  }

  if (source.output?.trim()) {
    lines.push(`- Source output: ${asSingleLine(source.output).slice(0, 400)}`);
  }

  if (source.blocked && source.blocker_reason?.trim()) {
    lines.push(`- Source blocker: ${asSingleLine(source.blocker_reason).slice(0, 280)}`);
  }

  return lines.join('\n');
}
