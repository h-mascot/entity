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

/**
 * T-031 local PPTX milestone (THE-972). Semantic PresentationML presentation.
 *
 * The engine treats a presentation as an ordered list of slides, each with stable slide ids
 * and ordered text elements (title/subtitle/body/notes). It creates/reopens a real OOXML
 * PPTX ZIP package, exposes a bounded agent slide-text mutation, and fails closed on any
 * malformed, unknown, macro-enabled, embedded, external, or oversized content. Images and
 * full rendering fidelity are deliberately outside this gate (PRD 16.6 non-goal).
 */

export type PptxElementKind = 'title' | 'subtitle' | 'body' | 'notes';
export interface PptxSlideElement {
  id: string;
  kind: PptxElementKind;
  text: string;
}
export interface PptxSlide {
  id: string;
  elements: PptxSlideElement[];
}
export interface PptxPresentation {
  title: string;
  slides: PptxSlide[];
}

export const PPTX_LIMITS: Readonly<
  OoxmlPackageLimits & { maxXmlBytes: number; maxTextLength: number; maxSlides: number; maxElementsPerSlide: number; maxElementTextLength: number; maxTotalTextLength: number }
> = {
  ...DEFAULT_OOXML_LIMITS,
  maxXmlBytes: 512 * 1024,
  maxTextLength: 16 * 1024, // total across the presentation for the engine's own authored content
  maxSlides: 200,
  maxElementsPerSlide: 40,
  maxElementTextLength: 10_000, // matches the canonical §12.5 type bound (google MAX_SLIDE_TEXT_LENGTH)
  maxTotalTextLength: 256 * 1024,
};

export class PptxValidationError extends Error {
  constructor(
    public readonly code:
      | OoxmlPackageError['code']
      | 'invalid_pptx'
      | 'macro_forbidden'
      | 'external_relationship_forbidden'
      | 'embedded_content_forbidden'
      | 'unsafe_xml'
      | 'limit_exceeded'
      | 'slide_target_not_found',
    message: string,
  ) {
    super(message);
    this.name = 'PptxValidationError';
  }
}

const xml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function assertUnicodeScalars(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        throw new PptxValidationError('invalid_pptx', 'PPTX semantic text contains an invalid Unicode scalar');
      }
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new PptxValidationError('invalid_pptx', 'PPTX semantic text contains an invalid Unicode scalar');
    }
  }
}

const STABLE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function boundedPresentation(presentation: PptxPresentation): void {
  if (!presentation || typeof presentation !== 'object' || typeof presentation.title !== 'string'
    || !Array.isArray(presentation.slides) || presentation.slides.length === 0
    || presentation.slides.length > PPTX_LIMITS.maxSlides) {
    throw new PptxValidationError('limit_exceeded', 'PPTX semantic content exceeds its limit');
  }
  assertUnicodeScalars(presentation.title);
  if (presentation.title.length > 512) throw new PptxValidationError('limit_exceeded', 'PPTX title exceeds its limit');
  const seenSlideIds = new Set<string>();
  let totalText = presentation.title.length;
  for (const slide of presentation.slides) {
    if (!slide || typeof slide !== 'object' || typeof slide.id !== 'string' || !STABLE_ID_PATTERN.test(slide.id)) {
      throw new PptxValidationError('invalid_pptx', 'PPTX slide id is invalid');
    }
    if (seenSlideIds.has(slide.id)) throw new PptxValidationError('invalid_pptx', 'PPTX slide ids must be unique');
    seenSlideIds.add(slide.id);
    if (!Array.isArray(slide.elements) || slide.elements.length === 0
      || slide.elements.length > PPTX_LIMITS.maxElementsPerSlide) {
      throw new PptxValidationError('limit_exceeded', 'PPTX slide element count exceeds its limit');
    }
    const seenElementIds = new Set<string>();
    for (const element of slide.elements) {
      if (!element || typeof element !== 'object' || typeof element.id !== 'string'
        || !STABLE_ID_PATTERN.test(element.id) || typeof element.text !== 'string'
        || !['title', 'subtitle', 'body', 'notes'].includes(element.kind)) {
        throw new PptxValidationError('invalid_pptx', 'PPTX slide element is invalid');
      }
      if (seenElementIds.has(element.id)) throw new PptxValidationError('invalid_pptx', 'PPTX element ids must be unique within a slide');
      seenElementIds.add(element.id);
      assertUnicodeScalars(element.text);
      if (element.text.length > PPTX_LIMITS.maxElementTextLength) {
        throw new PptxValidationError('limit_exceeded', 'PPTX element text exceeds its limit');
      }
      totalText += element.text.length;
    }
  }
  if (totalText > PPTX_LIMITS.maxTotalTextLength) throw new PptxValidationError('limit_exceeded', 'PPTX total text exceeds its limit');
}

