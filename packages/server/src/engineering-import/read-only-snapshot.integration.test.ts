import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { readCurrentEntitySnapshot } from './read-only-snapshot';

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-b-05-snapshot-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'entity.sqlite');
}

function fileIdentity(filePath: string) {
  const stat = fs.statSync(filePath, { bigint: true });
  return {
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    sha256: createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function databaseIdentity(databasePath: string) {
  return {
    database: fileIdentity(databasePath),
    wal: fileIdentity(`${databasePath}-wal`),
    shm: fileIdentity(`${databasePath}-shm`),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('read-only Entity snapshot SQLite integration', () => {
  it('sees uncheckpointed WAL state, rejects writes, and preserves all database files', () => {
    const databasePath = temporaryDatabasePath();
    const writer = new Database(databasePath);
    try {
      writer.pragma('journal_mode = WAL');
      writer.pragma('wal_autocheckpoint = 0');
      writer.exec(`
        CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE task_projects (task_id INTEGER NOT NULL, project_id INTEGER NOT NULL);
        INSERT INTO projects (id, name) VALUES (7, 'Entity Engineering');
        INSERT INTO tasks (id, name) VALUES (44, 'WAL-visible task');
        INSERT INTO task_projects (task_id, project_id) VALUES (44, 7);
      `);

      expect(fs.statSync(`${databasePath}-wal`).size).toBeGreaterThan(0);
      expect(readCurrentEntitySnapshot(databasePath).tasks.map((task) => task.id)).toEqual([44]);
      const before = databaseIdentity(databasePath);

      const readonly = new Database(databasePath, { readonly: true, fileMustExist: true });
      try {
        readonly.pragma('query_only = ON');
        expect(() =>
          readonly.prepare("INSERT INTO tasks (name) VALUES ('forbidden')").run(),
        ).toThrow();
      } finally {
        readonly.close();
      }

      expect(readCurrentEntitySnapshot(databasePath).tasks.map((task) => task.id)).toEqual([44]);
      expect(databaseIdentity(databasePath)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it('rejects malformed ledger rows instead of silently enabling create', () => {
    const databasePath = temporaryDatabasePath();
    const writer = new Database(databasePath);
    writer.exec(`
      CREATE TABLE task_import_keys (
        project_id INTEGER,
        source_system TEXT,
        source_key TEXT,
        task_id INTEGER,
        source_fingerprint TEXT,
        source_snapshot_sha256 TEXT
      );
      CREATE UNIQUE INDEX task_import_project_source
        ON task_import_keys(project_id, source_system, source_key);
      CREATE UNIQUE INDEX task_import_task ON task_import_keys(task_id);
      INSERT INTO task_import_keys (
        project_id, source_system, source_key, task_id, source_fingerprint,
        source_snapshot_sha256
      ) VALUES (7, 'entity-todo', NULL, 44, 'fingerprint', 'snapshot');
    `);
    writer.close();

    expect(() => readCurrentEntitySnapshot(databasePath)).toThrow(
      'task_import_keys contains a malformed entity-todo row',
    );
  });

  it('does not accept partial unique indexes as full ledger constraints', () => {
    const databasePath = temporaryDatabasePath();
    const writer = new Database(databasePath);
    writer.exec(`
      CREATE TABLE task_import_keys (
        project_id INTEGER,
        source_system TEXT,
        source_key TEXT,
        task_id INTEGER,
        source_fingerprint TEXT,
        source_snapshot_sha256 TEXT
      );
      CREATE UNIQUE INDEX task_import_project_source_partial
        ON task_import_keys(project_id, source_system, source_key)
        WHERE source_system = 'entity-todo';
      CREATE UNIQUE INDEX task_import_task_partial
        ON task_import_keys(task_id) WHERE task_id > 0;
    `);
    writer.close();

    const snapshot = readCurrentEntitySnapshot(databasePath);
    expect(snapshot.schema.ledgerUniqueProjectSourceKey).toBe(false);
    expect(snapshot.schema.ledgerUniqueTaskId).toBe(false);
  });

  it('rejects malformed task import metadata instead of hiding a stable key', () => {
    const databasePath = temporaryDatabasePath();
    const writer = new Database(databasePath);
    writer.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        metadata TEXT
      );
      INSERT INTO tasks (id, name, metadata) VALUES (
        44,
        'Existing imported task',
        '{"engineering_import":{"source_system":"entity-todo","source_key":"candidate-key"}}'
      );
    `);
    writer.close();

    expect(() => readCurrentEntitySnapshot(databasePath)).toThrow(
      'tasks contains malformed engineering_import metadata',
    );
  });
});
