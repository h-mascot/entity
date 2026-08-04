import { describe, it, expect } from 'vitest';
import { classifyFile, extractIndexableFileContent } from './classify';

describe('classifyFile', () => {
  describe('type detection', () => {
    it('should detect daily-review type', () => {
      const result = classifyFile('memory/2026-02-21.md', '# Daily Review\nToday was productive');
      expect(result.type).toBe('daily-review');
    });

    it('should detect business-review type', () => {
      const result = classifyFile('reports/q4.md', '# Business Review Q4');
      expect(result.type).toBe('business-review');
    });

    it('should detect blog type', () => {
      const result = classifyFile('posts/new-post.md', '# My Blog Post');
      expect(result.type).toBe('blog');
    });

    it('should detect dispatch as blog type', () => {
      const result = classifyFile('dispatch/weekly.md', 'Weekly dispatch notes');
      expect(result.type).toBe('blog');
    });

    it('should detect prd type', () => {
      const result = classifyFile('docs/feature.md', '# PRD: New Feature');
      expect(result.type).toBe('prd');
    });

    it('should detect product requirements as prd', () => {
      const result = classifyFile('docs/spec.md', 'Product requirements document');
      expect(result.type).toBe('prd');
    });

    it('should detect script type', () => {
      const result = classifyFile('scripts/deploy.sh', '#!/bin/bash\necho deploy');
      expect(result.type).toBe('script');
    });

    it('should detect project-doc type', () => {
      const result = classifyFile('projects/entity.md', '# Project Entity');
      expect(result.type).toBe('project-doc');
    });

    it('should default to one-off for unknown content', () => {
      const result = classifyFile('random/file.md', 'some random text');
      expect(result.type).toBe('one-off');
    });

    it('should handle empty content', () => {
      const result = classifyFile('unknown.md', '');
      expect(result.type).toBe('one-off');
    });

    it('should handle no content argument', () => {
      const result = classifyFile('unknown.md');
      expect(result.type).toBe('one-off');
    });
  });

  describe('agent detection', () => {
    it('does not hardcode private agent names in public file classification', () => {
      const result = classifyFile('agents/operator-notes.md', 'Assistant generated this');
      expect(result.agent).toBe('other');
    });
  });

  describe('origin detection', () => {
    it('should detect cron origin from memory daily path', () => {
      const result = classifyFile('memory/2026-03-19.md', '# Daily log');
      expect(result.origin).toBe('cron');
    });

    it('should detect task origin from task marker', () => {
      const result = classifyFile('output/report.md', 'MC Task #315 implementation notes');
      expect(result.origin).toBe('task');
    });

    it('should detect manual origin from docs path', () => {
      const result = classifyFile('docs/notes.md', 'Normal note');
      expect(result.origin).toBe('manual');
    });

    it('should default to unknown origin', () => {
      const result = classifyFile('tmp/blob.txt', 'misc');
      expect(result.origin).toBe('unknown');
    });
  });

  describe('recurring detection', () => {
    it('should detect daily pattern from keyword', () => {
      const result = classifyFile('daily/review.md', 'Daily standup notes');
      expect(result.isRecurring).toBe(true);
      expect(result.recurringPattern).toBe('daily');
    });

    it('should detect daily pattern from date in path', () => {
      const result = classifyFile('memory/2026-02-21.md', 'Notes');
      expect(result.isRecurring).toBe(true);
      expect(result.recurringPattern).toBe('daily');
    });

    it('should detect weekly pattern', () => {
      const result = classifyFile('reports/weekly.md', 'This week summary');
      expect(result.isRecurring).toBe(true);
      expect(result.recurringPattern).toBe('weekly');
    });

    it('should detect monthly pattern', () => {
      const result = classifyFile('reports/monthly.md', 'Monthly report');
      expect(result.isRecurring).toBe(true);
      expect(result.recurringPattern).toBe('monthly');
    });

    it('should detect non-recurring files', () => {
      const result = classifyFile('one-time/setup.md', 'Initial setup guide');
      expect(result.isRecurring).toBe(false);
      expect(result.recurringPattern).toBeUndefined();
    });
  });

  describe('title derivation', () => {
    it('should extract title from markdown heading', () => {
      const result = classifyFile('file.md', '# My Great Title\nSome content');
      expect(result.title).toBe('My Great Title');
    });

    it('should fall back to filename without extension', () => {
      const result = classifyFile('notes/my-notes.md', 'no heading here');
      expect(result.title).toBe('my-notes');
    });

    it('should handle nested paths', () => {
      const result = classifyFile('deep/nested/path/file.md');
      expect(result.title).toBe('file');
    });

    it('should handle empty path gracefully', () => {
      const result = classifyFile('');
      expect(result.title).toBeDefined();
    });

    it('extracts a readable title from generated HTML', () => {
      const result = classifyFile(
        'features/index.html',
        '<!doctype html><html><head><title>Fallback · Entity Wiki</title></head><body><h1>Files and documents</h1></body></html>',
      );
      expect(result.title).toBe('Files and documents');
    });
  });

  describe('indexable content', () => {
    it('strips HTML chrome, scripts, and tags from search previews', () => {
      const result = extractIndexableFileContent(
        'quickstart.html',
        '<!doctype html><html><head><style>.hidden{display:none}</style><script>alert(1)</script></head><body><h1>Quickstart</h1><p>Start &amp; verify Entity.</p></body></html>',
      );
      expect(result.title).toBe('Quickstart');
      expect(result.text).toBe('Quickstart Start & verify Entity.');
      expect(result.text).not.toContain('<!doctype');
      expect(result.text).not.toContain('alert');
    });

    it('leaves Markdown content unchanged', () => {
      const result = extractIndexableFileContent('guide.md', '# Guide\nReadable text');
      expect(result).toEqual({ title: undefined, text: '# Guide\nReadable text' });
    });
  });

  describe('tags derivation', () => {
    it('should include type and agent as tags', () => {
      const result = classifyFile('ada/daily-review.md', '# Daily Review');
      expect(result.tags).toContain('daily-review');
      expect(result.tags).toContain('ada');
    });

    it('should extract path segments as tags', () => {
      const result = classifyFile('memory/experiments/test.md', 'content');
      expect(result.tags).toContain('memory');
      expect(result.tags).toContain('experiments');
    });

    it('should filter out short segments (<=2 chars)', () => {
      const result = classifyFile('a/b/real-tag.md', 'content');
      // 'a' and 'b' should not be in tags
      expect(result.tags).not.toContain('a');
      expect(result.tags).not.toContain('b');
    });

    it('should include 3-char segments (boundary test)', () => {
      const result = classifyFile('api/doc/file.md', 'content');
      expect(result.tags).toContain('api');
      expect(result.tags).toContain('doc');
    });
  });

  describe('content hash', () => {
    it('should produce consistent hash for same content', () => {
      const r1 = classifyFile('a.md', 'hello world');
      const r2 = classifyFile('b.md', 'hello world');
      expect(r1.contentHash).toBe(r2.contentHash);
    });

    it('should produce different hash for different content', () => {
      const r1 = classifyFile('a.md', 'hello');
      const r2 = classifyFile('a.md', 'world');
      expect(r1.contentHash).not.toBe(r2.contentHash);
    });

    it('should handle empty content', () => {
      const result = classifyFile('a.md', '');
      expect(result.contentHash).toBeTruthy();
      expect(result.contentHash.length).toBe(40); // SHA1 hex length
    });
  });
});
