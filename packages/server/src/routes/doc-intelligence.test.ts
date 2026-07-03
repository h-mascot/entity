import { describe, expect, it } from 'vitest';
import { buildDocAskPrompt, buildDocNotesKey, validateDocAskInput } from './doc-intelligence';

describe('buildDocNotesKey', () => {
  it('builds keys scoped by source and path', () => {
    expect(buildDocNotesKey('workspace', 'output/a.md')).toBe('docNotes.workspace::output/a.md');
    expect(buildDocNotesKey(null, 'output/a.md')).toBe('docNotes.local::output/a.md');
    expect(buildDocNotesKey('  ', 'output/a.md')).toBe('docNotes.local::output/a.md');
  });

  it('rejects empty, oversized, or multi-line paths', () => {
    expect(buildDocNotesKey('s', '')).toBeNull();
    expect(buildDocNotesKey('s', '   ')).toBeNull();
    expect(buildDocNotesKey('s', 'a'.repeat(601))).toBeNull();
    expect(buildDocNotesKey('s', 'a\nb')).toBeNull();
  });
});

describe('validateDocAskInput', () => {
  it('rejects non-object bodies', () => {
    expect(validateDocAskInput(null)).toEqual({ ok: false, error: 'Request body must be a JSON object.' });
    expect(validateDocAskInput([1, 2])).toEqual({ ok: false, error: 'Request body must be a JSON object.' });
    expect(validateDocAskInput('question')).toEqual({ ok: false, error: 'Request body must be a JSON object.' });
  });

  it('requires a non-empty question', () => {
    expect(validateDocAskInput({ content: 'doc' })).toEqual({ ok: false, error: 'question is required.' });
    expect(validateDocAskInput({ question: '   ', content: 'doc' })).toEqual({ ok: false, error: 'question is required.' });
  });

  it('rejects oversized questions', () => {
    const result = validateDocAskInput({ question: 'q'.repeat(2001), content: 'doc' });
    expect(result.ok).toBe(false);
  });

  it('requires document content', () => {
    expect(validateDocAskInput({ question: 'what?' })).toEqual({ ok: false, error: 'content is required.' });
    expect(validateDocAskInput({ question: 'what?', content: '   ' })).toEqual({ ok: false, error: 'content is required.' });
  });

  it('accepts valid input and truncates long content', () => {
    const result = validateDocAskInput({
      question: '  What is this?  ',
      content: 'x'.repeat(30_000),
      path: 'docs/readme.md',
      filename: 'readme.md',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.question).toBe('What is this?');
      expect(result.input.content.length).toBe(24_000);
      expect(result.input.path).toBe('docs/readme.md');
      expect(result.input.filename).toBe('readme.md');
    }
  });

  it('ignores non-string path/filename', () => {
    const result = validateDocAskInput({ question: 'q', content: 'doc', path: 42, filename: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.path).toBeUndefined();
      expect(result.input.filename).toBeUndefined();
    }
  });
});

describe('buildDocAskPrompt', () => {
  it('labels the document by filename first, then path', () => {
    expect(
      buildDocAskPrompt({ question: 'q', content: 'c', filename: 'a.md', path: 'x/a.md' }).user,
    ).toContain('Document: a.md');
    expect(buildDocAskPrompt({ question: 'q', content: 'c', path: 'x/a.md' }).user).toContain('Document: x/a.md');
    expect(buildDocAskPrompt({ question: 'q', content: 'c' }).user).toContain('Document: the document');
  });

  it('embeds content between markers and includes the question', () => {
    const prompt = buildDocAskPrompt({ question: 'What changed?', content: 'Body text' });
    expect(prompt.user).toContain('--- DOCUMENT CONTENT START ---');
    expect(prompt.user).toContain('Body text');
    expect(prompt.user).toContain('Question: What changed?');
    expect(prompt.system).toContain('If the answer is not in the document, say so plainly.');
  });
});
