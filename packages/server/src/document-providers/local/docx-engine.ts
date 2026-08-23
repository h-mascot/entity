import { createHash } from 'node:crypto';
import type { EvidenceArtifactRepository } from '../../../../db/src';
import type { DocumentIntegrationsRepository } from '../../../../db/src/document-integrations';
import {
  linkDocumentMutationToReceipt,
  recordDocumentActivity,
  type DocumentActivityPersistence,
  type DocumentActivityRecord,
} from '../activity-adapter';
import type { Phase2FlagSnapshot } from '../../phase2-flags';
import type { DocumentRegistry } from '../registry';
import { StaleRevisionError, UnsupportedAdapterMutationError, mutationCapability } from '../types';
import type {
  CreateArtifactInput,
  CreateArtifactResult,
  EngineReadiness,
  LocalDocumentActor,
  LocalOfficeEngine,
  MutateArtifactInput,
  MutationResult,
  OpenArtifactInput,
  OpenArtifactResult,
  SaveArtifactInput,
  SaveResult,
  ArtifactStructure,
} from './engine-spike';
import { SafeSaveError, type LocalSafeSaveCoordinator, type SafeSaveResult } from './safe-save';
import { claimLocalDocumentOperation } from './document-operation';
import {
  DEFAULT_OOXML_LIMITS,
  decodeXmlReferences,
  isWellFormedXml,
  OoxmlPackageError,
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackageLimits,
} from './ooxml-package';
export type DocxBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string; bold?: boolean; italic?: boolean }
  | { kind: 'list-item'; text: string }
  | { kind: 'table'; rows: string[][] };
export interface DocxDocument {
  title: string;
  blocks: DocxBlock[];
}
export const DOCX_LIMITS: Readonly<OoxmlPackageLimits & { maxXmlBytes: number; maxTextLength: number }> = {
  ...DEFAULT_OOXML_LIMITS,
  maxXmlBytes: 512 * 1024,
  maxTextLength: 64 * 1024,
};
export class DocxValidationError extends Error {
  constructor(
    public readonly code:
      | OoxmlPackageError['code']
      | 'invalid_docx'
      | 'macro_forbidden'
      | 'external_relationship_forbidden'
      | 'embedded_content_forbidden'
      | 'unsafe_xml'
      | 'limit_exceeded',
    message: string,
  ) {
    super(message);
    this.name = 'DocxValidationError';
  }
}
const xml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');
function run(text: string, styles = '', prefix = 'w'): string {
  const name = (localName: string): string => prefix ? `${prefix}:${localName}` : localName;
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<${name('r')}>${styles ? `<${name('rPr')}>${styles}</${name('rPr')}>` : ''}<${name('t')}${preserve}>${xml(text)}</${name('t')}></${name('r')}>`;
}
function blockXml(block: DocxBlock): string {
  switch (block.kind) {
    case 'heading':
      return `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/></w:pPr>${run(block.text)}</w:p>`;
    case 'paragraph': {
      const styles = `${block.bold ? '<w:b/>' : ''}${block.italic ? '<w:i/>' : ''}`;
      return `<w:p>${run(block.text, styles)}</w:p>`;
    }
    case 'list-item':
      return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(block.text)}</w:p>`;
    case 'table':
      return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr>${block.rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p>${run(cell)}</w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
  }
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;
const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;
function documentXml(document: DocxDocument): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${document.blocks.map(blockXml).join('')}<w:sectPr/></w:body></w:document>`;
}
function coreXml(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`;
}
function assertUnicodeScalars(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        throw new DocxValidationError('invalid_docx', 'DOCX semantic text contains an invalid Unicode scalar');
      }
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new DocxValidationError('invalid_docx', 'DOCX semantic text contains an invalid Unicode scalar');
    }
  }
}
function boundedDocument(document: DocxDocument): void {
  if (!document || typeof document !== 'object' || typeof document.title !== 'string'
    || !Array.isArray(document.blocks) || !document.title.trim()
    || document.title.length > 512 || document.blocks.length > 2_000) {
    throw new DocxValidationError('limit_exceeded', 'DOCX semantic content exceeds its limit');
  }
  assertUnicodeScalars(document.title);
  let textLength = document.title.length;
  for (const block of document.blocks) {
    if (!block || typeof block !== 'object' || !('kind' in block)) {
      throw new DocxValidationError('invalid_docx', 'DOCX semantic block is invalid');
    }
    if (block.kind === 'table') {
      if (!Array.isArray(block.rows) || block.rows.length > 256
        || block.rows.some((row) => !Array.isArray(row) || row.length > 64 || row.some((cell) => typeof cell !== 'string'))) {
        throw new DocxValidationError('limit_exceeded', 'DOCX table exceeds its limit');
      }
      block.rows.flat().forEach(assertUnicodeScalars);
      textLength += block.rows.flat().reduce((sum, cell) => sum + cell.length, 0);
    } else {
      if (!['heading', 'paragraph', 'list-item'].includes(block.kind) || typeof block.text !== 'string'
        || (block.kind === 'heading' && ![1, 2, 3].includes(block.level))) {
        throw new DocxValidationError('invalid_docx', 'DOCX semantic block is invalid');
      }
      assertUnicodeScalars(block.text);
      textLength += block.text.length;
    }
  }
  if (textLength > DOCX_LIMITS.maxTextLength) throw new DocxValidationError('limit_exceeded', 'DOCX text exceeds its limit');
}
export function createDocxPackage(document: DocxDocument): Buffer {
  boundedDocument(document);
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'docProps/core.xml', data: Buffer.from(coreXml(document.title)) },
    { name: 'word/document.xml', data: Buffer.from(documentXml(document)) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(documentRels) },
    { name: 'word/styles.xml', data: Buffer.from(styles) },
    { name: 'word/numbering.xml', data: Buffer.from(numbering) },
  ];
  const packageBytes = writeOoxmlPackage(entries);
  if (packageBytes.length > DOCX_LIMITS.maxArchiveBytes) throw new DocxValidationError('limit_exceeded', 'DOCX package exceeds its limit');
  inspectDocxPackage(packageBytes);
  return packageBytes;
}

