#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const DEFAULT_OUT = 'output/entity-phase-2/boundary-release-gate/THE-94';

const SCAN_ROOTS = [
  'packages/app/src',
  'packages/server/src',
  'packages/db/src',
  'package.json',
];

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
]);

const RULES = [
  {
    id: 'paperclip_internal_dependency_absent',
    description: 'Paperclip must remain external and must not appear as a runtime provider, module, product, layer, or dependency.',
    regex: /\bpaperclip\b/i,
    appliesTo: () => true,
  },
  {
    id: 'curacel_specific_framing_absent',
    description: 'Curacel can be design-customer context only; product code must not hardcode Curacel repo/demo framing.',
    regex: /\b(?:curacel[-\s]+specific|curacel\s+demo|hardcode[sd]?\s+curacel|github\.com\/curacel\/entity|curacel\/entity)\b/i,
    appliesTo: () => true,
  },
  {
    id: 'helm_secrets_and_deep_admin_absent',
    description: 'Entity may show Helm status/light controls only, not Helm secrets, object browsers, or deep admin payloads.',
    regex: /(?:\/api\/helm\/objects|runtimeAdminPayload|helmObject|deploymentMutation|destructiveRuntime|helm[^;\n]*(?:secret|credential|api[-_]?key|token|password|model\s+config)|(?:secret|credential|api[-_]?key|token|password|model\s+config)[^;\n]*helm)/i,
    appliesTo: (file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'),
  },
  {
    id: 'google_docs_v1_mutation_absent',
    description: 'Google Docs/Drive V1 must remain read, index, link, and preview only.',
    regex: /(?:function\s+(?:create|update|write|export|sync)Google|(?:create|update|write|export|sync)Google(?:Doc|Drive)|google[^;\n]*mutation[^;\n]*true|mutation_capabilities[^;\n]*true)/i,
    appliesTo: (file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'),
  },
  {
    id: 'clickclack_unavailable_does_not_block_core_flows',
    description: 'ClickClack unavailable/degraded state must not block Entity docs, files, proof, review, task, or search flows.',
    regex: /clickclack[^;\n]*(?:throw\s+new\s+Error|return\s+res\.status\(5|core_flow_blocked:\s*true|coreFlowBlocked:\s*true)/i,
    appliesTo: (file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'),
  },
  {
    id: 'restricted_snippets_not_returned',
    description: 'Restricted snippets/previews/activity/evidence must not be returned in permission-denied envelopes.',
    regex: /(?:permission_state:\s*['"]restricted['"][^;\n]*snippet:\s*['"][^'"]|snippet:\s*['"][^'"]+['"][^;\n]*permission_state:\s*['"]restricted['"]|restricted:\s*true[^;\n]*preview_text:\s*['"][^'"])/i,
    appliesTo: (file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'),
  },
];

const REQUIRED_EVIDENCE = [
  {
    id: 'google_docs_readonly_tests_present',
    file: 'packages/server/src/google-docs-metadata.test.ts',
    patterns: [
      /exports read-only metadata\/open helpers, not mutation helpers/,
      /forces mutation capabilities off/,
      /does not add export\/write\/sync data/,
    ],
  },
  {
    id: 'clickclack_degraded_core_flow_tests_present',
    file: 'packages/server/src/routes/chat-degraded-core-flows.test.ts',
    patterns: [
      /keeps chat, docs\/proof, and search APIs usable when ClickClack is unavailable/,
    ],
  },
  {
    id: 'restricted_snippet_suppression_tests_present',
    file: 'packages/server/src/document-objects.test.ts',
    patterns: [
      /suppresses restricted Google snippets, previews, titles, and open URLs before output/,
      /not\.toContain\('Do not leak customer renewal snippet'\)/,
      /denies cross-org document access without leaking the object body/,
    ],
  },
  {
    id: 'helm_status_boundary_tests_present',
    file: 'packages/server/src/fs/routes-search.test.ts',
    patterns: [
      /surfaces Helm status references without exposing deep Helm object search/,
      /not\.toContain\('runtimeAdminPayload'\)/,
      /not\.toContain\('\/api\/helm\/objects'\)/,
    ],
  },
];

const NEGATIVE_FIXTURES = [
  {
    ruleId: 'paperclip_internal_dependency_absent',
    file: 'packages/server/src/swarm/providers/example.ts',
    text: "import { PaperclipProvider } from './paperclip';\n",
  },
  {
    ruleId: 'curacel_specific_framing_absent',
    file: 'packages/server/src/swarm/routes.ts',
    text: "const repo = 'https://github.com/curacel/entity';\n",
  },
  {
    ruleId: 'helm_secrets_and_deep_admin_absent',
    file: 'packages/server/src/fs/routes-search.ts',
    text: "return { helmObject: runtimeAdminPayload, deploymentMutation: true };\n",
  },
  {
    ruleId: 'google_docs_v1_mutation_absent',
    file: 'packages/server/src/google-docs-write.ts',
    text: 'export function createGoogleDoc() { return { mutation_capabilities: true }; }\n',
  },
  {
    ruleId: 'clickclack_unavailable_does_not_block_core_flows',
    file: 'packages/server/src/clickclack/proxy.ts',
    text: "if (!clickclackReady) throw new Error('ClickClack unavailable');\n",
  },
  {
    ruleId: 'restricted_snippets_not_returned',
    file: 'packages/server/src/document-objects.ts',
    text: "return { permission_state: 'restricted', snippet: 'leaked restricted content' };\n",
  },
];

function parseArgs(argv) {
  const parsed = {
    out: DEFAULT_OUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      const next = argv[index + 1];
      if (!next) throw new Error('--out requires a path');
      parsed.out = next;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  return [
    'Usage: node scripts/proof/entity-phase-2-boundary-release-gate.mjs [--out <dir>]',
    '',
    'Builds deterministic THE-94 boundary release-gate artifacts:',
    '- THE-94.boundary-release-gate.json',
    '- THE-94.summary.md',
    '- THE-94.dom-receipt.html',
  ].join('\n');
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function markdownList(values) {
  return values.map((value) => `- ${value}`).join('\n');
}

function getGitFiles() {
  const raw = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw.split('\0').filter(Boolean).sort();
}

function isInScanRoot(file) {
  return SCAN_ROOTS.some((root) => file === root || file.startsWith(`${root}/`));
}

function isTextFile(file) {
  const base = path.basename(file);
  if (base === 'package.json') return true;
  return TEXT_EXTENSIONS.has(path.extname(file));
}

function scanText(file, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (!rule.appliesTo(file)) continue;
      rule.regex.lastIndex = 0;
      if (rule.regex.test(line)) {
        findings.push({
          ruleId: rule.id,
          file,
          line: index + 1,
          excerpt: line.trim().slice(0, 240),
        });
      }
    }
  });
  return findings;
}

async function scanRepository(files) {
  const scannedFiles = [];
  const findings = [];
  const curacelLabelObservations = [];

  for (const file of files) {
    if (!isInScanRoot(file) || !isTextFile(file)) continue;
    const fullPath = path.join(repoRoot, file);
    let text;
    try {
      text = await readFile(fullPath, 'utf8');
    } catch {
      continue;
    }
    scannedFiles.push(file);
    findings.push(...scanText(file, text));

    if (/\bcuracel\b/i.test(text)) {
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/\bcuracel\b/i.test(line)) {
          curacelLabelObservations.push({
            file,
            line: index + 1,
            scope: /github\.com\/curacel\/entity|curacel\s+demo|curacel[-\s]+specific/i.test(line)
              ? 'blocking-framing'
              : 'legacy-label-or-context',
            excerpt: line.trim().slice(0, 240),
          });
        }
      });
    }
  }

  return { scannedFiles, findings, curacelLabelObservations };
}

async function checkRequiredEvidence() {
  const evidence = [];
  for (const item of REQUIRED_EVIDENCE) {
    let text = '';
    let exists = true;
    try {
      text = await readFile(path.join(repoRoot, item.file), 'utf8');
    } catch {
      exists = false;
    }
    const missingPatterns = exists
      ? item.patterns
          .map((pattern) => ({ pattern: pattern.source, matched: pattern.test(text) }))
          .filter((entry) => !entry.matched)
      : item.patterns.map((pattern) => ({ pattern: pattern.source, matched: false }));
    evidence.push({
      id: item.id,
      file: item.file,
      pass: exists && missingPatterns.length === 0,
      missingPatterns,
    });
  }
  return evidence;
}

function checkNegativeFixtures() {
  return NEGATIVE_FIXTURES.map((fixture) => {
    const findings = scanText(fixture.file, fixture.text).filter((finding) => finding.ruleId === fixture.ruleId);
    return {
      id: `${fixture.ruleId}_negative_fixture_detected`,
      ruleId: fixture.ruleId,
      pass: findings.length > 0,
      findingCount: findings.length,
    };
  });
}

function summarizeByRule(findings) {
  return findings.reduce((acc, finding) => {
    acc[finding.ruleId] = (acc[finding.ruleId] || 0) + 1;
    return acc;
  }, {});
}

function buildDomReceipt(report) {
  const rows = report.validation.checks
    .map((check) => `<li data-check="${check.id}" data-pass="${check.pass}">${check.id}: ${check.pass ? 'PASS' : 'FAIL'}</li>`)
    .join('\n        ');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <title>THE-94 Boundary Release Gate DOM Receipt</title>',
    '</head>',
    '<body data-issue="THE-94" data-proof="boundary-release-gate">',
    '  <main>',
    '    <h1>THE-94 Boundary Release Gate</h1>',
    `    <section data-step="scan" data-status="${report.validation.status}" data-files="${report.scannedFiles.length}">boundary source scan</section>`,
    `    <section data-step="findings" data-count="${report.findings.length}">blocking findings</section>`,
    `    <section data-step="evidence" data-count="${report.evidence.length}">required security proof fixtures</section>`,
    `    <section data-step="negative-fixtures" data-count="${report.negativeFixtures.length}">forbidden-drift fixtures detected</section>`,
    '    <ul data-validation="the-94">',
    `        ${rows}`,
    '    </ul>',
    '  </main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function buildSummary(report, artifactNames) {
  const failed = report.validation.checks.filter((check) => !check.pass);
  return [
    '# THE-94 Boundary Release Gate Summary',
    '',
    `- Status: ${report.validation.status}`,
    `- Generated At: ${report.generatedAt}`,
    `- Issue: ${report.issue} / ${report.source_id}`,
    `- Scanned Files: ${report.scannedFiles.length}`,
    `- Blocking Findings: ${report.findings.length}`,
    `- Baseline Observations: ${report.curacelLabelObservations.length}`,
    `- JSON Receipt: ${artifactNames.json}`,
    `- DOM Receipt: ${artifactNames.dom}`,
    `- Report Hash: ${report.reportHash}`,
    '',
    '## Boundary Checks',
    '',
    markdownList(report.validation.checks.map((check) => `${check.pass ? 'PASS' : 'FAIL'} ${check.id}`)),
    '',
    '## Blocking Findings',
    '',
    report.findings.length
      ? markdownList(report.findings.map((finding) => `${finding.ruleId} ${finding.file}:${finding.line} ${finding.excerpt}`))
      : '- none',
    '',
    '## Baseline Observations',
    '',
    report.curacelLabelObservations.length
      ? markdownList(report.curacelLabelObservations.map((entry) => `${entry.scope} ${entry.file}:${entry.line} ${entry.excerpt}`))
      : '- none',
    failed.length ? `\nFailed checks: ${failed.map((check) => check.id).join(', ')}` : '',
    '',
  ].join('\n');
}

async function buildReport() {
  const files = getGitFiles();
  const scan = await scanRepository(files);
  const evidence = await checkRequiredEvidence();
  const negativeFixtures = checkNegativeFixtures();
  const ruleCounts = summarizeByRule(scan.findings);

  const checks = [
    ...RULES.map((rule) => ({
      id: rule.id,
      pass: (ruleCounts[rule.id] || 0) === 0,
      findingCount: ruleCounts[rule.id] || 0,
      description: rule.description,
    })),
    ...evidence.map((entry) => ({
      id: entry.id,
      pass: entry.pass,
      findingCount: entry.missingPatterns.length,
      description: `Required proof fixture present in ${entry.file}`,
    })),
    {
      id: 'negative_fixtures_detect_forbidden_drift',
      pass: negativeFixtures.every((entry) => entry.pass),
      findingCount: negativeFixtures.filter((entry) => !entry.pass).length,
      description: 'The release gate detects synthetic forbidden boundary drift fixtures.',
    },
  ];

  const report = {
    issue: 'THE-94',
    source_id: 'THE-20.4',
    generatedAt: new Date().toISOString(),
    scope: 'phase2-security-privacy-boundary-release-gate',
    scanRoots: SCAN_ROOTS,
    scannedFiles: scan.scannedFiles,
    findings: scan.findings,
    findingCountsByRule: ruleCounts,
    curacelLabelObservations: scan.curacelLabelObservations,
    evidence,
    negativeFixtures,
    validation: {
      status: checks.every((check) => check.pass) ? 'PASS' : 'FAIL',
      checks,
    },
  };
  report.reportHash = sha256(JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const outDir = path.resolve(repoRoot, args.out);
  const report = await buildReport();
  const artifactNames = {
    json: 'THE-94.boundary-release-gate.json',
    summary: 'THE-94.summary.md',
    dom: 'THE-94.dom-receipt.html',
  };
  const summary = buildSummary(report, artifactNames);
  const domReceipt = buildDomReceipt(report);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, artifactNames.json), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outDir, artifactNames.summary), summary);
  await writeFile(path.join(outDir, artifactNames.dom), domReceipt);

  if (report.validation.status !== 'PASS') {
    console.error(`[THE-94] FAIL ${outDir}`);
    for (const check of report.validation.checks.filter((entry) => !entry.pass)) {
      console.error(`- ${check.id} findings=${check.findingCount}`);
    }
    process.exit(1);
  }

  console.log('[THE-94] PASS boundary release gate');
  console.log(`[THE-94] output=${path.relative(repoRoot, outDir)}`);
  console.log(`[THE-94] json=${artifactNames.json}`);
  console.log(`[THE-94] dom=${artifactNames.dom}`);
  console.log(`[THE-94] checks=${report.validation.checks.length}`);
}

main().catch((error) => {
  console.error(`[THE-94] ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
