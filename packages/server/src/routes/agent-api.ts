import { randomBytes, randomUUID } from 'crypto';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type Database from 'better-sqlite3';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { createDocumentCollaborationRepository } from '../../../db/src/document-collab';

type Visibility = 'private' | 'shared' | 'public';

interface AgentDocumentRow {
  id: string;
  doc_id: string;
  source_id: string;
  path: string;
  content_hash: string | null;
  version: number;
  slug: string | null;
  visibility: Visibility;
  access_token: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureAgentApiSchema(db: Database.Database): void {
  createDocumentCollaborationRepository();

  db.exec(`
    CREATE TABLE IF NOT EXISTS document_blocks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      block_order INTEGER NOT NULL,
      markdown TEXT NOT NULL,
      by_actor TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_blocks_doc_order ON document_blocks(doc_id, block_order);
    CREATE INDEX IF NOT EXISTS idx_document_blocks_doc_id ON document_blocks(doc_id);

    CREATE TABLE IF NOT EXISTS document_events (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_document_events_doc_created ON document_events(doc_id, created_at);

    CREATE TABLE IF NOT EXISTS document_idempotency_keys (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      idem_key TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(doc_id, idem_key)
    );
  `);

  if (!hasColumn(db, 'document_sessions', 'slug')) {
    db.exec('ALTER TABLE document_sessions ADD COLUMN slug TEXT');
  }
  if (!hasColumn(db, 'document_sessions', 'visibility')) {
    db.exec("ALTER TABLE document_sessions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared'");
  }
  if (!hasColumn(db, 'document_sessions', 'access_token')) {
    db.exec('ALTER TABLE document_sessions ADD COLUMN access_token TEXT');
  }
  if (!hasColumn(db, 'document_sessions', 'revision')) {
    db.exec('ALTER TABLE document_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_sessions_slug ON document_sessions(slug);
  `);
}

function openDb(): Database.Database {
  return getEntityDatabase(ensureAgentApiSchema);
}

function generateSlug(): string {
  return randomBytes(6).toString('hex');
}

function generateToken(): string {
  return `tk_${randomBytes(12).toString('hex')}`;
}

function normalizeBy(by: unknown): string {
  if (typeof by !== 'string' || !by.trim()) {
    throw new Error('by is required (ai:name or human:name)');
  }
  const normalized = by.trim();
  if (!/^(ai|human):[a-zA-Z0-9_.-]+$/.test(normalized)) {
    throw new Error('by must match ai:name or human:name');
  }
  return normalized;
}

function docLinks(slug: string) {
  return {
    self: `/api/documents/${slug}`,
    state: `/api/documents/${slug}/state`,
    edit: `/api/documents/${slug}/edit`,
    editV2: `/api/documents/${slug}/edit/v2`,
    snapshot: `/api/documents/${slug}/snapshot`,
    ops: `/api/documents/${slug}/ops`,
    presence: `/api/documents/${slug}/presence`,
    events: `/api/documents/${slug}/events/pending`,
  };
}

function parseShareToken(req: Request): string | null {
  const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }

  const header = req.headers['x-share-token'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }

  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  return queryToken || null;
}

function mapDocRow(row: AgentDocumentRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.path,
    content: row.content_hash ?? '',
    visibility: row.visibility,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _links: docLinks(row.slug ?? ''),
  };
}

function splitBlocks(content: string, by: string): Array<{ id: string; markdown: string; by_actor: string }> {
  const parts = content.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return [{ id: randomUUID(), markdown: '', by_actor: by }];
  }
  return parts.map((markdown) => ({ id: randomUUID(), markdown, by_actor: by }));
}

function loadBlocks(db: Database.Database, docId: string) {
  return db
    .prepare('SELECT id, markdown, by_actor FROM document_blocks WHERE doc_id = ? ORDER BY block_order ASC')
    .all(docId) as Array<{ id: string; markdown: string; by_actor: string }>;
}

function persistBlocks(db: Database.Database, docId: string, blocks: Array<{ id: string; markdown: string; by_actor: string }>) {
  const del = db.prepare('DELETE FROM document_blocks WHERE doc_id = ?');
  const ins = db.prepare('INSERT INTO document_blocks (id, doc_id, block_order, markdown, by_actor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)');
  const tx = db.transaction(() => {
    del.run(docId);
    blocks.forEach((block, index) => {
      ins.run(block.id, docId, index, block.markdown, block.by_actor);
    });
  });
  tx();
}

function recordEvent(db: Database.Database, docId: string, type: string, by: string, payload: unknown): void {
  db.prepare('INSERT INTO document_events (id, doc_id, event_type, payload_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .run(randomUUID(), docId, type, JSON.stringify(payload ?? {}), by);
}

function ensureAuthorized(req: Request, res: Response, doc: AgentDocumentRow): boolean {
  if (doc.visibility === 'public') {
    return true;
  }
  const token = parseShareToken(req);
  if (!token || token !== doc.access_token) {
    res.status(401).json({ code: 'UNAUTHORIZED', error: 'Valid share token required.', _links: docLinks(doc.slug ?? '') });
    return false;
  }
  return true;
}

function getDocBySlug(db: Database.Database, slug: string): AgentDocumentRow | undefined {
  return db.prepare('SELECT * FROM document_sessions WHERE slug = ? LIMIT 1').get(slug) as AgentDocumentRow | undefined;
}

function updateDocumentContent(db: Database.Database, doc: AgentDocumentRow, content: string): AgentDocumentRow {
  const nextRevision = (doc.revision ?? 0) + 1;
  db.prepare('UPDATE document_sessions SET content_hash = ?, revision = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(content, nextRevision, nextRevision, doc.id);
  return getDocBySlug(db, doc.slug ?? '')!;
}

function computeAuthorship(blocks: Array<{ markdown: string; by_actor: string }>) {
  const totals = new Map<string, number>();
  let full = 0;
  for (const block of blocks) {
    const len = block.markdown.length;
    full += len;
    totals.set(block.by_actor, (totals.get(block.by_actor) ?? 0) + len);
  }
  return Array.from(totals.entries()).map(([name, chars]) => ({
    name: name.split(':')[1] ?? name,
    type: name.startsWith('ai:') ? 'ai' : 'human',
    percent: full > 0 ? Math.round((chars / full) * 100) : 0,
  }));
}

export function createAgentApiRouter(): Router {
  const router = createRouter();

  router.post('/documents', (req, res) => {
    try {
      const db = openDb();
      const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Untitled';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      const visibility: Visibility = req.body?.visibility === 'public' || req.body?.visibility === 'private' ? req.body.visibility : 'shared';
      const by = normalizeBy(req.body?.by ?? 'human:system');
      const id = randomUUID();
      const slug = generateSlug();
      const token = generateToken();

      db.prepare(`INSERT INTO document_sessions (id, doc_id, source_id, path, content_hash, version, slug, visibility, access_token, revision, created_at, updated_at)
                  VALUES (?, ?, 'agent-api', ?, ?, 1, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .run(id, id, title, content, slug, visibility, token);

      const blocks = splitBlocks(content, by);
      persistBlocks(db, id, blocks);

      const shareUrl = `/d/${slug}?token=${token}`;
      res.status(201).json({ id, slug, title, shareUrl, accessToken: token, createdAt: new Date().toISOString(), _links: docLinks(slug) });
    } catch (error) {
      res.status(400).json({ code: 'CREATE_FAILED', error: error instanceof Error ? error.message : 'Failed to create document', _links: { self: '/api/documents' } });
    }
  });

  router.get('/documents/:slug', (req, res) => {
    const db = openDb();
    const doc = getDocBySlug(db, req.params.slug);
    if (!doc) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
      return;
    }
    if (!ensureAuthorized(req, res, doc)) return;

    if ((req.headers.accept ?? '').toString().includes('text/markdown')) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.send(doc.content_hash ?? '');
      return;
    }

    const blocks = loadBlocks(db, doc.id);
    res.json({ ...mapDocRow(doc), content: doc.content_hash ?? '', authors: computeAuthorship(blocks) });
  });

  router.get('/documents/:slug/state', (req, res) => {
    const db = openDb();
    const doc = getDocBySlug(db, req.params.slug);
    if (!doc) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
      return;
    }
    if (!ensureAuthorized(req, res, doc)) return;

    const blocks = loadBlocks(db, doc.id);
    const presence = db.prepare('SELECT * FROM document_presence WHERE doc_id = ? ORDER BY updated_at DESC').all(doc.id);
    const comments = db.prepare('SELECT * FROM document_events WHERE doc_id = ? AND event_type = ? ORDER BY created_at DESC').all(doc.id, 'comment.add');
    res.json({
      ...mapDocRow(doc),
      content: doc.content_hash ?? '',
      blocks,
      authors: computeAuthorship(blocks),
      presence,
      comments,
      _links: docLinks(doc.slug ?? ''),
    });
  });

  router.patch('/documents/:slug', (req, res) => {
    const db = openDb();
    const doc = getDocBySlug(db, req.params.slug);
    if (!doc) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
      return;
    }
    if (!ensureAuthorized(req, res, doc)) return;

    const visibility: Visibility = req.body?.visibility;
    if (!['private', 'shared', 'public'].includes(visibility)) {
      res.status(400).json({ code: 'INVALID_VISIBILITY', error: 'visibility must be private/shared/public', _links: docLinks(doc.slug ?? '') });
      return;
    }

    db.prepare('UPDATE document_sessions SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(visibility, doc.id);
    const updated = getDocBySlug(db, req.params.slug)!;
    res.json({ ...mapDocRow(updated), visibility: updated.visibility });
  });

  router.delete('/documents/:slug', (req, res) => {
    const db = openDb();
    const doc = getDocBySlug(db, req.params.slug);
    if (!doc) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
      return;
    }
    if (!ensureAuthorized(req, res, doc)) return;

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM document_blocks WHERE doc_id = ?').run(doc.id);
      db.prepare('DELETE FROM document_presence WHERE doc_id = ?').run(doc.id);
      db.prepare('DELETE FROM document_events WHERE doc_id = ?').run(doc.id);
      db.prepare('DELETE FROM document_sessions WHERE id = ?').run(doc.id);
    });
    tx();

    res.json({ success: true, slug: doc.slug, _links: { create: '/api/documents' } });
  });

  router.post('/documents/:slug/edit', (req, res) => {
    try {
      const db = openDb();
      const doc = getDocBySlug(db, req.params.slug);
      if (!doc) {
        res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
        return;
      }
      if (!ensureAuthorized(req, res, doc)) return;

      const by = normalizeBy(req.body?.by);
      const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
      if (operations.length === 0) {
        res.status(400).json({ code: 'INVALID_OPERATIONS', error: 'operations[] is required', _links: docLinks(doc.slug ?? '') });
        return;
      }

      let content = doc.content_hash ?? '';
      for (const operation of operations) {
        if (operation?.op === 'append') {
          const section = typeof operation.section === 'string' ? operation.section.trim() : '';
          const add = String(operation.content ?? '');
          if (section) {
            const marker = `# ${section}`;
            if (content.includes(marker)) {
              content = content.replace(marker, `${marker}\n${add}`);
            } else {
              content += `\n\n${marker}\n${add}`;
            }
          } else {
            content += add;
          }
        } else if (operation?.op === 'replace') {
          const search = String(operation.search ?? '');
          const replace = String(operation.content ?? '');
          content = search ? content.split(search).join(replace) : content;
        } else if (operation?.op === 'insert') {
          const after = String(operation.after ?? '');
          const insert = String(operation.content ?? '');
          const index = content.indexOf(after);
          content = index >= 0 ? `${content.slice(0, index + after.length)}${insert}${content.slice(index + after.length)}` : `${content}${insert}`;
        }
      }

      const updated = updateDocumentContent(db, doc, content);
      const blocks = splitBlocks(content, by);
      persistBlocks(db, doc.id, blocks);
      recordEvent(db, doc.id, 'edit.v1', by, { operationsCount: operations.length, revision: updated.revision });
      res.json({ success: true, slug: updated.slug, revision: updated.revision, updatedAt: updated.updated_at, collabApplied: true, _links: docLinks(updated.slug ?? '') });
    } catch (error) {
      res.status(400).json({ code: 'EDIT_FAILED', error: error instanceof Error ? error.message : 'Edit failed', _links: { create: '/api/documents' } });
    }
  });

  router.get('/documents/:slug/snapshot', (req, res) => {
    const db = openDb();
    const doc = getDocBySlug(db, req.params.slug);
    if (!doc) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
      return;
    }
    if (!ensureAuthorized(req, res, doc)) return;

    const blocks = loadBlocks(db, doc.id);
    res.json({ revision: doc.revision, blocks: blocks.map((b) => ({ id: b.id, markdown: b.markdown, by: b.by_actor })), updatedAt: doc.updated_at, _links: docLinks(doc.slug ?? '') });
  });

  router.post('/documents/:slug/edit/v2', (req, res) => {
    try {
      const db = openDb();
      const doc = getDocBySlug(db, req.params.slug);
      if (!doc) {
        res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
        return;
      }
      if (!ensureAuthorized(req, res, doc)) return;

      const by = normalizeBy(req.body?.by);
      const baseRevision = Number(req.body?.baseRevision ?? -1);
      if (!Number.isInteger(baseRevision)) {
        res.status(400).json({ code: 'BASE_REVISION_REQUIRED', error: 'baseRevision is required', _links: docLinks(doc.slug ?? '') });
        return;
      }
      if (baseRevision !== doc.revision) {
        const blocks = loadBlocks(db, doc.id);
        res.status(409).json({ code: 'STALE_REVISION', error: 'baseRevision is stale', snapshot: { revision: doc.revision, blocks }, _links: docLinks(doc.slug ?? '') });
        return;
      }

      const idemKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : '';
      if (idemKey) {
        const existing = db.prepare('SELECT response_json FROM document_idempotency_keys WHERE doc_id = ? AND idem_key = ? LIMIT 1').get(doc.id, idemKey) as { response_json: string } | undefined;
        if (existing) {
          res.json(JSON.parse(existing.response_json));
          return;
        }
      }

      const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
      let blocks = loadBlocks(db, doc.id).map((b) => ({ ...b }));
      const idx = (ref: string) => blocks.findIndex((b) => b.id === ref);

      for (const operation of operations) {
        const op = operation?.op;
        if (op === 'replace_block') {
          const i = idx(String(operation.ref ?? ''));
          if (i >= 0) blocks[i] = { id: blocks[i].id, markdown: String(operation.block?.markdown ?? ''), by_actor: by };
        } else if (op === 'insert_before' || op === 'insert_after') {
          const i = idx(String(operation.ref ?? ''));
          const add = Array.isArray(operation.blocks) ? operation.blocks.map((b: any) => ({ id: randomUUID(), markdown: String(b?.markdown ?? ''), by_actor: by })) : [];
          if (i >= 0) {
            const at = op === 'insert_before' ? i : i + 1;
            blocks.splice(at, 0, ...add);
          }
        } else if (op === 'delete_block') {
          const i = idx(String(operation.ref ?? ''));
          if (i >= 0) blocks.splice(i, 1);
        } else if (op === 'replace_range') {
          const start = idx(String(operation.startRef ?? ''));
          const end = idx(String(operation.endRef ?? ''));
          if (start >= 0 && end >= start) {
            const add = Array.isArray(operation.blocks) ? operation.blocks.map((b: any) => ({ id: randomUUID(), markdown: String(b?.markdown ?? ''), by_actor: by })) : [];
            blocks.splice(start, end - start + 1, ...add);
          }
        } else if (op === 'find_replace_in_block') {
          const i = idx(String(operation.ref ?? ''));
          if (i >= 0) {
            const search = String(operation.search ?? '');
            const repl = String(operation.content ?? '');
            blocks[i] = { ...blocks[i], markdown: blocks[i].markdown.split(search).join(repl), by_actor: by };
          }
        }
      }

      const nextContent = blocks.map((b) => b.markdown).join('\n\n');
      const updated = updateDocumentContent(db, doc, nextContent);
      persistBlocks(db, doc.id, blocks);
      recordEvent(db, doc.id, 'edit.v2', by, { revision: updated.revision, operationsCount: operations.length });

      const response = { success: true, slug: updated.slug, revision: updated.revision, updatedAt: updated.updated_at, blocks: blocks.map((b) => ({ id: b.id, markdown: b.markdown, by: b.by_actor })), _links: docLinks(updated.slug ?? '') };
      if (idemKey) {
        db.prepare('INSERT OR IGNORE INTO document_idempotency_keys (id, doc_id, idem_key, response_json, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
          .run(randomUUID(), doc.id, idemKey, JSON.stringify(response));
      }
      res.json(response);
    } catch (error) {
      res.status(400).json({ code: 'EDIT_V2_FAILED', error: error instanceof Error ? error.message : 'Edit V2 failed', _links: { create: '/api/documents' } });
    }
  });

  router.post('/documents/:slug/ops', (req, res) => {
    try {
      const db = openDb();
      const doc = getDocBySlug(db, req.params.slug);
      if (!doc) {
        res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
        return;
      }
      if (!ensureAuthorized(req, res, doc)) return;
      const by = normalizeBy(req.body?.by);
      const type = String(req.body?.type ?? '');
      if (!['comment.add', 'suggestion.add', 'rewrite.apply'].includes(type)) {
        res.status(400).json({ code: 'INVALID_OP', error: 'Unsupported op type', _links: docLinks(doc.slug ?? '') });
        return;
      }
      recordEvent(db, doc.id, type, by, req.body ?? {});
      res.json({ success: true, type, _links: docLinks(doc.slug ?? '') });
    } catch (error) {
      res.status(400).json({ code: 'OPS_FAILED', error: error instanceof Error ? error.message : 'Ops failed', _links: { create: '/api/documents' } });
    }
  });

  router.post('/documents/:slug/presence', (req, res) => {
    try {
      const db = openDb();
      const doc = getDocBySlug(db, req.params.slug);
      if (!doc) {
        res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
        return;
      }
      if (!ensureAuthorized(req, res, doc)) return;

      const by = normalizeBy(req.body?.by);
      const status = typeof req.body?.status === 'string' ? req.body.status : 'active';
      const cursor = req.body?.cursor ?? {};
      db.prepare(`INSERT INTO document_presence (id, doc_id, agent_id, status, cursor_json, last_activity_at, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                  ON CONFLICT(doc_id, agent_id) DO UPDATE SET status=excluded.status, cursor_json=excluded.cursor_json, last_activity_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`)
        .run(randomUUID(), doc.id, by, status, JSON.stringify(cursor));
      recordEvent(db, doc.id, 'presence.update', by, { status });
      const row = db.prepare('SELECT * FROM document_presence WHERE doc_id = ? AND agent_id = ? LIMIT 1').get(doc.id, by);
      res.json({ presence: row, _links: docLinks(doc.slug ?? '') });
    } catch (error) {
      res.status(400).json({ code: 'PRESENCE_FAILED', error: error instanceof Error ? error.message : 'Presence failed', _links: { create: '/api/documents' } });
    }
  });

  router.get('/documents/:slug/events/pending', (req, res) => {
    const db = openDb();
    const doc = getDocBySlug(db, req.params.slug);
    if (!doc) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
      return;
    }
    if (!ensureAuthorized(req, res, doc)) return;

    const after = typeof req.query.after === 'string' ? req.query.after : '';
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));
    const rows = after
      ? db.prepare('SELECT * FROM document_events WHERE doc_id = ? AND id > ? AND acknowledged_at IS NULL ORDER BY created_at ASC LIMIT ?').all(doc.id, after, limit)
      : db.prepare('SELECT * FROM document_events WHERE doc_id = ? AND acknowledged_at IS NULL ORDER BY created_at ASC LIMIT ?').all(doc.id, limit);
    res.json({ events: rows, _links: docLinks(doc.slug ?? '') });
  });

  router.post('/documents/:slug/events/ack', (req, res) => {
    const db = openDb();
    const doc = getDocBySlug(db, req.params.slug);
    if (!doc) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Document not found', _links: { create: '/api/documents' } });
      return;
    }
    if (!ensureAuthorized(req, res, doc)) return;

    const ids = Array.isArray(req.body?.eventIds) ? req.body.eventIds.map((v: unknown) => String(v)) : [];
    const ackOne = db.prepare('UPDATE document_events SET acknowledged_at = CURRENT_TIMESTAMP WHERE doc_id = ? AND id = ?');
    const tx = db.transaction(() => {
      for (const id of ids) {
        ackOne.run(doc.id, id);
      }
    });
    tx();
    res.json({ acknowledged: ids.length, _links: docLinks(doc.slug ?? '') });
  });

  router.get('/.well-known/agent.json', (_req, res) => {
    res.json({
      name: 'Entity DocHub Agent API',
      version: '1.0.0',
      endpoints: {
        create: '/api/documents',
        read: '/api/documents/{slug}',
        state: '/api/documents/{slug}/state',
        edit: '/api/documents/{slug}/edit',
        editV2: '/api/documents/{slug}/edit/v2',
      },
      auth: ['Authorization: Bearer <token>', 'X-Share-Token: <token>', '?token=<token>'],
      _links: { create: '/api/documents' },
    });
  });

  return router;
}

export { parseShareToken };