/* =============================================================================
 * Package authoring
 * ============================================================================= */

const PRESENTATION_NAMESPACE = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAWING_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

/** presentation.xml.rels: rId1..N slides, plus one slide master and one theme. */
function presentationRels(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, i) =>
    `  <Relationship Id="rId${i + 1}" Type="${OFFICE_RELATIONSHIPS}/slide" Target="slides/slide${i + 1}.xml"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">
${slides}
  <Relationship Id="rIdMaster" Type="${OFFICE_RELATIONSHIPS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rIdTheme" Type="${OFFICE_RELATIONSHIPS}/theme" Target="theme/theme1.xml"/>
</Relationships>`;
}

function slideMasterRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="rIdTheme" Type="${OFFICE_RELATIONSHIPS}/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${DRAWING_NAMESPACE}" name="Entity">
  <a:themeElements>
    <a:clrScheme name="Entity">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Entity"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Entity">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:noFill/></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:bgFillRef><a:schemeClr val="phClr"/></a:bgFillRef></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`;

const slideMasterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${DRAWING_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS}" xmlns:p="${PRESENTATION_NAMESPACE}">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
  </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rIdLayout1"/></p:sldLayoutIdLst>
  <p:txStyles/>
</p:sldMaster>`;

function shapeXml(element: PptxSlideElement, shapeId: string): string {
  const preserve = /^\s|\s$/.test(element.text) ? ' xml:space="preserve"' : '';
  // Notes are carried as an authored notes part body rather than a slide shape.
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${xml(element.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t${preserve}>${xml(element.text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function slideXml(elements: PptxSlideElement[], shapeIdOffset: number): string {
  const shapes = elements.map((element, index) => shapeXml(element, String(shapeIdOffset + index))).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${DRAWING_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS}" xmlns:p="${PRESENTATION_NAMESPACE}">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr><p:nvPr/></p:cNvGrpSpPr></p:nvGrpSpPr>
    <p:grpSpPr/>
    ${shapes}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function presentationXml(slideCount: number): string {
  const ids = Array.from({ length: slideCount }, (_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${DRAWING_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIPS}" xmlns:p="${PRESENTATION_NAMESPACE}">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>
  <p:sldIdLst>${ids}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function coreXml(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`;
}

export function createPptxPackage(presentation: PptxPresentation): Buffer {
  boundedPresentation(presentation);
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'docProps/core.xml', data: Buffer.from(coreXml(presentation.title)) },
    { name: 'ppt/presentation.xml', data: Buffer.from(presentationXml(presentation.slides.length)) },
    { name: 'ppt/_rels/presentation.xml.rels', data: Buffer.from(presentationRels(presentation.slides.length)) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: Buffer.from(slideMasterXml) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: Buffer.from(slideMasterRels()) },
    { name: 'ppt/theme/theme1.xml', data: Buffer.from(themeXml) },
  ];
  let shapeIdOffset = 2;
  presentation.slides.forEach((slide, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: Buffer.from(slideXml(slide.elements, shapeIdOffset)) });
    shapeIdOffset += slide.elements.length;
  });
  const packageBytes = writeOoxmlPackage(entries);
  if (packageBytes.length > PPTX_LIMITS.maxArchiveBytes) throw new PptxValidationError('limit_exceeded', 'PPTX package exceeds its limit');
  inspectPptxPackage(packageBytes);
  return packageBytes;
}

/* =============================================================================
 * Parsing / validation
 * ============================================================================= */

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

/** Reject start tags carrying dangerous/unknown element names in a slide part. */
function assertNoUnsafeShapeElements(source: string): void {
  // Only allow well-scoped PresentationML/DrawingML shape infra and text.
  if (/<(?:[A-Za-z_][A-Za-z0-9_.:-]*:)?(?:object|OLEObject|control|embedded|package|altChunk)\b/i.test(visibleXml(source))) {
    throw new PptxValidationError('embedded_content_forbidden', 'embedded or imported presentation content is forbidden');
  }
}

function localName(prefix: string, localName: string): string {
  return prefix ? `${prefix}:${localName}` : localName;
}

function localPattern(prefix: string, element: string): string {
  return localName(prefix, element).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitChildren(source: string, maskedSource: string, openName: string, closeName: string): string[] {
  const children: string[] = [];
  const openTag = `<${openName}`;
  const closeTag = `</${closeName}>`;
  let scan = 0;
  while (scan < maskedSource.length) {
    const openIndex = maskedSource.indexOf(openTag, scan);
    if (openIndex < 0) break;
    // Require an exact element-name boundary: `<p:sp>` matches, `<p:spTree>` must not.
    const afterOpen = maskedSource[openIndex + openTag.length];
    if (afterOpen !== '>' && afterOpen !== ' ' && afterOpen !== '\t' && afterOpen !== '\n' && afterOpen !== '\r' && afterOpen !== '/') {
      scan = openIndex + openTag.length;
      continue;
    }
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
    selfClosing = /\/\s*$/.test(head);
    if (selfClosing) {
      children.push(source.slice(openIndex, arrow + 1));
      scan = arrow + 1;
      continue;
    }
    const closeIndex = maskedSource.indexOf(closeTag, arrow + 1);
    if (closeIndex < 0) throw new PptxValidationError('invalid_pptx', `unbalanced PPTX element: ${openName}`);
    children.push(source.slice(openIndex, closeIndex + closeTag.length));
    scan = closeIndex + closeTag.length;
  }
  return children;
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

function xmlPart(entries: Map<string, Buffer>, name: string): string {
  const part = entries.get(name);
  if (!part || part.length > PPTX_LIMITS.maxXmlBytes) throw new PptxValidationError('invalid_pptx', `required PPTX part is missing or oversized: ${name}`);
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(part); }
  catch { throw new PptxValidationError('invalid_pptx', 'PPTX XML is not valid UTF-8'); }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new PptxValidationError('unsafe_xml', 'unsafe XML declarations are forbidden');
  if (!isWellFormedXml(source)) throw new PptxValidationError('invalid_pptx', 'PPTX XML is not well formed');
  return source;
}

function relationshipTags(source: string): readonly XmlStartTag[] {
  const tags = xmlStartTags(source);
  const root = tags[0];
  const separator = root?.name.indexOf(':') ?? -1;
  const prefix = separator >= 0 ? root.name.slice(0, separator) : '';
  if (!root || root.name.slice(separator + 1) !== 'Relationships'
    || root.attributes.get(prefix ? `xmlns:${prefix}` : 'xmlns') !== RELATIONSHIPS_NAMESPACE) {
    throw new PptxValidationError('invalid_pptx', 'OOXML relationship namespace is invalid');
  }
  const relationshipName = prefix ? `${prefix}:Relationship` : 'Relationship';
  if (tags.slice(1).some((tag) => tag.name !== relationshipName)) {
    throw new PptxValidationError('invalid_pptx', 'OOXML relationship element is invalid');
  }
  return tags.slice(1);
}

function assertSafeRelationshipTarget(relationshipPart: string, target: string): void {
  let decoded: string;
  try { decoded = decodeURIComponent(target); }
  catch { throw new PptxValidationError('external_relationship_forbidden', 'malformed OOXML relationship target is forbidden'); }
  if (decoded.includes('\\') || decoded.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) {
    throw new PptxValidationError('external_relationship_forbidden', 'unsafe OOXML relationship target is forbidden');
  }
  const sourceDirectory = relationshipPart === '_rels/.rels'
    ? ''
    : relationshipPart.match(/^(?:(.*)\/)?_rels\/[^/]+\.rels$/)?.[1];
  if (sourceDirectory === undefined) throw new PptxValidationError('invalid_pptx', `invalid OOXML relationship part path: ${relationshipPart}`);
  const resolved = sourceDirectory ? sourceDirectory.split('/') : [];
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) throw new PptxValidationError('external_relationship_forbidden', 'unsafe OOXML relationship target is forbidden');
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
}

/** Determine the presentation/p element prefix from a slide part root. */
function presentationPrefix(source: string): string {
  const root = xmlStartTags(source)[0];
  const separator = root?.name.indexOf(':') ?? -1;
  const prefix = separator >= 0 ? root.name.slice(0, separator) : '';
  if (!root || root.name.slice(separator + 1) !== 'sld'
    || root.attributes.get(prefix ? `xmlns:${prefix}` : 'xmlns') !== PRESENTATION_NAMESPACE) {
    throw new PptxValidationError('invalid_pptx', 'PresentationML slide namespace is invalid');
  }
  return prefix;
}

function prefixFromSource(source: string, localRoot: string, namespace: string): string {
  const root = xmlStartTags(source)[0];
  const separator = root?.name.indexOf(':') ?? -1;
  const prefix = separator >= 0 ? root.name.slice(0, separator) : '';
  if (!root || root.name.slice(separator + 1) !== localRoot
    || root.attributes.get(prefix ? `xmlns:${prefix}` : 'xmlns') !== namespace) {
    throw new PptxValidationError('invalid_pptx', `${namespace} namespace root is invalid`);
  }
  return prefix;
}

/** Parse one slide part into its ordered text elements (stable ids preserved). */
function parseSlideXml(source: string): PptxSlideElement[] {
  const p = presentationPrefix(source);
  assertNoUnsafeShapeElements(source);
  const masked = visibleXml(source);
  const spName = localPattern(p, 'sp');
  const closeSp = localPattern(p, 'sp');
  const elements: PptxSlideElement[] = [];
  const spTreeName = localPattern(p, 'spTree');
  const closeSpTree = localPattern(p, 'spTree');
  const spTreeChildren = splitChildren(source, masked, spTreeName, closeSpTree);
  if (spTreeChildren.length === 0) throw new PptxValidationError('invalid_pptx', 'PPTX slide shape tree is missing');
  for (const shape of splitChildren(source, masked, spName, closeSp)) {
    const cNvPr = xmlStartTags(shape).find((tag) => tag.name === localName(p, 'cNvPr'));
    const id = cNvPr?.attributes.get('name');
    if (!id || !STABLE_ID_PATTERN.test(id)) throw new PptxValidationError('invalid_pptx', 'PPTX shape has an invalid stable id');
    // Extract the text runs within this shape.
    const tPattern = new RegExp(`<${localPattern('a', 't')}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${localPattern('a', 't')}>`, 'g');
    const text = [...visibleXml(shape).matchAll(tPattern)]
      .map((match) => {
        const contentOffset = match.index + match[0].indexOf('>') + 1;
        return decodeXmlTextContent(shape.slice(contentOffset, contentOffset + match[1].length));
      }).join('');
    const kind = /^title$/.test(id) ? 'title' : /^subtitle$/.test(id) ? 'subtitle' : /^notes$/.test(id) ? 'notes' : 'body';
    elements.push({ id, kind, text });
  }
  if (elements.length === 0) throw new PptxValidationError('invalid_pptx', 'PPTX slide has no authored text elements');
  return elements;
}

export function inspectPptxPackage(packageBytes: Buffer): PptxPresentation {
  let entries: Map<string, Buffer>;
  try { entries = readOoxmlPackage(packageBytes, PPTX_LIMITS); }
  catch (error) {
    if (error instanceof OoxmlPackageError) throw new PptxValidationError(error.code, error.message);
    throw error;
  }
  for (const [name] of entries) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) xmlPart(entries, name);
  }
  const types = decodeXmlReferences(xmlPart(entries, '[Content_Types].xml'));
  if (!types.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')) {
    throw new PptxValidationError('invalid_pptx', 'package content types do not identify a PPTX presentation');
  }
  if (/macroEnabled|vbaProject/i.test(types) || [...entries.keys()].some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) {
    throw new PptxValidationError('macro_forbidden', 'macro-enabled OOXML is outside the supported PPTX format');
  }
  if ([...entries.keys()].some((name) => /(^|\/)(embeddings|activeX)\//i.test(name) || /\.(exe|dll|js|vbs|cmd|bat)$/i.test(name))) {
    throw new PptxValidationError('embedded_content_forbidden', 'embedded executable content is forbidden');
  }
  const relationshipsByPart = new Map<string, readonly XmlStartTag[]>();
  for (const [name] of entries) {
    if (!name.endsWith('.rels')) continue;
    const relationships = relationshipTags(xmlPart(entries, name));
    relationshipsByPart.set(name, relationships);
    for (const relationship of relationships) {
      const type = relationship.attributes.get('Type') ?? '';
      if (/\/relationships\/(?:oleObject|package|control)$/i.test(type)) {
        throw new PptxValidationError('embedded_content_forbidden', 'embedded OOXML relationships are forbidden');
      }
      if (relationship.attributes.get('TargetMode')?.toLowerCase() === 'external') {
        throw new PptxValidationError('external_relationship_forbidden', 'external OOXML relationships are forbidden');
      }
      assertSafeRelationshipTarget(name, relationship.attributes.get('Target') ?? '');
    }
  }
  const rootRelationships = relationshipsByPart.get('_rels/.rels') ?? [];
  if (!rootRelationships.some((relationship) =>
    relationship.attributes.get('Type')?.endsWith('/relationships/officeDocument')
    && relationship.attributes.get('Target') === 'ppt/presentation.xml')) {
    throw new PptxValidationError('invalid_pptx', 'PPTX root relationship is missing');
  }
  const presentation = xmlPart(entries, 'ppt/presentation.xml');
  assertNoUnsafeShapeElements(presentation);
  if (/<(?:[A-Za-z_][A-Za-z0-9_.:-]*:)?(?:object|OLEObject|package|control)\b/i.test(visibleXml(presentation))) {
    throw new PptxValidationError('embedded_content_forbidden', 'embedded or imported presentation content is forbidden');
  }
  const presentationRelsPart = relationshipsByPart.get('ppt/_rels/presentation.xml.rels') ?? [];
  const slideTargets = presentationRelsPart
    .filter((relationship) => relationship.attributes.get('Type')?.endsWith('/relationships/slide'))
    .map((relationship) => (relationship.attributes.get('Target') ?? '').replace(/^\//, '').replace(/^\.\//, ''));
  if (slideTargets.length === 0) throw new PptxValidationError('invalid_pptx', 'PPTX presentation has no slide');
  // Order slides by the presentation-level sldIdLst rather than relationship order.
  const pPrefix = prefixFromSource(presentation, 'presentation', PRESENTATION_NAMESPACE);
  const sldIdTag = localPattern(pPrefix, 'sldId');
  const ordered = [...visibleXml(presentation).matchAll(new RegExp(`<${sldIdTag}(?:\\s[^>]*)?>`, 'g'))]
    .map((match) => xmlStartTags(presentation.slice(match.index, match.index + match[0].length))[0]?.attributes.get('r:id'))
    .filter((rId): rId is string => !!rId);
  if (ordered.length === 0) throw new PptxValidationError('invalid_pptx', 'PPTX presentation sldIdLst is missing');
  const targetByRId = new Map<string, string>();
  presentationRelsPart.forEach((relationship) => {
    targetByRId.set(relationship.attributes.get('Id') ?? '', (relationship.attributes.get('Target') ?? '').replace(/^\//, '').replace(/^\.\//, ''));
  });

  const slides: PptxSlide[] = [];
  const usedSlideIds = new Set<string>();
  for (const rId of ordered) {
    const target = targetByRId.get(rId);
    if (!target) throw new PptxValidationError('invalid_pptx', 'PPTX slide relationship is unresolved');
    const partName = `ppt/${target}`;
    if (!entries.has(partName)) throw new PptxValidationError('invalid_pptx', `PPTX slide part is missing: ${partName}`);
    const elements = parseSlideXml(xmlPart(entries, partName));
    const slideId = `slide_${slides.length + 1}`;
    if (usedSlideIds.has(slideId)) throw new PptxValidationError('invalid_pptx', 'PPTX slide ids must be unique');
    usedSlideIds.add(slideId);
    slides.push({ id: slideId, elements });
  }

  const titlePart = entries.get('docProps/core.xml');
  const titleSource = titlePart ? xmlPart(entries, 'docProps/core.xml') : '';
  const title = decodeXmlReferences(titleSource.match(/<dc:title(?:\s[^>]*)?>([\s\S]*?)<\/dc:title>/)?.[1] ?? 'Untitled');
  const presentationModel: PptxPresentation = { title, slides };
  boundedPresentation(presentationModel);
  return presentationModel;
}

export function pptxRevision(packageBytes: Buffer): string {
  return createHash('sha256').update(packageBytes).digest('hex');
}

/** Stable-id safe selector bound mirroring the canonical slide lane. */
function isWellFormedStableId(id: string): boolean {
  return STABLE_ID_PATTERN.test(id);
}

/**
 * Parse the canonical slide-lane `slideId` into the §12.5 `update_slide_text` envelope
 * `{slideRef, elementRef, text}` (JSON-encoded), exactly as the Google slides adapter does.
 * Anything else returns null so the caller fails closed instead of guessing semantics.
 */
export function parseSlideTextSelector(
  slideId: string,
): { slideRef: string; elementRef: string; text: string } | null {
  if (!slideId.startsWith('{')) return null;
  let raw: unknown;
  try { raw = JSON.parse(slideId); } catch { return null; }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length !== 3 || keys[0] !== 'elementRef' || keys[1] !== 'slideRef' || keys[2] !== 'text') return null;
  const { slideRef, elementRef, text } = obj;
  if (typeof slideRef !== 'string' || typeof elementRef !== 'string' || typeof text !== 'string'
    || !isWellFormedStableId(slideRef) || !isWellFormedStableId(elementRef)
    || text.length > PPTX_LIMITS.maxElementTextLength) {
    return null;
  }
  return { slideRef, elementRef, text };
}

/** Replace `/` with the not-in-name separator then resolve the ordered slide index by slideRef. */
function resolveSlideIndex(slides: readonly PptxSlide[], slideRef: string): number {
  const index = slides.findIndex((slide) => slide.id === slideRef);
  if (index < 0) throw new PptxValidationError('slide_target_not_found', `PPTX slide ${slideRef} does not exist`);
  return index;
}

/** The sole T-031 structured agent lane: update one bounded text element on one stable slide. */
export function setSlideText(packageBytes: Buffer, selector: { slideRef: string; elementRef: string; text: string }): Buffer {
  if (selector.text.length > PPTX_LIMITS.maxElementTextLength) {
    throw new PptxValidationError('limit_exceeded', 'PPTX slide text exceeds its limit');
  }
  assertUnicodeScalars(selector.text);
  if (!STABLE_ID_PATTERN.test(selector.slideRef) || !STABLE_ID_PATTERN.test(selector.elementRef)) {
    throw new PptxValidationError('slide_target_not_found', 'PPTX slide/element targeting is invalid');
  }
  // Validate the complete untrusted package before retaining any of its parts.
  const validated = inspectPptxPackage(packageBytes);
  const slideRef = selector.slideRef;
  const elementRef = selector.elementRef;
  const validSlideIds = new Set(validated.slides.map((s) => s.id));
  if (!validSlideIds.has(slideRef)) throw new PptxValidationError('slide_target_not_found', `PPTX slide ${slideRef} does not exist`);
  const validTarget = validated.slides.find((s) => s.id === slideRef)!.elements.find((e) => e.id === elementRef);
  if (!validTarget) throw new PptxValidationError('slide_target_not_found', `PPTX element ${elementRef} does not exist on slide ${slideRef}`);

  const entries = readOoxmlPackage(packageBytes, PPTX_LIMITS);
  const slideIndex = resolveSlideIndex(validated.slides, slideRef);
  const slideName = `ppt/slides/slide${slideIndex + 1}.xml`;
  const slideSource = xmlPart(entries, slideName);
  const p = presentationPrefix(slideSource);
  const masked = visibleXml(slideSource);
  const spName = localPattern(p, 'sp');
  const closeSp = localPattern(p, 'sp');
  const rewritten: string[] = [];
  let updated = 0;
  for (const shape of splitChildren(slideSource, masked, spName, closeSp)) {
    const cNvPr = xmlStartTags(shape).find((tag) => tag.name === localName(p, 'cNvPr'));
    const id = cNvPr?.attributes.get('name');
    if (id !== elementRef) { rewritten.push(shape); continue; }
    if (updated > 0) throw new PptxValidationError('invalid_pptx', `ambiguous PPTX element targeting at ${elementRef}`);
    const preserve = /^\s|\s$/.test(selector.text) ? ' xml:space="preserve"' : '';
    const newText = `<${localName('a', 't')}${preserve}>${xml(selector.text)}</${localName('a', 't')}>`;
    const tPattern = new RegExp(`<${localName('a', 't')}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${localName('a', 't')}>`, 'g');
    // Replace the first (and our authored shape has exactly one) text run.
    let count = 0;
    const nextShape = shape.replace(tPattern, () => { count++; return newText; });
    if (count !== 1) throw new PptxValidationError('invalid_pptx', `PPTX element ${elementRef} has no writable text run`);
    rewritten.push(nextShape);
    updated++;
  }
  if (updated !== 1) throw new PptxValidationError('slide_target_not_found', `PPTX element ${elementRef} is not writable on slide ${slideRef}`);
  const newSlideBody = rewritten.join('');
  const spTreeName = localPattern(p, 'spTree');
  const closeSpTree = localPattern(p, 'spTree');
  const spTreeChildren = splitChildren(slideSource, masked, spTreeName, closeSpTree);
  if (spTreeChildren.length === 0) throw new PptxValidationError('invalid_pptx', 'PPTX slide shape tree is missing');
  const treeStart = slideSource.indexOf(spTreeChildren[0]);
  const nextSlide = `${slideSource.slice(0, treeStart)}<${spTreeName}>${newSlideBody}</${closeSpTree}>${slideSource.slice(treeStart + spTreeChildren[0].length)}`;
  entries.set(slideName, Buffer.from(nextSlide));
  const candidate = writeOoxmlPackage([...entries].map(([name, data]) => ({ name, data })));
  inspectPptxPackage(candidate);
  return candidate;
}

/* =============================================================================
 * Engine (T-031)
 * ============================================================================= */

export interface PptxEngineRuntime {
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

function requirePptx(format: string): void {
  if (format !== 'pptx') throw new PptxValidationError('invalid_pptx', 'the PPTX engine accepts only pptx artifacts');
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
    throw new PptxValidationError('invalid_pptx', 'agent PPTX mutations require a resolvable canonical Entity receipt');
  }
}

export class LocalPptxEngine implements LocalOfficeEngine {
  private readonly now: () => string;
  constructor(private readonly options: { workspaceId: string; runtime: PptxEngineRuntime }) {
    this.now = options.runtime.now ?? (() => new Date().toISOString());
  }
  probe(): Promise<EngineReadiness> {
    return this.options.runtime.probe();
  }

  async create(input: CreateArtifactInput): Promise<CreateArtifactResult> {
    requirePptx(input.format);
    requireAgentReceipt(input.actor, this.options.runtime.receipts);
    const content = createPptxPackage(input.document as PptxPresentation);
    const operation = claimLocalDocumentOperation<CreateArtifactResult>({
      repository: this.options.runtime.operations,
      workspaceId: this.options.workspaceId,
      idempotencyKey: input.idempotencyKey,
      fingerprintInput: { operation: 'create', documentRef: input.documentRef, revision: pptxRevision(content) },
    });
    if (operation.replay) return operation.replay;
    let created: { documentId: string; revision: string } | undefined;
    try {
      created = await this.options.runtime.create({ documentRef: input.documentRef, content, idempotencyKey: input.idempotencyKey });
      const revision = pptxRevision(content);
      if (created.revision !== revision) throw new PptxValidationError('invalid_pptx', 'managed create returned an unverifiable revision');
      await this.recordChange({ documentId: created.documentId, documentRef: input.documentRef,
        operation: 'create', actor: input.actor, priorRevision: null, resultRevision: revision,
        idempotencyKey: input.idempotencyKey, title: (input.document as PptxPresentation).title });
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
    requirePptx(input.format);
    inspectPptxPackage(await this.options.runtime.read(input.documentRef));
    return this.options.runtime.open(input);
  }

  async inspect(input: OpenArtifactInput): Promise<ArtifactStructure> {
    requirePptx(input.format);
    inspectPptxPackage(await this.options.runtime.read(input.documentRef));
    return { format: 'pptx', valid: true };
  }

  async mutate(input: MutateArtifactInput): Promise<MutationResult> {
    requirePptx(input.format);
    requireAgentReceipt(input.actor, this.options.runtime.receipts);
    if (input.mutation.kind !== 'slide') {
      const capability = mutationCapability(input.mutation);
      throw new UnsupportedAdapterMutationError(capability, 'the PPTX engine supports only bounded authorized slide text mutation');
    }
    const selector = parseSlideTextSelector(input.mutation.slideId);
    if (!selector) {
      throw new PptxValidationError('invalid_pptx', 'PPTX slide mutation requires the canonical {slideRef, elementRef, text} envelope');
    }
    const saved = await this.persistCandidate(
      input,
      (before) => setSlideText(before, selector),
      'mutate',
    );
    return { changed: true, revision: saved.revision.contentHash };
  }

  async save(input: SaveArtifactInput): Promise<SaveResult> {
    requirePptx(input.format);
    if (input.actor.actorClass === 'agent') throw new PptxValidationError('invalid_pptx', 'agents must use the bounded PPTX slide mutation lane');
    const saved = await this.persistCandidate(input, input.candidate, 'save');
    return { saved: true, revision: saved.revision.contentHash };
  }

  private async persistCandidate(
    input: MutateArtifactInput | SaveArtifactInput,
    candidate: Buffer | ((before: Buffer) => Buffer),
    operation: 'mutate' | 'save',
  ): Promise<SafeSaveResult> {
    if (Buffer.isBuffer(candidate)) inspectPptxPackage(candidate);
    type PersistOperationOutcome =
      | { kind: 'saved'; result: SafeSaveResult }
      | { kind: 'stale'; expectedRevision: string; currentRevision: string };
    const operationRecord = claimLocalDocumentOperation<PersistOperationOutcome>({
      repository: this.options.runtime.operations,
      workspaceId: this.options.workspaceId,
      idempotencyKey: input.idempotencyKey,
      fingerprintInput: { operation, documentId: input.documentId, documentRef: input.documentRef,
        expectedRevision: input.expectedRevision,
        ...('mutation' in input ? { mutation: input.mutation } : { candidateRevision: pptxRevision(input.candidate) }) },
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
      const currentRevision = pptxRevision(before);
      if (currentRevision !== input.expectedRevision) {
        operationRecord.complete({ kind: 'stale', expectedRevision: input.expectedRevision, currentRevision }, input.documentId, input.documentRef);
        throw new StaleRevisionError(input.expectedRevision, currentRevision);
      }
      const preparedCandidate = Buffer.isBuffer(candidate) ? candidate : candidate(before);
      inspectPptxPackage(preparedCandidate);
      saved = await this.options.runtime.save({
        documentId: input.documentId,
        candidate: preparedCandidate,
        expectedRevision: {
          token: input.expectedRevision,
          contentHash: input.expectedRevision,
          size: before.length,
          modifiedAtMs: 0,
        },
        validate: (content) => { inspectPptxPackage(content); },
      });
      const reopened = await this.options.runtime.read(input.documentRef);
      inspectPptxPackage(reopened);
      const reopenedRevision = pptxRevision(reopened);
      if (reopenedRevision !== saved.revision.contentHash || reopenedRevision !== pptxRevision(preparedCandidate)) {
        throw new PptxValidationError('invalid_pptx', 'saved PPTX revision does not match the reopened candidate');
      }
      await this.recordChange({ documentId: input.documentId, documentRef: input.documentRef,
        operation, actor: input.actor, priorRevision: input.expectedRevision,
        resultRevision: saved.revision.contentHash, idempotencyKey: input.idempotencyKey });
      operationRecord.complete({ kind: 'saved', result: saved }, input.documentId, input.documentRef);
      return saved;
    } catch (error) {
      if (error instanceof StaleRevisionError) throw error;
      if (error instanceof SafeSaveError && error.code === 'stale') {
        const latest = pptxRevision(await this.options.runtime.read(input.documentRef));
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
      artifactType: 'presentation',
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
          artifact_type: 'presentation',
          title: input.title ?? 'Local presentation',
          external_id: input.documentRef,
          auth_state: 'authorized',
          readiness_state: 'ready',
          current_revision: input.resultRevision,
        }, this.options.workspaceId);
        if (registered.id !== input.documentId) {
          throw new PptxValidationError('invalid_pptx', 'managed create returned a non-canonical document id');
        }
      } else {
        const updated = this.options.runtime.registry.update(input.documentId, this.options.workspaceId, {
          current_revision: input.resultRevision,
          provider_modified_at: timestamp,
        });
        if (!updated) throw new PptxValidationError('invalid_pptx', 'canonical document revision could not be updated');
      }
      this.options.runtime.versions.recordDocumentVersion({ document_id: input.documentId,
        provider_revision: input.resultRevision, content_hash: input.resultRevision,
        actor_type: input.actor.actorClass, actor_id: input.actor.actorId,
        source: 'local_pptx_engine', observed_at: timestamp });
      this.options.runtime.events.appendEvent({ document_id: input.documentId,
        event_type: input.operation, actor_type: input.actor.actorClass, actor_id: input.actor.actorId,
        provider: 'local_office', operation_id: input.idempotencyKey,
        receipt_id: activity.receiptId, idempotency_key: input.idempotencyKey,
        before_revision: input.priorRevision, after_revision: input.resultRevision, status: 'succeeded' });
      recordDocumentActivity({ activity, createActivity: this.options.runtime.activity.createActivity });
    });
  }
}
