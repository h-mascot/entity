import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const taskDetailSource = readFileSync(
  new URL('./TaskDetailPanel.tsx', import.meta.url),
  'utf8',
);

test('task detail exposes Handoffs as a first-class section destination', () => {
  assert.match(taskDetailSource, /type DetailTab = [^;]*'handoffs'/);
  assert.match(taskDetailSource, /label: 'Handoffs', tab: 'handoffs' as const/);
  assert.match(taskDetailSource, /detailTab === 'handoffs'[^?]*\?\s*\(\s*<TaskHandoffSection/s);
});
