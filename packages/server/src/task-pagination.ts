export interface TaskPagination {
  limit: number | null;
  offset: number;
}

export interface TaskPaginationMeta extends TaskPagination {
  count: number;
  total: number;
  hasMore: boolean;
}

export interface TaskPaginationError {
  error: string;
}

const DEFAULT_LIMIT = null;
const DEFAULT_OFFSET = 0;

function parseInteger(
  rawValue: unknown,
  {
    defaultValue,
    minimum,
    errorMessage,
  }: {
    defaultValue: number | null;
    minimum: number;
    errorMessage: string;
  }
): number | null | TaskPaginationError {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    return { error: errorMessage };
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < minimum) {
    return { error: errorMessage };
  }

  return parsedValue;
}

export function parseTaskPaginationQuery(query: Record<string, unknown>): TaskPagination | TaskPaginationError {
  const parsedLimit = parseInteger(query.limit, {
    defaultValue: DEFAULT_LIMIT,
    minimum: 1,
    errorMessage: 'limit must be a positive integer',
  });

  if (parsedLimit !== null && typeof parsedLimit !== 'number') {
    return parsedLimit;
  }

  const parsedOffset = parseInteger(query.offset, {
    defaultValue: DEFAULT_OFFSET,
    minimum: 0,
    errorMessage: 'offset must be a non-negative integer',
  });

  if (parsedOffset === null || typeof parsedOffset !== 'number') {
    return parsedOffset ?? { error: 'offset must be a non-negative integer' };
  }

  return {
    limit: parsedLimit,
    offset: parsedOffset,
  };
}

export function paginateTasks<T>(tasks: T[], pagination: TaskPagination): T[] {
  if (pagination.limit === null) {
    return tasks.slice(pagination.offset);
  }
  return tasks.slice(pagination.offset, pagination.offset + pagination.limit);
}

export function buildTaskPaginationMeta(total: number, pagination: TaskPagination, count: number): TaskPaginationMeta {
  return {
    ...pagination,
    count,
    total,
    hasMore: pagination.offset + count < total,
  };
}
