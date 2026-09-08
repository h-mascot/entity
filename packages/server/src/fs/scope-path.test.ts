import { describe, expect, it } from 'vitest';
import { buildUploadScopeRoot, encodeUploadScopeSegment } from './scope-path';

describe('upload scope path encoding', () => {
  it('keeps existing safe IDs byte-for-byte compatible', () => {
    expect(encodeUploadScopeSegment('org-a')).toBe('org-a');
    expect(buildUploadScopeRoot('org-a', 'team-a')).toBe('uploads/org-a/team-a');
  });

  it('uses a bounded deterministic disjoint encoding for unsafe IDs', () => {
    const encoded = encodeUploadScopeSegment('Sales Team');
    expect(encoded).toMatch(/^~[0-9a-f]{64}$/);
    expect(encoded).toBe(encodeUploadScopeSegment('Sales Team'));
    expect(encoded).not.toBe('Sales Team');
    expect(encodeUploadScopeSegment('Sales Team')).not.toBe(encodeUploadScopeSegment('Sales-Team'));
    expect(encodeUploadScopeSegment('x'.repeat(256))).toMatch(/^~[0-9a-f]{64}$/);
  });

  it.each([
    'sales/team',
    String.raw`sales\team`,
    '../sales',
    '営業チーム',
  ])('encodes unsafe ID %j as one bounded path segment', (id) => {
    const encoded = encodeUploadScopeSegment(id);
    expect(encoded).toMatch(/^~[0-9a-f]{64}$/);
    expect(encoded).not.toMatch(/[\\/]/);
    expect(Buffer.byteLength(encoded, 'utf8')).toBeLessThanOrEqual(255);
  });

  it('preserves the exact 255-byte safe boundary and separates encoded-looking IDs', () => {
    const boundary = `a${'x'.repeat(254)}`;
    expect(Buffer.byteLength(boundary, 'utf8')).toBe(255);
    expect(encodeUploadScopeSegment(boundary)).toBe(boundary);
    const encodedSales = encodeUploadScopeSegment('Sales Team');
    expect(encodeUploadScopeSegment(`~${encodedSales}`)).not.toBe(encodedSales);
  });
});
