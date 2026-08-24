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

/** Semantic XLSX model: named sheets of uniform string cells. Values are plain text
 *  (the engine does not claim formula recalculation or number fidelity). */
export interface XlsxSheet {
  name: string;
  rows: string[][];
}
export interface XlsxWorkbook {
  title: string;
  sheets: XlsxSheet[];
}
export const XLSX_LIMITS: Readonly<OoxmlPackageLimits & { maxXmlBytes: number; maxTextLength: number; maxSheets: number; maxCols: number; maxRows: number }> = {
  ...DEFAULT_OOXML_LIMITS,
  maxXmlBytes: 512 * 1024,
  maxTextLength: 256 * 1024,
  maxSheets: 200,
  maxCols: 64,
  maxRows: 1_048_576,
};

export class XlsxValidationError extends Error {
  constructor(
    public readonly code:
      | OoxmlPackageError['code']
      | 'invalid_xlsx'
      | 'macro_forbidden'
      | 'external_relationship_forbidden'
      | 'embedded_content_forbidden'
      | 'unsafe_xml'
      | 'limit_exceeded'
      | 'range_out_of_bounds',
    message: string,
  ) {
    super(message);
    this.name = 'XlsxValidationError';
  }
}

const xml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

export function colLetter(index: number): string {
  let value = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    n = Math.floor((n - 1) / 26);
  }
  return value;
}

export function cellReference(row: number, col: number): string {
  return `${colLetter(col)}${row + 1}`;
}

/** Resolve a spreadsheet cell reference (e.g. "B3", "AA10") to 0-based {row, col}. */
export function parseCellReference(reference: string): { row: number; col: number } {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(reference);
  if (!match) throw new XlsxValidationError('range_out_of_bounds', `invalid XLSX cell reference: ${reference}`);
  let col = 0;
  for (const character of match[1].toUpperCase()) col = col * 26 + (character.charCodeAt(0) - 64);
  const row = Number(match[2]) - 1;
  if (col - 1 >= XLSX_LIMITS.maxCols || row >= XLSX_LIMITS.maxRows) {
    throw new XlsxValidationError('range_out_of_bounds', `XLSX cell reference is out of bounds: ${reference}`);
  }
  return { row, col: col - 1 };
}

function assertUnicodeScalars(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        throw new XlsxValidationError('invalid_xlsx', 'XLSX semantic text contains an invalid Unicode scalar');
      }
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new XlsxValidationError('invalid_xlsx', 'XLSX semantic text contains an invalid Unicode scalar');
    }
  }
}

