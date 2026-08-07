import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVisibleWorkspaceFallbackUrl,
  DEFAULT_WORKSPACE_MODULE_VISIBILITY,
  getFirstVisibleWorkspaceTab,
  getNavigationGroups,
  getVisibleWorkspaceTabs,
  normalizeWorkspaceModuleVisibility,
  resolveVisibleWorkspaceTab,
  resolveWorkspaceGroup,
  shouldApplyWorkspaceNavigationSettingsResponse,
} from './workspaceNavigation.js';

test('workspace navigation groups related modules and keeps Admin available', () => {
  const groups = getNavigationGroups(DEFAULT_WORKSPACE_MODULE_VISIBILITY);

  assert.deepEqual(groups.map((group) => group.label), ['Workspace', 'Work', 'Team', 'Admin']);
  assert.deepEqual(groups[0]?.tabs.map((tab) => tab.id), ['files', 'chat']);
  assert.deepEqual(groups[1]?.tabs.map((tab) => tab.id), ['tasks', 'services']);
  assert.deepEqual(groups[2]?.tabs.map((tab) => tab.id), ['agents']);
  assert.deepEqual(groups[3]?.tabs.map((tab) => tab.id), ['admin']);
});

test('hidden modules are removed while Admin cannot be hidden', () => {
  const visibility = normalizeWorkspaceModuleVisibility({
    files: false,
    chat: false,
    tasks: true,
    services: false,
    agents: false,
    terminal: false,
    admin: false,
  });

  assert.equal(visibility.admin, true);
  assert.equal(visibility.terminal, false);
  assert.deepEqual(getVisibleWorkspaceTabs(visibility), ['tasks', 'admin']);
  assert.equal(getFirstVisibleWorkspaceTab(visibility), 'tasks');
});

test('navigation falls back to Admin when every optional workspace module is hidden', () => {
  const visibility = normalizeWorkspaceModuleVisibility({
    files: false,
    chat: false,
    tasks: false,
    services: false,
    agents: false,
    terminal: false,
  });

  assert.deepEqual(getVisibleWorkspaceTabs(visibility), ['admin']);
  assert.equal(getFirstVisibleWorkspaceTab(visibility), 'admin');
  assert.equal(resolveWorkspaceGroup('admin'), 'admin');
});

test('hidden route and programmatic navigation requests resolve to the first visible module', () => {
  const visibility = normalizeWorkspaceModuleVisibility({
    files: false,
    chat: false,
    tasks: true,
    services: false,
    agents: false,
  });

  assert.equal(resolveVisibleWorkspaceTab('files', visibility), 'tasks');
  assert.equal(resolveVisibleWorkspaceTab('chat', visibility), 'tasks');
  assert.equal(resolveVisibleWorkspaceTab('tasks', visibility), 'tasks');
  assert.equal(resolveVisibleWorkspaceTab('admin', visibility), 'admin');
});

test('stored partial settings inherit visible defaults for backward compatibility', () => {
  const visibility = normalizeWorkspaceModuleVisibility({ chat: false });

  assert.equal(visibility.chat, false);
  assert.equal(visibility.files, true);
  assert.equal(visibility.tasks, true);
  assert.equal(visibility.terminal, true);
});

test('hidden-route fallback preserves unrelated URL state while replacing the module route', () => {
  const resolved = new URL(buildVisibleWorkspaceFallbackUrl(
    'https://entity.local/task/123?scope=mine&tab=tasks#context',
    'chat',
  ));

  assert.equal(resolved.pathname, '/');
  assert.equal(resolved.searchParams.get('tab'), 'chat');
  assert.equal(resolved.searchParams.get('scope'), 'mine');
  assert.equal(resolved.hash, '#context');
});

test('stale initial navigation settings cannot override a newer admin update', () => {
  assert.equal(shouldApplyWorkspaceNavigationSettingsResponse(0, 0), true);
  assert.equal(shouldApplyWorkspaceNavigationSettingsResponse(0, 1), false);
  assert.equal(shouldApplyWorkspaceNavigationSettingsResponse(2, 2), true);
});
