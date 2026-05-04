import { describe, expect, it } from 'vitest';
import { buildDocsRootCandidates } from '../docs-paths';

describe('buildDocsRootCandidates', () => {
  it('includes configured root first and workspace fallbacks for output', () => {
    const roots = buildDocsRootCandidates('output', '/srv/entity/workspaces/main/output', [
      '/srv/entity/workspaces/main',
      '/srv/entity/workspaces/research',
      '/srv/entity/workspaces/ops',
    ]);

    expect(roots).toEqual([
      '/srv/entity/workspaces/main/output',
      '/srv/entity/workspaces/research/output',
      '/srv/entity/workspaces/ops/output',
    ]);
  });

  it('uses workspace root fallback for workspace docs', () => {
    const roots = buildDocsRootCandidates('workspace', '/srv/entity/workspaces/main', [
      '/srv/entity/workspaces/main',
      '/srv/entity/workspaces/research',
    ]);

    expect(roots).toEqual(['/srv/entity/workspaces/main', '/srv/entity/workspaces/research']);
  });
});