function boundedWorkbook(workbook: XlsxWorkbook): void {
  if (!workbook || typeof workbook !== 'object' || typeof workbook.title !== 'string'
    || !Array.isArray(workbook.sheets) || workbook.sheets.length === 0
    || workbook.sheets.length > XLSX_LIMITS.maxSheets) {
    throw new XlsxValidationError('limit_exceeded', 'XLSX semantic content exceeds its limit');
  }
  assertUnicodeScalars(workbook.title);
  const seenNames = new Set<string>();
  let textLength = workbook.title.length;
  for (const sheet of workbook.sheets) {
    if (!sheet || typeof sheet.name !== 'string' || !sheet.name.trim()
      || sheet.name.length > 64 || !Array.isArray(sheet.rows)
      || sheet.rows.length > XLSX_LIMITS.maxRows) {
      throw new XlsxValidationError('limit_exceeded', 'XLSX sheet exceeds its limit');
    }
    if (seenNames.has(sheet.name)) throw new XlsxValidationError('invalid_xlsx', 'XLSX sheet names must be unique');
    seenNames.add(sheet.name);
    assertUnicodeScalars(sheet.name);
    for (const row of sheet.rows) {
      if (!Array.isArray(row) || row.length > XLSX_LIMITS.maxCols || row.some((cell) => typeof cell !== 'string')) {
        throw new XlsxValidationError('limit_exceeded', 'XLSX row exceeds its limit');
      }
      row.forEach(assertUnicodeScalars);
      textLength += row.reduce((sum, cell) => sum + cell.length, 0);
    }
  }
  if (textLength > XLSX_LIMITS.maxTextLength) throw new XlsxValidationError('limit_exceeded', 'XLSX text exceeds its limit');
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/_rels/workbook.xml.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const workbookRels = (count: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${Array.from({ length: count }, (_, index) => `  <Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('\n')}
</Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><name val="Calibri"/><family val="2"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

function workbookXml(workbook: XlsxWorkbook): string {
  const sheets = workbook.sheets.map((sheet, index) =>
    `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const body = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => {
      const reference = cellReference(rowIndex, colIndex);
      if (cell === '') return `<c r="${reference}"/>`;
      return `<c r="${reference}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function coreXml(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`;
}

export function createXlsxPackage(workbook: XlsxWorkbook): Buffer {
  boundedWorkbook(workbook);
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'docProps/core.xml', data: Buffer.from(coreXml(workbook.title)) },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(workbook)) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels(workbook.sheets.length)) },
    { name: 'xl/styles.xml', data: Buffer.from(styles) },
  ];
  workbook.sheets.forEach((sheet, index) => {
    entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: Buffer.from(sheetXml(sheet)) });
  });
  const packageBytes = writeOoxmlPackage(entries);
  if (packageBytes.length > XLSX_LIMITS.maxArchiveBytes) throw new XlsxValidationError('limit_exceeded', 'XLSX package exceeds its limit');
  inspectXlsxPackage(packageBytes);
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
const SPREADSHEET_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function worksheetPrefix(source: string): string {
  const root = xmlStartTags(source)[0];
  const separator = root?.name.indexOf(':') ?? -1;
  const prefix = separator >= 0 ? root.name.slice(0, separator) : '';
  if (!root || root.name.slice(separator + 1) !== 'worksheet'
    || root.attributes.get(prefix ? `xmlns:${prefix}` : 'xmlns') !== SPREADSHEET_NAMESPACE) {
    throw new XlsxValidationError('invalid_xlsx', 'SpreadsheetML worksheet namespace is invalid');
  }
  return prefix;
}

function localName(prefix: string, localName: string): string {
  return prefix ? `${prefix}:${localName}` : localName;
}

