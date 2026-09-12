import { describe, expect, it } from 'vitest';
import { normalizeTaskOutputLinks } from './task-output-links';

const BASE = 'https://entity.example';
const RECEIPT_PATH = '/docs/source/agent-output/mc-1496/receipt-20260912.txt';

describe('source document links in task output', () => {
  it('preserves a source artifact URL across repeated task saves', () => {
    const output = `Receipt: ${BASE}${RECEIPT_PATH}`;
    const saved = normalizeTaskOutputLinks(output, BASE);

    expect(saved).toBe(output);
    expect(normalizeTaskOutputLinks(saved, BASE)).toBe(output);
  });

  it('keeps the source route when updating the Entity origin', () => {
    expect(normalizeTaskOutputLinks(`See http://old-entity.example${RECEIPT_PATH}.`, BASE))
      .toBe(`See ${BASE}${RECEIPT_PATH}.`);
  });

  it('leaves unrelated external source paths unchanged', () => {
    const output = 'Source: https://external.example/source/report.txt';
    expect(normalizeTaskOutputLinks(output, BASE)).toBe(output);
  });

  it('leaves a root-relative source URL unchanged', () => {
    expect(normalizeTaskOutputLinks(RECEIPT_PATH, BASE)).toBe(RECEIPT_PATH);
  });
});
