import { describe, expect, it } from 'vitest';
import type { FileSourceRecord } from '../../../../db/src/file-sources';
import { normalizeSourceRelativePath } from '../security';
import type { FileSourceAdapter, SourceCapability, SourceNode } from './types';
import {
  collectAdapterContractViolations,
  CONTRACT_CHECK_IDS,
  runFileSourceAdapterContractTests,
  type AdapterContractFixture,
} from './adapter-contract';

/**
 * Minimal compliant in-memory adapter used to prove the shared contract
 * harness accepts conforming adapters and flags each contract violation
 * class deterministically.
 */
class MemoryAdapter implements FileSourceAdapter {
  readonly key = 'memory';
  readonly files: Map<string, string>;

  constructor(files: Record<string, string>, private readonly capabilitiesOverride?: SourceCapability) {
    this.files = new Map(Object.entries(files));
  }

  async validate(): Promise<void> {}

  capabilities(): SourceCapability {
    return this.capabilitiesOverride ?? {
      read: true,
      write: false,
      rename: false,
      delete: false,
      list: true,
      search: false,
    };
  }

  private children(relativePath: string): SourceNode[] {
    const prefix = relativePath ? `${relativePath}/` : '';
    const nodes = new Map<string, SourceNode>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const remainder = filePath.slice(prefix.length);
      const separator = remainder.indexOf('/');
      if (separator >= 0) {
        const directoryName = remainder.slice(0, separator);
        nodes.set(directoryName, {
          sourceId: 'memory',
          path: `${prefix}${directoryName}`,
          name: directoryName,
          isDirectory: true,
          kind: 'directory',
        });
      } else {
        nodes.set(filePath, {
          sourceId: 'memory',
          path: filePath,
          name: remainder,
          isDirectory: false,
          kind: 'file',
          size: Buffer.byteLength(this.files.get(filePath) ?? '', 'utf8'),
        });
      }
    }
    return Array.from(nodes.values()).sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async list(relativePath: string): Promise<SourceNode[]> {
    const normalized = normalizeSourceRelativePath(relativePath);
    if (normalized && !Array.from(this.files.keys()).some((key) => key.startsWith(`${normalized}/`))) {
      throw new Error(`Path not found: ${normalized}`);
    }
    return this.children(normalized);
  }

  async read(relativePath: string): Promise<{ content: string; contentType: string }> {
    const normalized = normalizeSourceRelativePath(relativePath);
    const content = this.files.get(normalized);
    if (content === undefined) {
      throw new Error(`File not found: ${normalized}`);
    }
    return { content, contentType: 'text/plain' };
  }

  async write(): Promise<{ updatedAt?: string }> {
    throw new Error('memory source is read-only.');
  }

  async mkdir(): Promise<void> {
    throw new Error('memory source is read-only.');
  }
}

function fixture(): AdapterContractFixture {
  return {
    rootTree: [
      { path: 'docs', isDirectory: true },
      { path: 'readme.md', isDirectory: false },
    ],
    files: {
      'readme.md': '# hello\n',
      'docs/a.md': 'alpha\n',
      'docs/b.md': 'beta\n',
    },
    subdirectory: {
      path: 'docs',
      expected: [
        { path: 'docs/a.md', isDirectory: false },
        { path: 'docs/b.md', isDirectory: false },
      ],
    },
  };
}

function baseOptions(overrides?: Partial<Parameters<typeof collectAdapterContractViolations>[0]>) {
  return {
    name: 'memory',
    createAdapter: () => new MemoryAdapter(fixture().files),
    fixture: fixture(),
    readOnly: true,
    capabilities: {
      read: true,
      write: false,
      rename: false,
      delete: false,
      list: true,
      search: false,
    },
    ...overrides,
  };
}