function localPattern(prefix: string, element: string): string {
  return localName(prefix, element).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relationshipTags(source: string): readonly XmlStartTag[] {
  const tags = xmlStartTags(source);
  const root = tags[0];
  const separator = root?.name.indexOf(':') ?? -1;
  const prefix = separator >= 0 ? root.name.slice(0, separator) : '';
  if (!root || root.name.slice(separator + 1) !== 'Relationships'
    || root.attributes.get(prefix ? `xmlns:${prefix}` : 'xmlns') !== RELATIONSHIPS_NAMESPACE) {
    throw new XlsxValidationError('invalid_xlsx', 'OOXML relationship namespace is invalid');
  }
  const relationshipName = prefix ? `${prefix}:Relationship` : 'Relationship';
  if (tags.slice(1).some((tag) => tag.name !== relationshipName)) {
    throw new XlsxValidationError('invalid_xlsx', 'OOXML relationship element is invalid');
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

/**
 * Split a masked XML fragment into the source slices of each direct child of `openName`.
 * Cells and rows in SpreadsheetML are never nested inside one another, so a flat scan is
 * exact: for every `<open ...>` start we pair it with the nearest following `</close>`,
 * and self-closing `<open .../>` elements are returned as empty slices.
 */
function splitChildren(source: string, maskedSource: string, openName: string, closeName: string): string[] {
  const children: string[] = [];
  const openTag = `<${openName}`;
  const closeTag = `</${closeName}>`;
  let scan = 0;
  while (scan < maskedSource.length) {
    const openIndex = maskedSource.indexOf(openTag, scan);
    if (openIndex < 0) break;
    // Find the end of this start tag (">" not inside quotes).
    let arrow = openIndex + openTag.length;
    let quote = '';
    let selfClosing = false;
    for (; arrow < maskedSource.length; arrow++) {
      const character = maskedSource[arrow];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    const head = maskedSource.slice(openIndex + openTag.length, arrow);
    // Reject self-closing `<open .../>` (a `/` immediately before `>`).
    selfClosing = /\/\s*$/.test(head);
    if (selfClosing) {
      children.push(source.slice(openIndex, arrow + 1));
      scan = arrow + 1;
      continue;
    }
    const closeIndex = maskedSource.indexOf(closeTag, arrow + 1);
    if (closeIndex < 0) throw new XlsxValidationError('invalid_xlsx', `unbalanced XLSX element: ${openName}`);
    children.push(source.slice(openIndex, closeIndex + closeTag.length));
    scan = closeIndex + closeTag.length;
  }
  return children;
}

function decodeInlineCell(cellSlice: string, prefix: string): string {
  // Our inline strings are `<t ...>text</t>` (possibly CDATA/entity escaped). Decode any
  // inline t content, ignoring the shared string formula/shared infrastructure.
  const tName = localPattern(prefix, 't');
  const regex = new RegExp(`<${tName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tName}>`, 'g');
  const masked = visibleXml(cellSlice);
  let result = '';
  for (const match of masked.matchAll(regex)) {
    const contentOffset = match.index + match[0].indexOf('>') + 1;
    result += decodeXmlTextContent(cellSlice.slice(contentOffset, contentOffset + match[1].length));
  }
  return result;
}

function parseSheetXml(source: string): string[][] {
  const prefix = worksheetPrefix(source);
  const sheetDataName = localPattern(prefix, 'sheetData');
  const rowName = localPattern(prefix, 'row');
  const closeRow = localPattern(prefix, 'row');
  const cellName = localPattern(prefix, 'c');
  const closeCell = localPattern(prefix, 'c');
  const closeSheetData = localPattern(prefix, 'sheetData');
  const masked = visibleXml(source);
  const dataChildren = splitChildren(source, masked, sheetDataName, closeSheetData);
  if (dataChildren.length === 0) return [];
  const sheetDataSlice = dataChildren[0];
  const sheetDataMasked = visibleXml(sheetDataSlice);

  const rows: string[][] = [];
  for (const rowSlice of splitChildren(sheetDataSlice, sheetDataMasked, rowName, closeRow)) {
    const rowMasked = visibleXml(rowSlice);
    const rowBody = rowMasked.slice(rowMasked.indexOf('>') + 1, rowMasked.lastIndexOf(`${closeRow}`));
    if (!rowBody.trim() || rowBody.includes(`<${rowName}`)) continue; // blank or nested row
    const cells: string[] = [];
    for (const cellSlice of splitChildren(rowSlice, rowMasked, cellName, closeCell)) {
      const cellMasked = visibleXml(cellSlice);
      if (cellMasked.includes(`<${localPattern(prefix, 'is')}`)) {
        cells.push(decodeInlineCell(cellSlice, prefix));
      } else {
        cells.push('');
      }
    }
    rows.push(cells);
  }
  return rows;
}

function xmlPart(entries: Map<string, Buffer>, name: string): string {
  const part = entries.get(name);
  if (!part || part.length > XLSX_LIMITS.maxXmlBytes) throw new XlsxValidationError('invalid_xlsx', `required XLSX part is missing or oversized: ${name}`);
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(part); }
  catch { throw new XlsxValidationError('invalid_xlsx', 'XLSX XML is not valid UTF-8'); }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new XlsxValidationError('unsafe_xml', 'unsafe XML declarations are forbidden');
  if (!isWellFormedXml(source)) throw new XlsxValidationError('invalid_xlsx', 'XLSX XML is not well formed');
  return source;
}

function assertSafeRelationshipTarget(relationshipPart: string, target: string): void {
  let decoded: string;
  try { decoded = decodeURIComponent(target); }
  catch { throw new XlsxValidationError('external_relationship_forbidden', 'malformed OOXML relationship target is forbidden'); }
  if (decoded.includes('\\') || decoded.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) {
    throw new XlsxValidationError('external_relationship_forbidden', 'unsafe OOXML relationship target is forbidden');
  }
  const sourceDirectory = relationshipPart === '_rels/.rels'
    ? ''
    : relationshipPart.match(/^(?:(.*)\/)?_rels\/[^/]+\.rels$/)?.[1];
  if (sourceDirectory === undefined) {
    throw new XlsxValidationError('invalid_xlsx', `invalid OOXML relationship part path: ${relationshipPart}`);
  }
  const resolved = sourceDirectory ? sourceDirectory.split('/') : [];
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) throw new XlsxValidationError('external_relationship_forbidden', 'unsafe OOXML relationship target is forbidden');
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
}

function sheetNameFromWorkbook(workbookSource: string, sheetId: string, prefix: string): string {
  const sheetTag = xmlStartTags(workbookSource).find((tag) =>
    tag.name === `${prefix ? `${prefix}:` : ''}sheet` && tag.attributes.get('sheetId') === sheetId);
  const raw = sheetTag?.attributes.get('name')?.trim();
  return raw && raw.length > 0 ? raw : `Sheet${sheetId}`;
}

export function inspectXlsxPackage(packageBytes: Buffer): XlsxWorkbook {
  let entries: Map<string, Buffer>;
  try { entries = readOoxmlPackage(packageBytes, XLSX_LIMITS); }
  catch (error) {
    if (error instanceof OoxmlPackageError) throw new XlsxValidationError(error.code, error.message);
    throw error;
  }
  for (const [name] of entries) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) xmlPart(entries, name);
  }
  const types = decodeXmlReferences(xmlPart(entries, '[Content_Types].xml'));
  if (!types.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) {
    throw new XlsxValidationError('invalid_xlsx', 'package content types do not identify an XLSX workbook');
  }
  if (/macroEnabled|vbaProject/i.test(types) || [...entries.keys()].some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) {
    throw new XlsxValidationError('macro_forbidden', 'macro-enabled OOXML is outside the supported XLSX format');
  }
  if ([...entries.keys()].some((name) => /(^|\/)(embeddings|activeX)\//i.test(name) || /\.(exe|dll|js|vbs|cmd|bat)$/i.test(name))) {
    throw new XlsxValidationError('embedded_content_forbidden', 'embedded executable content is forbidden');
  }
  const relationshipsByPart = new Map<string, readonly XmlStartTag[]>();
  for (const [name] of entries) {
    if (!name.endsWith('.rels')) continue;
    const relationships = relationshipTags(xmlPart(entries, name));
    relationshipsByPart.set(name, relationships);
    for (const relationship of relationships) {
      const type = relationship.attributes.get('Type') ?? '';
      if (/\/relationships\/(?:oleObject|package|control)$/i.test(type)) {
        throw new XlsxValidationError('embedded_content_forbidden', 'embedded OOXML relationships are forbidden');
      }
      if (relationship.attributes.get('TargetMode')?.toLowerCase() === 'external') {
        throw new XlsxValidationError('external_relationship_forbidden', 'external OOXML relationships are forbidden');
      }
      assertSafeRelationshipTarget(name, relationship.attributes.get('Target') ?? '');
    }
  }
  const rootRelationships = relationshipsByPart.get('_rels/.rels') ?? [];
  if (!rootRelationships.some((relationship) =>
    relationship.attributes.get('Type')?.endsWith('/relationships/officeDocument')
    && relationship.attributes.get('Target') === 'xl/workbook.xml')) {
    throw new XlsxValidationError('invalid_xlsx', 'XLSX root relationship is missing');
  }
  const workbookSource = xmlPart(entries, 'xl/workbook.xml');
  if (/<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:oleObject|object|OLEObject|package|control|externalLink)\b/i.test(visibleXml(workbookSource))) {
    throw new XlsxValidationError('embedded_content_forbidden', 'embedded or imported workbook content is forbidden');
  }
  const workbookRelationships = relationshipsByPart.get('xl/_rels/workbook.xml.rels') ?? [];
  const worksheetTargets = workbookRelationships
    .filter((relationship) => relationship.attributes.get('Type')?.endsWith('/relationships/worksheet'))
    .map((relationship) => (relationship.attributes.get('Target') ?? '').replace(/^\//, '').replace(/^\.\//, ''));
  if (worksheetTargets.length === 0) throw new XlsxValidationError('invalid_xlsx', 'XLSX workbook has no worksheet');

  const workbookPrefix = (() => {
    const root = xmlStartTags(workbookSource)[0];
    const sep = root?.name.indexOf(':') ?? -1;
    return sep >= 0 ? root.name.slice(0, sep) : '';
  })();

  const sheets: XlsxSheet[] = [];
  const usedNames = new Set<string>();
  worksheetTargets.forEach((target, index) => {
    const partName = `xl/${target}`;
    if (!entries.has(partName)) throw new XlsxValidationError('invalid_xlsx', `XLSX worksheet part is missing: ${partName}`);
    const prefix = worksheetPrefix(xmlPart(entries, partName));
    const rows = parseSheetXml(xmlPart(entries, partName));
    const name = sheetNameFromWorkbook(workbookSource, String(index + 1), workbookPrefix);
    if (usedNames.has(name)) throw new XlsxValidationError('invalid_xlsx', 'XLSX sheet names must be unique');
    usedNames.add(name);
    sheets.push({ name, rows });
  });

  const titlePart = entries.get('docProps/core.xml');
  const titleSource = titlePart ? xmlPart(entries, 'docProps/core.xml') : '';
  const title = decodeXmlReferences(titleSource.match(/<dc:title(?:\s[^>]*)?>([\s\S]*?)<\/dc:title>/)?.[1] ?? 'Untitled');
  const workbook: XlsxWorkbook = { title, sheets };
  boundedWorkbook(workbook);
  return workbook;
}

export function xlsxRevision(packageBytes: Buffer): string {
  return createHash('sha256').update(packageBytes).digest('hex');
}

/** The sole T-030 structured agent lane: authorized mutation of one bounded cell range in the first sheet. */
export function setXlsxRange(packageBytes: Buffer, cell: string, value: string): Buffer {
  if (value.length > XLSX_LIMITS.maxTextLength) throw new XlsxValidationError('limit_exceeded', 'XLSX range value exceeds its limit');
  assertUnicodeScalars(value);
  const bounds = parseCellReference(cell);
  // Validate the complete untrusted package before retaining any of its parts.
  inspectXlsxPackage(packageBytes);
  const entries = readOoxmlPackage(packageBytes, XLSX_LIMITS);
  const worksheetPart = 'xl/worksheets/sheet1.xml';
  const sheetSource = xmlPart(entries, worksheetPart);
  const prefix = worksheetPrefix(sheetSource);
  const sheetDataName = localPattern(prefix, 'sheetData');
  const closeSheetData = localPattern(prefix, 'sheetData');
  const rowName = localPattern(prefix, 'row');
  const closeRow = localPattern(prefix, 'row');
  const cellName = localPattern(prefix, 'c');
  const closeCell = localPattern(prefix, 'c');
  const masked = visibleXml(sheetSource);

  const dataChildren = splitChildren(sheetSource, masked, sheetDataName, closeSheetData);
  if (dataChildren.length === 0) throw new XlsxValidationError('invalid_xlsx', 'XLSX sheetData is not writable');
  const dataStart = sheetSource.indexOf(dataChildren[0]);
  const sheetDataSlice = dataChildren[0];
  const sheetDataMasked = visibleXml(sheetDataSlice);

  const targetReference = cellReference(bounds.row, bounds.col);
  let updated = 0;
  const rewrittenRows: string[] = [];
  for (const rowSlice of splitChildren(sheetDataSlice, sheetDataMasked, rowName, closeRow)) {
    const rowMasked = visibleXml(rowSlice);
    const rowBody = rowMasked.slice(rowMasked.indexOf('>') + 1, rowMasked.lastIndexOf(`${closeRow}`));
    if (!rowBody.trim() || rowBody.includes(`<${rowName}`)) { rewrittenRows.push(rowSlice); continue; }
    let rowChanged = false;
    const rewrittenCells: string[] = [];
    for (const cellSlice of splitChildren(rowSlice, rowMasked, cellName, closeCell)) {
      const cellMasked = visibleXml(cellSlice);
      const ref = xmlStartTags(cellSlice)[0]?.attributes.get('r');
      if (ref === targetReference) {
        const newCell = value === ''
          ? `<${localName(prefix, 'c')} r="${targetReference}"/>`
          : `<${localName(prefix, 'c')} r="${targetReference}" t="inlineStr"><${localName(prefix, 'is')}><${localName(prefix, 't')}>${xml(value)}</${localName(prefix, 't')}></${localName(prefix, 'is')}></${localName(prefix, 'c')}>`;
        rewrittenCells.push(newCell);
        rowChanged = true;
        updated++;
        continue;
      }
      rewrittenCells.push(cellSlice);
    }
    rewrittenRows.push(rowChanged ? `<${localName(prefix, 'row')} r="${rowIndexOf(rowSlice)}">${rewrittenCells.join('')}</${localName(prefix, 'row')}>` : rowSlice);
  }
  if (updated === 0) {
    throw new XlsxValidationError('range_out_of_bounds', `no existing cell at ${targetReference} was authorized for mutation`);
  }
  if (updated > 1) throw new XlsxValidationError('invalid_xlsx', `ambiguous XLSX cell mutation at ${targetReference}`);

  const newSheetData = `<${sheetDataName}>${rewrittenRows.join('')}</${closeSheetData}>`;
  const nextSheet = `${sheetSource.slice(0, dataStart)}${newSheetData}${sheetSource.slice(dataStart + sheetDataSlice.length)}`;
  entries.set(worksheetPart, Buffer.from(nextSheet));
  const candidate = writeOoxmlPackage(
    [...entries].map(([name, data]) => ({ name, data })),
  );
  inspectXlsxPackage(candidate);
  return candidate;
}

function rowIndexOf(rowSlice: string): string {
  const attr = xmlStartTags(rowSlice)[0]?.attributes.get('r');
  return attr?.trim() ?? '';
}

export interface XlsxEngineRuntime {
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
  transaction: <T>(work: () => T) => T;
  now?: () => string;
}

function requireXlsx(format: string): void {
  if (format !== 'xlsx') throw new XlsxValidationError('invalid_xlsx', 'the XLSX engine accepts only xlsx artifacts');
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
    throw new XlsxValidationError('invalid_xlsx', 'agent XLSX mutations require a resolvable canonical Entity receipt');
  }
}

export class LocalXlsxEngine implements LocalOfficeEngine {
  private readonly now: () => string;
  constructor(private readonly options: { workspaceId: string; runtime: XlsxEngineRuntime }) {
    this.now = options.runtime.now ?? (() => new Date().toISOString());
  }
  probe(): Promise<EngineReadiness> {
    return this.options.runtime.probe();
  }

  async create(input: CreateArtifactInput): Promise<CreateArtifactResult> {
    requireXlsx(input.format);
    requireAgentReceipt(input.actor, this.options.runtime.receipts);
    const content = createXlsxPackage(input.document as XlsxWorkbook);
    const operation = claimLocalDocumentOperation<CreateArtifactResult>({
      repository: this.options.runtime.operations,
      workspaceId: this.options.workspaceId,
      idempotencyKey: input.idempotencyKey,
      fingerprintInput: { operation: 'create', documentRef: input.documentRef, revision: xlsxRevision(content) },
    });
    if (operation.replay) return operation.replay;
    let created: { documentId: string; revision: string } | undefined;
    try {
      created = await this.options.runtime.create({ documentRef: input.documentRef, content, idempotencyKey: input.idempotencyKey });
      const revision = xlsxRevision(content);
      if (created.revision !== revision) throw new XlsxValidationError('invalid_xlsx', 'managed create returned an unverifiable revision');
      await this.recordChange({ documentId: created.documentId, documentRef: input.documentRef,
        operation: 'create', actor: input.actor, priorRevision: null, resultRevision: revision,
        idempotencyKey: input.idempotencyKey, title: (input.document as XlsxWorkbook).title });
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
    requireXlsx(input.format);
    inspectXlsxPackage(await this.options.runtime.read(input.documentRef));
    return this.options.runtime.open(input);
  }

  async inspect(input: OpenArtifactInput): Promise<ArtifactStructure> {
    requireXlsx(input.format);
    inspectXlsxPackage(await this.options.runtime.read(input.documentRef));
    return { format: 'xlsx', valid: true };
  }

  async mutate(input: MutateArtifactInput): Promise<MutationResult> {
    requireXlsx(input.format);
    requireAgentReceipt(input.actor, this.options.runtime.receipts);
    if (input.mutation.kind !== 'range') {
      const capability = mutationCapability(input.mutation);
      throw new UnsupportedAdapterMutationError(capability, 'the XLSX engine supports only bounded authorized range mutation');
    }
    const { cell, value } = input.mutation;
    const saved = await this.persistCandidate(
      input,
      (before) => setXlsxRange(before, cell, value),
      'mutate',
    );
    return { changed: true, revision: saved.revision.contentHash };
  }

  async save(input: SaveArtifactInput): Promise<SaveResult> {
    requireXlsx(input.format);
    if (input.actor.actorClass === 'agent') throw new XlsxValidationError('invalid_xlsx', 'agents must use the bounded XLSX mutation lane');
    const saved = await this.persistCandidate(input, input.candidate, 'save');
    return { saved: true, revision: saved.revision.contentHash };
  }

  private async persistCandidate(
    input: MutateArtifactInput | SaveArtifactInput,
    candidate: Buffer | ((before: Buffer) => Buffer),
    operation: 'mutate' | 'save',
  ): Promise<SafeSaveResult> {
    if (Buffer.isBuffer(candidate)) inspectXlsxPackage(candidate);
    type PersistOperationOutcome =
      | { kind: 'saved'; result: SafeSaveResult }
      | { kind: 'stale'; expectedRevision: string; currentRevision: string };
    const operationRecord = claimLocalDocumentOperation<PersistOperationOutcome>({
      repository: this.options.runtime.operations,
      workspaceId: this.options.workspaceId,
      idempotencyKey: input.idempotencyKey,
      fingerprintInput: { operation, documentId: input.documentId, documentRef: input.documentRef,
        expectedRevision: input.expectedRevision,
        ...('mutation' in input ? { mutation: input.mutation } : { candidateRevision: xlsxRevision(input.candidate) }) },
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
      const currentRevision = xlsxRevision(before);
      if (currentRevision !== input.expectedRevision) {
        operationRecord.complete({ kind: 'stale', expectedRevision: input.expectedRevision, currentRevision }, input.documentId, input.documentRef);
        throw new StaleRevisionError(input.expectedRevision, currentRevision);
      }
      const preparedCandidate = Buffer.isBuffer(candidate) ? candidate : candidate(before);
      inspectXlsxPackage(preparedCandidate);
      saved = await this.options.runtime.save({
        documentId: input.documentId,
        candidate: preparedCandidate,
        expectedRevision: {
          token: input.expectedRevision,
          contentHash: input.expectedRevision,
          size: before.length,
          modifiedAtMs: 0,
        },
        validate: (content) => { inspectXlsxPackage(content); },
      });
      const reopened = await this.options.runtime.read(input.documentRef);
      inspectXlsxPackage(reopened);
      const reopenedRevision = xlsxRevision(reopened);
      if (reopenedRevision !== saved.revision.contentHash || reopenedRevision !== xlsxRevision(preparedCandidate)) {
        throw new XlsxValidationError('invalid_xlsx', 'saved XLSX revision does not match the reopened candidate');
      }
      await this.recordChange({ documentId: input.documentId, documentRef: input.documentRef,
        operation, actor: input.actor, priorRevision: input.expectedRevision,
        resultRevision: saved.revision.contentHash, idempotencyKey: input.idempotencyKey });
      operationRecord.complete({ kind: 'saved', result: saved }, input.documentId, input.documentRef);
      return saved;
    } catch (error) {
      if (error instanceof StaleRevisionError) throw error;
      if (error instanceof SafeSaveError && error.code === 'stale') {
        const latest = xlsxRevision(await this.options.runtime.read(input.documentRef));
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
          title: input.title ?? 'Local spreadsheet',
          external_id: input.documentRef,
          auth_state: 'authorized',
          readiness_state: 'ready',
          current_revision: input.resultRevision,
        }, this.options.workspaceId);
        if (registered.id !== input.documentId) {
          throw new XlsxValidationError('invalid_xlsx', 'managed create returned a non-canonical document id');
        }
      } else {
        const updated = this.options.runtime.registry.update(input.documentId, this.options.workspaceId, {
          current_revision: input.resultRevision,
          provider_modified_at: timestamp,
        });
        if (!updated) throw new XlsxValidationError('invalid_xlsx', 'canonical document revision could not be updated');
      }
      this.options.runtime.versions.recordDocumentVersion({ document_id: input.documentId,
        provider_revision: input.resultRevision, content_hash: input.resultRevision,
        actor_type: input.actor.actorClass, actor_id: input.actor.actorId,
        source: 'local_xlsx_engine', observed_at: timestamp });
      this.options.runtime.events.appendEvent({ document_id: input.documentId,
        event_type: input.operation, actor_type: input.actor.actorClass, actor_id: input.actor.actorId,
        provider: 'local_office', operation_id: input.idempotencyKey,
        receipt_id: activity.receiptId, idempotency_key: input.idempotencyKey,
        before_revision: input.priorRevision, after_revision: input.resultRevision, status: 'succeeded' });
      recordDocumentActivity({ activity, createActivity: this.options.runtime.activity.createActivity });
    });
  }
}
