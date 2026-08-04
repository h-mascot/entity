import { describe, expect, it } from 'vitest';
import {
  buildDocAskPrompt,
  buildDocNotesKey,
  validateDocAskInput,
  validateDocSchemaExtraction,
} from './doc-intelligence';

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

  it('injects a schema-extraction instruction keyed by exact field names when schema is provided', () => {
    const prompt = buildDocAskPrompt({
      question: 'q',
      content: 'c',
      schema: ['Owner', 'Address'],
    });
    expect(prompt.user).toContain('Owner');
    expect(prompt.user).toContain('Address');
    expect(prompt.user.toLowerCase()).toContain('json');
  });
});

describe('validateDocAskInput — schema (THE-934)', () => {
  it('accepts a well-formed schema and preserves field order/case', () => {
    const result = validateDocAskInput({ question: 'q', content: 'c', schema: ['Owner', 'Homeowner'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.schema).toEqual(['Owner', 'Homeowner']);
    }
  });

  it('rejects a non-array schema with a structured schema_invalid code before any model call', () => {
    const result = validateDocAskInput({ question: 'q', content: 'c', schema: 'Owner' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('schema_invalid');
    }
  });

  it('rejects duplicate, empty, and non-string field names', () => {
    expect(validateDocAskInput({ question: 'q', content: 'c', schema: ['Owner', 'Owner'] }).ok).toBe(false);
    expect(validateDocAskInput({ question: 'q', content: 'c', schema: ['Owner', '   '] }).ok).toBe(false);
    expect(validateDocAskInput({ question: 'q', content: 'c', schema: ['Owner', 42] }).ok).toBe(false);
  });

  it('rejects oversized field names and too many fields (bounded state)', () => {
    expect(validateDocAskInput({ question: 'q', content: 'c', schema: ['x'.repeat(65)] }).ok).toBe(false);
    const tooMany = Array.from({ length: 25 }, (_, i) => `field${i}`);
    expect(validateDocAskInput({ question: 'q', content: 'c', schema: tooMany }).ok).toBe(false);
  });
});

describe('validateDocSchemaExtraction — exact field match (THE-934)', () => {
  it('passes when every required field is present as an exact own-property', () => {
    const decision = validateDocSchemaExtraction('{"Owner": "Alice", "Address": "123 St"}', ['Owner', 'Address']);
    expect(decision.ok).toBe(true);
  });

  it('fails when a required Owner is answered only as Homeowner (no substring/prefix match)', () => {
    const decision = validateDocSchemaExtraction('{"Homeowner": "Alice"}', ['Owner']);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.missingFields).toEqual(['Owner']);
    }
  });

  it('fails when the model returns non-JSON free text', () => {
    const decision = validateDocSchemaExtraction('The owner is Alice.', ['Owner']);
    expect(decision.ok).toBe(false);
  });

  it('does not treat null or nested objects as present scalar fields', () => {
    const decision = validateDocSchemaExtraction('{"Owner": null}', ['Owner']);
    expect(decision.ok).toBe(false);
  });

  it('rejects inherited Object.prototype keys (toString, constructor, __proto__) for an empty object', () => {
    // `{}` must not satisfy a required field that only exists on the prototype.
    for (const field of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
      const decision = validateDocSchemaExtraction('{}', [field]);
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.missingFields).toEqual([field]);
      }
    }
  });

  it('rejects inherited keys even when combined with valid own fields', () => {
    const decision = validateDocSchemaExtraction('{"Owner": "Alice"}', ['Owner', 'toString']);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.missingFields).toEqual(['toString']);
    }
  });

  it('accepts a valid own-property field and distinguishes Owner from Homeowner', () => {
    // Owner is a real own property; Homeowner is a different own property and
    // must not satisfy a required Owner.
    expect(validateDocSchemaExtraction('{"Owner": "Alice"}', ['Owner']).ok).toBe(true);
    expect(validateDocSchemaExtraction('{"Homeowner": "Alice"}', ['Owner']).ok).toBe(false);
    // Both Owner and Homeowner present as own properties — Owner is satisfied.
    expect(validateDocSchemaExtraction('{"Owner": "Alice", "Homeowner": "Bob"}', ['Owner']).ok).toBe(true);
  });
});
