import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categorize,
  groupCommits,
  parseArgs,
  parseCommitLine,
  renderInitialChangelog,
  renderWindowMarkdown,
  resolveWindow,
} from './changelog-window.mjs';

test('parseArgs reads flags and rejects bad --days', () => {
  const parsed = parseArgs(['--since', '2026-06-01', '--days', '14', '--out', '-']);
  assert.equal(parsed.since, '2026-06-01');
  assert.equal(parsed.days, 14);
  assert.equal(parsed.out, '-');
  assert.throws(() => parseArgs(['--days', 'nope']), /non-negative integer/);
  assert.throws(() => parseArgs(['--days', '-3']), /non-negative integer/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});

test('resolveWindow defaults to the previous full day', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');
  const { sinceISO, untilISO } = resolveWindow({ now });
  assert.equal(untilISO, '2026-07-01T10:00:00.000Z');
  assert.equal(sinceISO, '2026-06-30T10:00:00.000Z');
});

test('resolveWindow honors --days and explicit --since', () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  assert.equal(resolveWindow({ days: 14, now }).sinceISO, '2026-06-17T00:00:00.000Z');
  assert.equal(resolveWindow({ since: '2026-01-01', now }).sinceISO, '2026-01-01T00:00:00.000Z');
});

test('resolveWindow rejects invalid dates', () => {
  assert.throws(() => resolveWindow({ since: 'not-a-date' }), /Invalid/);
});

test('parseCommitLine splits the unit-separated record and ignores blanks', () => {
  const parsed = parseCommitLine('abc123\u001f2026-06-30\u001ffeat(mc): add board');
  assert.deepEqual(parsed, { sha: 'abc123', date: '2026-06-30', subject: 'feat(mc): add board' });
  assert.equal(parseCommitLine(''), null);
  assert.equal(parseCommitLine('abc123\u001f2026-06-30\u001f'), null);
});

test('categorize maps conventional prefixes, scope, breaking, and refs', () => {
  assert.equal(categorize('feat: add thing').section, 'added');
  assert.equal(categorize('fix(server): stop crash').section, 'fixed');
  assert.equal(categorize('docs: update readme').section, 'docs');
  assert.equal(categorize('chore: bump deps').section, 'internal');
  assert.equal(categorize('refactor: tidy').section, 'changed');
  assert.equal(categorize('random subject without prefix').section, 'changed');

  const scoped = categorize('feat(mc): tasks board (#8)');
  assert.equal(scoped.scope, 'mc');
  assert.equal(scoped.prNumber, '8');
  assert.equal(scoped.text, 'tasks board (#8)');

  const breaking = categorize('feat!: drop legacy api');
  assert.equal(breaking.breaking, true);
  assert.equal(breaking.section, 'changed');

  assert.equal(categorize('THE-94: add phase2 boundary release gate').linear, 'THE-94');
});

test('groupCommits buckets commits into every section key', () => {
  const groups = groupCommits([
    { sha: 'a1', date: '2026-06-30', subject: 'feat: one' },
    { sha: 'b2', date: '2026-06-30', subject: 'fix: two' },
    { sha: 'c3', date: '2026-06-30', subject: 'chore: three' },
  ]);
  assert.equal(groups.added.length, 1);
  assert.equal(groups.fixed.length, 1);
  assert.equal(groups.internal.length, 1);
  assert.equal(groups.removed.length, 0);
});

test('renderWindowMarkdown flags internal and reports totals', () => {
  const groups = groupCommits([
    { sha: 'deadbeef1', date: '2026-06-30', subject: 'feat(mc): add board (#8)' },
    { sha: 'cafef00d2', date: '2026-06-30', subject: 'chore: tidy' },
  ]);
  const md = renderWindowMarkdown(groups, {
    sinceISO: '2026-06-29T00:00:00.000Z',
    untilISO: '2026-06-30T00:00:00.000Z',
    headSha: 'deadbeef',
  });
  assert.match(md, /Commits in window: 2/);
  assert.match(md, /## Added/);
  assert.match(md, /Internal \(usually skip\)/);
  assert.match(md, /#8/);
});

test('renderWindowMarkdown handles an empty window', () => {
  const md = renderWindowMarkdown(groupCommits([]), {});
  assert.match(md, /Commits in window: 0/);
  assert.match(md, /No commits in this window/);
});

test('renderInitialChangelog emits a Keep-a-Changelog scaffold with only user-facing sections', () => {
  const groups = groupCommits([
    { sha: 'a1b2c3d', date: '2026-06-30', subject: 'feat: shiny feature' },
    { sha: 'e4f5061', date: '2026-06-30', subject: 'chore: internal only' },
  ]);
  const md = renderInitialChangelog(groups, { untilISO: '2026-07-01T00:00:00.000Z' });
  assert.match(md, /^# Changelog/);
  assert.match(md, /Keep a Changelog/);
  assert.match(md, /## 2026-07-01/);
  assert.match(md, /### Added/);
  assert.doesNotMatch(md, /### Internal/);
});

test('renderInitialChangelog records a no-change entry when nothing is user-facing', () => {
  const md = renderInitialChangelog(groupCommits([
    { sha: 'a1', date: '2026-06-30', subject: 'chore: internal only' },
  ]));
  assert.match(md, /No user-facing changes/);
});
