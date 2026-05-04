
import test from 'node:test';
import assert from 'node:assert/strict';

import { getInitialFileRestoreState } from '../fileRestoreState.ts';

test('restores file workspace tab and edit mode together when a file is restored', () => {
  const state = getInitialFileRestoreState({
    pathname: '/',
    search: '?file=packages/app/src/App.tsx&source=repo',
    lastFilePath: null,
    savedSidebarTab: 'agents',
    savedFileWorkspaceTab: 'tasks',
    savedEditMode: 'true',
  });

  assert.deepEqual(state, {
    hasRestoredFile: true,
    sidebarTab: 'tasks',
    editMode: true,
  });
});


test('falls back to files sidebar when a file is restored from a non-file workspace tab', () => {
  const state = getInitialFileRestoreState({
    pathname: '/',
    search: '',
    lastFilePath: 'packages/app/src/App.tsx',
    savedSidebarTab: 'agents',
    savedFileWorkspaceTab: 'admin',
    savedEditMode: 'true',
  });

  assert.deepEqual(state, {
    hasRestoredFile: true,
    sidebarTab: 'files',
    editMode: true,
  });
});

test('does not restore edit mode when there is no restored file context', () => {
  const state = getInitialFileRestoreState({
    pathname: '/',
    search: '',
    lastFilePath: null,
    savedSidebarTab: 'files',
    savedFileWorkspaceTab: 'tasks',
    savedEditMode: 'true',
  });

  assert.deepEqual(state, {
    hasRestoredFile: false,
    sidebarTab: 'files',
    editMode: false,
  });
});

test('task routes still win over file restore state', () => {
  const state = getInitialFileRestoreState({
    pathname: '/task/403',
    search: '?file=packages/app/src/App.tsx',
    lastFilePath: 'packages/app/src/App.tsx',
    savedSidebarTab: 'files',
    savedFileWorkspaceTab: 'files',
    savedEditMode: 'true',
  });

  assert.deepEqual(state, {
    hasRestoredFile: false,
    sidebarTab: 'tasks',
    editMode: false,
  });
});