function visibleXml(source: string): string {
  return source.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g, (value) => ' '.repeat(value.length));
}

interface XmlStartTag {
  name: string;
  attributes: ReadonlyMap<string, string>;
}

function xmlStartTags(source: string): XmlStartTag[] {
  const masked = visibleXml(source);
  const tags: XmlStartTag[] = [];
  let offset = 0;
  while ((offset = masked.indexOf('<', offset)) >= 0) {
    if (masked[offset + 1] === '/') { offset += 2; continue; }
    let quote = '';
    let end = -1;
    for (let index = offset + 1; index < masked.length; index++) {
      const character = masked[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') { end = index; break; }
    }
    if (end < 0) break;
    const content = source.slice(offset + 1, end).replace(/\/\s*$/, '');
    const name = content.match(/^[A-Za-z_][A-Za-z0-9_.:-]*/)?.[0];
    if (name) {
      const attributes = new Map<string, string>();
      for (const match of content.slice(name.length).matchAll(/([^\s=]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
        attributes.set(match[1], decodeXmlReferences(match[3]));
      }
      tags.push({ name, attributes });
    }
    offset = end + 1;
  }
  return tags;
}

const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORDPROCESSING_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wordprocessingPrefix(source: string): string {
  const root = xmlStartTags(source)[0];
  const separator = root?.name.indexOf(':') ?? -1;
  const prefix = separator >= 0 ? root.name.slice(0, separator) : '';
  if (!root || root.name.slice(separator + 1) !== 'document'
    || root.attributes.get(prefix ? `xmlns:${prefix}` : 'xmlns') !== WORDPROCESSING_NAMESPACE) {
    throw new DocxValidationError('invalid_docx', 'WordprocessingML document namespace is invalid');
  }
  return prefix;
}

function wordName(prefix: string, localName: string): string {
  return prefix ? `${prefix}:${localName}` : localName;
}

function wordPattern(prefix: string, localName: string): string {
  return wordName(prefix, localName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relationshipTags(source: string): readonly XmlStartTag[] {
  const tags = xmlStartTags(source);
  const root = tags[0];
  const separator = root?.name.indexOf(':') ?? -1;
  const prefix = separator >= 0 ? root.name.slice(0, separator) : '';
  if (!root || root.name.slice(separator + 1) !== 'Relationships'
    || root.attributes.get(prefix ? `xmlns:${prefix}` : 'xmlns') !== RELATIONSHIPS_NAMESPACE) {
    throw new DocxValidationError('invalid_docx', 'OOXML relationship namespace is invalid');
  }
  const relationshipName = prefix ? `${prefix}:Relationship` : 'Relationship';
  if (tags.slice(1).some((tag) => tag.name !== relationshipName)) {
    throw new DocxValidationError('invalid_docx', 'OOXML relationship element is invalid');
  }
  return tags.slice(1);
}

function decodeXmlTextContent(source: string): string {
  let result = '';
  let offset = 0;
  for (const match of source.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g)) {
    result += decodeXmlReferences(source.slice(offset, match.index));
    if (match[1] !== undefined) result += match[1];
    offset = match.index + match[0].length;
  }
  return result + decodeXmlReferences(source.slice(offset));
}

function textFrom(container: string, prefix: string): string {
  const textName = wordPattern(prefix, 't');
  return [...visibleXml(container).matchAll(new RegExp(`<${textName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${textName}>`, 'g'))]
    .map((match) => {
      const contentOffset = match.index + match[0].indexOf('>') + 1;
      return decodeXmlTextContent(container.slice(contentOffset, contentOffset + match[1].length));
    }).join('');
}

function parseDocumentXml(source: string): DocxBlock[] {
  const prefix = wordprocessingPrefix(source);
  const bodyName = wordPattern(prefix, 'body');
  const paragraphName = wordPattern(prefix, 'p');
  const tableName = wordPattern(prefix, 'tbl');
  const masked = visibleXml(source);
  const bodyMatch = new RegExp(`<${bodyName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${bodyName}>`).exec(masked);
  if (!bodyMatch || bodyMatch.index === undefined) throw new DocxValidationError('invalid_docx', 'DOCX document body is missing');
  const bodyOffset = bodyMatch.index + bodyMatch[0].indexOf(bodyMatch[1]);
  const body = source.slice(bodyOffset, bodyOffset + bodyMatch[1].length);
  const maskedBody = masked.slice(bodyOffset, bodyOffset + bodyMatch[1].length);
  const blocks: DocxBlock[] = [];
  const blockPattern = new RegExp(`<${paragraphName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${paragraphName}>|<${tableName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tableName}>`, 'g');
  for (const match of maskedBody.matchAll(blockPattern)) {
    const token = body.slice(match.index, match.index + match[0].length);
    if (token.startsWith(`<${wordName(prefix, 'tbl')}`)) {
      const rowName = wordPattern(prefix, 'tr');
      const cellName = wordPattern(prefix, 'tc');
      const rows = [...token.matchAll(new RegExp(`<${rowName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${rowName}>`, 'g'))].map((row) =>
        [...row[1].matchAll(new RegExp(`<${cellName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${cellName}>`, 'g'))].map((cell) => textFrom(cell[1], prefix)),
      );
      blocks.push({ kind: 'table', rows });
      continue;
    }
    const text = textFrom(token, prefix);
    const heading = token.match(new RegExp(`<${wordPattern(prefix, 'pStyle')}\\s+${wordPattern(prefix, 'val')}="Heading([123])"\\s*\\/>`));
    if (heading) blocks.push({ kind: 'heading', level: Number(heading[1]) as 1 | 2 | 3, text });
    else if (new RegExp(`<${wordPattern(prefix, 'numPr')}(?:\\s|>)`).test(token)) blocks.push({ kind: 'list-item', text });
    else {
      const bold = new RegExp(`<${wordPattern(prefix, 'b')}(?:\\s[^>]*)?\\/>`).test(token);
      const italic = new RegExp(`<${wordPattern(prefix, 'i')}(?:\\s[^>]*)?\\/>`).test(token);
      blocks.push({ kind: 'paragraph', text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
    }
  }
  return blocks;
}

function xmlPart(entries: Map<string, Buffer>, name: string): string {
  const part = entries.get(name);
  if (!part || part.length > DOCX_LIMITS.maxXmlBytes) throw new DocxValidationError('invalid_docx', `required DOCX part is missing or oversized: ${name}`);
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(part); }
  catch { throw new DocxValidationError('invalid_docx', 'DOCX XML is not valid UTF-8'); }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new DocxValidationError('unsafe_xml', 'unsafe XML declarations are forbidden');
  if (!isWellFormedXml(source)) throw new DocxValidationError('invalid_docx', 'DOCX XML is not well formed');
  return source;
}

function assertSafeRelationshipTarget(relationshipPart: string, target: string): void {
  let decoded: string;
  try { decoded = decodeURIComponent(target); }
  catch { throw new DocxValidationError('external_relationship_forbidden', 'malformed OOXML relationship target is forbidden'); }
  if (decoded.includes('\\') || decoded.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) {
    throw new DocxValidationError('external_relationship_forbidden', 'unsafe OOXML relationship target is forbidden');
  }
  const sourceDirectory = relationshipPart === '_rels/.rels'
    ? ''
    : relationshipPart.match(/^(?:(.*)\/)?_rels\/[^/]+\.rels$/)?.[1];
  if (sourceDirectory === undefined) {
    throw new DocxValidationError('invalid_docx', `invalid OOXML relationship part path: ${relationshipPart}`);
  }
  const resolved = sourceDirectory ? sourceDirectory.split('/') : [];
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) {
        throw new DocxValidationError('external_relationship_forbidden', 'unsafe OOXML relationship target is forbidden');
      }
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
}

export function inspectDocxPackage(packageBytes: Buffer): DocxDocument {
  let entries: Map<string, Buffer>;
  try { entries = readOoxmlPackage(packageBytes, DOCX_LIMITS); }
  catch (error) {
    if (error instanceof OoxmlPackageError) throw new DocxValidationError(error.code, error.message);
    throw error;
  }
  for (const [name] of entries) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) xmlPart(entries, name);
  }
  const types = decodeXmlReferences(xmlPart(entries, '[Content_Types].xml'));
  if (!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) {
    throw new DocxValidationError('invalid_docx', 'package content types do not identify a DOCX document');
  }
  if (/macroEnabled|vbaProject/i.test(types) || [...entries.keys()].some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) {
    throw new DocxValidationError('macro_forbidden', 'macro-enabled OOXML is outside the supported DOCX format');
  }
  if ([...entries.keys()].some((name) => /(^|\/)(embeddings|activeX)\//i.test(name) || /\.(exe|dll|js|vbs|cmd|bat)$/i.test(name))) {
    throw new DocxValidationError('embedded_content_forbidden', 'embedded executable content is forbidden');
  }
  const relationshipsByPart = new Map<string, readonly XmlStartTag[]>();
  for (const [name] of entries) {
    if (!name.endsWith('.rels')) continue;
    const relationships = relationshipTags(xmlPart(entries, name));
    relationshipsByPart.set(name, relationships);
    for (const relationship of relationships) {
      const type = relationship.attributes.get('Type') ?? '';
      if (/\/relationships\/(?:oleObject|package|control)$/i.test(type)) {
        throw new DocxValidationError('embedded_content_forbidden', 'embedded OOXML relationships are forbidden');
      }
      if (relationship.attributes.get('TargetMode')?.toLowerCase() === 'external') {
        throw new DocxValidationError('external_relationship_forbidden', 'external OOXML relationships are forbidden');
      }
      assertSafeRelationshipTarget(name, relationship.attributes.get('Target') ?? '');
    }
  }
  const mainDocument = xmlPart(entries, 'word/document.xml');
  if (/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:altChunk|object|OLEObject|package|control)\b/i.test(visibleXml(mainDocument))) {
    throw new DocxValidationError('embedded_content_forbidden', 'embedded or imported document content is forbidden');
  }
  const rootRelationships = relationshipsByPart.get('_rels/.rels') ?? [];
  if (!rootRelationships.some((relationship) =>
    relationship.attributes.get('Type')?.endsWith('/relationships/officeDocument')
    && relationship.attributes.get('Target') === 'word/document.xml')) {
    throw new DocxValidationError('invalid_docx', 'DOCX root relationship is missing');
  }
  const titlePart = entries.get('docProps/core.xml');
  const titleSource = titlePart ? xmlPart(entries, 'docProps/core.xml') : '';
  const title = decodeXmlReferences(titleSource.match(/<dc:title(?:\s[^>]*)?>([\s\S]*?)<\/dc:title>/)?.[1] ?? 'Untitled');
  const document: DocxDocument = { title, blocks: parseDocumentXml(mainDocument) };
  boundedDocument(document);
  return document;
}

export function docxRevision(packageBytes: Buffer): string {
  return createHash('sha256').update(packageBytes).digest('hex');
}

/** The sole T-029 structured agent lane: append one plain paragraph, preserving all other parts. */
export function appendTextToDocx(packageBytes: Buffer, text: string): Buffer {
  if (!text || text.length > DOCX_LIMITS.maxTextLength) {
    throw new DocxValidationError('limit_exceeded', 'DOCX mutation text is empty or exceeds its limit');
  }
  assertUnicodeScalars(text);
  // Validate the complete untrusted package before retaining any of its parts.
  inspectDocxPackage(packageBytes);
  const entries = readOoxmlPackage(packageBytes, DOCX_LIMITS);
  const document = xmlPart(entries, 'word/document.xml');
  const prefix = wordprocessingPrefix(document);
  const masked = visibleXml(document);
  const insertionPoint = masked.lastIndexOf(`<${wordName(prefix, 'sectPr')}`);
  const bodyEnd = masked.lastIndexOf(`</${wordName(prefix, 'body')}>`);
  const offset = insertionPoint >= 0 ? insertionPoint : bodyEnd;
  if (offset < 0) throw new DocxValidationError('invalid_docx', 'DOCX document body is not writable');
  const nextDocument = `${document.slice(0, offset)}<${wordName(prefix, 'p')}>${run(text, '', prefix)}</${wordName(prefix, 'p')}>${document.slice(offset)}`;
  entries.set('word/document.xml', Buffer.from(nextDocument));
  const candidate = writeOoxmlPackage(
    [...entries].map(([name, data]) => ({ name, data })),
  );
  // Generated candidates traverse the same validation boundary before save.
  inspectDocxPackage(candidate);
  return candidate;
}

export interface DocxEngineRuntime {
  probe: () => Promise<EngineReadiness>;
  create: (input: {
    documentRef: string;
    content: Buffer;
    idempotencyKey: string;
  }) => Promise<{ documentId: string; revision: string }>;
  read: (documentRef: string) => Promise<Buffer>;
  open: (input: OpenArtifactInput) => Promise<OpenArtifactResult>;
  save: LocalSafeSaveCoordinator['save'];
  registry: Pick<DocumentRegistry, 'create' | 'update'>;
  versions: Pick<DocumentIntegrationsRepository, 'recordDocumentVersion'>;
  events: Pick<DocumentIntegrationsRepository, 'appendEvent'>;
  operations: Pick<DocumentIntegrationsRepository, 'claimDocumentOperation' | 'completeDocumentOperation'>;
  activity: DocumentActivityPersistence;
  receipts: Pick<EvidenceArtifactRepository, 'getArtifact'>;
  flags: Phase2FlagSnapshot;
  /** Must transact registry/version/event/activity writes against their shared canonical DB. */
  transaction: <T>(work: () => T) => T;
  now?: () => string;
}

function requireDocx(format: string): void {
  if (format !== 'docx') throw new DocxValidationError('invalid_docx', 'the DOCX engine accepts only docx artifacts');
}

function requireAgentReceipt(
  actor: LocalDocumentActor,
  receipts: Pick<EvidenceArtifactRepository, 'getArtifact'>,
): void {
  if (actor.actorClass !== 'agent') return;
  const supplied = actor.receipt?.artifact;
  const persisted = supplied?.id ? receipts?.getArtifact(supplied.id) : undefined;
  if (!supplied || supplied.artifact_kind !== 'raw_task_receipt' || !persisted
    || persisted.artifact_kind !== 'raw_task_receipt'
    || persisted.content_hash !== supplied.content_hash
    || persisted.stable_path !== supplied.stable_path
    || persisted.origin_task_id !== actor.receipt.task.id
    || persisted.org_id !== actor.receipt.task.org_id
    || persisted.mutability_policy !== 'immutable_append_only'
    || persisted.integrity_state !== 'valid'
    || persisted.availability_state !== 'available') {
    throw new DocxValidationError('invalid_docx', 'agent DOCX mutations require a resolvable canonical Entity receipt');
  }
}

export class LocalDocxEngine implements LocalOfficeEngine {
  private readonly now: () => string;
  constructor(private readonly options: { workspaceId: string; runtime: DocxEngineRuntime }) {
    this.now = options.runtime.now ?? (() => new Date().toISOString());
  }
  probe(): Promise<EngineReadiness> {
    return this.options.runtime.probe();
  }

  async create(input: CreateArtifactInput): Promise<CreateArtifactResult> {
    requireDocx(input.format);
    requireAgentReceipt(input.actor, this.options.runtime.receipts);
    const content = createDocxPackage(input.document as DocxDocument);
    const operation = claimLocalDocumentOperation<CreateArtifactResult>({
      repository: this.options.runtime.operations,
      workspaceId: this.options.workspaceId,
      idempotencyKey: input.idempotencyKey,
      fingerprintInput: { operation: 'create', documentRef: input.documentRef, revision: docxRevision(content) },
    });
    if (operation.replay) return operation.replay;
    let created: { documentId: string; revision: string } | undefined;
    try {
      created = await this.options.runtime.create({ documentRef: input.documentRef, content, idempotencyKey: input.idempotencyKey });
      const revision = docxRevision(content);
      if (created.revision !== revision) throw new DocxValidationError('invalid_docx', 'managed create returned an unverifiable revision');
      await this.recordChange({ documentId: created.documentId, documentRef: input.documentRef,
        operation: 'create', actor: input.actor, priorRevision: null, resultRevision: revision,
        idempotencyKey: input.idempotencyKey, title: (input.document as DocxDocument).title });
      const result = { documentId: created.documentId, documentRef: input.documentRef,
        entityUrl: `/documents/${created.documentId}`, revision };
      operation.complete(result, created.documentId, input.documentRef);
      return result;
    } catch (error) {
      operation.uncertain(created?.documentId, input.documentRef);
      throw error;
    }
  }

  async open(input: OpenArtifactInput): Promise<OpenArtifactResult> {
    requireDocx(input.format);
    inspectDocxPackage(await this.options.runtime.read(input.documentRef));
    return this.options.runtime.open(input);
  }

  async inspect(input: OpenArtifactInput): Promise<ArtifactStructure> {
    requireDocx(input.format);
    inspectDocxPackage(await this.options.runtime.read(input.documentRef));
    return { format: 'docx', valid: true };
  }

  async mutate(input: MutateArtifactInput): Promise<MutationResult> {
    requireDocx(input.format);
    requireAgentReceipt(input.actor, this.options.runtime.receipts);
    if (input.mutation.kind !== 'text') {
      const capability = mutationCapability(input.mutation);
      throw new UnsupportedAdapterMutationError(capability, 'the DOCX engine supports only bounded text append mutation');
    }
    const mutationText = input.mutation.text;
    const saved = await this.persistCandidate(
      input,
      (before) => appendTextToDocx(before, mutationText),
      'mutate',
    );
    return { changed: true, revision: saved.revision.contentHash };
  }

  async save(input: SaveArtifactInput): Promise<SaveResult> {
    requireDocx(input.format);
    if (input.actor.actorClass === 'agent') throw new DocxValidationError('invalid_docx', 'agents must use the bounded DOCX mutation lane');
    const saved = await this.persistCandidate(input, input.candidate, 'save');
    return { saved: true, revision: saved.revision.contentHash };
  }

  private async persistCandidate(
    input: MutateArtifactInput | SaveArtifactInput,
    candidate: Buffer | ((before: Buffer) => Buffer),
    operation: 'mutate' | 'save',
  ): Promise<SafeSaveResult> {
    if (Buffer.isBuffer(candidate)) inspectDocxPackage(candidate);
    type PersistOperationOutcome =
      | { kind: 'saved'; result: SafeSaveResult }
      | { kind: 'stale'; expectedRevision: string; currentRevision: string };
    const operationRecord = claimLocalDocumentOperation<PersistOperationOutcome>({
      repository: this.options.runtime.operations,
      workspaceId: this.options.workspaceId,
      idempotencyKey: input.idempotencyKey,
      fingerprintInput: { operation, documentId: input.documentId, documentRef: input.documentRef,
        expectedRevision: input.expectedRevision,
        ...('mutation' in input ? { mutation: input.mutation } : { candidateRevision: docxRevision(input.candidate) }) },
    });
    if (operationRecord.replay) {
      if (operationRecord.replay.kind === 'stale') {
        throw new StaleRevisionError(operationRecord.replay.expectedRevision, operationRecord.replay.currentRevision);
      }
      return operationRecord.replay.result;
    }
    let saved: SafeSaveResult | undefined;
    try {
      const before = await this.options.runtime.read(input.documentRef);
      const currentRevision = docxRevision(before);
      if (currentRevision !== input.expectedRevision) {
        operationRecord.complete({ kind: 'stale', expectedRevision: input.expectedRevision, currentRevision }, input.documentId, input.documentRef);
        throw new StaleRevisionError(input.expectedRevision, currentRevision);
      }
      const preparedCandidate = Buffer.isBuffer(candidate) ? candidate : candidate(before);
      inspectDocxPackage(preparedCandidate);
      saved = await this.options.runtime.save({
        documentId: input.documentId,
        candidate: preparedCandidate,
        expectedRevision: {
          token: input.expectedRevision,
          contentHash: input.expectedRevision,
          size: before.length,
          modifiedAtMs: 0,
        },
        validate: (content) => { inspectDocxPackage(content); },
      });
      // Reopen semantically through the managed reference, not merely byte-compare the candidate.
      const reopened = await this.options.runtime.read(input.documentRef);
      inspectDocxPackage(reopened);
      const reopenedRevision = docxRevision(reopened);
      if (reopenedRevision !== saved.revision.contentHash || reopenedRevision !== docxRevision(preparedCandidate)) {
        throw new DocxValidationError('invalid_docx', 'saved DOCX revision does not match the reopened candidate');
      }
      await this.recordChange({ documentId: input.documentId, documentRef: input.documentRef,
        operation, actor: input.actor, priorRevision: input.expectedRevision,
        resultRevision: saved.revision.contentHash, idempotencyKey: input.idempotencyKey });
      operationRecord.complete({ kind: 'saved', result: saved }, input.documentId, input.documentRef);
      return saved;
    } catch (error) {
      if (error instanceof StaleRevisionError) throw error;
      if (error instanceof SafeSaveError && error.code === 'stale') {
        const latest = docxRevision(await this.options.runtime.read(input.documentRef));
        operationRecord.complete({
          kind: 'stale', expectedRevision: input.expectedRevision, currentRevision: latest,
        }, input.documentId, input.documentRef);
        throw new StaleRevisionError(input.expectedRevision, latest);
      }
      operationRecord.uncertain(input.documentId, input.documentRef);
      throw error;
    }
  }

  private async recordChange(input: {
    documentId: string;
    documentRef: string;
    operation: 'create' | 'mutate' | 'save';
    actor: LocalDocumentActor;
    priorRevision: string | null;
    resultRevision: string;
    idempotencyKey: string;
    title?: string;
  }): Promise<void> {
    const timestamp = this.now();
    let activity: DocumentActivityRecord = {
      id: input.idempotencyKey,
      documentId: input.documentId,
      provider: 'local_office',
      artifactType: 'document',
      externalId: input.documentRef,
      operationType: input.operation === 'save' ? 'mutate' : input.operation,
      actorClass: input.actor.actorClass,
      actorId: input.actor.actorId,
      priorRevision: input.priorRevision,
      resultRevision: input.resultRevision,
      timestamp,
      succeeded: true,
      reasonCode: null,
      receiptId: null,
    };
    if (input.actor.actorClass === 'agent') {
      activity = (await linkDocumentMutationToReceipt({
        receipt: input.actor.receipt,
        documentActivity: activity,
        flags: this.options.runtime.flags,
      })).documentActivity;
    }
    this.options.runtime.transaction(() => {
      if (input.operation === 'create') {
        const registered = this.options.runtime.registry.create({
          provider: 'local_office',
          artifact_type: 'document',
          title: input.title ?? 'Local document',
          external_id: input.documentRef,
          auth_state: 'authorized',
          readiness_state: 'ready',
          current_revision: input.resultRevision,
        }, this.options.workspaceId);
        if (registered.id !== input.documentId) {
          throw new DocxValidationError('invalid_docx', 'managed create returned a non-canonical document id');
        }
      } else {
        const updated = this.options.runtime.registry.update(input.documentId, this.options.workspaceId, {
          current_revision: input.resultRevision,
          provider_modified_at: timestamp,
        });
        if (!updated) throw new DocxValidationError('invalid_docx', 'canonical document revision could not be updated');
      }
      this.options.runtime.versions.recordDocumentVersion({ document_id: input.documentId,
        provider_revision: input.resultRevision, content_hash: input.resultRevision,
        actor_type: input.actor.actorClass, actor_id: input.actor.actorId,
        source: 'local_docx_engine', observed_at: timestamp });
      this.options.runtime.events.appendEvent({ document_id: input.documentId,
        event_type: input.operation, actor_type: input.actor.actorClass, actor_id: input.actor.actorId,
        provider: 'local_office', operation_id: input.idempotencyKey,
        receipt_id: activity.receiptId, idempotency_key: input.idempotencyKey,
        before_revision: input.priorRevision, after_revision: input.resultRevision, status: 'succeeded' });
      recordDocumentActivity({ activity, createActivity: this.options.runtime.activity.createActivity });
    });
  }
}
