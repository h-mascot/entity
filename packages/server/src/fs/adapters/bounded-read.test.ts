import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOURCE_READ_LIMIT_BYTES, readLocalFileBounded, readResponseTextBounded, SourceReadLimitError } from './bounded-read';

describe('bounded remote reads', () => {
  it('uses one bounded allocation rather than retaining attacker-controlled chunk arrays', async () => {
    let emitted = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= 10_000) {
          controller.close();
          return;
        }
        controller.enqueue(Uint8Array.of(0x61));
        emitted += 1;
      },
    }));
    const concat = vi.spyOn(Buffer, 'concat');
    try {
      const result = await readResponseTextBounded(response, { maxBytes: 10_000 });
      expect(result.size).toBe(10_000);
      expect(result.content).toBe('a'.repeat(10_000));
      expect(concat).not.toHaveBeenCalled();
    } finally {
      concat.mockRestore();
    }
  });

  it('applies the 16 MiB ceiling when remote callers omit read options', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ pull() {}, cancel }), {
      headers: { 'content-length': String(DEFAULT_SOURCE_READ_LIMIT_BYTES + 1) },
    });

    await expect(readResponseTextBounded(response)).rejects.toBeInstanceOf(SourceReadLimitError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a declared oversized response body before rejecting', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull() {},
      cancel,
    });
    const response = new Response(stream, {
      headers: { 'content-length': '5' },
    });

    await expect(readResponseTextBounded(response, { maxBytes: 4 }))
      .rejects.toBeInstanceOf(SourceReadLimitError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});


describe('bounded local reads', () => {
  it('applies the 16 MiB ceiling when local callers omit read options', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'entity-bounded-read-'));
    const filePath = path.join(directory, 'oversized.md');
    try {
      await fs.promises.writeFile(filePath, 'x');
      await fs.promises.truncate(filePath, DEFAULT_SOURCE_READ_LIMIT_BYTES + 1);
      await expect(readLocalFileBounded(filePath)).rejects.toBeInstanceOf(SourceReadLimitError);
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  });
});
