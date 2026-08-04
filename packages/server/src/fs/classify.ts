import crypto from 'crypto';

export interface FileClassification {
  type: 'daily-review' | 'business-review' | 'blog' | 'prd' | 'project-doc' | 'script' | 'one-off';
  agent: string;
  origin: 'task' | 'cron' | 'manual' | 'unknown';
  isRecurring: boolean;
  recurringPattern?: 'daily' | 'weekly' | 'monthly';
  title: string;
  tags: string[];
  contentHash: string;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeCodePoint(value: string, radix: number, fallback: string): string {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) {
      return decodeCodePoint(entity.slice(2), 16, match);
    }
    if (entity.startsWith('#')) {
      return decodeCodePoint(entity.slice(1), 10, match);
    }
    return HTML_ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
}

function htmlFragmentToText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function extractIndexableFileContent(pathValue: string, content: string): { title?: string; text: string } {
  const looksLikeHtml = /\.html?$/i.test(pathValue) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(content);
  if (!looksLikeHtml) {
    return { title: undefined, text: content };
  }

  const headingMatch = content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const titleMatch = content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = htmlFragmentToText(headingMatch?.[1] ?? titleMatch?.[1] ?? '') || undefined;
  const body = content.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? content;
  const text = htmlFragmentToText(
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '),
  );
  return { title, text };
}

function detectType(text: string): FileClassification['type'] {
  if (text.includes('daily review') || text.includes('daily-review')) {
    return 'daily-review';
  }
  if (text.includes('business review') || text.includes('business-review')) {
    return 'business-review';
  }
  if (text.includes('blog') || text.includes('dispatch')) {
    return 'blog';
  }
  if (text.includes('prd') || text.includes('product requirements')) {
    return 'prd';
  }
  if (text.includes('script') || text.includes('/scripts/')) {
    return 'script';
  }
  if (text.includes('project') || text.includes('context')) {
    return 'project-doc';
  }
  return 'one-off';
}

function detectAgent(text: string): string {
  // Generic agent detection - relies on API-driven registry for specific agents
  // Falls back to 'other' for unknown agent names
  return 'other';
}

function detectOrigin(pathValue: string, content: string): FileClassification['origin'] {
  const pathText = pathValue.toLowerCase();
  const contentText = content.toLowerCase();

  if (
    /(^|\/)memory\/\d{4}-\d{2}-\d{2}[^/]*\.md$/.test(pathText) ||
    /(^|\/)output\/(daily-|weekly-|monthly-)/.test(pathText) ||
    /(^|\/)output\/[^/]*(digest|brief|review)/.test(pathText) ||
    pathText.includes('/output/discord-insights/') ||
    pathText.includes('/output/business-ideas-digest/') ||
    pathText.includes('cron') ||
    contentText.includes('[cron]') ||
    contentText.includes('scheduled run') ||
    /^##\s*(daily|weekly)/im.test(content)
  ) {
    return 'cron';
  }

  if (
    /\bmc\s*task\s*#\d+\b/i.test(content) ||
    /\btask\s*#\d+\b/i.test(content) ||
    contentText.includes('mission-control') ||
    contentText.includes('task_id') ||
    pathText.includes('/task-output/') ||
    pathText.includes('/tasks/')
  ) {
    return 'task';
  }

  if (
    /(^|\/)notes\//.test(pathText) ||
    /(^|\/)docs\//.test(pathText) ||
    /(^|\/)projects\//.test(pathText) ||
    /(^|\/)obsidian\//.test(pathText) ||
    /(^|\/)vault\//.test(pathText)
  ) {
    return 'manual';
  }

  return 'unknown';
}

function detectRecurring(text: string): { isRecurring: boolean; recurringPattern?: 'daily' | 'weekly' | 'monthly' } {
  if (text.includes('daily') || /\b\d{4}-\d{2}-\d{2}\b/.test(text)) {
    return { isRecurring: true, recurringPattern: 'daily' };
  }
  if (text.includes('weekly') || /\bweek\b/.test(text)) {
    return { isRecurring: true, recurringPattern: 'weekly' };
  }
  if (text.includes('monthly') || /\bmonth\b/.test(text)) {
    return { isRecurring: true, recurringPattern: 'monthly' };
  }
  return { isRecurring: false };
}

function deriveTitle(pathValue: string, content?: string): string {
  if (content) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch?.[1]?.trim()) {
      return headingMatch[1].trim();
    }
  }

  const parts = pathValue.split('/');
  const fallback = parts[parts.length - 1] || pathValue;
  return fallback.replace(/\.(?:md|html?)$/i, '');
}

function deriveTags(pathValue: string, type: FileClassification['type'], agent: FileClassification['agent']): string[] {
  const tags = new Set<string>();
  tags.add(type);
  tags.add(agent);

  const pieces = pathValue
    .toLowerCase()
    .split(/[\/_\-\s]+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  for (const piece of pieces.slice(0, 5)) {
    if (piece.length > 2) {
      tags.add(piece);
    }
  }

  return Array.from(tags);
}

export function classifyFile(pathValue: string, content = ''): FileClassification {
  const indexable = extractIndexableFileContent(pathValue, content);
  const text = `${pathValue} ${indexable.text}`.toLowerCase();
  const type = detectType(text);
  const agent = detectAgent(text);
  const origin = detectOrigin(pathValue, indexable.text);
  const recurring = detectRecurring(text);
  const title = indexable.title ?? deriveTitle(pathValue, indexable.text);
  const tags = deriveTags(pathValue, type, agent);
  const contentHash = crypto.createHash('sha1').update(content).digest('hex');

  return {
    type,
    agent,
    origin,
    isRecurring: recurring.isRecurring,
    recurringPattern: recurring.recurringPattern,
    title,
    tags,
    contentHash,
  };
}
