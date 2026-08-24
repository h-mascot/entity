import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityRecord, EvidenceArtifactRecord, TaskRecord } from '../../../../db/src';
import { completeTaskWithReceipt, type CompletionReceiptResult } from '../../receipt-writer';
import { resolvePhase2Flags } from '../../phase2-flags';
import {
  createPptxPackage,
  inspectPptxPackage,
  LocalPptxEngine,
  parseSlideTextSelector,
  pptxRevision,
  setSlideText,
  type PptxEngineRuntime,
  type PptxPresentation,
} from './pptx-engine';
import { readOoxmlPackage, writeOoxmlPackage } from './ooxml-package';

const FIXED_NOW = '2026-08-24T12:00:00.000Z';
const RELATIONSHIPS_OPEN = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

function slideEnvelope(slideRef: string, elementRef: string, text: string): string {
  return JSON.stringify({ slideRef, elementRef, text });
}

async function canonicalReceipt(): Promise<CompletionReceiptResult> {
  const previousTask = { id: 31, name: 'T-031 mutation', column: 'doing', metadata: '{}', org_id: 'org-1' } as TaskRecord;
  const nextTask = { ...previousTask, column: 'done' } as TaskRecord;
  return completeTaskWithReceipt(
    { previousTask, nextTask, actorPrincipalId: 'agent-1' },
    {
      storageRoot: '/unused', idFactory: () => 'receipt-31', now: () => new Date(FIXED_NOW),
      mkdir: async () => undefined, writeFile: async () => undefined,
      artifactRepository: { createArtifact: (input) => ({ ...input, id: input.id!, created_at: FIXED_NOW }) as EvidenceArtifactRecord },
      activityRepository: {
        listActivitiesByTaskId: () => [],
        createActivity: () => ({ id: 1, created_at: FIXED_NOW }) as ActivityRecord,
      },
      updateTask: () => nextTask,
    },
  );
}

function receiptRepository(receipt?: CompletionReceiptResult): PptxEngineRuntime['receipts'] {
  return { getArtifact: (id) => receipt?.artifact.id === id ? receipt.artifact : undefined };
}

function operationRepository() {
  const records = new Map<string, Record<string, unknown>>();
  const repository: PptxEngineRuntime['operations'] = {
    claimDocumentOperation: (input) => {
      const existing = records.get(input.idempotency_key);
      if (existing) return { kind: existing.operation_status === 'completed' ? 'completed' : 'uncertain', record: existing as never };
      const record = { ...input, operation_status: 'in_flight', result_json: null };
      records.set(input.idempotency_key, record);
      return { kind: 'new', record: record as never };
    },
    completeDocumentOperation: (_workspaceId, key, fields) => {
      const record = records.get(key)!;
      Object.assign(record, fields);
      return record as never;
    },
  };
  return { records, repository };
}

async function fullFidelityFixture(): Promise<PptxPresentation> {
  const file = path.join(__dirname, 'fixtures/pptx/full-fidelity.json');
  return JSON.parse(await readFile(file, 'utf8')) as PptxPresentation;
}

