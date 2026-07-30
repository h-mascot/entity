import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  constructorArgs: [] as unknown[],
  execCalls: [] as string[],
  pragmaCalls: [] as string[],
  closed: false,
}));

vi.mock('better-sqlite3', () => {
  class FakeDatabase {
    readonly = true;
    inTransaction = false;

    constructor(...args: unknown[]) {
      state.constructorArgs = args;
    }

    pragma(statement: string, options?: { simple?: boolean }) {
      state.pragmaCalls.push(statement);
      if (statement === 'query_only' && options?.simple) return 1;
      return undefined;
    }

    exec(statement: string) {
      state.execCalls.push(statement);
      if (statement === 'BEGIN') this.inTransaction = true;
      if (statement === 'COMMIT' || statement === 'ROLLBACK') {
        this.inTransaction = false;
      }
    }

    prepare(sql: string) {
      if (sql.includes('total_changes()')) {
        return { get: () => ({ changes: 0 }) };
      }
      return {
        get: () => undefined,
        all: () => [],
      };
    }

    close() {
      state.closed = true;
    }
  }

  return { default: FakeDatabase };
});

import { readCurrentEntitySnapshot } from './read-only-snapshot';

describe('read-only Entity snapshot adapter', () => {
  beforeEach(() => {
    state.constructorArgs = [];
    state.execCalls = [];
    state.pragmaCalls = [];
    state.closed = false;
  });

  it('opens file-must-exist read-only and pins all reads in one transaction', () => {
    const result = readCurrentEntitySnapshot('/current/entity.sqlite');

    expect(state.constructorArgs).toEqual([
      '/current/entity.sqlite',
      { readonly: true, fileMustExist: true, timeout: 5_000 },
    ]);
    expect(state.execCalls).toEqual(['BEGIN', 'COMMIT']);
    expect(state.pragmaCalls).toEqual(['query_only = ON', 'query_only']);
    expect(state.closed).toBe(true);
    expect(result.connection).toEqual({
      readonly: true,
      queryOnly: true,
      totalChanges: 0,
    });
  });
});
