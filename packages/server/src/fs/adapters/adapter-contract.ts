import { describe, it } from 'vitest';
import type { FileSourceAdapter, SourceCapability, SourceNode } from './types';

/**
 * Shared deterministic FileSourceAdapter contract used by the GitHub and S3
 * connector suites (GQR-005). The harness runs every adapter against the same
 * behavioral clauses with fully synthetic fixtures, so connector compliance is
 * proven without any live network, credential, or external dependency.
 *
 * Contract clauses:
 *  - capabilities: the adapter advertises exactly the declared capabilities.
 *  - root-list: list('') returns the fixture's immediate root children,
 *    directories first, then files, each alphabetical by name.
 *  - subtree-scoping: list(subdirectory) returns only nodes inside that
 *    subtree (path bounds; no out-of-scope leakage).
 *  - traversal-rejected: '../' style paths are rejected for list and read.
 *  - read-known-files: every fixture file reads back with exact content.
 *  - read-unknown-file: reading a missing path rejects.
 *  - read-only: readOnly adapters reject write and mkdir.
 *  - secret-redaction: when a secret is declared, no thrown error message
 *    contains it (bearer redaction).
 */

export interface AdapterContractExpectedNode {
  path: string;
  isDirectory: boolean;
  size?: number;
}

export interface AdapterContractFixture {
  /** Immediate children of the source root the adapter must list. */
  rootTree: AdapterContractExpectedNode[];
  /** relative path -> exact file content the adapter must return. */
  files: Record<string, string>;
  /** Subdirectory used to prove path bounds on list(). */
  subdirectory: {
    path: string;
    expected: AdapterContractExpectedNode[];
  } | null;
}

export interface AdapterContractRedactionScenario {
  name: string;
  run: (adapter: FileSourceAdapter) => Promise<unknown> | unknown;
}

export interface AdapterContractOptions {
  name: string;
  createAdapter: () => FileSourceAdapter | Promise<FileSourceAdapter>;
  fixture: AdapterContractFixture;
  /** Exact capability advertisement the adapter must report. */
  capabilities: SourceCapability;
  /** When true, write() and mkdir() must reject. */
  readOnly: boolean;
  /** Secret that must never appear in any error message. */
  redactedSecret?: string;
  /** Extra operations whose rejections are scanned for secret leakage. */
  redactionScenarios?: AdapterContractRedactionScenario[];
}

export const CONTRACT_CHECK_IDS = [
  'capabilities',
  'root-list',
  'subtree-scoping',
  'traversal-rejected',
  'read-known-files',
  'read-unknown-file',
  'read-only',
  'secret-redaction',
] as const;

export type ContractCheckId = (typeof CONTRACT_CHECK_IDS)[number];

const TRAVERSAL_PROBES = ['..', '../escape.txt', 'docs/../../escape.md'];

function sortNodes(nodes: SourceNode[]): SourceNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function describeNodes(nodes: SourceNode[]): string {
  return nodes.map((node) => `${node.isDirectory ? 'd' : 'f'}:${node.path}`).join(', ');
}

async function expectRejection(runnable: () => Promise<unknown> | unknown): Promise<string | null> {
  try {
    await runnable();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message;
  }
}

interface CheckContext {
  adapter: FileSourceAdapter;
  options: AdapterContractOptions;
}

type ContractCheck = { id: ContractCheckId; run: (ctx: CheckContext) => Promise<string | null> };

async function checkCapabilities({ adapter, options }: CheckContext): Promise<string | null> {
  const actual = adapter.capabilities();
  const expected = options.capabilities;
  for (const key of Object.keys(expected) as Array<keyof SourceCapability>) {
    if (actual[key] !== expected[key]) {
      return `capabilities mismatch: ${key} advertised ${String(actual[key])}, contract requires ${String(expected[key])}`;
    }
  }
  return null;
}

async function checkRootList({ adapter, options }: CheckContext): Promise<string | null> {
  const nodes = sortNodes(await adapter.list(''));
  const actual = describeNodes(nodes);
  const expected = describeNodes(
    options.fixture.rootTree.map((node) => ({
      sourceId: '',
      path: node.path,
      name: node.path.split('/').pop() ?? node.path,
      isDirectory: node.isDirectory,
    })),
  );
  if (actual !== expected) {
    return `root listing mismatch: expected [${expected}], got [${actual}]`;
  }
  return null;
}

async function checkSubtreeScoping({ adapter, options }: CheckContext): Promise<string | null> {
  const { subdirectory } = options.fixture;
  if (!subdirectory) {
    return null;
  }
  const nodes = await adapter.list(subdirectory.path);
  const scopePrefix = `${subdirectory.path}/`;
  const outOfScope = nodes.filter((node) => !node.path.startsWith(scopePrefix));
  if (outOfScope.length > 0) {
    return `subtree listing leaked out-of-scope nodes: ${describeNodes(outOfScope)}`;
  }
  const actual = describeNodes(sortNodes(nodes));
  const expected = describeNodes(
    subdirectory.expected.map((node) => ({
      sourceId: '',
      path: node.path,
      name: node.path.split('/').pop() ?? node.path,
      isDirectory: node.isDirectory,
    })),
  );
  if (actual !== expected) {
    return `subtree listing mismatch for ${subdirectory.path}: expected [${expected}], got [${actual}]`;
  }
  return null;
}

