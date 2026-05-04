#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const enforce = process.argv.includes('--enforce');
const json = process.argv.includes('--json');
const now = new Date().toISOString();

const scannedRoots = [
  'packages/app/src',
  'packages/server/src',
  'packages/db/src',
  'scripts',
  'deploy.sh',
  'dev.sh',
  'README.md',
  'docs/config',
  'entity.config.example.yaml',
  '.env.example',
].map((p) => path.join(repoRoot, p));

const excludedPathParts = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
]);

const allowedExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.md', '.sh', '.env', '.example', ''
]);

const privatePatterns = [
  { id: 'enterprise-user-path', re: /\/Users\/enterprise\b/g, severity: 'error' },
  { id: 'henry-home-path', re: /\/home\/henrymascot\b/g, severity: 'error' },
  { id: 'jamify-home-path', re: /\/home\/jamify\b/g, severity: 'error' },
  { id: 'enterprise-ssh-target', re: /\benterprise@(?:[\w.-]+|\d+\.\d+\.\d+\.\d+)\b/g, severity: 'error' },
  { id: 'tailnet-ip-100', re: /\b100\.(?:\d{1,3}\.){2}\d{1,3}\b/g, severity: 'warn' },
  { id: 'enterprise-name', re: /\bEnterprise\b/g, severity: 'warn' },
  { id: 'henry-name', re: /\bHenry(?: Mascot)?\b/g, severity: 'warn' },
  { id: 'enterprise-agent-name', re: /\b(?:Ada|Spock|Scotty|Zora|Midas|Uhura|Geordi|Book)\b/g, severity: 'warn' },
  { id: 'clawd-workspace-name', re: /\bclawd(?:-[A-Za-z0-9_-]+)?\b/g, severity: 'warn' },
];

function shouldSkip(filePath) {
  const rel = path.relative(repoRoot, filePath);
  const parts = rel.split(path.sep);
  if (parts.some((part) => excludedPathParts.has(part))) return true;
  if (rel.startsWith('docs/plans/') || rel.startsWith('docs/specs/') || rel.startsWith('docs/reports/')) return true;
  if (rel === 'docs/config/private-default-scan.md') return true;
  return false;
}

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return shouldSkip(target) ? [] : [target];
  if (!stat.isDirectory() || shouldSkip(target)) return [];
  const out = [];
  for (const entry of fs.readdirSync(target)) {
    out.push(...walk(path.join(target, entry)));
  }
  return out;
}

function extAllowed(filePath) {
  const base = path.basename(filePath);
  if (base === '.env.example' || base.endsWith('.env')) return true;
  return allowedExtensions.has(path.extname(filePath));
}

const files = [...new Set(scannedRoots.flatMap(walk))].filter(extAllowed);
const findings = [];

for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const pattern of privatePatterns) {
      pattern.re.lastIndex = 0;
      if (pattern.re.test(line)) {
        findings.push({
          id: pattern.id,
          severity: pattern.severity,
          file: path.relative(repoRoot, file),
          line: idx + 1,
          excerpt: line.trim().slice(0, 240),
        });
      }
    }
  });
}

const counts = findings.reduce((acc, f) => {
  acc[f.severity] = (acc[f.severity] || 0) + 1;
  acc[f.id] = (acc[f.id] || 0) + 1;
  return acc;
}, {});

const result = {
  generatedAt: now,
  scannedFiles: files.length,
  findingCount: findings.length,
  counts,
  enforce,
  findings,
};

const reportDir = path.join(repoRoot, 'docs', 'reports');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'private-default-scan-baseline.md');
const byFile = new Map();
for (const finding of findings) {
  const arr = byFile.get(finding.file) || [];
  arr.push(finding);
  byFile.set(finding.file, arr);
}
const md = [
  '# Private Default Scan Baseline',
  '',
  `Generated: ${now}`,
  '',
  `Scanned files: ${files.length}`,
  `Findings: ${findings.length}`,
  `Errors: ${counts.error || 0}`,
  `Warnings: ${counts.warn || 0}`,
  '',
  'This is the baseline guardrail for Entity portability work. It intentionally reports current hardcoded private defaults without failing by default. Use `npm run scan:private-defaults -- --enforce` when the allowlist has been tightened enough to block regressions.',
  '',
  '## Findings by file',
  '',
];
for (const [file, items] of [...byFile.entries()].sort()) {
  md.push(`### ${file}`, '');
  for (const item of items) {
    md.push(`- L${item.line} [${item.severity}] ${item.id}: \`${item.excerpt.replace(/`/g, '\\`')}\``);
  }
  md.push('');
}
fs.writeFileSync(reportPath, md.join('\n'));

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`[scan:private-defaults] scanned ${files.length} files; findings=${findings.length}; errors=${counts.error || 0}; warnings=${counts.warn || 0}`);
  console.log(`[scan:private-defaults] report ${path.relative(repoRoot, reportPath)}`);
}

if (enforce && findings.some((f) => f.severity === 'error')) {
  process.exit(1);
}
