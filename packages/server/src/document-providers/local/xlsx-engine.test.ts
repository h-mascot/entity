import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityRecord, EvidenceArtifactRecord, TaskRecord } from '../../../../db/src';
import { completeTaskWithReceipt, type CompletionReceiptResult } from '../../receipt-writer';
import { resolvePhase2Flags } from '../../phase2-flags';
import {
  createXlsxPackage,
  inspectXlsxPackage,
  LocalXlsxEngine,
  parseCellReference,
  setXlsxRange,
  xlsxRevision,
  type XlsxEngineRuntime,
  type XlsxWorkbook,
} from './xlsx-engine';
import { readOoxmlPackage, writeOoxmlPackage } from './ooxml-package';

const FIXED_NOW = '2026-08-24T12:00:00.000Z';
const RELATIONSHIPS_OPEN = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

async function canonicalReceipt(): Promise<CompletionReceiptResult> {
  const previousTask = { id: 30, name: 'T-030 mutation', column: 'doing', metadata: '{}', org_id: 'org-1' } as TaskRecord;
  const nextTask = { ...previousTask, column: 'done' } as TaskRecord;
  return completeTaskWithReceipt(
    { previousTask, nextTask, actorPrincipalId: 'agent-1' },
    {
      storageRoot: '/unused', idFactory: () => 'receipt-30', now: () => new Date(FIXED_NOW),
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

function receiptRepository(receipt?: CompletionReceiptResult): XlsxEngineRuntime['receipts'] {
  return { getArtifact: (id) => receipt?.artifact.id === id ? receipt.artifact : undefined };
}

function operationRepository() {
  const records = new Map<string, Record<string, unknown>>();
  const repository: XlsxEngineRuntime['operations'] = {
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

async function fullFidelityFixture(): Promise<XlsxWorkbook> {
  const file = path.join(__dirname, 'fixtures/xlsx/full-fidelity.json');
  return JSON.parse(await readFile(file, 'utf8')) as XlsxWorkbook;
}

function withEntry(packageBytes: Buffer, name: string, data: string | Buffer): Buffer {
  const entries = readOoxmlPackage(packageBytes);
  entries.set(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  return writeOoxmlPackage([...entries].map(([entryName, entryData]) => ({ name: entryName, data: entryData })));
}

function withAlternateSpreadsheetPrefix(packageBytes: Buffer): Buffer {
  const entries = readOoxmlPackage(packageBytes);
  const source = entries.get('xl/worksheets/sheet1.xml')!.toString('utf8')
    .replace('xmlns=', 'xmlns:x=').replace(/\b(worksheet|sheetData|row|c|is|t)\b(?!\s*=)/g, 'x:$1');
  entries.set('xl/worksheets/sheet1.xml', Buffer.from(source));
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

describe('local XLSX engine', () => {
  it('creates and reopens a real XLSX package with the committed semantic fixture intact', async () => {
    const fixture = await fullFidelityFixture();
    const created = createXlsxPackage(fixture);
    const reopened = inspectXlsxPackage(created);
    expect(created.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(reopened).toEqual(fixture);
  });

  it('round-trips multiple named sheets with values, escaping, and Unicode', async () => {
    const workbook: XlsxWorkbook = {
      title: 'Multi',
      sheets: [
        { name: 'Alpha', rows: [['a<b>&"c', ''], ['', 'déjà ✓']] },
        { name: 'Beta', rows: [['1', '2'], ['3', '4']] },
      ],
    };
    const reopened = inspectXlsxPackage(createXlsxPackage(workbook));
    expect(reopened.sheets.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    expect(reopened.sheets[0].rows).toEqual([['a<b>&"c', ''], ['', 'déjà ✓']]);
  });

  it('preserves semantics with an alternate SpreadsheetML prefix', async () => {
    const fixture = await fullFidelityFixture();
    const prefixed = withAlternateSpreadsheetPrefix(createXlsxPackage(fixture));
    const reopened = inspectXlsxPackage(prefixed);
    expect(reopened.sheets[0].rows).toEqual(fixture.sheets[0].rows);
  });

  it('authorized range mutation writes one bounded cell and preserves every other part', async () => {
    const fixture = await fullFidelityFixture();
    const created = createXlsxPackage(fixture);
    const mutated = setXlsxRange(created, 'D2', '9999');
    const reopened = inspectXlsxPackage(mutated);
    expect(reopened.sheets[0].rows[1][3]).toBe('9999');
    expect(reopened.sheets[0].rows[1][0]).toBe(fixture.sheets[0].rows[1][0]);
    // Other sheets unaffected.
    expect(reopened.sheets[1]).toEqual(fixture.sheets[1]);
  });

  it('range mutation can clear a cell to empty', async () => {
    const fixture = await fullFidelityFixture();
    const mutated = setXlsxRange(createXlsxPackage(fixture), 'B2', '');
    const reopened = inspectXlsxPackage(mutated);
    expect(reopened.sheets[0].rows[1][1]).toBe('');
  });

  it('range mutation accepts a multi-letter column reference', () => {
    expect(parseCellReference('AA10')).toEqual({ row: 9, col: 26 });
    const workbook: XlsxWorkbook = { title: 'x', sheets: [{ name: 's', rows: [['v']] }] };
    // AA10 does not exist in the single-cell sheet, so mutation must reject it.
    expect(() => setXlsxRange(createXlsxPackage(workbook), 'AA10', 'v2'))
      .toThrow(expect.objectContaining({ code: 'range_out_of_bounds' }));
  });

  it('rejects invalid or out-of-bounds cell references', () => {
    for (const ref of ['B', '1', 'A0', 'A999999999999', '', '!bad', 'B-1']) {
      expect(() => parseCellReference(ref)).toThrow(expect.objectContaining({ code: 'range_out_of_bounds' }));
    }
  });

  it('rejects range mutation for a cell index beyond the authored width', async () => {
    const fixture = await fullFidelityFixture();
    const created = createXlsxPackage(fixture);
    // Column E is the last authored column; F2 does not exist.
    expect(() => setXlsxRange(created, 'F2', 'v'))
      .toThrow(expect.objectContaining({ code: 'range_out_of_bounds' }));
  });

  it.each([
    ['truncated archive', (valid: Buffer) => valid.subarray(0, valid.length - 10), 'invalid_archive'],
    ['encrypted entry', (valid: Buffer) => patchFirstZipEntry(valid, (local, central, result) => {
      result.writeUInt16LE(result.readUInt16LE(local + 6) | 1, local + 6);
      result.writeUInt16LE(result.readUInt16LE(central + 8) | 1, central + 8);
    }), 'encrypted_entry'],
    ['macros payload', (valid: Buffer) => withEntry(valid, 'xl/vbaProject.bin', 'not executed'), 'macro_forbidden'],
    ['macro content type', (valid: Buffer) => {
      const entries = readOoxmlPackage(valid);
      const contentTypes = entries.get('[Content_Types].xml')!.toString('utf8')
        .replace(
          '</Types>',
          '<Override PartName="/xl/benign.bin" ContentType="application/vnd.ms-excel.sheet.macro&#x45;nabled.main+xml"/></Types>',
        );
      return withEntry(valid, '[Content_Types].xml', contentTypes);
    }, 'macro_forbidden'],
    ['embedded payload', (valid: Buffer) => withEntry(valid, 'xl/embeddings/object.bin', 'not executed'), 'embedded_content_forbidden'],
    ['external relationship', (valid: Buffer) => withEntry(
      valid,
      'xl/_rels/workbook.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship TargetMode="External" Target="https://attacker.invalid"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['traversing relationship', (valid: Buffer) => withEntry(
      valid,
      'xl/_rels/workbook.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship Target="../../outside.xml"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['encoded traversing relationship', (valid: Buffer) => withEntry(
      valid,
      'xl/_rels/workbook.xml.rels',
      `${RELATIONSHIPS_OPEN}<Relationship Target="..&#x2F;..&#x2F;outside.xml"/></Relationships>`,
    ), 'external_relationship_forbidden'],
    ['unsafe XML declaration', (valid: Buffer) => withEntry(
      valid,
      'xl/worksheets/sheet1.xml',
      '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><worksheet><sheetData/></worksheet>',
    ), 'unsafe_xml'],
    ['malformed sheet XML', (valid: Buffer) => withEntry(
      valid,
      'xl/worksheets/sheet1.xml',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c><is><t>broken</t></is></c></row></sheetData>',
    ), 'invalid_xlsx'],
    ['non-XLSX package type', (valid: Buffer) => withEntry(
      valid,
      '[Content_Types].xml',
      '<Types><Override ContentType="application/xml"/></Types>',
    ), 'invalid_xlsx'],
    ['external link workbook content', (valid: Buffer) => withEntry(
      valid,
      'xl/workbook.xml',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><externalLink r:id="rIdE"/></workbook>',
    ), 'embedded_content_forbidden'],
    ['oversized expanded part', (valid: Buffer) => withEntry(
      valid,
      'xl/oversized.bin',
      Buffer.alloc(512 * 1024 + 1),
    ), 'limit_exceeded'],
    ['unaccounted ZIP bytes', (valid: Buffer) => insertZipGap(valid), 'invalid_archive'],
    ['ZIP traversal', (valid: Buffer) => renameEntryBytes(
      withEntry(valid, 'xl/z.xml', '<z/>'), 'xl/z.xml', '../evilz',
    ), 'unsafe_path'],
    ['duplicate ZIP entry', (valid: Buffer) => renameEntryBytes(
      withEntry(withEntry(valid, 'xl/a.xml', 'a'), 'xl/b.xml', 'b'), 'xl/b.xml', 'xl/a.xml',
    ), 'duplicate_entry'],
  ])('rejects malicious/invalid XLSX: %s', async (_case, build, code) => {
    const valid = createXlsxPackage(await fullFidelityFixture());
    expect(() => inspectXlsxPackage(build(valid))).toThrow(expect.objectContaining({ code }));
  });

  it('fails closed on a malformed sheetData (unbalanced row)', async () => {
    const valid = createXlsxPackage(await fullFidelityFixture());
    const hostile = withEntry(valid, 'xl/worksheets/sheet1.xml',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c><is><t>x</t></is></c></sheetData></worksheet>');
    expect(() => inspectXlsxPackage(hostile)).toThrow(expect.objectContaining({ code: 'invalid_xlsx' }));
  });

  it('performs the create/open/human-save/reopen lifecycle through the engine seam', async () => {
    const fixture = await fullFidelityFixture();
    const bytes = new Map<string, Buffer>();
    const operationState = operationRepository();
    const runtime: XlsxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async ({ content }) => {
        const revision = xlsxRevision(content);
        bytes.set('file-source:v1.fixture', content);
        return { documentId: 'document-30', revision };
      },
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate }) => {
        const content = Buffer.from(candidate);
        bytes.set('file-source:v1.fixture', content);
        const revision = xlsxRevision(content);
        return { revision: { token: revision, contentHash: revision, size: content.length, modifiedAtMs: 0 },
          recoveryReference: 'source:recovery', atomicReplacement: true, linearization: 'broker-serialized-conditional-replace' };
      },
      registry: { create: () => ({ id: 'document-30' }) as never, update: () => ({ id: 'document-30' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: (input) => input as never },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalXlsxEngine({ workspaceId: 'workspace-1', runtime });
    const actor = { actorClass: 'human' as const, actorId: 'human-1' };

    const created = await engine.create({ documentRef: 'file-source:v1.fixture', format: 'xlsx', document: fixture, idempotencyKey: 'create-30', actor });
    expect(created.documentId).toBe('document-30');
    expect(created.entityUrl).toBe('/documents/document-30');
    expect(xlsxRevision(bytes.get('file-source:v1.fixture')!)).toBe(created.revision);
    expect(inspectXlsxPackage(bytes.get('file-source:v1.fixture')!)).toEqual(fixture);

    const opened = await engine.open({ documentRef: 'file-source:v1.fixture', format: 'xlsx' });
    expect(opened).toEqual({ opened: true, readiness: 'ready' });

    // Human candidate save: change one cell, save, reopen semantics.
    const before = bytes.get('file-source:v1.fixture')!;
    const updated = inspectXlsxPackage(before);
    updated.sheets[0].rows[1][1] = '9999';
    const candidate = createXlsxPackage(updated);
    const saved = await engine.save({ documentRef: 'file-source:v1.fixture', format: 'xlsx', documentId: 'document-30',
      candidate, expectedRevision: xlsxRevision(before), idempotencyKey: 'save-30', actor });
    expect(saved.saved).toBe(true);
    expect(saved.revision).toBe(xlsxRevision(bytes.get('file-source:v1.fixture')!));
    const reopened = inspectXlsxPackage(bytes.get('file-source:v1.fixture')!);
    expect(reopened.sheets[0].rows[1][1]).toBe('9999');
    expect(reopened.sheets[1]).toEqual(fixture.sheets[1]);
  });

  it('agent authorized range mutation lands a receipt-linked flat revision', async () => {
    const fixture = await fullFidelityFixture();
    const original = createXlsxPackage(fixture);
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const operationState = operationRepository();
    const receipt = await canonicalReceipt();
    const runtime: XlsxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-30', revision: xlsxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate }) => {
        const content = Buffer.from(candidate);
        bytes.set('file-source:v1.fixture', content);
        const revision = xlsxRevision(content);
        return { revision: { token: revision, contentHash: revision, size: content.length, modifiedAtMs: 0 },
          recoveryReference: 'source:recovery', atomicReplacement: true, linearization: 'broker-serialized-conditional-replace' };
      },
      registry: { create: () => ({ id: 'document-30' }) as never, update: () => ({ id: 'document-30' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: (input) => input as never },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(receipt),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalXlsxEngine({ workspaceId: 'workspace-1', runtime });
    const mutated = await engine.mutate({
      documentId: 'document-30', documentRef: 'file-source:v1.fixture', format: 'xlsx',
      expectedRevision: xlsxRevision(original), idempotencyKey: 'agent-range-30',
      mutation: { kind: 'range', cell: 'C3', value: '7777' },
      actor: { actorClass: 'agent', actorId: 'agent-1', receipt },
    });
    expect(mutated.changed).toBe(true);
    expect(inspectXlsxPackage(bytes.get('file-source:v1.fixture')!).sheets[0].rows[2][2]).toBe('7777');
    const activity = operationState.records.get('agent-range-30');
    expect(activity?.operation_status).toBe('completed');
    expect(activity?.document_id).toBe('document-30');
    expect(inspectXlsxPackage(bytes.get('file-source:v1.fixture')!).sheets[0].rows[2][2]).toBe('7777');
  });

  it('rejects a range mutation on a cell that was never authored', async () => {
    const fixture = await fullFidelityFixture();
    const original = createXlsxPackage(fixture);
    expect(() => setXlsxRange(original, 'H1', 'x'))
      .toThrow(expect.objectContaining({ code: 'range_out_of_bounds' }));
  });

  it('rejects an agent range mutation without a resolvable canonical receipt', async () => {
    const fixture = await fullFidelityFixture();
    const original = createXlsxPackage(fixture);
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const receipt = await canonicalReceipt();
    let saveCalls = 0;
    const runtime: XlsxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-30', revision: xlsxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async () => { saveCalls++; throw new Error('must not save'); },
      registry: { create: () => ({ id: 'document-30' }) as never, update: () => ({ id: 'document-30' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: (input) => input as never },
      operations: operationRepository().repository,
      activity: { createActivity: (input) => input as never },
      receipts: { getArtifact: () => undefined },
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalXlsxEngine({ workspaceId: 'workspace-1', runtime });
    await expect(engine.mutate({
      documentId: 'document-30', documentRef: 'file-source:v1.fixture', format: 'xlsx',
      expectedRevision: xlsxRevision(original), idempotencyKey: 'missing-receipt-30',
      mutation: { kind: 'range', cell: 'A1', value: 'x' },
      actor: { actorClass: 'agent', actorId: 'agent-1', receipt },
    })).rejects.toMatchObject({ name: 'XlsxValidationError', code: 'invalid_xlsx' });
    expect(saveCalls).toBe(0);
  });

  it('marks a post-write evidence failure uncertain so retries reconcile instead of rewriting', async () => {
    const fixture = await fullFidelityFixture();
    const original = createXlsxPackage(fixture);
    const candidate = setXlsxRange(original, 'B2', '2000');
    const bytes = new Map([['file-source:v1.fixture', original]]);
    const operationState = operationRepository();
    let saveCalls = 0;
    const runtime: XlsxEngineRuntime = {
      probe: async () => ({ state: 'ready', reason: 'test' }),
      create: async () => ({ documentId: 'document-30', revision: xlsxRevision(original) }),
      read: async (reference) => Buffer.from(bytes.get(reference)!),
      open: async () => ({ opened: true, readiness: 'ready' }),
      save: async ({ candidate: next }) => {
        saveCalls++;
        bytes.set('file-source:v1.fixture', Buffer.from(next));
        const revision = xlsxRevision(Buffer.from(next));
        return { revision: { token: revision, contentHash: revision, size: Buffer.from(next).length, modifiedAtMs: 0 },
          recoveryReference: 'source:recovery', atomicReplacement: true, linearization: 'broker-serialized-conditional-replace' };
      },
      registry: { create: () => ({ id: 'document-30' }) as never, update: () => ({ id: 'document-30' }) as never },
      versions: { recordDocumentVersion: (input) => input as never },
      events: { appendEvent: () => { throw new Error('audit write failed'); } },
      operations: operationState.repository,
      activity: { createActivity: (input) => input as never },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}), transaction: (work) => work(), now: () => FIXED_NOW,
    };
    const engine = new LocalXlsxEngine({ workspaceId: 'workspace-1', runtime });
    const request = { documentId: 'document-30', documentRef: 'file-source:v1.fixture', format: 'xlsx' as const,
      candidate, expectedRevision: xlsxRevision(original), idempotencyKey: 'save-uncertain-30',
      actor: { actorClass: 'human' as const, actorId: 'human-1' } };

    await expect(engine.save(request)).rejects.toThrow('audit write failed');
    expect(bytes.get(request.documentRef)).toEqual(candidate);
    expect(operationState.records.get(request.idempotencyKey)?.operation_status).toBe('uncertain');
    await expect(engine.save(request)).rejects.toMatchObject({ code: 'uncertain' });
    expect(saveCalls).toBe(1);
  });

  it('keeps a stale expected revision retryable and deterministic on the same operation key', async () => {
    const fixture = await fullFidelityFixture();
    const original = createXlsxPackage(fixture);
    const operationState = operationRepository();
    let saveCalls = 0;
    const runtime = {
      probe: async () => ({ state: 'ready' as const, reason: 'test' }),
      create: async () => ({ documentId: 'document-30', revision: xlsxRevision(original) }),
      read: async () => Buffer.from(original),
      open: async () => ({ opened: true, readiness: 'ready' as const }),
      save: async () => { saveCalls++; throw new Error('must not save'); },
      registry: { update: () => ({ id: 'document-30' }) as never },
      versions: { recordDocumentVersion: (input: never) => input },
      events: { appendEvent: (input: never) => input },
      operations: operationState.repository,
      activity: { createActivity: (input: never) => input },
      receipts: receiptRepository(),
      flags: resolvePhase2Flags({}), transaction: (work: () => unknown) => work(),
    } as unknown as XlsxEngineRuntime;
    const engine = new LocalXlsxEngine({ workspaceId: 'workspace-1', runtime });
    const mutation = {
      documentId: 'document-30', documentRef: 'file-source:v1.fixture', format: 'xlsx' as const,
      expectedRevision: 'stale-revision', idempotencyKey: 'stale-mutation-30',
      mutation: { kind: 'range' as const, cell: 'A1', value: 'Nope' },
      actor: { actorClass: 'human' as const, actorId: 'human-1' },
    };

    await expect(engine.mutate(mutation)).rejects.toMatchObject({ name: 'StaleRevisionError' });
    expect(saveCalls).toBe(0);
    await expect(engine.mutate(mutation)).rejects.toMatchObject({ name: 'StaleRevisionError' });
    expect(saveCalls).toBe(0);
    expect(operationState.records.get('stale-mutation-30')?.operation_status).toBe('completed');
  });
});
