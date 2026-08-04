import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChatRepository } from './chat';
import { getEntityDatabase } from './entity-db';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const duplicateDbPath = path.join(os.tmpdir(), `entity-chat-migration-duplicates-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const wrongIndexesDbPath = path.join(os.tmpdir(), `entity-chat-migration-wrong-indexes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeAll(() => {
  const legacy = new Database(tmpDbPath);
  legacy.pragma('foreign_keys = ON');
  legacy.exec(`
    CREATE TABLE chat_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      "order" INTEGER NOT NULL DEFAULT 0,
      org_id TEXT,
      team_id TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'workspace-default',
      metadata TEXT NOT NULL DEFAULT '{"source":"category-default"}' CHECK(json_valid(metadata)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chat_categories_name_unique UNIQUE(name) ON CONFLICT FAIL,
      UNIQUE(workspace_id, id)
    );
    CREATE TABLE chat_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE ON CONFLICT ABORT,
      description TEXT,
      category_id TEXT NOT NULL REFERENCES chat_categories(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 0,
      agents TEXT NOT NULL DEFAULT '[]',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      org_id TEXT,
      team_id TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'workspace-default',
      metadata TEXT NOT NULL DEFAULT '{"source":"channel-default"}' CHECK(json_valid(metadata)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      thread_id TEXT,
      sender TEXT NOT NULL,
      sender_emoji TEXT,
      content TEXT NOT NULL,
      model TEXT,
      is_local INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'sent',
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reply_to TEXT,
      org_id TEXT,
      team_id TEXT
    );
    CREATE TABLE chat_threads (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      parent_message_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
      org_id TEXT,
      team_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE chat_channel_audit (
      channel_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      metadata TEXT NOT NULL
    );
    CREATE INDEX idx_chat_categories_workspace_metadata ON chat_categories(workspace_id, metadata);
    CREATE INDEX idx_chat_channels_workspace_metadata ON chat_channels(workspace_id, metadata);
    CREATE INDEX idx_chat_channels_custom_order ON chat_channels("order", id);
    CREATE TRIGGER trg_chat_channels_metadata_audit
      AFTER UPDATE OF metadata ON chat_channels
      BEGIN
        INSERT INTO chat_channel_audit(channel_id, workspace_id, metadata)
        VALUES (NEW.id, NEW.workspace_id, NEW.metadata);
      END;
    INSERT INTO chat_categories
      (id, name, emoji, "order", org_id, team_id, workspace_id, metadata, created_at)
      VALUES ('legacy-cat', 'Shared', '📦', 7, 'org-a', 'team-a', 'workspace-a', '{"kind":"category"}', '2026-01-01T00:00:00.000Z');
    INSERT INTO chat_channels
      (id, name, description, category_id, "order", agents, unread_count, linked_object_refs_json, org_id, team_id, workspace_id, metadata, created_at)
      VALUES ('legacy-ch', 'general', 'kept', 'legacy-cat', 3, '["ada"]', 4, '[{"object_type":"task","object_id":"9","link_role":"context"}]', 'org-a', 'team-a', 'workspace-a', '{"kind":"channel"}', '2026-01-02T00:00:00.000Z');
    INSERT INTO chat_messages (id, channel_id, sender, content, org_id, team_id)
      VALUES ('legacy-msg', 'legacy-ch', 'user', 'preserved', 'org-a', 'team-a');
    INSERT INTO chat_threads (id, channel_id, parent_message_id, title, org_id, team_id)
      VALUES ('legacy-thread', 'legacy-ch', 'legacy-msg', 'Preserved thread', 'org-a', 'team-a');
  `);
  legacy.close();
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  for (const dbPath of [tmpDbPath, duplicateDbPath, wrongIndexesDbPath]) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('THE-931 legacy chat name migration', () => {
  it('preserves arbitrary deployed columns, values, constraints, relationships, indexes, triggers, and foreign keys', () => {
    const repo = createChatRepository();
    const db = getEntityDatabase();

    expect(repo.listCategories()).toContainEqual(expect.objectContaining({
      id: 'legacy-cat', name: 'Shared', org_id: 'org-a', team_id: 'team-a', order: 7,
    }));
    expect(repo.getChannel('legacy-ch')).toEqual(expect.objectContaining({
      id: 'legacy-ch', category_id: 'legacy-cat', org_id: 'org-a', team_id: 'team-a', unread_count: 4,
    }));
    expect(repo.getMessage('legacy-msg')).toEqual(expect.objectContaining({ channel_id: 'legacy-ch', content: 'preserved' }));
    expect(repo.getThread('legacy-thread')).toEqual(expect.objectContaining({ channel_id: 'legacy-ch', parent_message_id: 'legacy-msg' }));

    expect(db.prepare('SELECT workspace_id, metadata FROM chat_categories WHERE id = ?').get('legacy-cat')).toEqual({
      workspace_id: 'workspace-a', metadata: '{"kind":"category"}',
    });
    expect(db.prepare('SELECT workspace_id, metadata FROM chat_channels WHERE id = ?').get('legacy-ch')).toEqual({
      workspace_id: 'workspace-a', metadata: '{"kind":"channel"}',
    });
    const categorySql = String((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_categories'").get() as { sql: string }).sql);
    const channelSql = String((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_channels'").get() as { sql: string }).sql);
    expect(categorySql).toContain("DEFAULT 'workspace-default'");
    expect(categorySql).toContain('CHECK(json_valid(metadata))');
    expect(categorySql).toContain('UNIQUE(workspace_id, id)');
    expect(channelSql).toContain("DEFAULT 'workspace-default'");
    expect(channelSql).toContain('CHECK(json_valid(metadata))');

    for (const name of [
      'idx_chat_categories_workspace_metadata',
      'idx_chat_channels_workspace_metadata',
      'idx_chat_channels_custom_order',
      'trg_chat_channels_metadata_audit',
    ]) {
      expect(db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(name)).toBeTruthy();
    }
    db.prepare('UPDATE chat_channels SET metadata = ? WHERE id = ?').run('{"kind":"updated"}', 'legacy-ch');
    expect(db.prepare('SELECT * FROM chat_channel_audit').all()).toEqual([{
      channel_id: 'legacy-ch', workspace_id: 'workspace-a', metadata: '{"kind":"updated"}',
    }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects foreign and missing categories identically at the DB write boundary', () => {
    const repo = createChatRepository();
    repo.createCategory({ id: 'cat-foreign-boundary', name: 'Foreign boundary', org_id: 'org-b', team_id: 'team-b' });

    const createError = (category_id: string): string => {
      try {
        repo.createChannel({ name: `boundary-${category_id}`, category_id, org_id: 'org-a', team_id: 'team-a' });
        return 'created';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    expect(createError('cat-foreign-boundary')).toBe(createError('cat-does-not-exist'));
    expect(repo.getChannelByName('boundary-cat-foreign-boundary')).toBeUndefined();
    expect(repo.getChannelByName('boundary-cat-does-not-exist')).toBeUndefined();

    expect(repo.updateChannel('legacy-ch', { category_id: 'cat-foreign-boundary' })).toBeUndefined();
    expect(repo.updateChannel('legacy-ch', { category_id: 'cat-does-not-exist' })).toBeUndefined();
    expect(repo.getChannel('legacy-ch')?.category_id).toBe('legacy-cat');
  });

  it('replaces global names with case-insensitive org/team scoped uniqueness including NULL teams', () => {
    const repo = createChatRepository();

    expect(repo.createCategory({ id: 'cat-b', name: 'Shared', org_id: 'org-b', team_id: 'team-b' }).id).toBe('cat-b');
    expect(repo.createCategory({ id: 'cat-a-other-team', name: 'Shared', org_id: 'org-a', team_id: 'team-other' }).id).toBe('cat-a-other-team');
    expect(() => repo.createCategory({ name: 'shared', org_id: 'org-a', team_id: 'team-a' })).toThrow();

    const orgWideA = repo.createCategory({ id: 'cat-orgwide-a', name: 'Orgwide', org_id: 'org-a' });
    repo.createCategory({ id: 'cat-orgwide-b', name: 'Orgwide', org_id: 'org-b' });
    expect(() => repo.createCategory({ name: 'ORGWIDE', org_id: 'org-a' })).toThrow();

    expect(repo.createChannel({ id: 'ch-b', name: 'general', category_id: 'cat-b', org_id: 'org-b', team_id: 'team-b' }).id).toBe('ch-b');
    expect(() => repo.createChannel({ name: 'GENERAL', category_id: 'legacy-cat', org_id: 'org-a', team_id: 'team-a' })).toThrow();
    repo.createChannel({ id: 'orgwide-a', name: 'announcements', category_id: orgWideA.id, org_id: 'org-a' });
    expect(() => repo.createChannel({ name: 'ANNOUNCEMENTS', category_id: orgWideA.id, org_id: 'org-a' })).toThrow();
  });

  it('initializes a second time without changing migrated schema or data', () => {
    const db = getEntityDatabase();
    const before = db.prepare(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE tbl_name IN ('chat_categories', 'chat_channels') OR name = 'trg_chat_channels_metadata_audit'
      ORDER BY type, name
    `).all();

    expect(() => createChatRepository()).not.toThrow();

    const after = db.prepare(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE tbl_name IN ('chat_categories', 'chat_channels') OR name = 'trg_chat_channels_metadata_audit'
      ORDER BY type, name
    `).all();
    expect(after).toEqual(before);
    expect(db.prepare('SELECT workspace_id, metadata FROM chat_channels WHERE id = ?').get('legacy-ch')).toEqual({
      workspace_id: 'workspace-a', metadata: '{"kind":"updated"}',
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('fails repeatably before mutating a legacy global-UNIQUE schema with same-scope case variants', () => {
    const legacy = new Database(duplicateDbPath);
    legacy.pragma('foreign_keys = ON');
    legacy.exec(`
      CREATE TABLE chat_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        emoji TEXT,
        "order" INTEGER NOT NULL DEFAULT 0,
        org_id TEXT,
        team_id TEXT,
        workspace_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE chat_channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        category_id TEXT NOT NULL REFERENCES chat_categories(id) ON DELETE CASCADE,
        "order" INTEGER NOT NULL DEFAULT 0,
        agents TEXT NOT NULL DEFAULT '[]',
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_message_at TEXT,
        linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
        org_id TEXT,
        team_id TEXT,
        workspace_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
        thread_id TEXT,
        sender TEXT NOT NULL,
        sender_emoji TEXT,
        content TEXT NOT NULL,
        model TEXT,
        is_local INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'sent',
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reply_to TEXT,
        org_id TEXT,
        team_id TEXT
      );
      CREATE TABLE chat_threads (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
        parent_message_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        linked_object_refs_json TEXT NOT NULL DEFAULT '[]',
        org_id TEXT,
        team_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_chat_categories_workspace_legacy ON chat_categories(workspace_id);
      CREATE INDEX idx_chat_channels_workspace_legacy ON chat_channels(workspace_id);
      INSERT INTO chat_categories (id, name, org_id, team_id, workspace_id)
        VALUES ('cat-upper', 'Foo', 'org-a', 'team-a', 'workspace-a'),
               ('cat-lower', 'foo', 'org-a', 'team-a', 'workspace-a');
      INSERT INTO chat_channels (id, name, category_id, org_id, team_id, workspace_id)
        VALUES ('channel-legacy', 'General', 'cat-upper', 'org-a', 'team-a', 'workspace-a');
      INSERT INTO chat_messages (id, channel_id, sender, content, org_id, team_id)
        VALUES ('message-legacy', 'channel-legacy', 'user', 'unchanged', 'org-a', 'team-a');
      INSERT INTO chat_threads (id, channel_id, parent_message_id, title, org_id, team_id)
        VALUES ('thread-legacy', 'channel-legacy', 'message-legacy', 'Unchanged', 'org-a', 'team-a');
    `);
    const beforeSchema = legacy.prepare(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all();
    const beforeRows = {
      categories: legacy.prepare('SELECT * FROM chat_categories ORDER BY id').all(),
      channels: legacy.prepare('SELECT * FROM chat_channels ORDER BY id').all(),
      messages: legacy.prepare('SELECT * FROM chat_messages ORDER BY id').all(),
      threads: legacy.prepare('SELECT * FROM chat_threads ORDER BY id').all(),
    };
    legacy.close();
    process.env.ENTITY_TASK_DB_PATH = duplicateDbPath;

    const expectedError = 'chat tenant-name migration blocked by duplicate: chat_categories org_id=org-a team_id=team-a name=foo';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => createChatRepository()).toThrow(expectedError);
      const db = getEntityDatabase();
      expect(db.prepare(`
        SELECT type, name, tbl_name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
      `).all()).toEqual(beforeSchema);
      expect({
        categories: db.prepare('SELECT * FROM chat_categories ORDER BY id').all(),
        channels: db.prepare('SELECT * FROM chat_channels ORDER BY id').all(),
        messages: db.prepare('SELECT * FROM chat_messages ORDER BY id').all(),
        threads: db.prepare('SELECT * FROM chat_threads ORDER BY id').all(),
      }).toEqual(beforeRows);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    }
    process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  });

  it('replaces reserved tenant index names even when they already point at the wrong columns', () => {
    const legacy = new Database(wrongIndexesDbPath);
    legacy.exec(`
      CREATE TABLE chat_categories (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT, "order" INTEGER NOT NULL DEFAULT 0,
        org_id TEXT, team_id TEXT, workspace_id TEXT NOT NULL DEFAULT 'workspace-default', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE chat_channels (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
        category_id TEXT NOT NULL REFERENCES chat_categories(id) ON DELETE CASCADE,
        "order" INTEGER NOT NULL DEFAULT 0, agents TEXT NOT NULL DEFAULT '[]',
        unread_count INTEGER NOT NULL DEFAULT 0, last_message_at TEXT,
        linked_object_refs_json TEXT NOT NULL DEFAULT '[]', org_id TEXT, team_id TEXT,
        workspace_id TEXT NOT NULL DEFAULT 'workspace-default', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX idx_chat_categories_tenant_name_team ON chat_categories(workspace_id);
      CREATE UNIQUE INDEX idx_chat_categories_tenant_name_orgwide ON chat_categories(workspace_id, id);
      CREATE UNIQUE INDEX idx_chat_channels_tenant_name_team ON chat_channels(workspace_id);
      CREATE UNIQUE INDEX idx_chat_channels_tenant_name_orgwide ON chat_channels(workspace_id, id);
    `);
    legacy.close();
    process.env.ENTITY_TASK_DB_PATH = wrongIndexesDbPath;

    const repo = createChatRepository();
    const db = getEntityDatabase();
    const indexSql = Object.fromEntries((db.prepare(`
      SELECT name, lower(replace(replace(sql, char(10), ' '), '  ', ' ')) AS sql
      FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_chat_%_tenant_name_%'
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>).map((row) => [row.name, row.sql]));
    expect(indexSql).toEqual({
      idx_chat_categories_tenant_name_orgwide: expect.stringContaining('on chat_categories(org_id, name collate nocase)'),
      idx_chat_categories_tenant_name_team: expect.stringContaining('on chat_categories(org_id, team_id, name collate nocase)'),
      idx_chat_channels_tenant_name_orgwide: expect.stringContaining('on chat_channels(org_id, name collate nocase)'),
      idx_chat_channels_tenant_name_team: expect.stringContaining('on chat_channels(org_id, team_id, name collate nocase)'),
    });
    expect(Object.values(indexSql).every((sql) => sql.includes(' where org_id is not null and '))).toBe(true);

    repo.createCategory({ id: 'cat-a', name: 'Foo', org_id: 'org-a', team_id: 'team-a' });
    expect(() => repo.createCategory({ name: 'foo', org_id: 'org-a', team_id: 'team-a' })).toThrow();
    expect(() => repo.createCategory({ id: 'cat-b', name: 'foo', org_id: 'org-b', team_id: 'team-b' })).not.toThrow();
    repo.createChannel({ id: 'channel-a', name: 'General', category_id: 'cat-a', org_id: 'org-a', team_id: 'team-a' });
    expect(() => repo.createChannel({ name: 'general', category_id: 'cat-a', org_id: 'org-a', team_id: 'team-a' })).toThrow();
    expect(() => repo.createChannel({ name: 'general', category_id: 'cat-b', org_id: 'org-b', team_id: 'team-b' })).not.toThrow();
    process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  });
});
