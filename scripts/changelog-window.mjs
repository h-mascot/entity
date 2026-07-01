#!/usr/bin/env node
// changelog-window.mjs — deterministic input for Loop #008 (nightly changelog).
//
// Gathers the git commits in a time window and groups them into
// Keep-a-Changelog sections. It writes a reviewable "window" markdown file that
// the changelog loop agent curates into human-facing CHANGELOG.md entries.
//
// This script never edits CHANGELOG.md itself — curation stays with the agent
// (or a human) so machine noise (chore/ci/refactor) does not leak to users.
//
// Usage:
//   node scripts/changelog-window.mjs [--since <iso>] [--until <iso>]
//                                     [--days <n>] [--out <path>] [--root <dir>]
//
// Examples:
//   node scripts/changelog-window.mjs --days 1            # nightly (previous day)
//   node scripts/changelog-window.mjs --days 14 --out -   # first-run seed to stdout

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const UNIT = '\u001f'; // record field separator used in the git pretty format

// Ordered so the rendered changelog reads Added → Changed → Fixed → …
export const SECTIONS = [
  { key: 'added', title: 'Added', userFacing: true },
  { key: 'changed', title: 'Changed', userFacing: true },
  { key: 'fixed', title: 'Fixed', userFacing: true },
  { key: 'removed', title: 'Removed', userFacing: true },
  { key: 'docs', title: 'Documentation', userFacing: true },
  { key: 'internal', title: 'Internal', userFacing: false },
];

const PREFIX_TO_SECTION = {
  feat: 'added',
  feature: 'added',
  add: 'added',
  fix: 'fixed',
  bugfix: 'fixed',
  hotfix: 'fixed',
  perf: 'changed',
  refactor: 'changed',
  change: 'changed',
  update: 'changed',
  revert: 'removed',
  remove: 'removed',
  drop: 'removed',
  deprecate: 'removed',
  docs: 'docs',
  doc: 'docs',
  chore: 'internal',
  ci: 'internal',
  build: 'internal',
  test: 'internal',
  tests: 'internal',
  style: 'internal',
  deps: 'internal',
};

export function parseArgs(argv) {
  const parsed = { since: '', until: '', days: null, out: '', root: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--since') parsed.since = argv[++i] || '';
    else if (arg === '--until') parsed.until = argv[++i] || '';
    else if (arg === '--days') parsed.days = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--out') parsed.out = argv[++i] || '';
    else if (arg === '--root') parsed.root = argv[++i] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.days !== null && (!Number.isFinite(parsed.days) || parsed.days < 0)) {
    throw new Error('--days must be a non-negative integer');
  }
  return parsed;
}

// Resolve the [since, until) window as ISO strings. Precedence: explicit --since
// wins; otherwise --days back from now; otherwise the previous full day (nightly).
export function resolveWindow({ since, until, days, now = new Date() } = {}) {
  const untilDate = until ? new Date(until) : now;
  let sinceDate;
  if (since) {
    sinceDate = new Date(since);
  } else if (Number.isFinite(days)) {
    sinceDate = new Date(untilDate.getTime() - days * 24 * 60 * 60 * 1000);
  } else {
    sinceDate = new Date(untilDate.getTime() - 24 * 60 * 60 * 1000);
  }
  if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) {
    throw new Error('Invalid --since/--until date');
  }
  return { sinceISO: sinceDate.toISOString(), untilISO: untilDate.toISOString() };
}

export function parseCommitLine(line) {
  if (!line) return null;
  const [sha, date, ...rest] = line.split(UNIT);
  const subject = rest.join(UNIT);
  if (!sha || subject === undefined || subject === '') return null;
  return { sha: sha.trim(), date: (date || '').trim(), subject: subject.trim() };
}