describe('shared adapter contract harness', () => {
  it('exposes the full deterministic check set', () => {
    expect(CONTRACT_CHECK_IDS).toEqual([
      'capabilities',
      'root-list',
      'subtree-scoping',
      'traversal-rejected',
      'read-known-files',
      'read-unknown-file',
      'read-only',
      'secret-redaction',
    ]);
  });

  it('reports no violations for a compliant adapter', async () => {
    const violations = await collectAdapterContractViolations(baseOptions());
    expect(violations).toEqual([]);
  });

  it('flags capability advertisements that do not match the declared contract', async () => {
    const violations = await collectAdapterContractViolations(baseOptions({
      createAdapter: () => new MemoryAdapter(fixture().files, {
        read: true,
        write: true,
        rename: false,
        delete: false,
        list: true,
        search: false,
      }),
    }));
    expect(violations).toEqual([
      expect.stringContaining('capabilities mismatch'),
    ]);
  });

  it('flags a root listing that returns the wrong tree', async () => {
    const files = { 'readme.md': 'x\n' };
    const violations = await collectAdapterContractViolations(baseOptions({ createAdapter: () => new MemoryAdapter(files) }));
    expect(violations.some((v) => v.includes('root listing'))).toBe(true);
  });

  it('flags subtree listings that leak nodes from outside the subtree', async () => {
    // The adapter returns the full tree for every path: out-of-scope leak.
    const leaking = new (class extends MemoryAdapter {
      async list(): Promise<SourceNode[]> {
        return super.list('');
      }
    })(fixture().files);
    const violations = await collectAdapterContractViolations(baseOptions({ createAdapter: () => leaking }));
    expect(violations.some((v) => v.includes('subtree'))).toBe(true);
  });

  it('flags traversal paths that are not rejected', async () => {
    const permissive = new (class extends MemoryAdapter {
      async list(): Promise<SourceNode[]> {
        return [];
      }
      async read(): Promise<{ content: string; contentType: string }> {
        return { content: 'leaked', contentType: 'text/plain' };
      }
    })(fixture().files);
    const violations = await collectAdapterContractViolations(baseOptions({ createAdapter: () => permissive }));
    expect(violations.some((v) => v.includes('traversal'))).toBe(true);
  });

  it('flags known-file reads that return the wrong content or size', async () => {
    const wrong = new (class extends MemoryAdapter {
      async read(relativePath: string): Promise<{ content: string; contentType: string }> {
        const result = await super.read(relativePath);
        return { ...result, content: `${result.content}tampered` };
      }
    })(fixture().files);
    const violations = await collectAdapterContractViolations(baseOptions({ createAdapter: () => wrong }));
    expect(violations.some((v) => v.includes('readme.md'))).toBe(true);
  });

  it('flags unknown-file reads that resolve instead of rejecting', async () => {
    const lenient = new (class extends MemoryAdapter {
      async read(): Promise<{ content: string; contentType: string }> {
        return { content: 'ghost', contentType: 'text/plain' };
      }
    })(fixture().files);
    const violations = await collectAdapterContractViolations(baseOptions({ createAdapter: () => lenient }));
    expect(violations.some((v) => v.includes('unknown'))).toBe(true);
  });

  it('flags read-only adapters that accept writes or mkdir', async () => {
    const writable = new (class extends MemoryAdapter {
      async write(): Promise<{ updatedAt?: string }> {
        return {};
      }
    })(fixture().files);
    const violations = await collectAdapterContractViolations(baseOptions({ createAdapter: () => writable }));
    expect(violations.some((v) => v.includes('read-only'))).toBe(true);
  });

  it('flags error messages that leak the declared secret', async () => {
    const secret = 'ghp_supersecretvalue';
    const leaking = new (class extends MemoryAdapter {
      async read(relativePath: string): Promise<{ content: string; contentType: string }> {
        if (relativePath === 'docs/a.md') {
          throw new Error(`upstream rejected token ${secret}`);
        }
        return super.read(relativePath);
      }
    })(fixture().files);
    const violations = await collectAdapterContractViolations(baseOptions({
      createAdapter: () => leaking,
      redactedSecret: secret,
      redactionScenarios: [
        { name: 'auth-failure', run: () => leaking.read('docs/a.md') },
      ],
    }));
    expect(violations.some((v) => v.includes('secret'))).toBe(true);
  });

  it('registers vitest suites that pass for a compliant adapter', async () => {
    let registered = 0;
    const describeShim = (name: string, fn: () => void) => {
      registered += 1;
      fn();
    };
    const itShim = (_name: string, fn: () => void | Promise<unknown>) => {
      // Execute inline: a compliant adapter must make every registered
      // assertion body run without throwing.
      return fn();
    };
    runFileSourceAdapterContractTests(baseOptions(), { describe: describeShim, it: itShim } as never);
    await Promise.resolve();
    expect(registered).toBe(1);
  });
});
