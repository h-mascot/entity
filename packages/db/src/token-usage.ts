import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const TOKEN_SOURCES = ['openclaw', 'codex', 'claude-code', 'hermes'] as const;
export type TokenSource = (typeof TOKEN_SOURCES)[number];

export interface TokenUsageRecord {
  id: number;
  source: TokenSource;
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  session_id: string | null;
  project: string | null;
  recorded_at: string;
  source_date: string;
}

export interface UpsertTokenUsageInput {
  source: TokenSource;
  model?: string;
  provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
  session_id?: string;
  project?: string;
  source_date: string;
}

export interface TokenUsageSummary {
  total_tokens: number;
  total_cost: number;
  by_source: Array<{ source: TokenSource; tokens: number; cost: number }>;
  by_model: Array<{ model: string; tokens: number; cost: number }>;
  by_day: Array<{ date: string; tokens: number; cost: number }>;
}

export interface TokenUsageDaily {
  date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  source: TokenSource;
}

export interface TokenSourceInfo {
  source: TokenSource;
  last_sync: string | null;
  total_tokens: number;
  sessions: number;
}

interface TokenUsageRepository {
  upsertUsage: (input: UpsertTokenUsageInput) => TokenUsageRecord;
  listUsage: (filters?: { source?: TokenSource; from?: string; to?: string; limit?: number }) => TokenUsageRecord[];
  getSummary: (from?: string, to?: string) => TokenUsageSummary;
  getDailyBreakdown: (from: string, to: string) => TokenUsageDaily[];
  getSources: () => TokenSourceInfo[];
  deleteOldRecords: (beforeDate: string) => number;
}

function ensureTokenUsageSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      session_id TEXT,
      project TEXT,
      recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source_date TEXT NOT NULL,
      UNIQUE(source, session_id, source_date)
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_source ON token_usage(source);
    CREATE INDEX IF NOT EXISTS idx_token_usage_source_date ON token_usage(source_date);
    CREATE INDEX IF NOT EXISTS idx_token_usage_recorded_at ON token_usage(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);
  `);
}

function normalizeTokenSource(value: unknown): TokenSource {
  if (typeof value !== 'string') {
    return 'openclaw';
  }

  const normalized = value.trim().toLowerCase();
  if (TOKEN_SOURCES.includes(normalized as TokenSource)) {
    return normalized as TokenSource;
  }

  return 'openclaw';
}

function normalizeTimestamp(value: string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeNumber(value: unknown, defaultValue = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : defaultValue;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  return defaultValue;
}

function mapTokenUsageRow(row: Record<string, unknown>): TokenUsageRecord {
  return {
    id: Number(row.id),
    source: normalizeTokenSource(row.source),
    model: normalizeNullableString(row.model),
    provider: normalizeNullableString(row.provider),
    input_tokens: normalizeNumber(row.input_tokens),
    output_tokens: normalizeNumber(row.output_tokens),
    total_tokens: normalizeNumber(row.total_tokens),
    cost_usd: normalizeNumber(row.cost_usd),
    session_id: normalizeNullableString(row.session_id),
    project: normalizeNullableString(row.project),
    recorded_at: normalizeTimestamp(String(row.recorded_at)),
    source_date: String(row.source_date),
  };
}

export function createTokenUsageRepository(): TokenUsageRepository {
  const db = getEntityDatabase(ensureTokenUsageSchema);

  const upsertStmt = db.prepare(`
    INSERT INTO token_usage (
      source, model, provider, input_tokens, output_tokens, total_tokens,
      cost_usd, session_id, project, recorded_at, source_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(source, session_id, source_date) DO UPDATE SET
      model = excluded.model,
      provider = excluded.provider,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      total_tokens = excluded.total_tokens,
      cost_usd = excluded.cost_usd,
      project = excluded.project,
      recorded_at = CURRENT_TIMESTAMP
  `);

  const listStmt = db.prepare('SELECT * FROM token_usage ORDER BY source_date DESC, recorded_at DESC LIMIT ?');
  const listFilteredStmt = db.prepare(`
    SELECT * FROM token_usage
    WHERE source = ? AND source_date >= ? AND source_date <= ?
    ORDER BY source_date DESC, recorded_at DESC
    LIMIT ?
  `);

  const summaryStmt = db.prepare(`
    SELECT
      SUM(total_tokens) as total_tokens,
      SUM(cost_usd) as total_cost
    FROM token_usage
    WHERE source_date >= ? AND source_date <= ?
  `);

  const bySourceStmt = db.prepare(`
    SELECT
      source,
      SUM(total_tokens) as tokens,
      SUM(cost_usd) as cost
    FROM token_usage
    WHERE source_date >= ? AND source_date <= ?
    GROUP BY source
  `);

  const byModelStmt = db.prepare(`
    SELECT
      COALESCE(model, 'unknown') as model,
      SUM(total_tokens) as tokens,
      SUM(cost_usd) as cost
    FROM token_usage
    WHERE source_date >= ? AND source_date <= ?
    GROUP BY model
    ORDER BY tokens DESC
  `);

  const byDayStmt = db.prepare(`
    SELECT
      source_date as date,
      SUM(total_tokens) as tokens,
      SUM(cost_usd) as cost
    FROM token_usage
    WHERE source_date >= ? AND source_date <= ?
    GROUP BY source_date
    ORDER BY date DESC
  `);

  const dailyBreakdownStmt = db.prepare(`
    SELECT
      source_date,
      source,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(cost_usd) as cost
    FROM token_usage
    WHERE source_date >= ? AND source_date <= ?
    GROUP BY source_date, source
    ORDER BY source_date DESC, source
  `);

  const sourcesStmt = db.prepare(`
    SELECT
      source,
      MAX(recorded_at) as last_sync,
      SUM(total_tokens) as total_tokens,
      COUNT(DISTINCT session_id) as sessions
    FROM token_usage
    GROUP BY source
  `);

  const deleteOldStmt = db.prepare('DELETE FROM token_usage WHERE source_date < ?');

  return {
    upsertUsage: (input: UpsertTokenUsageInput) => {
      const source = normalizeTokenSource(input.source);
      const model = normalizeNullableString(input.model);
      const provider = normalizeNullableString(input.provider);
      const inputTokens = normalizeNumber(input.input_tokens);
      const outputTokens = normalizeNumber(input.output_tokens);
      const totalTokens = normalizeNumber(input.total_tokens, inputTokens + outputTokens);
      const costUsd = normalizeNumber(input.cost_usd);
      const sessionId = normalizeNullableString(input.session_id);
      const project = normalizeNullableString(input.project);
      const sourceDate = input.source_date;

      upsertStmt.run(
        source,
        model,
        provider,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
        sessionId,
        project,
        sourceDate
      );

      const row = db
        .prepare('SELECT * FROM token_usage WHERE source = ? AND session_id = ? AND source_date = ?')
        .get(source, sessionId ?? '', sourceDate) as Record<string, unknown> | undefined;

      if (!row) {
        throw new Error('Failed to upsert token usage');
      }

      return mapTokenUsageRow(row);
    },

    listUsage: (filters = {}) => {
      const { source, from, to, limit = 500 } = filters;

      if (source && from && to) {
        const rows = listFilteredStmt.all(source, from, to, limit) as Array<Record<string, unknown>>;
        return rows.map(mapTokenUsageRow);
      }

      const rows = listStmt.all(limit) as Array<Record<string, unknown>>;
      return rows.map(mapTokenUsageRow);
    },

    getSummary: (from, to) => {
      const today = new Date();
      const defaultFrom = new Date(today);
      defaultFrom.setDate(defaultFrom.getDate() - 30);

      const fromDate = from || defaultFrom.toISOString().split('T')[0];
      const toDate = to || today.toISOString().split('T')[0];

      const summaryRow = summaryStmt.get(fromDate, toDate) as { total_tokens?: number; total_cost?: number } | undefined;
      const sourceRows = bySourceStmt.all(fromDate, toDate) as Array<Record<string, unknown>>;
      const modelRows = byModelStmt.all(fromDate, toDate) as Array<Record<string, unknown>>;
      const dayRows = byDayStmt.all(fromDate, toDate) as Array<Record<string, unknown>>;

      return {
        total_tokens: normalizeNumber(summaryRow?.total_tokens),
        total_cost: normalizeNumber(summaryRow?.total_cost),
        by_source: sourceRows.map((r) => ({
          source: normalizeTokenSource(r.source),
          tokens: normalizeNumber(r.tokens),
          cost: normalizeNumber(r.cost),
        })),
        by_model: modelRows.map((r) => ({
          model: String(r.model),
          tokens: normalizeNumber(r.tokens),
          cost: normalizeNumber(r.cost),
        })),
        by_day: dayRows.map((r) => ({
          date: String(r.date),
          tokens: normalizeNumber(r.tokens),
          cost: normalizeNumber(r.cost),
        })),
      };
    },

    getDailyBreakdown: (from, to) => {
      const rows = dailyBreakdownStmt.all(from, to) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        date: String(r.source_date),
        source: normalizeTokenSource(r.source),
        input_tokens: normalizeNumber(r.input_tokens),
        output_tokens: normalizeNumber(r.output_tokens),
        total_tokens: normalizeNumber(r.total_tokens),
        cost: normalizeNumber(r.cost),
      }));
    },

    getSources: () => {
      const rows = sourcesStmt.all() as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        source: normalizeTokenSource(r.source),
        last_sync: normalizeNullableString(r.last_sync),
        total_tokens: normalizeNumber(r.total_tokens),
        sessions: normalizeNumber(r.sessions),
      }));
    },

    deleteOldRecords: (beforeDate) => {
      const result = deleteOldStmt.run(beforeDate);
      return result.changes;
    },
  };
}

export function resolveOpenClawLcmPath(): string {
  const custom = process.env.OPENCLAW_LCM_DB_PATH;
  if (custom) {
    return path.resolve(custom);
  }

  return path.join(os.homedir(), '.openclaw', 'lcm.db');
}

export function resolveCodexLogsPath(): string {
  const custom = process.env.CODEX_LOGS_DB_PATH;
  if (custom) {
    return path.resolve(custom);
  }

  return path.join(os.homedir(), '.codex', 'logs_2.sqlite');
}

export function resolveClaudeCodeProjectsPath(): string {
  const custom = process.env.CLAUDE_CODE_PROJECTS_PATH;
  if (custom) {
    return path.resolve(custom);
  }

  return path.join(os.homedir(), '.claude', 'projects');
}