// Map a commit subject to a changelog section + a cleaned display string.
export function categorize(subject) {
  const match = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject);
  let section = 'changed';
  let scope = '';
  let text = subject;
  let breaking = false;
  if (match) {
    const prefix = match[1].toLowerCase();
    scope = (match[2] || '').trim();
    breaking = match[3] === '!';
    text = match[4].trim();
    if (PREFIX_TO_SECTION[prefix]) section = PREFIX_TO_SECTION[prefix];
  }
  const prNumber = (/\(#(\d+)\)\s*$/.exec(text) || [])[1] || '';
  const linear = (/\b(THE-\d+)\b/.exec(subject) || [])[1] || '';
  if (breaking) section = 'changed';
  return { section, scope, text, breaking, prNumber, linear };
}

export function groupCommits(commits) {
  const groups = Object.fromEntries(SECTIONS.map((s) => [s.key, []]));
  for (const commit of commits) {
    const info = categorize(commit.subject);
    groups[info.section].push({ ...commit, ...info });
  }
  return groups;
}

function renderEntry(entry) {
  const bits = [];
  if (entry.breaking) bits.push('**BREAKING** ');
  bits.push(entry.scope ? `**${entry.scope}:** ` : '');
  bits.push(entry.text.replace(/\s*\(#\d+\)\s*$/, ''));
  const refs = [];
  if (entry.prNumber) refs.push(`#${entry.prNumber}`);
  if (entry.linear) refs.push(entry.linear);
  refs.push(entry.sha.slice(0, 7));
  return `- ${bits.join('')} (${refs.join(', ')})`;
}

export function renderWindowMarkdown(groups, meta = {}) {
  const total = Object.values(groups).reduce((n, list) => n + list.length, 0);
  const lines = [
    '# Changelog window (agent input — not the changelog itself)',
    '',
    `- Range: ${meta.sinceISO || '?'} → ${meta.untilISO || '?'}`,
    `- HEAD: ${meta.headSha || 'unknown'}`,
    `- Commits in window: ${total}`,
    '',
    'Curate the user-relevant items into `CHANGELOG.md` under a dated entry.',
    'Skip anything in **Internal** unless it changes user- or operator-visible behavior.',
    'If nothing user-facing shipped, record a "No user-facing changes" note instead.',
    '',
  ];
  for (const section of SECTIONS) {
    const list = groups[section.key];
    if (!list.length) continue;
    lines.push(`## ${section.title}${section.userFacing ? '' : ' (usually skip)'}`);
    for (const entry of list) lines.push(renderEntry(entry));
    lines.push('');
  }
  if (total === 0) lines.push('_No commits in this window._', '');
  return lines.join('\n');
}

// A Keep-a-Changelog scaffold used to seed CHANGELOG.md on first run.
export function renderInitialChangelog(groups, meta = {}) {
  const date = (meta.untilISO || new Date().toISOString()).slice(0, 10);
  const lines = [
    '# Changelog',
    '',
    'All notable, user- and operator-facing changes to Entity are recorded here.',
    'The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).',
    'Entity is pre-1.0 and not yet versioned; entries are grouped by date.',
    '',
    `## ${date}`,
    '',
  ];
  let wrote = false;
  for (const section of SECTIONS) {
    if (!section.userFacing) continue;
    const list = groups[section.key];
    if (!list.length) continue;
    wrote = true;
    lines.push(`### ${section.title}`);
    for (const entry of list) lines.push(renderEntry(entry));
    lines.push('');
  }
  if (!wrote) lines.push('- No user-facing changes.', '');
  return lines.join('\n');
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function collectCommits({ sinceISO, untilISO, root }) {
  const raw = git(
    [
      'log',
      '--no-merges',
      `--since=${sinceISO}`,
      `--until=${untilISO}`,
      `--pretty=format:%H${UNIT}%ad${UNIT}%s`,
      '--date=short',
    ],
    root,
  );
  return raw
    .split('\n')
    .map(parseCommitLine)
    .filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root || process.cwd());
  const { sinceISO, untilISO } = resolveWindow({ since: args.since, until: args.until, days: args.days });
  const commits = collectCommits({ sinceISO, untilISO, root });
  const groups = groupCommits(commits);
  const headSha = git(['rev-parse', 'HEAD'], root);
  const markdown = renderWindowMarkdown(groups, { sinceISO, untilISO, headSha });
  const target = args.out || '.loop-cache/changelog-window.md';
  if (target === '-') {
    process.stdout.write(`${markdown}\n`);
    return;
  }
  const outPath = resolve(root, target);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${markdown}\n`);
  process.stdout.write(`Wrote ${outPath} (${commits.length} commits)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
