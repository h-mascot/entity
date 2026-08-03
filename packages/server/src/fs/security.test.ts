import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  normalizeSourceRelativePath,
  resolveLocalPath,
  assertAllowedRemoteUrl,
  redactSensitive,
  assertSourceEnabled,
  assertRealpathContained,
  assertWriteTargetRealpathContained,
  resolvePathThroughNearestExistingAncestor,
} from './security';

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-fs-security-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe('normalizeSourceRelativePath', () => {
  it('should normalize a simple path', () => {
    expect(normalizeSourceRelativePath('docs/readme.md')).toBe('docs/readme.md');
  });

  it('should strip leading slashes', () => {
    expect(normalizeSourceRelativePath('/docs/readme.md')).toBe('docs/readme.md');
    expect(normalizeSourceRelativePath('///docs/readme.md')).toBe('docs/readme.md');
  });

  it('should normalize backslashes to forward slashes', () => {
    expect(normalizeSourceRelativePath('docs\\subdir\\file.md')).toBe('docs/subdir/file.md');
  });

  it('should return empty for null/undefined/empty', () => {
    expect(normalizeSourceRelativePath(null as any)).toBe('');
    expect(normalizeSourceRelativePath(undefined)).toBe('');
    expect(normalizeSourceRelativePath('')).toBe('');
    expect(normalizeSourceRelativePath('   ')).toBe('');
  });

  it('should return empty for dot path', () => {
    expect(normalizeSourceRelativePath('.')).toBe('');
  });

  it('should throw on null bytes (path injection)', () => {
    expect(() => normalizeSourceRelativePath('file\0.md')).toThrow('Invalid path');
  });

  it('should throw on path traversal (..)', () => {
    expect(() => normalizeSourceRelativePath('../../../etc/passwd')).toThrow('Path traversal');
  });

  it('should throw on path traversal (.. alone)', () => {
    expect(() => normalizeSourceRelativePath('..')).toThrow('Path traversal');
  });

  it('should handle paths with dots that are NOT traversal', () => {
    // e.g. "file..name.md" or "some.dir/file.md" should be fine
    expect(normalizeSourceRelativePath('file..name.md')).toBe('file..name.md');
    expect(normalizeSourceRelativePath('some.dir/file.md')).toBe('some.dir/file.md');
  });

  it('should normalize redundant slashes', () => {
    expect(normalizeSourceRelativePath('docs///subdir//file.md')).toBe('docs/subdir/file.md');
  });

  it('should handle encoded traversal attempt via normalization', () => {
    // After normalization, ./../../etc should resolve to ../../etc
    expect(() => normalizeSourceRelativePath('./../../etc/passwd')).toThrow('Path traversal');
  });
});

describe('resolveLocalPath', () => {
  it('should resolve a simple relative path', () => {
    const result = resolveLocalPath('/home/user/data', 'docs/readme.md');
    expect(result).toBe('/home/user/data/docs/readme.md');
  });

  it('should resolve empty relative to base', () => {
    const result = resolveLocalPath('/home/user/data', '');
    expect(result).toBe('/home/user/data');
  });

  it('should throw on path traversal outside base', () => {
    expect(() => resolveLocalPath('/home/user/data', '../../etc/passwd')).toThrow();
  });

  it('should allow paths within base even with dots', () => {
    const result = resolveLocalPath('/home/user/data', 'subdir/../other/file.md');
    expect(result).toBe('/home/user/data/other/file.md');
  });
});

describe('canonical path resolution', () => {
  it('resolves symlinked ancestors for targets that do not exist yet', async () => {
    const root = await makeTempRoot();
    const actual = path.join(root, 'actual');
    const alias = path.join(root, 'alias');
    await fs.promises.mkdir(actual);
    await fs.promises.symlink(actual, alias, 'dir');
    expect(resolvePathThroughNearestExistingAncestor(path.join(alias, 'nested', 'new.md'))).toBe(
      path.join(fs.realpathSync.native(actual), 'nested', 'new.md'),
    );
  });
});