async function checkTraversalRejected({ adapter }: CheckContext): Promise<string | null> {
  for (const probe of TRAVERSAL_PROBES) {
    const listMessage = await expectRejection(() => adapter.list(probe));
    if (listMessage === null) {
      return `traversal not rejected: list(${probe}) resolved`;
    }
    const readMessage = await expectRejection(() => adapter.read(probe));
    if (readMessage === null) {
      return `traversal not rejected: read(${probe}) resolved`;
    }
  }
  return null;
}

async function checkReadKnownFiles({ adapter, options }: CheckContext): Promise<string | null> {
  for (const [filePath, expectedContent] of Object.entries(options.fixture.files)) {
    const result = await adapter.read(filePath);
    if (result.content !== expectedContent) {
      return `known file read mismatch for ${filePath}: expected ${JSON.stringify(expectedContent)}, got ${JSON.stringify(result.content)}`;
    }
    if (!result.contentType || result.contentType.trim() === '') {
      return `known file read for ${filePath} returned no content type`;
    }
    if (typeof result.size === 'number' && result.size !== Buffer.byteLength(result.content, 'utf8')) {
      return `known file read size mismatch for ${filePath}: reported ${result.size}, content is ${Buffer.byteLength(result.content, 'utf8')} bytes`;
    }
  }
  return null;
}

async function checkReadUnknownFile({ adapter }: CheckContext): Promise<string | null> {
  const message = await expectRejection(() => adapter.read('definitely/not/present/missing-file.txt'));
  if (message === null) {
    return 'unknown file read resolved instead of rejecting';
  }
  return null;
}

async function checkReadOnly({ adapter, options }: CheckContext): Promise<string | null> {
  if (!options.readOnly) {
    return null;
  }
  const writeMessage = await expectRejection(() => adapter.write('contract-probe.txt', 'x'));
  if (writeMessage === null) {
    return 'read-only adapter accepted write()';
  }
  const mkdirMessage = await expectRejection(() => adapter.mkdir('contract-probe-dir'));
  if (mkdirMessage === null) {
    return 'read-only adapter accepted mkdir()';
  }
  return null;
}

async function checkSecretRedaction({ adapter, options }: CheckContext): Promise<string | null> {
  const secret = options.redactedSecret;
  if (!secret) {
    return null;
  }
  const scenarios = options.redactionScenarios ?? [
    { name: 'list-root', run: () => adapter.list('') },
    { name: 'read-known', run: () => adapter.read(Object.keys(options.fixture.files)[0]) },
    { name: 'read-unknown', run: () => adapter.read('definitely/not/present/missing-file.txt') },
  ];
  for (const scenario of scenarios) {
    const message = await expectRejection(() => scenario.run(adapter));
    if (message !== null && message.includes(secret)) {
      return `secret leaked in error message for scenario ${scenario.name}`;
    }
  }
  return null;
}

const CONTRACT_CHECKS: readonly ContractCheck[] = [
  { id: 'capabilities', run: checkCapabilities },
  { id: 'root-list', run: checkRootList },
  { id: 'subtree-scoping', run: checkSubtreeScoping },
  { id: 'traversal-rejected', run: checkTraversalRejected },
  { id: 'read-known-files', run: checkReadKnownFiles },
  { id: 'read-unknown-file', run: checkReadUnknownFile },
  { id: 'read-only', run: checkReadOnly },
  { id: 'secret-redaction', run: checkSecretRedaction },
];

/** Runs every contract clause and returns the observed violation descriptions. */
export async function collectAdapterContractViolations(
  options: AdapterContractOptions,
): Promise<string[]> {
  const adapter = await options.createAdapter();
  const ctx: CheckContext = { adapter, options };
  const violations: string[] = [];
  for (const check of CONTRACT_CHECKS) {
    try {
      const violation = await check.run(ctx);
      if (violation !== null) {
        violations.push(violation);
      }
    } catch (error) {
      // A clause that throws is itself a contract violation, never a
      // harness crash: record it so callers see every deviation.
      const message = error instanceof Error ? error.message : String(error);
      violations.push(`check ${check.id} threw: ${message}`);
    }
  }
  return violations;
}

/** Minimal describe/it surface so the self-test can drive suites headlessly. */
interface SuiteRegistrar {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<unknown>) => void;
}

/**
 * Registers the shared contract as a vitest describe block. Each clause runs
 * as its own test so failures pinpoint the exact broken contract clause.
 */
export function runFileSourceAdapterContractTests(
  options: AdapterContractOptions,
  registrar: SuiteRegistrar = { describe, it },
): void {
  registrar.describe(`adapter contract: ${options.name}`, () => {
    let adapterPromise: Promise<FileSourceAdapter> | null = null;
    const getAdapter = (): Promise<FileSourceAdapter> => {
      adapterPromise ??= Promise.resolve(options.createAdapter());
      return adapterPromise;
    };
    for (const check of CONTRACT_CHECKS) {
      registrar.it(`satisfies ${check.id}`, async () => {
        const adapter = await getAdapter();
        let violation: string | null;
        try {
          violation = await check.run({ adapter, options });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          violation = `check ${check.id} threw: ${message}`;
        }
        if (violation !== null) {
          throw new Error(violation);
        }
      });
    }
  });
}