function withEntry(packageBytes: Buffer, name: string, data: string | Buffer): Buffer {
  const entries = readOoxmlPackage(packageBytes);
  entries.set(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  return writeOoxmlPackage([...entries].map(([entryName, entryData]) => ({ name: entryName, data: entryData })));
}

function renameEntryBytes(packageBytes: Buffer, from: string, to: string): Buffer {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
  const result = Buffer.from(packageBytes);
  let offset = 0;
  let replacements = 0;
  while ((offset = result.indexOf(from, offset, 'utf8')) >= 0) {
    result.write(to, offset, 'utf8');
    offset += to.length;
    replacements++;
  }
  expect(replacements).toBe(2);
  return result;
}

function patchFirstZipEntry(packageBytes: Buffer, patch: (local: number, central: number, result: Buffer) => void): Buffer {
  const result = Buffer.from(packageBytes);
  const central = result.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expect(central).toBeGreaterThan(0);
  patch(0, central, result);
  return result;
}

function insertZipGap(packageBytes: Buffer): Buffer {
  const central = packageBytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const result = Buffer.concat([packageBytes.subarray(0, central), Buffer.from([0x00]), packageBytes.subarray(central)]);
  const end = result.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  result.writeUInt32LE(central + 1, end + 16);
  return result;
}

describe('local PPTX engine', () => {
  it('creates and reopens a real PPTX package with the committed semantic fixture intact', async () => {
    const fixture = await fullFidelityFixture();
    const created = createPptxPackage(fixture);
    const reopened = inspectPptxPackage(created);
    expect(created.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(reopened).toEqual(fixture);
  });

  it('round-trips multiple ordered slides with escaping, Unicode, and preserved ordering', async () => {
    const presentation: PptxPresentation = {
      title: 'Multi',
      slides: [
        { id: 'slide_1', elements: [{ id: 'title', kind: 'title', text: 'a<b>&"c' }, { id: 'body', kind: 'body', text: '' }] },
        { id: 'slide_2', elements: [{ id: 'title', kind: 'title', text: 'déjà ✓ 向导' }] },
      ],
    };
    const reopened = inspectPptxPackage(createPptxPackage(presentation));
    expect(reopened.slides.map((s) => s.id)).toEqual(['slide_1', 'slide_2']);
    expect(reopened.slides[0].elements[0].text).toBe('a<b>&"c');
    expect(reopened.slides[1].elements[0].text).toBe('déjà ✓ 向导');
  });

  it('slide ordering is preserved across slide mutation', async () => {
    const fixture = await fullFidelityFixture();
    const mutated = setSlideText(createPptxPackage(fixture), { slideRef: 'slide_2', elementRef: 'title', text: 'Updated title' });
    const reopened = inspectPptxPackage(mutated);
    expect(reopened.slides.map((s) => s.id)).toEqual(fixture.slides.map((s) => s.id));
    expect(reopened.slides[1].elements[0].text).toBe('Updated title');
    // Other slides and other elements unchanged.
    expect(reopened.slides[0]).toEqual(fixture.slides[0]);
    expect(reopened.slides[2]).toEqual(fixture.slides[2]);
  });

  it('authorized slide mutation updates one bounded text element and preserves every other part', async () => {
    const fixture = await fullFidelityFixture();
    const mutated = setSlideText(createPptxPackage(fixture), { slideRef: 'slide_3', elementRef: 'body', text: 'Revised closing statement' });
    const reopened = inspectPptxPackage(mutated);
    expect(reopened.slides[2].elements[1].text).toBe('Revised closing statement');
    expect(reopened.slides[2].elements[0].text).toBe(fixture.slides[2].elements[0].text);
    expect(reopened.slides[0]).toEqual(fixture.slides[0]);
    expect(reopened.title).toBe(fixture.title);
  });

  it('slide mutation round-trips blank and whitespace-preserving text', async () => {
    const fixture = await fullFidelityFixture();
    const mutated = setSlideText(createPptxPackage(fixture), { slideRef: 'slide_2', elementRef: 'body', text: '  spaced lead and trail  ' });
    const reopened = inspectPptxPackage(mutated);
    expect(reopened.slides[1].elements[1].text).toBe('  spaced lead and trail  ');
  });

  it('rejects unknown slide or element targeting and fails closed', async () => {
    const valid = createPptxPackage(await fullFidelityFixture());
    expect(() => setSlideText(valid, { slideRef: 'slide_99', elementRef: 'title', text: 'x' }))
      .toThrow(expect.objectContaining({ code: 'slide_target_not_found' }));
    expect(() => setSlideText(valid, { slideRef: 'slide_1', elementRef: 'missing', text: 'x' }))
      .toThrow(expect.objectContaining({ code: 'slide_target_not_found' }));
  });

  it('parses the canonical slide-lane envelope strictly', () => {
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 'slide_1', elementRef: 'title', text: 'hi' })))
      .toEqual({ slideRef: 'slide_1', elementRef: 'title', text: 'hi' });
    // Bare slide id, wrong keys, non-object, and oversize text all fail closed.
    expect(parseSlideTextSelector('slide_1')).toBeNull();
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 'slide_1', elementRef: 'title' }))).toBeNull();
    expect(parseSlideTextSelector(JSON.stringify({ a: 1, b: 2, c: 3 }))).toBeNull();
    expect(parseSlideTextSelector('{not json')).toBeNull();
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 'slide x', elementRef: 'title', text: 'hi' }))).toBeNull();
    expect(parseSlideTextSelector(JSON.stringify({ slideRef: 'slide_1', elementRef: 'title', text: 'x'.repeat(10001) }))).toBeNull();
  });

  it.each([
    ['truncated archive', (valid: Buffer) => valid.subarray(0, valid.length - 10), 'invalid_archive'],
    ['encrypted entry', (valid: Buffer) => patchFirstZipEntry(valid, (local, central, result) => {
      result.writeUInt16LE(result.readUInt16LE(local + 6) | 1, local + 6);
      result.writeUInt16LE(result.readUInt16LE(central + 8) | 1, central + 8);
    }), 'encrypted_entry'],
    ['macros payload', (valid: Buffer) => withEntry(valid, 'ppt/vbaProject.bin', 'not executed'), 'macro_forbidden'],
    ['macro content type', (valid: Buffer) => {
      const entries = readOoxmlPackage(valid);
      const contentTypes = entries.get('[Content_Types].xml')!.toString('utf8')
        .replace(
          '</Types>',
          '<Override PartName="/ppt/benign.bin" ContentType="application/vnd.ms-powerpoint.presentation.macro&#x45;nabled.main+xml"/></Types>',
        );
      return withEntry(valid, '[Content_Types].xml', contentTypes);
    }, 'macro_forbidden'],
    ['embedded payload', (valid: Buffer) => withEntry(valid, 'ppt/embeddings/object.bin', 'not executed'), 'embedded_content_forbidden'],
    ['unrelated non-PPTX type', (valid: Buffer) => withEntry(
      valid, '[Content_Types].xml',
      '<Types><Override ContentType="application/xml"/></Types>',
    ), 'invalid_pptx'],
    ['external relationship', (valid: Buffer) => withEntry(
      valid,
      'ppt/_rels/presentation.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship TargetMode="External" Target="https://attacker.invalid"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['traversing relationship', (valid: Buffer) => withEntry(
      valid,
      'ppt/_rels/presentation.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship Target="../../outside.xml"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['unsafe XML declaration', (valid: Buffer) => withEntry(
      valid,
      'ppt/slides/slide1.xml',
      '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>',
    ), 'unsafe_xml'],
    ['malformed slide XML', (valid: Buffer) => withEntry(
      valid,
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr></p:spTree></p:cSld></p:sld>',
    ), 'invalid_pptx'],
    ['embedded object in slide', (valid: Buffer) => withEntry(
      valid,
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:object/></p:spTree></p:cSld></p:sld>',
    ), 'embedded_content_forbidden'],
    ['oversized expanded part', (valid: Buffer) => withEntry(valid, 'ppt/oversized.bin', Buffer.alloc(512 * 1024 + 1)), 'limit_exceeded'],
    ['unaccounted ZIP bytes', (valid: Buffer) => insertZipGap(valid), 'invalid_archive'],
    ['ZIP traversal', (valid: Buffer) => renameEntryBytes(
      withEntry(valid, 'ppt/z.xml', '<z/>'), 'ppt/z.xml', '../evilz1',
    ), 'unsafe_path'],
    ['duplicate ZIP entry', (valid: Buffer) => renameEntryBytes(
      withEntry(withEntry(valid, 'ppt/a.xml', 'a'), 'ppt/b.xml', 'b'), 'ppt/b.xml', 'ppt/a.xml',
    ), 'duplicate_entry'],
  ])('rejects malicious/invalid PPTX: %s', async (_case, build, code) => {
    const valid = createPptxPackage(await fullFidelityFixture());
    expect(() => inspectPptxPackage(build(valid))).toThrow(expect.objectContaining({ code }));
  });

  it('rejects an oversized slide text mutation', async () => {
    const valid = createPptxPackage(await fullFidelityFixture());
    expect(() => setSlideText(valid, { slideRef: 'slide_1', elementRef: 'title', text: 'x'.repeat(10001) }))
      .toThrow(expect.objectContaining({ code: 'limit_exceeded' }));
  });

  it('performs the create/open/human-save/reopen lifecycle through the engine seam', async () => {
    const fixture = await fullFidelityFixture();
    const bytes = new Map<string, Buffer>();
    const operationState = operationRepository();
    const runtime: PptxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async ({ content }) => {
        const revision = pptxRevision(content);
        bytes.set('file-source:v1.fixture', content);
        return { documentId: 'document-31', revision };
      },
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate }) => {
        const content = Buffer.from(candidate);
        bytes.set('file-source:v1.fixture', content);
        const revision = pptxRevision(content);
        return { revision: { token: revision, contentHash: revision, size: content.length, modifiedAtMs: 0 },
          recoveryReference: 'source:recovery', atomicReplacement: true, linearization: 'broker-serialized-conditional-replace' };
      },
      registry: { create: () => ({ id: 'document-31' }) as never, update: () => ({ id: 'document-31' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: (input) => input as never },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalPptxEngine({ workspaceId: 'workspace-1', runtime });
    const actor = { actorClass: 'human' as const, actorId: 'human-1' };

    const created = await engine.create({ documentRef: 'file-source:v1.fixture', format: 'pptx', document: fixture, idempotencyKey: 'create-31', actor });
    expect(created.documentId).toBe('document-31');
    expect(created.entityUrl).toBe('/documents/document-31');
    expect(pptxRevision(bytes.get('file-source:v1.fixture')!)).toBe(created.revision);
    expect(inspectPptxPackage(bytes.get('file-source:v1.fixture')!)).toEqual(fixture);

    const opened = await engine.open({ documentRef: 'file-source:v1.fixture', format: 'pptx' });
    expect(opened).toEqual({ opened: true, readiness: 'ready' });

    // Human candidate save: change one slide's title, save, reopen semantics.
    const before = bytes.get('file-source:v1.fixture')!;
    const updated = inspectPptxPackage(before);
    updated.slides[1].elements[0].text = 'Human edited title';
    const candidate = createPptxPackage(updated);
    const saved = await engine.save({ documentRef: 'file-source:v1.fixture', format: 'pptx', documentId: 'document-31',
      candidate, expectedRevision: pptxRevision(before), idempotencyKey: 'save-31', actor });
    expect(saved.saved).toBe(true);
    expect(saved.revision).toBe(pptxRevision(bytes.get('file-source:v1.fixture')!));
    const reopened = inspectPptxPackage(bytes.get('file-source:v1.fixture')!);
    expect(reopened.slides[1].elements[0].text).toBe('Human edited title');
    expect(reopened.slides[0]).toEqual(fixture.slides[0]);
  });

  it('agent authorized slide mutation lands a receipt-linked flat revision', async () => {
    const fixture = await fullFidelityFixture();
    const original = createPptxPackage(fixture);
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const operationState = operationRepository();
    const receipt = await canonicalReceipt();
    const runtime: PptxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-31', revision: pptxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate }) => {
        const content = Buffer.from(candidate);
        bytes.set('file-source:v1.fixture', content);
        const revision = pptxRevision(content);
        return { revision: { token: revision, contentHash: revision, size: content.length, modifiedAtMs: 0 },
          recoveryReference: 'source:recovery', atomicReplacement: true, linearization: 'broker-serialized-conditional-replace' };
      },
      registry: { create: () => ({ id: 'document-31' }) as never, update: () => ({ id: 'document-31' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: (input) => input as never },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(receipt),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalPptxEngine({ workspaceId: 'workspace-1', runtime });
    const mutated = await engine.mutate({
      documentId: 'document-31', documentRef: 'file-source:v1.fixture', format: 'pptx',
      expectedRevision: pptxRevision(original), idempotencyKey: 'agent-slide-31',
      mutation: { kind: 'slide', slideId: slideEnvelope('slide_2', 'title', 'Revised market outlook') },
      actor: { actorClass: 'agent', actorId: 'agent-1', receipt },
    });
    expect(mutated.changed).toBe(true);
    expect(inspectPptxPackage(bytes.get('file-source:v1.fixture')!).slides[1].elements[0].text).toBe('Revised market outlook');
    const activity = operationState.records.get('agent-slide-31');
    expect(activity?.operation_status).toBe('completed');
    expect(activity?.document_id).toBe('document-31');
  });

  it('rejects an agent slide mutation with a malformed or bare slide lane', async () => {
    const fixture = await fullFidelityFixture();
    const original = createPptxPackage(fixture);
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const receipt = await canonicalReceipt();
    let saveCalls = 0;
    const runtime: PptxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-31', revision: pptxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async () => { saveCalls++; throw new Error('must not save'); },
      registry: { create: () => ({ id: 'document-31' }) as never, update: () => ({ id: 'document-31' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: (input) => input as never },
      operations: operationRepository().repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(receipt),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalPptxEngine({ workspaceId: 'workspace-1', runtime });
    await expect(engine.mutate({
      documentId: 'document-31', documentRef: 'file-source:v1.fixture', format: 'pptx',
      expectedRevision: pptxRevision(original), idempotencyKey: 'bare-lane-31',
      mutation: { kind: 'slide', slideId: 'slide_2' },
      actor: { actorClass: 'agent', actorId: 'agent-1', receipt },
    })).rejects.toMatchObject({ name: 'PptxValidationError', code: 'invalid_pptx' });
    expect(saveCalls).toBe(0);
  });

  it('rejects an agent slide mutation without a resolvable canonical receipt', async () => {
    const fixture = await fullFidelityFixture();
    const original = createPptxPackage(fixture);
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const receipt = await canonicalReceipt();
    let saveCalls = 0;
    const runtime: PptxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-31', revision: pptxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async () => { saveCalls++; throw new Error('must not save'); },
      registry: { create: () => ({ id: 'document-31' }) as never, update: () => ({ id: 'document-31' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: (input) => input as never },
      operations: operationRepository().repository,
      activity: { createActivity: (input) => input as never },
      receipts: { getArtifact: () => undefined },
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalPptxEngine({ workspaceId: 'workspace-1', runtime });
    await expect(engine.mutate({
      documentId: 'document-31', documentRef: 'file-source:v1.fixture', format: 'pptx',
      expectedRevision: pptxRevision(original), idempotencyKey: 'missing-receipt-31',
      mutation: { kind: 'slide', slideId: slideEnvelope('slide_1', 'title', 'x') },
      actor: { actorClass: 'agent', actorId: 'agent-1', receipt },
    })).rejects.toMatchObject({ name: 'PptxValidationError', code: 'invalid_pptx' });
    expect(saveCalls).toBe(0);
  });

  it('marks a post-write evidence failure uncertain so retries reconcile instead of rewriting', async () => {
    const fixture = await fullFidelityFixture();
    const original = createPptxPackage(fixture);
    const candidate = setSlideText(original, { slideRef: 'slide_1', elementRef: 'title', text: 'Edited' });
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const operationState = operationRepository();
    let saveCalls = 0;
    const runtime: PptxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-31', revision: pptxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate: next }) => {
        saveCalls++;
        bytes.set('file-source:v1.fixture', Buffer.from(next));
        const revision = pptxRevision(Buffer.from(next));
        return { revision: { token: revision, contentHash: revision, size: Buffer.from(next).length, modifiedAtMs: 0 },
          recoveryReference: 'source:recovery', atomicReplacement: true, linearization: 'broker-serialized-conditional-replace' };
      },
      registry: { create: () => ({ id: 'document-31' }) as never, update: () => ({ id: 'document-31' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: () => { throw new Error('audit write failed'); } },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalPptxEngine({ workspaceId: 'workspace-1', runtime });
    const request = { documentId: 'document-31', documentRef: 'file-source:v1.fixture', format: 'pptx' as const,
      candidate, expectedRevision: pptxRevision(original), idempotencyKey: 'save-uncertain-31',
      actor: { actorClass: 'human' as const, actorId: 'human-1' } };

    await expect(engine.save(request)).rejects.toThrow('audit write failed');
    expect(bytes.get(request.documentRef)).toEqual(candidate);
    expect(operationState.records.get(request.idempotencyKey)?.operation_status).toBe('uncertain');
    await expect(engine.save(request)).rejects.toMatchObject({ code: 'uncertain' });
    expect(saveCalls).toBe(1);
  });

  it('keeps a stale expected revision retryable and deterministic on the same operation key', async () => {
    const fixture = await fullFidelityFixture();
    const original = createPptxPackage(fixture);
    const operationState = operationRepository();
    let saveCalls = 0;
    const runtime = {
      probe: async () => ({ state: 'ready' as const, reason: 'test' }),
      create: async () => ({ documentId: 'document-31', revision: pptxRevision(original) }),
      read: async () => Buffer.from(original),
      open: async () => ({ opened: true, readiness: 'ready' as const }),
      save: async () => { saveCalls++; throw new Error('must not save'); },
      registry: { update: () => ({ id: 'document-31' }) as never },
      versions: { recordDocumentVersion: (input: never) => input },
      events: { appendEvent: (input: never) => input },
      operations: operationState.repository,
      activity: { createActivity: (input: never) => input },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}), transaction: (work: () => unknown) => work(),
    } as unknown as PptxEngineRuntime;
    const engine = new LocalPptxEngine({ workspaceId: 'workspace-1', runtime });
    const mutation = {
      documentId: 'document-31', documentRef: 'file-source:v1.fixture', format: 'pptx' as const,
      expectedRevision: 'stale-revision', idempotencyKey: 'stale-mutation-31',
      mutation: { kind: 'slide' as const, slideId: slideEnvelope('slide_1', 'title', 'Nope') },
      actor: { actorClass: 'human' as const, actorId: 'human-1' },
    };

    await expect(engine.mutate(mutation)).rejects.toMatchObject({ name: 'StaleRevisionError' });
    expect(saveCalls).toBe(0);
    await expect(engine.mutate(mutation)).rejects.toMatchObject({ name: 'StaleRevisionError' });
    expect(saveCalls).toBe(0);
    expect(operationState.records.get('stale-mutation-31')?.operation_status).toBe('completed');
  });

  it('registry create is presentation-scoped and verifies the canonical document id', async () => {
    const fixture = await fullFidelityFixture();
    const bytes = new Map<string, Buffer>();
    const operationState = operationRepository();
    let createCalled = false;
    const runtime: PptxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async ({ content }) => {
        const revision = pptxRevision(content);
        bytes.set('file-source:v1.fixture', content);
        return { documentId: 'document-31', revision };
      },
      read: async () => Buffer.from(bytes.get('file-source:v1.fixture')!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async () => { throw new Error('not used'); },
      registry: { create: (input) => { createCalled = true; expect(input.artifact_type).toBe('presentation'); return { id: 'document-31' } as never; }, update: () => ({ id: 'document-31' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: (input) => input as never },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalPptxEngine({ workspaceId: 'workspace-1', runtime });
    await engine.create({ documentRef: 'file-source:v1.fixture', format: 'pptx', document: fixture, idempotencyKey: 'create-311', actor: { actorClass: 'human', actorId: 'human-1' } });
    expect(createCalled).toBe(true);
  });
});
