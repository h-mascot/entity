import fs from 'fs';
import type { SourceReadOptions } from './types';

export const DEFAULT_SOURCE_READ_LIMIT_BYTES = 16 * 1024 * 1024;

export class SourceReadLimitError extends Error {
  readonly code = 'SOURCE_READ_LIMIT_EXCEEDED';
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Source file exceeds the configured read limit of ${maxBytes} bytes.`);
    this.name = 'SourceReadLimitError';
    this.maxBytes = maxBytes;
  }
}

function normalizedLimit(options: SourceReadOptions | undefined): number {
  const value = options?.maxBytes;
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_SOURCE_READ_LIMIT_BYTES;
  }
  return Math.min(Math.floor(value), DEFAULT_SOURCE_READ_LIMIT_BYTES);
}

export async function readResponseBufferBounded(
  response: Response,
  options?: SourceReadOptions,
): Promise<Buffer> {
  const maxBytes = normalizedLimit(options);
  const declaredLengthHeader = response.headers.get('content-length');
  const declaredLength = declaredLengthHeader === null ? Number.NaN : Number(declaredLengthHeader);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SourceReadLimitError(maxBytes);
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const capacity = Number.isFinite(declaredLength) && declaredLength >= 0
    ? Math.min(declaredLength, maxBytes)
    : maxBytes;
  let buffer = Buffer.allocUnsafe(capacity);
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (value.byteLength > maxBytes - total) {
        await reader.cancel().catch(() => undefined);
        throw new SourceReadLimitError(maxBytes);
      }
      if (value.byteLength > buffer.length - total) {
        const expanded = Buffer.allocUnsafe(maxBytes);
        buffer.copy(expanded, 0, 0, total);
        buffer = expanded;
      }
      buffer.set(value, total);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.from(buffer.subarray(0, total));
}

export async function readResponseTextBounded(
  response: Response,
  options?: SourceReadOptions,
): Promise<{ content: string; size: number }> {
  const content = await readResponseBufferBounded(response, options);
  return { content: content.toString('utf8'), size: content.length };
}

export async function readLocalFileBounded(
  absolutePath: string,
  options?: SourceReadOptions,
): Promise<Buffer> {
  const maxBytes = normalizedLimit(options);
  const handle = await fs.promises.open(absolutePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new SourceReadLimitError(maxBytes);
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
