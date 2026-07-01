import { describe, expect, it } from 'vitest';
import { MAX_TASK_LIMIT, buildTaskPaginationMeta, paginateTasks, parseTaskPaginationQuery } from './task-pagination';

describe('task pagination helpers', () => {
  it('uses the default pagination when query params are omitted', () => {
    expect(parseTaskPaginationQuery({})).toEqual({ limit: null, offset: 0 });
  });

  it('parses explicit pagination values', () => {
    expect(parseTaskPaginationQuery({ limit: '25', offset: '10' })).toEqual({ limit: 25, offset: 10 });
  });

  it('caps explicit limit values at the hard maximum', () => {
    expect(parseTaskPaginationQuery({ limit: String(MAX_TASK_LIMIT + 1) })).toEqual({ limit: MAX_TASK_LIMIT, offset: 0 });
  });

  it('rejects invalid limit values', () => {
    expect(parseTaskPaginationQuery({ limit: '-1' })).toEqual({ error: 'limit must be a positive integer' });
    expect(parseTaskPaginationQuery({ limit: 'abc' })).toEqual({ error: 'limit must be a positive integer' });
  });

  it('rejects invalid offset values', () => {
    expect(parseTaskPaginationQuery({ offset: '-1' })).toEqual({ error: 'offset must be a non-negative integer' });
    expect(parseTaskPaginationQuery({ offset: '1.5' })).toEqual({ error: 'offset must be a non-negative integer' });
  });

  it('caps default unbounded pagination at the hard maximum', () => {
    const tasks = Array.from({ length: MAX_TASK_LIMIT + 2 }, (_, index) => `task-${index}`);
    const pagination = parseTaskPaginationQuery({ offset: '1' });
    expect(pagination).toEqual({ limit: null, offset: 1 });
    if ('error' in pagination) throw new Error(pagination.error);

    const paginatedTasks = paginateTasks(tasks, pagination);

    expect(paginatedTasks).toHaveLength(MAX_TASK_LIMIT);
    expect(paginatedTasks[0]).toBe('task-1');
    expect(paginatedTasks[paginatedTasks.length - 1]).toBe(`task-${MAX_TASK_LIMIT}`);
    expect(buildTaskPaginationMeta(tasks.length, pagination, paginatedTasks.length)).toEqual({
      limit: null,
      offset: 1,
      count: MAX_TASK_LIMIT,
      total: MAX_TASK_LIMIT + 2,
      hasMore: true,
    });
  });

  it('paginates tasks and exposes pagination metadata', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e'];
    const pagination = { limit: 2, offset: 1 };
    const paginatedTasks = paginateTasks(tasks, pagination);

    expect(paginatedTasks).toEqual(['b', 'c']);
    expect(buildTaskPaginationMeta(tasks.length, pagination, paginatedTasks.length)).toEqual({
      limit: 2,
      offset: 1,
      count: 2,
      total: 5,
      hasMore: true,
    });
  });
});
