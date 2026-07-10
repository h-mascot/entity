import { describe, expect, it } from 'vitest';
import { isMissingPathError } from './errors';

describe('isMissingPathError', () => {
  it.each([
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
    new Error('ENOENT: no such file or directory'),
    new Error('File does not exist'),
    new Error('Path not found'),
    new Error('Remote source request failed (404).'),
    'upstream returned 404 Not Found',
  ])('recognizes missing-path errors', (error) => {
    expect(isMissingPathError(error)).toBe(true);
  });

  it.each([
    new Error('permission denied'),
    new Error('Remote source request failed (500).'),
    new Error('file 4040 is unavailable'),
    null,
  ])('does not misclassify other failures', (error) => {
    expect(isMissingPathError(error)).toBe(false);
  });
});
