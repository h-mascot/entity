import { describe, expect, it } from 'vitest';
import { acquireFileMutationGuard, FileMutationConflictError } from './mutation-guard';

describe('file mutation admission', () => {
  it('allows concurrent creations and excludes moves until every creator releases', () => {
    const first = acquireFileMutationGuard('create');
    const second = acquireFileMutationGuard('create');
    try {
      expect(() => acquireFileMutationGuard('move')).toThrow(FileMutationConflictError);
      first();
      first();
      expect(() => acquireFileMutationGuard('move')).toThrow(FileMutationConflictError);
    } finally {
      first();
      second();
    }
    acquireFileMutationGuard('move')();
  });

  it('excludes creations and other moves until a move releases', () => {
    const release = acquireFileMutationGuard('move');
    try {
      expect(() => acquireFileMutationGuard('create')).toThrow(FileMutationConflictError);
      expect(() => acquireFileMutationGuard('move')).toThrow(FileMutationConflictError);
    } finally {
      release();
    }
    acquireFileMutationGuard('create')();
    acquireFileMutationGuard('move')();
  });
});
