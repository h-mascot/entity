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
  return fallback.replace(/\.md$/i, '');
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
  const text = `${pathValue} ${content}`.toLowerCase();
  const type = detectType(text);
  const agent = detectAgent(text);
  const origin = detectOrigin(pathValue, content);
  const recurring = detectRecurring(text);
  const title = deriveTitle(pathValue, content);
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
