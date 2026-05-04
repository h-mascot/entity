import { describe, expect, it } from 'vitest';
import { normalizeTaskOutputLinks } from '../task-output-links';

const BASE = 'http://entity.example.test';

describe('normalizeTaskOutputLinks', () => {

  it('uses a portable localhost base URL when no installation-specific base is provided', () => {
    expect(normalizeTaskOutputLinks('Artifacts: output/report.md')).toBe('Artifacts: http://localhost:3000/docs/output/report.md');
  });

  it('rewrites legacy 8788 links to Entity docs links', () => {
    const result = normalizeTaskOutputLinks('See http://legacy-files.example.test:8788/output/report.md', BASE);
    expect(result).toContain(`${BASE}/docs/output/report.md`);
  });

  it('rewrites legacy 3000 output links to Entity docs links', () => {
    const result = normalizeTaskOutputLinks('See http://legacy-entity.example.test:3000/output/report.md', BASE);
    expect(result).toContain(`${BASE}/docs/output/report.md`);
  });

  it('rewrites all supported Entity docs roots from legacy URLs', () => {
    const result = normalizeTaskOutputLinks(
      [
        'http://legacy-entity.example.test:3000/memory/note.md',
        'http://legacy-entity.example.test:3000/workspace/docs/runbook.md',
        'http://legacy-entity.example.test:3000/projects/entity/spec.md',
        'http://legacy-entity.example.test:3000/zora/report.md',
        'http://legacy-entity.example.test:3000/spock/review.md',
      ].join(' '),
      BASE
    );

    expect(result).toContain(`${BASE}/docs/memory/note.md`);
    expect(result).toContain(`${BASE}/docs/workspace/docs/runbook.md`);
    expect(result).toContain(`${BASE}/docs/projects/entity/spec.md`);
    expect(result).toContain(`${BASE}/docs/zora/report.md`);
    expect(result).toContain(`${BASE}/docs/spock/review.md`);
  });

  it('does not rewrite already-normalized Entity docs links', () => {
    const normalized = `${BASE}/docs/output/report.md`;
    expect(normalizeTaskOutputLinks(`See ${normalized}`, BASE)).toBe(`See ${normalized}`);
  });

  it('rewrites absolute cross-agent local paths to the matching docs root', () => {
    expect(normalizeTaskOutputLinks('/Users/operator/clawd/output/a.md', BASE)).toBe(`${BASE}/docs/output/a.md`);
    expect(normalizeTaskOutputLinks('/home/operator/clawd-spock/output/a.md', BASE)).toBe(`${BASE}/docs/spock/a.md`);
    expect(normalizeTaskOutputLinks('/home/operator/clawd-zora/output/a.md', BASE)).toBe(`${BASE}/docs/zora/a.md`);
  });

  it('rewrites home-relative clawd paths', () => {
    const result = normalizeTaskOutputLinks('Artifacts: ~/clawd/output/a.md ~/clawd/projects/entity/spec.md', BASE);
    expect(result).toContain(`${BASE}/docs/output/a.md`);
    expect(result).toContain(`${BASE}/docs/projects/entity/spec.md`);
  });

  it('rewrites relative docs paths and keeps trailing punctuation outside the URL', () => {
    const result = normalizeTaskOutputLinks('Artifacts: output/a.md, memory/b.md. docs/c.md!', BASE);
    expect(result).toContain(`${BASE}/docs/output/a.md`);
    expect(result).toContain(`${BASE}/docs/memory/b.md`);
    expect(result).toContain(`${BASE}/docs/workspace/docs/c.md!`);
  });
});
