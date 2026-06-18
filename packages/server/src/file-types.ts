import path from 'path';

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  // text-like formats
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'application/javascript',
  cjs: 'application/javascript',
  ts: 'application/typescript',
  tsx: 'text/tsx',
  jsx: 'text/jsx',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  sh: 'application/x-sh',
  bash: 'application/x-sh',
  zsh: 'application/x-sh',
  py: 'text/x-python',
  go: 'text/x-go',
  rs: 'text/x-rust',
  sql: 'application/sql',
  toml: 'application/toml',
  env: 'text/plain',

  // binary-friendly preview formats
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
  tif: 'image/tiff',

  // common binary files
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
};

const GENERIC_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/binary',
]);

const TEXTUAL_APPLICATION_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/ecmascript',
  'application/typescript',
  'application/sql',
  'application/yaml',
  'application/toml',
  'application/x-sh',
  'application/x-www-form-urlencoded',
  'application/vnd.api+json',
  'image/svg+xml',
]);

export interface DetectContentTypeOptions {
  filePath: string;
  headerContentType?: string | null;
  content?: Buffer;
}

export interface DetectedContentType {
  contentType: string;
  isBinary: boolean;
}

export function normalizeContentType(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
}

export function contentTypeFromExtension(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase().replace('.', '');
  if (!extension) {
    return null;
  }

  return EXTENSION_CONTENT_TYPES[extension] ?? null;
}

function isLikelyTextBuffer(content: Buffer): boolean {
  if (content.length === 0) {
    return true;
  }

  const sample = content.subarray(0, Math.min(content.length, 2048));
  let suspiciousBytes = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }

    if (byte === 9 || byte === 10 || byte === 13) {
      continue;
    }

    if (byte >= 32 && byte <= 126) {
      continue;
    }

    // Allow high bytes so UTF-8 text doesn't get misclassified.
    if (byte >= 160) {
      continue;
    }

    suspiciousBytes += 1;
  }

  return suspiciousBytes / sample.length < 0.3;
}

function detectMagicContentType(content: Buffer): string | null {
  if (content.length >= 5 && content.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }

  if (
    content.length >= 8 &&
    content[0] === 0x89 &&
    content[1] === 0x50 &&
    content[2] === 0x4e &&
    content[3] === 0x47 &&
    content[4] === 0x0d &&
    content[5] === 0x0a &&
    content[6] === 0x1a &&
    content[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return 'image/jpeg';
  }

  if (content.length >= 6) {
    const signature = content.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return 'image/gif';
    }
  }

  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (isLikelyTextBuffer(content)) {
    const sample = content.subarray(0, Math.min(content.length, 4096)).toString('utf-8').toLowerCase();
    if (sample.includes('<svg')) {
      return 'image/svg+xml';
    }
  }

  return null;
}

export function isTextualContentType(contentType: string | null | undefined): boolean {
  const normalized = normalizeContentType(contentType);
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith('text/')) {
    return true;
  }

  if (normalized.endsWith('+json') || normalized.endsWith('+xml')) {
    return true;
  }

  return TEXTUAL_APPLICATION_TYPES.has(normalized);
}

export function detectContentType({
  filePath,
  headerContentType,
  content,
}: DetectContentTypeOptions): DetectedContentType {
  const normalizedHeader = normalizeContentType(headerContentType);
  const extensionType = contentTypeFromExtension(filePath);
  const magicType = content ? detectMagicContentType(content) : null;

  let contentType = 'application/octet-stream';

  if (magicType) {
    contentType = magicType;
  } else if (
    normalizedHeader &&
    !GENERIC_CONTENT_TYPES.has(normalizedHeader) &&
    normalizedHeader !== 'text/plain'
  ) {
    contentType = normalizedHeader;
  } else if (extensionType) {
    contentType = extensionType;
  } else if (normalizedHeader) {
    contentType = normalizedHeader;
  } else if (content) {
    contentType = isLikelyTextBuffer(content) ? 'text/plain' : 'application/octet-stream';
  }

  return {
    contentType,
    isBinary: !isTextualContentType(contentType),
  };
}
