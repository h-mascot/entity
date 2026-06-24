import type { Request, Response } from 'express';
import { Router } from 'express';
import { execFile } from 'child_process';
import { permissionSafeRecord, requireRequestOrg } from '../request-permissions';

type SearchMode = 'keyword' | 'semantic' | 'hybrid';
type SearchCollection = 'all' | 'obsidian' | 'superada' | 'sessions' | 'scotty' | 'spock' | 'memory';

interface QmdJsonResult {
  docid?: unknown;
  score?: unknown;
  file?: unknown;
  title?: unknown;
  snippet?: unknown;
  body?: unknown;
  org_id?: unknown;
  sensitivity?: unknown;
  acl_json?: unknown;
  entity_visibility_policy_json?: unknown;
}

interface QmdCollectionListEntry {
  name: string;
  files: number;
  pattern: string;
  updated: string;
}

interface LineRange {
  from: number;
  to: number;
}

const SEARCH_MODES: ReadonlySet<SearchMode> = new Set(['keyword', 'semantic', 'hybrid']);
const SEARCH_COLLECTIONS: ReadonlySet<SearchCollection> = new Set([
  'all',
  'obsidian',
  'superada',
  'sessions',
  'scotty',
  'spock',
  'memory',
]);

function normalizeMode(value: unknown): SearchMode | null {
  if (typeof value === 'undefined') {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (SEARCH_MODES.has(normalized as SearchMode)) {
    return normalized as SearchMode;
  }

  return null;
}

function normalizeCollection(value: unknown): SearchCollection | null {
  if (typeof value === 'undefined') {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (SEARCH_COLLECTIONS.has(normalized as SearchCollection)) {
    return normalized as SearchCollection;
  }

  return null;
}

function normalizeLimit(value: unknown, fallback = 20): number | null {
  if (typeof value === 'undefined') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return Math.min(parsed, 100);
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'undefined') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return null;
}

function shEscape(value: string): string {
  // POSIX-safe single-quote escaping: 'foo'"'"'bar'
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function stripAnsi(input: string): string {
  // Strip common ANSI escape sequences that may sneak into CLI output.
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function extractJsonPayload(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('qmd returned empty output');
  }

  const first = trimmed.search(/[\[{]/);
  if (first === -1) {
    throw new Error('qmd returned non-JSON output');
  }

  const lastArray = trimmed.lastIndexOf(']');
  const lastObject = trimmed.lastIndexOf('}');
  const last = Math.max(lastArray, lastObject);
  if (last < first) {
    throw new Error('qmd returned incomplete JSON output');
  }

  return trimmed.slice(first, last + 1);
}

function parseQmdFileUri(file: string): { collection: string | null; path: string; id: string } {
  const trimmed = file.trim();
  if (!trimmed) {
    return { collection: null, path: '', id: '' };
  }

  if (!trimmed.startsWith('qmd://')) {
    const basename = trimmed.split('/').filter(Boolean).pop() ?? trimmed;
    return { collection: null, path: trimmed, id: basename };
  }

  const withoutScheme = trimmed.slice('qmd://'.length);
  const [collectionRaw, ...rest] = withoutScheme.split('/');
  const collection = (collectionRaw || '').trim();
  const path = rest.join('/');
  const id = collection ? `${collection}/${path}` : path;
  return { collection: collection || null, path, id };
}

function normalizeQmdBin(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) {
    return 'qmd';
  }

  // Keep this intentionally strict because the value is interpolated into a shell command.
  // Allow common patterns like `qmd`, `~/.local/bin/qmd`, or `$HOME/.local/bin/qmd`.
  if (!/^[a-zA-Z0-9_./~$-]+$/.test(value)) {
    return 'qmd';
  }

  return value;
}

function getQmdExecConfig(): { sshTarget: string | null; qmdBin: string; timeoutMs: number; maxBufferBytes: number } {
  const sshTargetEnv = process.env.ENTITY_QMD_SSH_TARGET;
  // Default to the current qmd host (per UNIVERSAL-SEARCH-PRD.md); allow explicitly setting empty string to disable SSH.
  const sshTarget = typeof sshTargetEnv === 'string' ? sshTargetEnv.trim() : null;

  // Default to the installed path on the qmd host; keep env override for portability.
  const qmdBin = normalizeQmdBin(process.env.ENTITY_QMD_BIN ?? '~/.local/bin/qmd');

  const timeoutMs = Math.max(1_000, Number(process.env.ENTITY_QMD_TIMEOUT_MS ?? 15_000));
  const maxBufferBytes = Math.max(1_000_000, Number(process.env.ENTITY_QMD_MAX_BUFFER ?? 25 * 1024 * 1024));

  return { sshTarget, qmdBin, timeoutMs, maxBufferBytes };
}

function buildQmdCommand(args: {
  query: string;
  mode: SearchMode;
  collection: SearchCollection;
  limit: number;
  full: boolean;
  qmdBin: string;
}): string {
  const subcommand = args.mode === 'semantic' ? 'vsearch' : args.mode === 'hybrid' ? 'query' : 'search';
  const parts: string[] = ['CI=1', 'TERM=dumb', 'NO_COLOR=1', args.qmdBin, subcommand, shEscape(args.query), '--json', '-n', String(args.limit)];

  if (args.collection !== 'all') {
    parts.push('-c', args.collection);
  }

  if (args.full) {
    parts.push('--full');
  }

  return parts.join(' ');
}

function buildQmdCollectionListCommand(qmdBin: string): string {
  return ['CI=1', 'TERM=dumb', 'NO_COLOR=1', qmdBin, 'collection', 'list'].join(' ');
}

function buildQmdGetCommand(args: { qmdBin: string; id: string; lines: LineRange | null }): string {
  const parts: string[] = ['CI=1', 'TERM=dumb', 'NO_COLOR=1', args.qmdBin, 'get', shEscape(args.id)];

  if (args.lines) {
    const limit = args.lines.to - args.lines.from + 1;
    parts.push('-l', String(limit), '--from', String(args.lines.from));
  }

  return parts.join(' ');
}

function parseFilesCount(token: string): number | null {
  const normalized = token.replace(/,/g, '').trim();
  const match = normalized.match(/\d+/);
  if (!match) {
    return null;
  }

  const value = Number(match[0]);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}

function normalizeTableCell(input: string | undefined): string {
  const value = (input ?? '').trim();
  if (!value) {
    return '';
  }

  // Strip wrapping quotes, if any.
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function parseQmdCollectionListOutput(stdout: string): QmdCollectionListEntry[] {
  const cleaned = stripAnsi(stdout).replace(/\r\n/g, '\n').trim();
  if (!cleaned) {
    return [];
  }

  // If qmd ever gains a JSON output mode for this command, accept it.
  try {
    const jsonText = extractJsonPayload(cleaned);
    const parsed = JSON.parse(jsonText) as unknown;
    if (Array.isArray(parsed)) {
      const entries: QmdCollectionListEntry[] = [];
      for (const row of parsed) {
        if (!row || typeof row !== 'object') {
          continue;
        }

        const record = row as Record<string, unknown>;
        const name =
          typeof record.name === 'string'
            ? record.name.trim()
            : typeof record.collection === 'string'
              ? record.collection.trim()
              : '';

        const filesRaw = record.files;
        const files =
          typeof filesRaw === 'number'
            ? filesRaw
            : typeof filesRaw === 'string'
              ? parseFilesCount(filesRaw) ?? NaN
              : NaN;

        const pattern =
          typeof record.pattern === 'string'
            ? record.pattern
            : typeof record.glob === 'string'
              ? record.glob
              : typeof record.path === 'string'
                ? record.path
                : '';

        const updatedRaw = record.updated ?? record.lastUpdated ?? record.indexedAt;
        const updated = typeof updatedRaw === 'string' ? updatedRaw : '';

        if (!name || !Number.isFinite(files) || !Number.isInteger(files)) {
          continue;
        }

        entries.push({
          name,
          files,
          pattern: normalizeTableCell(pattern),
          updated: normalizeTableCell(updated),
        });
      }

      if (entries.length) {
        return entries;
      }
    }
  } catch {
    // fall through to text parsing
  }

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: QmdCollectionListEntry[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('name') && lower.includes('files')) {
      continue;
    }

    if (/^[\s|+.-]+$/.test(line)) {
      continue;
    }

    // Handle pipe-separated tables (e.g. markdown or ascii tables).
    if (line.includes('|')) {
      const cells = line.split('|').map((cell) => cell.trim());
      if (cells.length && cells[0] === '') {
        cells.shift();
      }
      if (cells.length && cells[cells.length - 1] === '') {
        cells.pop();
      }

      if (cells.length >= 2) {
        const name = normalizeTableCell(cells[0]);
        const files = parseFilesCount(cells[1]);
        if (!name || files === null) {
          continue;
        }

        const pattern = normalizeTableCell(cells[2]);
        const updated = normalizeTableCell(cells[3]);
        entries.push({ name, files, pattern, updated });
        continue;
      }
    }

    // Whitespace-separated rows. Name is first token, files is second.
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      continue;
    }

    const name = tokens[0].trim();
    if (!name || name.toLowerCase() === 'name') {
      continue;
    }

    const files = parseFilesCount(tokens[1]);
    if (files === null) {
      continue;
    }

    const rest = tokens.slice(2);
    let pattern = '';
    let updated = '';

    if (rest.length >= 2) {
      const last = rest[rest.length - 1];
      const secondLast = rest[rest.length - 2];

      const isTime = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(last);
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(secondLast);

      if (isDate && isTime) {
        updated = `${secondLast} ${last}`;
        pattern = rest.slice(0, -2).join(' ');
      } else {
        updated = last;
        pattern = rest.slice(0, -1).join(' ');
      }
    } else if (rest.length === 1) {
      // Best-effort: treat as pattern when updated column is missing.
      pattern = rest[0];
    }

    entries.push({
      name,
      files,
      pattern: normalizeTableCell(pattern),
      updated: normalizeTableCell(updated),
    });
  }

  return entries;
}

function normalizeLineRange(value: unknown): LineRange | null {
  if (typeof value === 'undefined') {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!match) {
    return null;
  }

  const from = Number(match[1]);
  const to = typeof match[2] === 'string' ? Number(match[2]) : from;
  if (!Number.isFinite(from) || !Number.isInteger(from) || from < 1) {
    return null;
  }

  if (!Number.isFinite(to) || !Number.isInteger(to) || to < from) {
    return null;
  }

  const maxSpan = 10_000;
  if (to - from + 1 > maxSpan) {
    return null;
  }

  return { from, to };
}

function buildSshCommand(target: string, remoteCommand: string): string {
  // Use BatchMode to avoid hanging on password prompts in production.
  const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
  return ['ssh', ...options, shEscape(target), shEscape(remoteCommand)].join(' ');
}

function execCommand(command: string, timeoutMs: number, maxBufferBytes: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/sh',
      ['-c', command],
      {
        timeout: timeoutMs,
        maxBuffer: maxBufferBytes,
        env: { ...process.env, CI: '1', TERM: 'dumb', NO_COLOR: '1' },
      },
      (err, stdout, stderr) => {
        if (err) {
          const error = err as Error & { code?: number | string; signal?: string | null; killed?: boolean };
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

function toErrorMessage(input: unknown): string {
  if (input instanceof Error && input.message.trim()) {
    return input.message;
  }

  return 'Unknown error';
}

function classifyExecError(err: unknown): { status: number; error: string } {
  const message = toErrorMessage(err);
  const record = err as { stderr?: unknown; code?: unknown; signal?: unknown; killed?: unknown };
  const stderr = typeof record?.stderr === 'string' ? record.stderr : '';
  const combined = `${message}\n${stderr}`.toLowerCase();

  const killed = record?.killed === true;
  const signal = typeof record?.signal === 'string' ? record.signal : null;
  if (killed || signal === 'sigterm' || combined.includes('timed out')) {
    return { status: 504, error: 'qmd search timed out' };
  }

  if (combined.includes('collection not found')) {
    return { status: 400, error: 'invalid collection' };
  }

  if (combined.includes('command not found') || combined.includes('no such file or directory')) {
    return { status: 500, error: 'qmd not found (or not executable) on search host' };
  }

  if (combined.includes('ssh:') || combined.includes('connection timed out') || combined.includes('could not resolve hostname')) {
    return { status: 502, error: 'ssh to qmd host failed' };
  }

  const code = record?.code;
  if (code === 255 || code === '255') {
    return { status: 502, error: 'ssh to qmd host failed' };
  }

  return { status: 502, error: 'qmd search failed' };
}

export function createSearchRouter(): Router {
  const router = Router();

  router.get('/collections', async (_req: Request, res: Response) => {
    const { sshTarget, qmdBin, timeoutMs, maxBufferBytes } = getQmdExecConfig();
    const qmdCommand = buildQmdCollectionListCommand(qmdBin);
    const command = sshTarget ? buildSshCommand(sshTarget, qmdCommand) : qmdCommand;

    try {
      const { stdout } = await execCommand(command, timeoutMs, maxBufferBytes);
      const collections = parseQmdCollectionListOutput(stdout);
      return res.json(collections);
    } catch (err) {
      const classified = classifyExecError(err);
      return res.status(classified.status).json({ error: classified.error });
    }
  });

  router.get('/document', async (req: Request, res: Response) => {
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!id) {
      return res.status(400).json({ error: 'id required' });
    }

    const linesRaw = req.query.lines;
    const lineRange = normalizeLineRange(linesRaw);
    if (typeof linesRaw !== 'undefined' && lineRange === null) {
      return res.status(400).json({ error: 'lines must be a range like 40-50' });
    }

    if (!requireRequestOrg(req, res)) return undefined;

    const { sshTarget, qmdBin, timeoutMs, maxBufferBytes } = getQmdExecConfig();
    const qmdCommand = buildQmdGetCommand({ qmdBin, id, lines: lineRange });
    const command = sshTarget ? buildSshCommand(sshTarget, qmdCommand) : qmdCommand;

    try {
      const { stdout } = await execCommand(command, timeoutMs, maxBufferBytes);
      return res.json({
        id,
        content: stdout.replace(/\r\n/g, '\n'),
        lines: lineRange ? `${lineRange.from}-${lineRange.to}` : null,
      });
    } catch (err) {
      const classified = classifyExecError(err);
      return res.status(classified.status).json({ error: classified.error });
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      return res.status(400).json({ error: 'q required' });
    }

    const modeRaw = req.query.mode;
    const mode = normalizeMode(modeRaw) ?? 'keyword';
    if (typeof modeRaw !== 'undefined' && !normalizeMode(modeRaw)) {
      return res.status(400).json({ error: 'mode must be keyword, semantic, or hybrid' });
    }

    const collectionRaw = req.query.collection;
    const collection = normalizeCollection(collectionRaw) ?? 'all';
    if (typeof collectionRaw !== 'undefined' && !normalizeCollection(collectionRaw)) {
      return res.status(400).json({ error: 'invalid collection' });
    }

    const limitRaw = req.query.limit;
    const limit = normalizeLimit(limitRaw, 20);
    if (limit === null) {
      return res.status(400).json({ error: 'limit must be a positive integer' });
    }

    const fullRaw = req.query.full;
    const full = normalizeBoolean(fullRaw) ?? false;
    if (typeof fullRaw !== 'undefined' && normalizeBoolean(fullRaw) === null) {
      return res.status(400).json({ error: 'full must be a boolean' });
    }

    const binding = requireRequestOrg(req, res);
    if (!binding) return undefined;

    const { sshTarget, qmdBin, timeoutMs, maxBufferBytes } = getQmdExecConfig();

    const qmdCommand = buildQmdCommand({ query, mode, collection, limit, full, qmdBin });
    const command = sshTarget ? buildSshCommand(sshTarget, qmdCommand) : qmdCommand;

    try {
      const { stdout } = await execCommand(command, timeoutMs, maxBufferBytes);
      const jsonText = extractJsonPayload(stdout);
      const parsed = JSON.parse(jsonText) as unknown;

      if (!Array.isArray(parsed)) {
        return res.status(502).json({ error: 'qmd returned invalid JSON' });
      }

      const results = (parsed as QmdJsonResult[]).map((entry) => {
        const file = typeof entry.file === 'string' ? entry.file : '';
        const parsedFile = parseQmdFileUri(file);
        const path = parsedFile.path;
        const title =
          typeof entry.title === 'string' && entry.title.trim()
            ? entry.title.trim()
            : path.split('/').filter(Boolean).pop() ?? parsedFile.id ?? file;

        const score = typeof entry.score === 'number' ? entry.score : null;
        const snippet = typeof entry.snippet === 'string' ? entry.snippet : null;
        const content = typeof entry.body === 'string' ? entry.body : null;
        const docid = typeof entry.docid === 'string' ? entry.docid : null;
        const resultCollection = parsedFile.collection ?? (collection === 'all' ? null : collection);
        const id = resultCollection ? `${resultCollection}/${path}` : parsedFile.id;

        const result = {
          id,
          docid,
          collection: resultCollection,
          path,
          title,
          score,
          uri: file || null,
          snippet: full ? null : snippet,
          content: full ? content : null,
        };
        const object = {
          object_type: 'search_result' as const,
          object_id: id || docid || file || path,
          org_id: typeof entry.org_id === 'string' && entry.org_id.trim() ? entry.org_id.trim() : binding.orgId,
          title,
          snippet,
          content,
          sensitivity: typeof entry.sensitivity === 'string' ? entry.sensitivity : null,
          acl_json: typeof entry.acl_json === 'string' ? entry.acl_json : null,
          entity_visibility_policy_json: typeof entry.entity_visibility_policy_json === 'string' ? entry.entity_visibility_policy_json : null,
        };
        const envelope = permissionSafeRecord(binding, object, result, full ? 'read' : 'search');
        return { ...envelope.object, permission: envelope.permission };
      });

      return res.json({
        query,
        mode,
        collection,
        count: results.length,
        results,
      });
    } catch (err) {
      const classified = classifyExecError(err);
      return res.status(classified.status).json({ error: classified.error });
    }
  });

  return router;
}
