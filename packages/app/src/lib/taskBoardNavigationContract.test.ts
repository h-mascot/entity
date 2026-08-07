import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectTaskBoardNavigationPlugins } from './mcBoardTabs.js';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const taskDetailSource = readFileSync(
  new URL('../components/mission-control/TaskDetailPanel.tsx', import.meta.url),
  'utf8',
);

test('Swarm is not a board-navigation peer while Run with agents remains available', () => {
  const visiblePlugins = selectTaskBoardNavigationPlugins([
    { id: 'geordi-swarm', label: 'Swarm' },
    { id: 'task-metrics', label: 'Task metrics' },
  ]);

  assert.deepEqual(visiblePlugins.map((plugin) => plugin.id), ['task-metrics']);
  assert.match(appSource, /selectTaskBoardNavigationPlugins\(\s*plugins\.filter/);
  assert.match(taskDetailSource, /aria-label="Run with agents"/);
});