describe('realpath containment helpers', () => {
  it('rejects symlink targets outside the real root', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    await fs.promises.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf-8');
    await fs.promises.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));

    await expect(assertRealpathContained(root, path.join(root, 'link.txt'))).rejects.toThrow(
      'Access outside source root is not allowed.',
    );
  });

  it('allows write targets whose nearest existing parent remains inside the real root', async () => {
    const root = await makeTempRoot();

    await expect(assertWriteTargetRealpathContained(root, path.join(root, 'nested', 'file.txt'))).resolves.toBeUndefined();
  });

  it('rejects write targets through symlinked parents outside the real root', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    await fs.promises.symlink(outside, path.join(root, 'linked-dir'), 'dir');

    await expect(assertWriteTargetRealpathContained(root, path.join(root, 'linked-dir', 'pwned.txt'))).rejects.toThrow(
      'Access outside source root is not allowed.',
    );
  });
});

describe('assertAllowedRemoteUrl', () => {
  const originalEnv = process.env.ENTITY_FS_ALLOWED_HOSTS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENTITY_FS_ALLOWED_HOSTS = originalEnv;
    } else {
      delete process.env.ENTITY_FS_ALLOWED_HOSTS;
    }
  });

  it('should allow any URL when no hosts are configured', () => {
    delete process.env.ENTITY_FS_ALLOWED_HOSTS;
    expect(() => assertAllowedRemoteUrl('https://evil.com/data')).not.toThrow();
  });

  it('should allow exact host match', () => {
    process.env.ENTITY_FS_ALLOWED_HOSTS = 'github.com,example.com';
    expect(() => assertAllowedRemoteUrl('https://github.com/repo')).not.toThrow();
  });

  it('should allow subdomain match', () => {
    process.env.ENTITY_FS_ALLOWED_HOSTS = 'github.com';
    expect(() => assertAllowedRemoteUrl('https://raw.github.com/file')).not.toThrow();
  });

  it('should reject non-allowed host', () => {
    process.env.ENTITY_FS_ALLOWED_HOSTS = 'github.com';
    expect(() => assertAllowedRemoteUrl('https://evil.com/steal')).toThrow('not allowlisted');
  });

  it('should be case insensitive', () => {
    process.env.ENTITY_FS_ALLOWED_HOSTS = 'GitHub.COM';
    expect(() => assertAllowedRemoteUrl('https://github.com/repo')).not.toThrow();
  });
});

describe('redactSensitive', () => {
  it('should redact known sensitive keys', () => {
    const result = redactSensitive({
      name: 'test',
      authRef: 'secret-token-123',
      token: 'abc',
      password: 'hunter2',
    });

    expect(result.name).toBe('test');
    expect(result.authRef).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
  });

  it('should redact case-insensitively', () => {
    const result = redactSensitive({
      Authorization: 'Bearer xyz',
      SECRET_KEY: 'mysecret',
    });

    expect(result.Authorization).toBe('[REDACTED]');
    expect(result.SECRET_KEY).toBe('[REDACTED]');
  });

  it('should not redact non-sensitive keys', () => {
    const result = redactSensitive({
      name: 'test',
      path: '/some/path',
      count: 42,
    });

    expect(result.name).toBe('test');
    expect(result.path).toBe('/some/path');
    expect(result.count).toBe(42);
  });

  it('should handle empty object', () => {
    const result = redactSensitive({});
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('assertSourceEnabled', () => {
  it('should throw on undefined source', () => {
    expect(() => assertSourceEnabled(undefined)).toThrow('Source not found');
  });

  it('should throw on disabled source', () => {
    expect(() =>
      assertSourceEnabled({ enabled: false, id: '1' } as any)
    ).toThrow('Source is disabled');
  });

  it('should pass for enabled source', () => {
    expect(() =>
      assertSourceEnabled({ enabled: true, id: '1' } as any)
    ).not.toThrow();
  });
});
