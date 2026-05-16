import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import {
  createTokenUsageRepository,
  resolveOpenClawLcmPath,
  resolveCodexLogsPath,
  resolveClaudeCodeProjectsPath,
  type TokenSource,
} from '../../../db/src/token-usage';

interface CollectionResult {
  source: TokenSource;
  collected: number;
  sessions: number;
  error?: string;
}

interface CollectorRunResult {
  collected: number;
  sources: CollectionResult[];
  duration_ms: number;
}

function collectOpenClawLcm(): CollectionResult {
  const lcmPath = resolveOpenClawLcmPath();

  if (!fs.existsSync(lcmPath)) {
    return {
      source: 'openclaw',
      collected: 0,
      sessions: 0,
      error: 'LCM database not found',
    };
  }

  const repo = createTokenUsageRepository();
  let collected = 0;
  let sessions = 0;

  try {
    const lcmDb = new Database(lcmPath, { readonly: true });

    try {
      const messagesStmt = lcmDb.prepare(`
        SELECT
          conversation_id,
          token_count,
          role,
          created_at
        FROM messages
        WHERE token_count IS NOT NULL AND token_count > 0
        ORDER BY created_at DESC
        LIMIT 5000
      `);

      const conversationsStmt = lcmDb.prepare(`
        SELECT conversation_id, session_key
        FROM conversations
      `);

      const conversations = new Map<string, string>();
      for (const row of conversationsStmt.all() as Array<{ conversation_id: string; session_key: string }>) {
        conversations.set(row.conversation_id, row.session_key);
      }

      const byDateAndSession = new Map<string, { input_tokens: number; output_tokens: number; total_tokens: number }>();

      for (const row of messagesStmt.all() as Array<{
        conversation_id: string;
        token_count: number;
        role: string;
        created_at: string;
      }>) {
        const sessionId = conversations.get(row.conversation_id) || row.conversation_id;
        const date = new Date(row.created_at).toISOString().split('T')[0];
        const key = `${sessionId}:${date}`;

        const current = byDateAndSession.get(key) || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

        if (row.role === 'user') {
          current.input_tokens += row.token_count;
        } else if (row.role === 'assistant' || row.role === 'system') {
          current.output_tokens += row.token_count;
        }
        current.total_tokens += row.token_count;

        byDateAndSession.set(key, current);
      }

      for (const [key, data] of byDateAndSession) {
        const [sessionId, sourceDate] = key.split(':');
        repo.upsertUsage({
          source: 'openclaw',
          model: 'gpt-4.1',
          provider: 'openai-codex',
          input_tokens: data.input_tokens,
          output_tokens: data.output_tokens,
          total_tokens: data.total_tokens,
          source_date: sourceDate,
          session_id: sessionId,
        });
        collected++;
      }

      sessions = byDateAndSession.size;
    } finally {
      lcmDb.close();
    }
  } catch (error) {
    return {
      source: 'openclaw',
      collected: 0,
      sessions: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return { source: 'openclaw', collected, sessions };
}

function collectCodexLogs(): CollectionResult {
  const logsPath = resolveCodexLogsPath();

  if (!fs.existsSync(logsPath)) {
    return {
      source: 'codex',
      collected: 0,
      sessions: 0,
      error: 'Codex logs database not found',
    };
  }

  const repo = createTokenUsageRepository();
  let collected = 0;
  let sessions = 0;

  try {
    const codexDb = new Database(logsPath, { readonly: true });

    try {
      const tables = codexDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;

      if (!tables.some((t) => t.name === 'sessions' || t.name === 'logs')) {
        codexDb.close();
        return {
          source: 'codex',
          collected: 0,
          sessions: 0,
          error: 'Codex logs schema not recognized',
        };
      }

      const hasSessionsTable = tables.some((t) => t.name === 'sessions');

      if (hasSessionsTable) {
        const sessionsStmt = codexDb.prepare(`
          SELECT
            id,
            model,
            tokens_used as tokens,
            created_at
          FROM sessions
          WHERE tokens_used IS NOT NULL AND tokens_used > 0
          ORDER BY created_at DESC
          LIMIT 1000
        `);

        for (const row of sessionsStmt.all() as Array<{
          id: string;
          model: string;
          tokens: number;
          created_at: string;
        }>) {
          const sourceDate = new Date(row.created_at).toISOString().split('T')[0];

          repo.upsertUsage({
            source: 'codex',
            model: row.model || 'claude-opus-4',
            provider: 'anthropic',
            total_tokens: row.tokens,
            input_tokens: Math.floor(row.tokens * 0.4),
            output_tokens: Math.ceil(row.tokens * 0.6),
            source_date: sourceDate,
            session_id: row.id,
          });
          collected++;
        }

        sessions = collected;
      }
    } finally {
      codexDb.close();
    }
  } catch (error) {
    return {
      source: 'codex',
      collected: 0,
      sessions: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return { source: 'codex', collected, sessions };
}

function collectClaudeCodeSessions(): CollectionResult {
  const projectsPath = resolveClaudeCodeProjectsPath();

  if (!fs.existsSync(projectsPath)) {
    return {
      source: 'claude-code',
      collected: 0,
      sessions: 0,
      error: 'Claude Code projects directory not found',
    };
  }

  const repo = createTokenUsageRepository();
  let collected = 0;
  let sessions = 0;

  try {
    const projectDirs = fs.readdirSync(projectsPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(projectsPath, d.name));

    for (const projectDir of projectDirs) {
      const jsonlFiles = fs.readdirSync(projectDir)
        .filter((f) => f.endsWith('.jsonl'));

      for (const jsonlFile of jsonlFiles) {
        const filePath = path.join(projectDir, jsonlFile);

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n').filter((l) => l.trim());

          let totalTokens = 0;
          let model = 'claude-opus-4';
          let createdAt = new Date().toISOString();

          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.tokens) {
                totalTokens += entry.tokens || 0;
              }
              if (entry.model) {
                model = entry.model;
              }
              if (entry.timestamp || entry.created_at) {
                createdAt = entry.timestamp || entry.created_at;
              }
            } catch {
              continue;
            }
          }

          if (totalTokens > 0) {
            const sourceDate = new Date(createdAt).toISOString().split('T')[0];
            const sessionId = path.basename(jsonlFile, '.jsonl');

            repo.upsertUsage({
              source: 'claude-code',
              model,
              provider: 'anthropic',
              total_tokens: totalTokens,
              input_tokens: Math.floor(totalTokens * 0.4),
              output_tokens: Math.ceil(totalTokens * 0.6),
              source_date: sourceDate,
              session_id: sessionId,
              project: path.basename(projectDir),
            });
            collected++;
            sessions++;
          }
        } catch {
          continue;
        }
      }
    }
  } catch (error) {
    return {
      source: 'claude-code',
      collected: 0,
      sessions: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return { source: 'claude-code', collected, sessions };
}

export function collectAllSources(): CollectorRunResult {
  const startTime = Date.now();

  const sources: CollectionResult[] = [
    collectOpenClawLcm(),
    collectCodexLogs(),
    collectClaudeCodeSessions(),
  ];

  const duration = Date.now() - startTime;
  const collected = sources.reduce((sum, s) => sum + s.collected, 0);

  return {
    collected,
    sources,
    duration_ms: duration,
  };
}

export function startCollectionScheduler(intervalMs: number = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    collectAllSources();
  }, intervalMs);
}
