import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityRecord, EvidenceArtifactRecord, TaskRecord } from '../../../../db/src';
import { completeTaskWithReceipt, type CompletionReceiptResult } from '../../receipt-writer';
import { resolvePhase2Flags } from '../../phase2-flags';
import { traverseAuditorChain, type DocumentActivityRecord } from '../activity-adapter';
import {
  appendTextToDocx,
  createDocxPackage,
  docxRevision,
  inspectDocxPackage,
  LocalDocxEngine,
  type DocxEngineRuntime,
  type DocxDocument,
} from './docx-engine';
import { readOoxmlPackage, writeOoxmlPackage } from './ooxml-package';

const FIXED_NOW = '2026-08-23T12:00:00.000Z';
const RELATIONSHIPS_OPEN = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

async function canonicalReceipt(): Promise<CompletionReceiptResult> {
  const previousTask = { id: 29, name: 'T-029 mutation', column: 'doing', metadata: '{}', org_id: 'org-1' } as TaskRecord;
  const nextTask = { ...previousTask, column: 'done' } as TaskRecord;
  return completeTaskWithReceipt(
    { previousTask, nextTask, actorPrincipalId: 'agent-1' },
    {
      storageRoot: '/unused', idFactory: () => 'receipt-29', now: () => new Date(FIXED_NOW),
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

function receiptRepository(receipt?: CompletionReceiptResult): DocxEngineRuntime['receipts'] {
  return { getArtifact: (id) => receipt?.artifact.id === id ? receipt.artifact : undefined };
}

function operationRepository() {
  const records = new Map<string, Record<string, unknown>>();
  const repository: DocxEngineRuntime['operations'] = {
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

async function fullFidelityFixture(): Promise<DocxDocument> {
  const file = path.join(__dirname, 'fixtures/docx/full-fidelity.json');
  return JSON.parse(await readFile(file, 'utf8')) as DocxDocument;
}

function withEntry(packageBytes: Buffer, name: string, data: string | Buffer): Buffer {
  const entries = readOoxmlPackage(packageBytes);
  entries.set(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  return writeOoxmlPackage([...entries].map(([entryName, entryData]) => ({ name: entryName, data: entryData })));
}

function withAlternateWordprocessingPrefix(packageBytes: Buffer): Buffer {
  const entries = readOoxmlPackage(packageBytes);
  const document = entries.get('word/document.xml')!.toString('utf8')
    .replace('xmlns:w=', 'xmlns:wp=')
    .replace(/\bw:/g, 'wp:');
  entries.set('word/document.xml', Buffer.from(document));
  return writeOoxmlPackage([...entries].map(([name, data]) => ({ name, data })));
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

describe('local DOCX engine', () => {
  it('creates and reopens a real DOCX package with the committed semantic fixture intact', async () => {
    const fixture = await fullFidelityFixture();

    const created = createDocxPackage(fixture);
    const reopened = inspectDocxPackage(created);

    expect(created.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(reopened).toEqual(fixture);
  });

  it('preserves fixture semantics with an alternate WordprocessingML prefix', async () => {
    const fixture = await fullFidelityFixture();
    const prefixed = withAlternateWordprocessingPrefix(createDocxPackage(fixture));

    expect(inspectDocxPackage(prefixed)).toEqual(fixture);
  });

  it('appends visible text with an alternate WordprocessingML prefix', async () => {
    const fixture = await fullFidelityFixture();
    const prefixed = withAlternateWordprocessingPrefix(createDocxPackage(fixture));

    const mutated = appendTextToDocx(prefixed, 'Visible namespace-safe append.');

    expect(inspectDocxPackage(mutated).blocks.slice(-1)[0]).toEqual({
      kind: 'paragraph', text: 'Visible namespace-safe append.',
    });
  });

  it('preserves well-formed CDATA text through inspection and append', () => {
    const cdataText = 'CDATA preserves <markup> & "quotes".';
    const entries = readOoxmlPackage(createDocxPackage({
      title: 'CDATA fixture', blocks: [{ kind: 'paragraph', text: 'replace-me' }],
    }));
    const document = entries.get('word/document.xml')!.toString('utf8')
      .replace('<w:t>replace-me</w:t>', `<w:t><![CDATA[${cdataText}]]></w:t>`);
    entries.set('word/document.xml', Buffer.from(document));
    const cdataPackage = writeOoxmlPackage(
      [...entries].map(([name, data]) => ({ name, data })),
    );

    expect(inspectDocxPackage(cdataPackage).blocks).toEqual([
      { kind: 'paragraph', text: cdataText },
    ]);

    const mutated = appendTextToDocx(cdataPackage, 'Visible append after CDATA.');
    expect(inspectDocxPackage(mutated).blocks).toEqual([
      { kind: 'paragraph', text: cdataText },
      { kind: 'paragraph', text: 'Visible append after CDATA.' },
    ]);
  });

  it('rejects traversing targets on namespace-prefixed relationship elements', async () => {
    const valid = createDocxPackage(await fullFidelityFixture());
    const hostile = withEntry(
      valid,
      'word/_rels/document.xml.rels',
      '<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="rIdTraversal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="../../outside.xml"/></r:Relationships>',
    );

    expect(() => inspectDocxPackage(hostile))
      .toThrow(expect.objectContaining({ code: 'external_relationship_forbidden' }));
  });

  it('accepts a valid namespace-prefixed officeDocument root relationship', async () => {
    const fixture = await fullFidelityFixture();
    const valid = createDocxPackage(fixture);
    const prefixed = withEntry(
      valid,
      '_rels/.rels',
      '<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></r:Relationships>',
    );

    expect(inspectDocxPackage(prefixed)).toEqual(fixture);
  });

  it('accepts a parent-relative relationship target that resolves inside the package', async () => {
    const fixture = await fullFidelityFixture();
    const entries = readOoxmlPackage(createDocxPackage(fixture));
    entries.set('word/header1.xml', Buffer.from(
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    ));
    entries.set('media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    entries.set('word/_rels/header1.xml.rels', Buffer.from(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
    ));
    const related = writeOoxmlPackage(
      [...entries].map(([name, data]) => ({ name, data })),
    );

    expect(inspectDocxPackage(related)).toEqual(fixture);
  });

  it('performs the bounded structured text mutation and advances the content revision', async () => {
    const created = createDocxPackage(await fullFidelityFixture());

    const mutated = appendTextToDocx(created, 'Agent-added conclusion.');

    const blocks = inspectDocxPackage(mutated).blocks;
    expect(blocks[blocks.length - 1]).toEqual({
      kind: 'paragraph',
      text: 'Agent-added conclusion.',
    });
    expect(docxRevision(mutated)).not.toBe(docxRevision(created));
  });

  it('rejects XML-illegal semantic text before managed creation', () => {
    expect(() => createDocxPackage({ title: 'Invalid\0title', blocks: [] }))
      .toThrow(expect.objectContaining({ code: 'invalid_docx' }));
  });

  it('rejects lone UTF-16 surrogates in semantic title and block text', () => {
    expect(() => createDocxPackage({ title: 'Invalid\uD800title', blocks: [] }))
      .toThrow(expect.objectContaining({ code: 'invalid_docx' }));
    expect(() => createDocxPackage({
      title: 'Valid title', blocks: [{ kind: 'paragraph', text: 'Invalid\uD800paragraph' }],
    })).toThrow(expect.objectContaining({ code: 'invalid_docx' }));
  });

  it('registers a created local DOCX canonically before recording its evidence trail', async () => {
    const fixture = await fullFidelityFixture();
    const operationState = operationRepository();
    const calls: string[] = [];
    const runtime = {
      probe: async () => ({ state: 'ready' as const, reason: 'test' }),
      create: async ({ content }: { content: Buffer }) => ({
        documentId: 'document-29', revision: docxRevision(content),
      }),
      read: async () => Buffer.alloc(0),
      open: async () => ({ opened: true, readiness: 'ready' as const }),
      save: async () => { throw new Error('not used'); },
      registry: {
        create: (input: Record<string, unknown>, workspaceId: string) => {
          calls.push('registry');
          expect(workspaceId).toBe('workspace-1');
          expect(input).toMatchObject({
            provider: 'local_office', artifact_type: 'document', title: fixture.title,
            external_id: 'file-source:v1.fixture', current_revision: expect.any(String),
            auth_state: 'authorized', readiness_state: 'ready',
          });
          return { id: 'document-29' } as never;
        },
        update: () => ({ id: 'document-29' }) as never,
      },
      versions: { recordDocumentVersion: (input: never) => { calls.push('version'); return input; } },
      events: { appendEvent: (input: never) => { calls.push('event'); return input; } },
      operations: operationState.repository,
      activity: { createActivity: (input: never) => { calls.push('activity'); return input; } },
      flags: resolvePhase2Flags({}), transaction: (work: () => unknown) => work(), now: () => FIXED_NOW,
    } as unknown as DocxEngineRuntime;
    const engine = new LocalDocxEngine({ workspaceId: 'workspace-1', runtime });

    await engine.create({
      documentRef: 'file-source:v1.fixture', format: 'docx', document: fixture,
      idempotencyKey: 'create-registry-29', actor: { actorClass: 'human', actorId: 'human-1' },
    });

    expect(calls).toEqual(['registry', 'version', 'event', 'activity']);
  });

  it('ignores markup-shaped comments when locating the mutation insertion point', async () => {
    const valid = createDocxPackage(await fullFidelityFixture());
    const entries = readOoxmlPackage(valid);
    const document = entries.get('word/document.xml')!.toString('utf8')
      .replace('<w:sectPr/>', '<w:sectPr/><!-- <w:sectPr attacker-marker -->');
    const commented = withEntry(valid, 'word/document.xml', document);

    const mutated = appendTextToDocx(commented, 'Visible after comment defense.');

    const blocks = inspectDocxPackage(mutated).blocks;
    expect(blocks[blocks.length - 1]).toEqual({
      kind: 'paragraph', text: 'Visible after comment defense.',
    });
    expect(readOoxmlPackage(mutated).get('word/document.xml')!.toString('utf8'))
      .not.toContain('<!-- <w:sectPr attacker-marker --><w:p>');
  });

  it('composes create, human open/save/reopen, agent mutation, versions, activity, receipt, and the stable Entity link', async () => {
    const bytes = new Map<string, Buffer>();
    const revisions: unknown[] = [];
    const events: unknown[] = [];
    const activities: unknown[] = [];
    const operationState = operationRepository();
    const receipt = await canonicalReceipt();
    let currentRevision: string | null = null;
    const runtime: DocxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'fixture-runtime' }),
      create: async ({ documentRef, content }) => {
        expect(operationState.records.get('create-29')?.operation_status).toBe('in_flight');
        bytes.set(documentRef, content);
        currentRevision = docxRevision(content);
        return { documentId: 'document-29', revision: currentRevision };
      },
      read: async (documentRef) => Buffer.from(bytes.get(documentRef)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate, expectedRevision, validate }) => {
        const documentRef = 'file-source:v1.fixture';
        const before = bytes.get(documentRef)!;
        if (docxRevision(before) !== expectedRevision.contentHash) throw new Error('stale fixture save');
        const candidateBytes = Buffer.isBuffer(candidate) ? candidate : Buffer.from(candidate);
        await validate(candidateBytes);
        bytes.set(documentRef, candidateBytes);
        const revision = docxRevision(candidateBytes);
        return {
          revision: { token: revision, contentHash: revision, size: candidateBytes.length, modifiedAtMs: 0 },
          recoveryReference: 'source:.entity-recovery/document-29.docx',
          atomicReplacement: true,
          linearization: 'broker-serialized-conditional-replace',
        };
      },
      registry: {
        create: () => ({ id: 'document-29' }) as never,
        update: (_documentId, _workspaceId, fields) => {
          currentRevision = fields.current_revision ?? currentRevision;
          return { id: 'document-29', current_revision: currentRevision } as never;
        },
      },
      versions: { recordDocumentVersion: (input) => { revisions.push(input); return input as never; } },
      events: { appendEvent: (input) => { events.push(input); return input as never; } },
      operations: operationState.repository,
      activity: { createActivity: (input) => { activities.push(input); return input as never; } },
      receipts: receiptRepository(receipt),
      flags: resolvePhase2Flags({}),
      transaction: (work) => work(),
      now: () => FIXED_NOW,
    };
    const engine = new LocalDocxEngine({ workspaceId: 'workspace-1', runtime });
    const fixture = await fullFidelityFixture();

    const created = await engine.create({
      documentRef: 'file-source:v1.fixture',
      format: 'docx',
      document: fixture,
      idempotencyKey: 'create-29',
      actor: { actorClass: 'human', actorId: 'human-1' },
    });
    expect(created.entityUrl).toBe('/documents/document-29');
    await expect(engine.open({ documentRef: created.documentRef, format: 'docx' }))
      .resolves.toEqual({ opened: true, readiness: 'ready' });

    const humanCandidate = appendTextToDocx(bytes.get(created.documentRef)!, 'Human editor change.');
    const saved = await engine.save({
      documentId: created.documentId,
      documentRef: created.documentRef,
      format: 'docx',
      candidate: humanCandidate,
      expectedRevision: created.revision,
      idempotencyKey: 'human-save-29',
      actor: { actorClass: 'human', actorId: 'human-1' },
    });
    expect((await engine.inspect({ documentRef: created.documentRef, format: 'docx' })).valid).toBe(true);

    const mutated = await engine.mutate({
      documentId: created.documentId,
      documentRef: created.documentRef,
      format: 'docx',
      expectedRevision: saved.revision!,
      mutation: { kind: 'text', text: 'Agent-added conclusion.' },
      idempotencyKey: 'agent-mutation-29',
      actor: { actorClass: 'agent', actorId: 'agent-1', receipt },
    });

    expect(mutated.revision).toBe(currentRevision);
    const mutatedBlocks = inspectDocxPackage(bytes.get(created.documentRef)!).blocks;
    expect(mutatedBlocks[mutatedBlocks.length - 1]).toEqual({
      kind: 'paragraph', text: 'Agent-added conclusion.',
    });
    expect(revisions).toHaveLength(3);
    expect(events).toHaveLength(3);
    expect(events[events.length - 1]).toMatchObject({ receipt_id: 'receipt-29', before_revision: saved.revision, after_revision: mutated.revision });
    expect(JSON.stringify(activities[activities.length - 1])).toContain('receipt-29');
    expect(operationState.records.get('agent-mutation-29')?.operation_status).toBe('completed');
    const auditActivity: DocumentActivityRecord = {
      id: 'agent-mutation-29', documentId: created.documentId, provider: 'local_office',
      artifactType: 'document', externalId: created.documentRef, operationType: 'mutate',
      actorClass: 'agent', actorId: 'agent-1', priorRevision: saved.revision,
      resultRevision: mutated.revision, timestamp: FIXED_NOW, succeeded: true,
      reasonCode: null, receiptId: receipt.artifact.id,
    };
    expect(traverseAuditorChain(auditActivity, {
      resolveEntityAction: () => ({ id: 1, type: 'task_updated', activity_event_type: 'agent_mutation', task_id: 29 }) as unknown as ActivityRecord,
      resolveReceipt: () => ({ artifactId: receipt.artifact.id, stablePath: receipt.artifact.stable_path!, contentHash: receipt.artifact.content_hash! }),
      resolveDocument: () => ({ id: created.documentId, currentRevision: mutated.revision, externalId: created.documentRef }),
      resolveProviderArtifact: () => ({ external_id: created.documentRef }) as never,
    }).map((hop) => hop.stage)).toEqual([
      'entity_action', 'receipt', 'document_operation', 'document_revision', 'provider_artifact',
    ]);
  });

  it('marks a post-write evidence failure uncertain so retries reconcile instead of rewriting', async () => {
    const original = createDocxPackage(await fullFidelityFixture());
    const candidate = appendTextToDocx(original, 'Human change before audit failure.');
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const operationState = operationRepository();
    let saveCalls = 0;
    const runtime: DocxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-29', revision: docxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate: next }) => {
        saveCalls++;
        const content = Buffer.from(next);
        bytes.set('file-source:v1.fixture', content);
        const revision = docxRevision(content);
        return { revision: { token: revision, contentHash: revision, size: content.length, modifiedAtMs: 0 },
          recoveryReference: 'source:recovery', atomicReplacement: true,
          linearization: 'broker-serialized-conditional-replace' };
      },
      registry: { create: () => ({ id: 'document-29' }) as never, update: () => ({ id: 'document-29' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: () => { throw new Error('audit write failed'); } },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalDocxEngine({ workspaceId: 'workspace-1', runtime });
    const request = { documentId: 'document-29', documentRef: 'file-source:v1.fixture', format: 'docx' as const,
      candidate, expectedRevision: docxRevision(original), idempotencyKey: 'save-uncertain',
      actor: { actorClass: 'human' as const, actorId: 'human-1' } };

    await expect(engine.save(request)).rejects.toThrow('audit write failed');
    expect(bytes.get(request.documentRef)).toEqual(candidate);
    expect(operationState.records.get(request.idempotencyKey)?.operation_status).toBe('uncertain');
    await expect(engine.save(request)).rejects.toMatchObject({ code: 'uncertain' });
    expect(saveCalls).toBe(1);
  });

  it('rejects an agent receipt that cannot be resolved from canonical evidence before save', async () => {
    const original = createDocxPackage(await fullFidelityFixture());
    const documentRef = 'file-source:v1.fixture';
    const bytes = new Map([[documentRef, original]]);
    const operationState = operationRepository();
    const receipt = await canonicalReceipt();
    const receiptLookups: string[] = [];
    let saveCalls = 0;
    const runtime = {
      probe: async () => ({ state: 'ready' as const, reason: 'test' }),
      create: async () => ({ documentId: 'document-29', revision: docxRevision(original) }),
      read: async (reference: string) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' as const }),
      save: async ({ candidate, validate }: Parameters<DocxEngineRuntime['save']>[0]) => {
        saveCalls++;
        const content = Buffer.from(candidate);
        await validate(content);
        bytes.set(documentRef, content);
        const revision = docxRevision(content);
        return {
          revision: { token: revision, contentHash: revision, size: content.length, modifiedAtMs: 0 },
          recoveryReference: 'source:.entity-recovery/document-29.docx',
          atomicReplacement: true as const,
          linearization: 'broker-serialized-conditional-replace' as const,
        };
      },
      registry: {
        create: () => ({ id: 'document-29' }) as never,
        update: () => ({ id: 'document-29' }) as never,
      },
      versions: { recordDocumentVersion: (input: never) => input },
      events: { appendEvent: (input: never) => input },
      operations: operationState.repository,
      activity: { createActivity: (input: never) => input },
      receipts: {
        getArtifact: (artifactId: string) => {
          receiptLookups.push(artifactId);
          return undefined;
        },
      },
      flags: resolvePhase2Flags({}),
      transaction: (work: () => unknown) => work(),
    } as unknown as DocxEngineRuntime;
    const engine = new LocalDocxEngine({ workspaceId: 'workspace-1', runtime });

    await expect(engine.mutate({
      documentId: 'document-29', documentRef, format: 'docx',
      expectedRevision: docxRevision(original), idempotencyKey: 'unresolved-receipt-mutation-29',
      mutation: { kind: 'text', text: 'Must not land.' },
      actor: { actorClass: 'agent', actorId: 'agent-1', receipt },
    })).rejects.toMatchObject({ name: 'DocxValidationError', code: 'invalid_docx' });
    expect(receiptLookups).toEqual([receipt.artifact.id]);
    expect(saveCalls).toBe(0);
    expect(bytes.get(documentRef)).toEqual(original);
  });

  it('returns uncertain when retrying a mutation whose artifact write outlived activity persistence', async () => {
    const original = createDocxPackage(await fullFidelityFixture());
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const operationState = operationRepository();
    const receipt = await canonicalReceipt();
    let saveCalls = 0;
    const runtime: DocxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-29', revision: docxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate }) => {
        saveCalls++;
        const content = Buffer.from(candidate);
        bytes.set('file-source:v1.fixture', content);
        const revision = docxRevision(content);
        return { revision: { token: revision, contentHash: revision, size: content.length, modifiedAtMs: 0 },
          recoveryReference: 'source:recovery', atomicReplacement: true,
          linearization: 'broker-serialized-conditional-replace' };
      },
      registry: { create: () => ({ id: 'document-29' }) as never, update: () => ({ id: 'document-29' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: () => { throw new Error('activity persistence failed'); } },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(receipt),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalDocxEngine({ workspaceId: 'workspace-1', runtime });
    const request = { documentId: 'document-29', documentRef: 'file-source:v1.fixture', format: 'docx' as const,
      expectedRevision: docxRevision(original), mutation: { kind: 'text' as const, text: 'Agent change before audit failure.' },
      idempotencyKey: 'mutation-uncertain', actor: { actorClass: 'agent' as const, actorId: 'agent-1', receipt } };

    await expect(engine.mutate(request)).rejects.toThrow('activity persistence failed');
    await expect(engine.mutate(request)).rejects.toMatchObject({ code: 'uncertain' });
    expect(saveCalls).toBe(1);
  });

  it.each([
    ['truncated archive', (valid: Buffer) => valid.subarray(0, valid.length - 10), 'invalid_archive'],
    ['encrypted entry', (valid: Buffer) => patchFirstZipEntry(valid, (local, central, result) => {
      result.writeUInt16LE(result.readUInt16LE(local + 6) | 1, local + 6);
      result.writeUInt16LE(result.readUInt16LE(central + 8) | 1, central + 8);
    }), 'encrypted_entry'],
    ['strong-encrypted entry', (valid: Buffer) => patchFirstZipEntry(valid, (local, central, result) => {
      result.writeUInt16LE(result.readUInt16LE(local + 6) | 0x40, local + 6);
      result.writeUInt16LE(result.readUInt16LE(central + 8) | 0x40, central + 8);
    }), 'encrypted_entry'],
    ['inconsistent local metadata', (valid: Buffer) => patchFirstZipEntry(valid, (local, _central, result) => {
      result.writeUInt32LE(result.readUInt32LE(local + 18) + 1, local + 18);
    }), 'invalid_archive'],
    ['unsupported data descriptor', (valid: Buffer) => patchFirstZipEntry(valid, (local, central, result) => {
      result.writeUInt16LE(result.readUInt16LE(local + 6) | 0x8, local + 6);
      result.writeUInt16LE(result.readUInt16LE(central + 8) | 0x8, central + 8);
    }), 'invalid_archive'],
    ['unaccounted local ZIP bytes', (valid: Buffer) => insertZipGap(valid), 'invalid_archive'],
    ['unsupported compression', (valid: Buffer) => patchFirstZipEntry(valid, (local, central, result) => {
      result.writeUInt16LE(99, local + 8);
      result.writeUInt16LE(99, central + 10);
    }), 'unsupported_compression'],
    ['ZIP traversal', (valid: Buffer) => renameEntryBytes(
      withEntry(valid, 'word/safe.xml', '<safe/>'),
      'word/safe.xml',
      '../evilxx.xml',
    ), 'unsafe_path'],
    ['duplicate ZIP entry', (valid: Buffer) => renameEntryBytes(
      withEntry(withEntry(valid, 'word/one.xml', 'one'), 'word/two.xml', 'two'),
      'word/two.xml',
      'word/one.xml',
    ), 'duplicate_entry'],
    ['macro payload', (valid: Buffer) => withEntry(valid, 'word/vbaProject.bin', 'not executed'), 'macro_forbidden'],
    ['entity-encoded macro content type', (valid: Buffer) => {
      const entries = readOoxmlPackage(valid);
      const contentTypes = entries.get('[Content_Types].xml')!.toString('utf8')
        .replace(
          '</Types>',
          '<Override PartName="/word/benign.bin" ContentType="application/vnd.ms-word.document.macro&#x45;nabled.main+xml"/></Types>',
        );
      return withEntry(valid, '[Content_Types].xml', contentTypes);
    }, 'macro_forbidden'],
    ['embedded payload', (valid: Buffer) => withEntry(valid, 'word/embeddings/object.bin', 'not executed'), 'embedded_content_forbidden'],
    ['entity-encoded embedded control relationship type', (valid: Buffer) => withEntry(
      withEntry(valid, 'word/media/benign.bin', 'not executed'),
      'word/_rels/document.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship Id="rIdControl" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/contr&#x6F;l" Target="media/benign.bin"/></Relationships>`,
    ), 'embedded_content_forbidden'],
    ['external relationship', (valid: Buffer) => withEntry(
      valid,
      'word/_rels/document.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship TargetMode="External" Target="https://attacker.invalid"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['encoded external relationship', (valid: Buffer) => withEntry(
      valid,
      'word/_rels/document.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship TargetMode="&#x45;xternal" Target="https&#x3A;&#x2F;&#x2F;attacker.invalid"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['traversing relationship', (valid: Buffer) => withEntry(
      valid,
      'word/_rels/document.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship Target="../../outside.xml"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['encoded traversing relationship', (valid: Buffer) => withEntry(
      valid,
      'word/_rels/document.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship Target="..&#x2F;..&#x2F;outside.xml"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['embedded document object', (valid: Buffer) => {
      const entries = readOoxmlPackage(valid);
      const document = entries.get('word/document.xml')!.toString('utf8')
        .replace('</w:body>', '<w:object><o:OLEObject/></w:object></w:body>');
      return withEntry(valid, 'word/document.xml', document);
    }, 'embedded_content_forbidden'],
    ['alternate-prefix imported content', (valid: Buffer) => {
      const entries = readOoxmlPackage(valid);
      const document = entries.get('word/document.xml')!.toString('utf8')
        .replace('</w:body>', '<attack:altChunk xmlns:attack="urn:attacker"/></w:body>');
      return withEntry(valid, 'word/document.xml', document);
    }, 'embedded_content_forbidden'],
    ['unsafe XML declaration', (valid: Buffer) => withEntry(
      valid,
      'word/document.xml',
      '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><w:document><w:body/></w:document>',
    ), 'unsafe_xml'],
    ['malformed document XML', (valid: Buffer) => withEntry(
      valid,
      'word/document.xml',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>broken</w:t></w:r></w:body></w:document>',
    ), 'invalid_docx'],
    ['malformed auxiliary XML', (valid: Buffer) => withEntry(
      valid,
      'word/styles.xml',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style></w:styles>',
    ), 'invalid_docx'],
    ['non-DOCX package type', (valid: Buffer) => withEntry(
      valid,
      '[Content_Types].xml',
      '<Types><Override ContentType="application/xml"/></Types>',
    ), 'invalid_docx'],
    ['oversized expanded part', (valid: Buffer) => withEntry(
      valid,
      'word/oversized.bin',
      Buffer.alloc(512 * 1024 + 1),
    ), 'limit_exceeded'],
    ['compression bomb', (valid: Buffer) => {
      const entries = readOoxmlPackage(valid);
      return writeOoxmlPackage([
        ...[...entries].map(([name, data]) => ({ name, data })),
        { name: 'word/bomb.bin', data: Buffer.alloc(256 * 1024), compression: 'deflate' as const },
      ]);
    }, 'limit_exceeded'],
  ])('rejects malicious/invalid OOXML: %s', async (_case, build, code) => {
    const valid = createDocxPackage(await fullFidelityFixture());
    expect(() => inspectDocxPackage(build(valid))).toThrow(expect.objectContaining({ code }));
  });

  it('keeps a stale expected revision retryable and deterministic on the same operation key', async () => {
    const original = createDocxPackage(await fullFidelityFixture());
    const currentRevision = docxRevision(original);
    const operationState = operationRepository();
    let saveCalls = 0;
    const runtime = {
      probe: async () => ({ state: 'ready' as const, reason: 'test' }),
      create: async () => ({ documentId: 'document-29', revision: currentRevision }),
      read: async () => Buffer.from(original),
      open: async () => ({ opened: true, readiness: 'ready' as const }),
      save: async () => { saveCalls++; throw new Error('must not save'); },
      registry: { update: () => ({ id: 'document-29' }) as never },
      versions: { recordDocumentVersion: (input: never) => input },
      events: { appendEvent: (input: never) => input },
      operations: operationState.repository,
      activity: { createActivity: (input: never) => input },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}),
      transaction: (work: () => unknown) => work(),
    } as unknown as DocxEngineRuntime;
    const engine = new LocalDocxEngine({ workspaceId: 'workspace-1', runtime });
    const mutation = {
      documentId: 'document-29', documentRef: 'file-source:v1.fixture', format: 'docx' as const,
      expectedRevision: 'stale-revision', idempotencyKey: 'stale-mutation-29',
      mutation: { kind: 'text' as const, text: 'Nope' },
      actor: { actorClass: 'human' as const, actorId: 'human-1' },
    };
    const expectedConflict = {
      name: 'StaleRevisionError', expectedRevision: 'stale-revision', currentRevision, retryable: true,
    };

    await expect(engine.mutate(mutation)).rejects.toMatchObject(expectedConflict);
    await expect(engine.mutate(mutation)).rejects.toMatchObject(expectedConflict);
    expect(saveCalls).toBe(0);
  });

  it('fails closed on stale mutation and unsupported mutation lanes without changing bytes', async () => {
    const original = createDocxPackage(await fullFidelityFixture());
    const bytes = new Map([['file-source:v1.fixture', original]]);
    let saveCalls = 0;
    const receipt = await canonicalReceipt();
    const operationState = operationRepository();
    const runtime = {
      probe: async () => ({ state: 'ready' as const, reason: 'test' }),
      create: async () => ({ documentId: 'document-29', revision: docxRevision(original) }),
      read: async (reference: string) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' as const }),
      save: async () => { saveCalls++; throw new Error('must not save'); },
      registry: { update: () => ({ id: 'document-29' }) as never },
      versions: { recordDocumentVersion: (input: never) => input },
      events: { appendEvent: (input: never) => input },
      operations: operationState.repository,
      activity: { createActivity: (input: never) => input },
      receipts: receiptRepository(receipt),
      flags: resolvePhase2Flags({}),
      transaction: (work: () => unknown) => work(),
    } as unknown as DocxEngineRuntime;
    const engine = new LocalDocxEngine({ workspaceId: 'workspace-1', runtime });
    const base = {
      documentId: 'document-29', documentRef: 'file-source:v1.fixture', format: 'docx' as const,
      idempotencyKey: 'mutation-29', actor: { actorClass: 'agent' as const, actorId: 'agent-1', receipt },
    };

    await expect(engine.save({
      ...base,
      candidate: original,
      expectedRevision: docxRevision(original),
    })).rejects.toMatchObject({ name: 'DocxValidationError' });
    await expect(engine.mutate({ ...base, expectedRevision: 'stale', mutation: { kind: 'text', text: 'Nope' } }))
      .rejects.toMatchObject({ name: 'StaleRevisionError' });
    await expect(engine.mutate({
      ...base,
      expectedRevision: docxRevision(original),
      mutation: { kind: 'text', text: 'No receipt' },
      actor: { actorClass: 'agent', actorId: 'agent-1' } as never,
    })).rejects.toMatchObject({ name: 'DocxValidationError' });
    await expect(engine.mutate({ ...base, expectedRevision: docxRevision(original), mutation: { kind: 'range', cell: 'A1', value: 'Nope' } }))
      .rejects.toMatchObject({ name: 'UnsupportedAdapterMutationError' });
    expect(saveCalls).toBe(0);
    expect(bytes.get(base.documentRef)).toEqual(original);
  });
});
