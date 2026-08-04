import path from 'path';
import { classifyFile, type FileClassification } from './classify';

export const DOCUMENT_CONVERT_TARGET_TYPES = [
  'daily-review',
  'business-review',
  'blog',
  'prd',
  'project-doc',
  'script',
  'one-off',
] as const;

export type DocumentConvertTargetType = (typeof DOCUMENT_CONVERT_TARGET_TYPES)[number];

export interface DocumentConvertInput {
  sourceId: string;
  sourcePath: string;
  sourceContent: string;
  targetType: DocumentConvertTargetType;
  targetName?: string;
}

export interface DocumentConvertResult {
  targetPath: string;
  targetType: DocumentConvertTargetType;
  targetName: string;
  content: string;
  provenance: {
    source_id: string;
    source_path: string;
    source_type: FileClassification['type'];
    converted_at: string;
    converter: 'entity-doc-convert-v1';
  };
  preview: string;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'converted-document';
}

function stripFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: '', body: content.trim() };
  return { frontmatter: match[1], body: match[2].trim() };
}

function extractTitle(sourcePath: string, body: string, fallback: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const base = path.basename(sourcePath).replace(/\.[^.]+$/, '');
  return base || fallback;
}

function summarizeBody(body: string, maxLines = 6): string {
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, maxLines).join('\n');
}

function buildTemplateSections(targetType: DocumentConvertTargetType, title: string, body: string): string {
  const summary = summarizeBody(body);
  switch (targetType) {
    case 'daily-review':
      return [
        `# ${title}`,
        '',
        '## Wins',
        summary ? `- ${summary.split('\n')[0]}` : '- ',
        '',
        '## Blockers',
        '- ',
        '',
        '## Next',
        summary ? summary.split('\n').slice(1).map((line) => `- ${line}`).join('\n') : '- ',
      ].join('\n');
    case 'business-review':
      return [
        `# ${title}`,
        '',
        '## Executive summary',
        summary || '_Add summary._',
        '',
        '## Metrics',
        '- ',
        '',
        '## Risks / decisions',
        summary ? summary.split('\n').map((line) => `- ${line}`).join('\n') : '- ',
      ].join('\n');
    case 'blog':
      return [
        `# ${title}`,
        '',
        '## Hook',
        summary ? summary.split('\n')[0] : '_Opening hook._',
        '',
        '## Body',
        summary || '_Develop the narrative from the source document._',
        '',
        '## CTA',
        '- ',
      ].join('\n');
    case 'prd':
      return [
        `# ${title}`,
        '',
        '## Problem',
        summary || '_Describe the user problem._',
        '',
        '## Goals / non-goals',
        '- Goal:',
        '- Non-goal:',
        '',
        '## Requirements',
        summary ? summary.split('\n').map((line) => `- ${line}`).join('\n') : '- ',
        '',
        '## Success metrics',
        '- ',
      ].join('\n');
    case 'project-doc':
      return [
        `# ${title}`,
        '',
        '## Context',
        summary || '_Project background._',
        '',
        '## Scope',
        '- In scope:',
        '- Out of scope:',
        '',
        '## Notes',
        summary ? summary.split('\n').map((line) => `- ${line}`).join('\n') : '- ',
      ].join('\n');
    case 'script':
      return [
        `# ${title}`,
        '',
        '## Setup',
        summary ? summary.split('\n')[0] : '_Scene/setup._',
        '',
        '## Script',
        summary || '_Dialogue and beats._',
        '',
        '## Wrap',
        '- ',
      ].join('\n');
    default:
      return [
        `# ${title}`,
        '',
        '## Converted content',
        body || '_No source body detected._',
      ].join('\n');
  }
}

export function buildConvertedDocumentContent(input: DocumentConvertInput): DocumentConvertResult {
  const sourceClassification = classifyFile(input.sourcePath, input.sourceContent);
  const { body } = stripFrontmatter(input.sourceContent);
  const targetName = input.targetName?.trim() || extractTitle(input.sourcePath, body, `${input.targetType} document`);
  const convertedAt = new Date().toISOString();
  const transformedBody = buildTemplateSections(input.targetType, targetName, body);
  const provenance = {
    source_id: input.sourceId,
    source_path: input.sourcePath,
    source_type: sourceClassification.type,
    converted_at: convertedAt,
    converter: 'entity-doc-convert-v1' as const,
  };

  const content = [
    '---',
    `entity_document_type: ${input.targetType}`,
    `entity_source_id: ${input.sourceId}`,
    `entity_source_path: ${input.sourcePath}`,
    `entity_source_type: ${sourceClassification.type}`,
    `entity_converted_at: ${convertedAt}`,
    `entity_converter: ${provenance.converter}`,
    '---',
    '',
    transformedBody,
    '',
    '## Source provenance',
    `- Source: \`${input.sourcePath}\` (${input.sourceId})`,
    `- Original type: ${sourceClassification.type}`,
    `- Converted: ${convertedAt}`,
  ].join('\n');

  const dir = path.posix.dirname(input.sourcePath.replace(/\\/g, '/'));
  const baseSlug = slugify(targetName);
  const targetPath = path.posix.join(dir === '.' ? '' : dir, `converted/${baseSlug}.${input.targetType}.md`).replace(/^\/+/, '');

  return {
    targetPath,
    targetType: input.targetType,
    targetName,
    content,
    provenance,
    preview: transformedBody.split('\n').slice(0, 12).join('\n'),
  };
}

export function parseDocumentConvertTargetType(value: unknown): DocumentConvertTargetType | null {
  return typeof value === 'string' && (DOCUMENT_CONVERT_TARGET_TYPES as readonly string[]).includes(value)
    ? value as DocumentConvertTargetType
    : null;
}
