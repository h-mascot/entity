import { describe, expect, it } from 'vitest';
import { buildConvertedDocumentContent } from './document-convert';

describe('document conversion', () => {
  it('creates a PRD with provenance and deterministic template sections', () => {
    const result = buildConvertedDocumentContent({
      sourceId: 'workspace',
      sourcePath: 'notes/idea.md',
      sourceContent: '# Launch idea\n\nUsers need faster onboarding.\n\nAdd checklist flow.',
      targetType: 'prd',
      targetName: 'Onboarding PRD',
    });

    expect(result.targetPath).toBe('notes/converted/onboarding-prd.prd.md');
    expect(result.content).toContain('entity_source_path: notes/idea.md');
    expect(result.content).toContain('## Problem');
    expect(result.content).toContain('Users need faster onboarding.');
    expect(result.content).toContain('Original type:');
    expect(result.preview).toContain('# Onboarding PRD');
  });

  it('maps blog conversion without mutating source metadata semantics', () => {
    const result = buildConvertedDocumentContent({
      sourceId: 'workspace',
      sourcePath: 'drafts/post.md',
      sourceContent: 'Weekly dispatch notes about Entity.',
      targetType: 'blog',
    });

    expect(result.targetType).toBe('blog');
    expect(result.provenance.source_type).toBe('blog');
    expect(result.content).toContain('## Hook');
    expect(result.content).toContain('entity_document_type: blog');
  });
});
