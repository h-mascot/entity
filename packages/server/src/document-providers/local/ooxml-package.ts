import { deflateRawSync, inflateRawSync } from 'node:zlib';

export interface OoxmlPackageLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_OOXML_LIMITS: Readonly<OoxmlPackageLimits> = {
  // The accepted native managed-storage broker has a hard 1 MiB artifact ceiling.
  maxArchiveBytes: 1024 * 1024,
  maxEntries: 256,
  maxEntryBytes: 512 * 1024,
  maxExpandedBytes: 4 * 1024 * 1024,
  maxCompressionRatio: 100,
};

export class OoxmlPackageError extends Error {
  constructor(
    public readonly code:
      | 'invalid_archive'
      | 'unsafe_path'
      | 'duplicate_entry'
      | 'encrypted_entry'
      | 'unsupported_compression'
      | 'limit_exceeded'
      | 'checksum_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'OoxmlPackageError';
  }
}

export interface OoxmlEntry {
  name: string;
  data: Buffer;
  compression?: 'store' | 'deflate';
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

function safeEntryName(name: string): string {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/')
    || /^[A-Za-z]:/.test(name) || name.split('/').some((part) => part === '..' || part === '.')) {
    throw new OoxmlPackageError('unsafe_path', 'OOXML entry path is unsafe');
  }
  return name;
}

function decodeEntryName(bytes: Uint8Array): string {
  try { return safeEntryName(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) {
    if (error instanceof OoxmlPackageError) throw error;
    throw new OoxmlPackageError('invalid_archive', 'OOXML entry name is not valid UTF-8');
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const XML_ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9A-Fa-f]+));/g;

function validXmlCodePoint(value: number): boolean {
  return value === 9 || value === 10 || value === 13
    || (value >= 0x20 && value <= 0xd7ff) || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff);
}

export function decodeXmlReferences(value: string): string {
  const named: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(XML_ENTITY, (_reference, name: string, decimal: string, hexadecimal: string) =>
    name ? named[name] : String.fromCodePoint(Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16)),
  );
}

function validXmlText(value: string): boolean {
  let referencesValid = true;
  const remainder = value.replace(XML_ENTITY, (_reference, _name: string, decimal: string, hexadecimal: string) => {
    if (decimal || hexadecimal) referencesValid &&= validXmlCodePoint(Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16));
    return '';
  });
  return referencesValid && !remainder.includes('&') && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}

function validXmlAttributes(value: string): boolean {
  let offset = 0;
  const names = new Set<string>();
  while (offset < value.length) {
    const whitespace = value.slice(offset).match(/^\s+/)?.[0].length ?? 0;
    offset += whitespace;
    if (offset === value.length) return true;
    const name = value.slice(offset).match(XML_NAME)?.[0];
    if (!name || names.has(name)) return false;
    names.add(name);
    offset += name.length;
    offset += value.slice(offset).match(/^\s*/)?.[0].length ?? 0;
    if (value[offset++] !== '=') return false;
    offset += value.slice(offset).match(/^\s*/)?.[0].length ?? 0;
    const quote = value[offset++];
    if (quote !== '"' && quote !== "'") return false;
    const end = value.indexOf(quote, offset);
    if (end < 0 || !validXmlText(value.slice(offset, end)) || value.slice(offset, end).includes('<')) return false;
    offset = end + 1;
  }
  return true;
}

/** Strict bounded well-formedness check used before any regex-based semantic extraction. */
export function isWellFormedXml(source: string): boolean {
  const stack: string[] = [];
  let rootSeen = false;
  let rootClosed = false;
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (offset < source.length) {
    const tagStart = source.indexOf('<', offset);
    if (tagStart < 0) return validXmlText(source.slice(offset)) && (stack.length > 0 || !source.slice(offset).trim()) && rootSeen && rootClosed;
    const text = source.slice(offset, tagStart);
    if (!validXmlText(text) || ((stack.length === 0 || rootClosed) && text.trim())) return false;
    if (source.startsWith('<!--', tagStart)) {
      const end = source.indexOf('-->', tagStart + 4);
      if (end < 0 || source.slice(tagStart + 4, end).includes('--')) return false;
      offset = end + 3;
      continue;
    }
    if (source.startsWith('<?', tagStart)) {
      const end = source.indexOf('?>', tagStart + 2);
      if (end < 0) return false;
      offset = end + 2;
      continue;
    }
    if (source.startsWith('<![CDATA[', tagStart)) {
      if (stack.length === 0) return false;
      const end = source.indexOf(']]>', tagStart + 9);
      if (end < 0) return false;
      offset = end + 3;
      continue;
    }
    if (source.startsWith('<!', tagStart)) return false;
    let quote = '';
    let tagEnd = -1;
    for (let index = tagStart + 1; index < source.length; index++) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '<') return false;
      else if (character === '>') { tagEnd = index; break; }
    }
    if (tagEnd < 0 || quote) return false;
    const raw = source.slice(tagStart + 1, tagEnd);
    if (raw.startsWith('/')) {
      const name = raw.slice(1).match(XML_NAME)?.[0];
      if (!name || raw.slice(name.length + 1).trim() || stack.pop() !== name) return false;
      if (stack.length === 0) rootClosed = true;
    } else {
      const selfClosing = /\/\s*$/.test(raw);
      const content = selfClosing ? raw.replace(/\/\s*$/, '') : raw;
      const name = content.match(XML_NAME)?.[0];
      if (!name || rootClosed || !validXmlAttributes(content.slice(name.length))) return false;
      if (stack.length === 0) {
        if (rootSeen) return false;
        rootSeen = true;
      }
      if (!selfClosing) stack.push(name);
      else if (stack.length === 0) rootClosed = true;
    }
    offset = tagEnd + 1;
  }
  return stack.length === 0 && rootSeen && rootClosed;
}

function findEndRecord(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset--) {
    if (archive.readUInt32LE(offset) === END_SIGNATURE) return offset;
  }
  throw new OoxmlPackageError('invalid_archive', 'ZIP end record is missing');
}

/** Read a ZIP package without extracting paths to disk. */
export function readOoxmlPackage(
  archive: Buffer,
  limits: Readonly<OoxmlPackageLimits> = DEFAULT_OOXML_LIMITS,
): Map<string, Buffer> {
  if (archive.length < 22 || archive.length > limits.maxArchiveBytes) {
    throw new OoxmlPackageError('limit_exceeded', 'OOXML archive size is outside the allowed limit');
  }
  const endOffset = findEndRecord(archive);
  if (archive.readUInt16LE(endOffset + 4) !== 0 || archive.readUInt16LE(endOffset + 6) !== 0) {
    throw new OoxmlPackageError('invalid_archive', 'multi-disk ZIP packages are not supported');
  }
  const diskEntryCount = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const commentLength = archive.readUInt16LE(endOffset + 20);
  if (diskEntryCount !== entryCount || entryCount > limits.maxEntries || endOffset + 22 + commentLength !== archive.length
    || centralOffset + centralSize !== endOffset) {
    throw new OoxmlPackageError(
      entryCount > limits.maxEntries ? 'limit_exceeded' : 'invalid_archive',
      'ZIP central directory is invalid or exceeds its entry limit',
    );
  }

  const entries = new Map<string, Buffer>();
  const localRanges: Array<{ start: number; end: number }> = [];
  let totalExpanded = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > endOffset || archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new OoxmlPackageError('invalid_archive', 'ZIP central entry is invalid');
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const expandedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const entryCommentLength = archive.readUInt16LE(cursor + 32);
    const disk = archive.readUInt16LE(cursor + 34);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (disk !== 0 || next > endOffset || nameLength === 0) {
      throw new OoxmlPackageError('invalid_archive', 'ZIP entry metadata is invalid');
    }
    if ((flags & 0x41) !== 0) throw new OoxmlPackageError('encrypted_entry', 'encrypted OOXML entries are forbidden');
    if ((flags & ~0x806) !== 0) throw new OoxmlPackageError('invalid_archive', 'ZIP entry flags are unsupported');
    if (method !== 0 && method !== 8) throw new OoxmlPackageError('unsupported_compression', 'ZIP compression method is unsupported');
    const name = decodeEntryName(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    if (entries.has(name)) throw new OoxmlPackageError('duplicate_entry', 'duplicate OOXML entry is forbidden');
    if (expandedSize > limits.maxEntryBytes || totalExpanded + expandedSize > limits.maxExpandedBytes
      || (compressedSize === 0 ? expandedSize > 0 : expandedSize / compressedSize > limits.maxCompressionRatio)) {
      throw new OoxmlPackageError('limit_exceeded', 'OOXML archive expansion exceeds its limit');
    }
    if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new OoxmlPackageError('invalid_archive', 'ZIP local entry is invalid');
    }
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localChecksum = archive.readUInt32LE(localOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localOffset + 18);
    const localExpandedSize = archive.readUInt32LE(localOffset + 22);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (localFlags !== flags || localMethod !== method || dataEnd > centralOffset
      || decodeEntryName(archive.subarray(localNameStart, localNameStart + localNameLength)) !== name
      || ((flags & 0x8) === 0 && (localChecksum !== checksum
        || localCompressedSize !== compressedSize || localExpandedSize !== expandedSize))) {
      throw new OoxmlPackageError('invalid_archive', 'ZIP local and central entry metadata disagree');
    }
    const compressed = archive.subarray(dataStart, dataEnd);
    let data: Buffer;
    try {
      data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
    } catch {
      throw new OoxmlPackageError('invalid_archive', 'ZIP entry could not be expanded safely');
    }
    if (data.length !== expandedSize || crc32(data) !== checksum) {
      throw new OoxmlPackageError('checksum_mismatch', 'ZIP entry checksum or size is invalid');
    }
    entries.set(name, data);
    localRanges.push({ start: localOffset, end: dataEnd });
    totalExpanded += data.length;
    cursor = next;
  }
  if (cursor !== endOffset) throw new OoxmlPackageError('invalid_archive', 'ZIP central directory has trailing data');
  localRanges.sort((left, right) => left.start - right.start);
  if (localRanges[0]?.start !== 0 || localRanges[localRanges.length - 1]?.end !== centralOffset
    || localRanges.some((range, index) => index > 0 && localRanges[index - 1].end !== range.start)) {
    throw new OoxmlPackageError('invalid_archive', 'ZIP local entry stream contains gaps or overlaps');
  }
  return entries;
}

/** Deterministic ZIP writer; creation uses STORE while fixtures can prove DEFLATE reads. */
export function writeOoxmlPackage(input: readonly OoxmlEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const names = new Set<string>();
  let offset = 0;
  for (const entry of input) {
    const name = safeEntryName(entry.name);
    if (names.has(name)) throw new OoxmlPackageError('duplicate_entry', 'duplicate OOXML entry is forbidden');
    names.add(name);
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(entry.data);
    const method = entry.compression === 'deflate' ? 8 : 0;
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + payload.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(input.length, 8);
  end.writeUInt16LE(input.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
