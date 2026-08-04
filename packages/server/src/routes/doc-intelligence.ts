import type { Express } from 'express';
import { generateText } from 'ai';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../config/settings-store';
import { getTaskAgentLanguageModel, getTaskAgentSettings } from '../agent/settings';

const SETTINGS_KEY = 'docIntelligence.settings';
const NOTES_KEY_PREFIX = 'docNotes.';
const MAX_DOC_CHARS = 24_000;
const MAX_QUESTION_CHARS = 2_000;
const MAX_NOTE_CHARS = 4_000;
const MAX_NOTES_PER_DOC = 200;
const MAX_SCHEMA_FIELDS = 20;
const MAX_SCHEMA_FIELD_LEN = 64;

export interface StoredDocIntelligenceSettings {
  enabled?: boolean;
}

export interface DocIntelligenceSettingsView {
  enabled: boolean;
  provider: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'env' | 'none';
  ready: boolean;
}

function readStoredSettings(): StoredDocIntelligenceSettings {
  try {
    const db = getEntityDatabase(ensureAppSettingsTable);
    const stored = getSettingJson(db, SETTINGS_KEY);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    return stored as StoredDocIntelligenceSettings;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown settings read error';
    console.warn('[DocIntelligence] Failed to read settings:', message);
    return {};
  }
}

export function getDocIntelligenceSettings(): DocIntelligenceSettingsView {
  const stored = readStoredSettings();
  const agentSettings = getTaskAgentSettings();
  const enabled = stored.enabled === true;

  return {
    enabled,
    provider: agentSettings.provider,
    model: agentSettings.model,
    apiKeyConfigured: agentSettings.apiKeyConfigured,
    apiKeySource: agentSettings.apiKeySource,
    ready: enabled && agentSettings.apiKeyConfigured,
  };
}

export function updateDocIntelligenceSettings(input: { enabled?: unknown }): DocIntelligenceSettingsView {
  const current = readStoredSettings();
  const next: StoredDocIntelligenceSettings = { ...current };

  if (typeof input.enabled === 'boolean') {
    next.enabled = input.enabled;
  }

  const db = getEntityDatabase(ensureAppSettingsTable);
  setSettingJson(db, SETTINGS_KEY, next, 'admin-ui');
  return getDocIntelligenceSettings();
}

export interface DocNoteRecord {
  id: string;
  text: string;
  createdAt: string;
}

export function buildDocNotesKey(sourceId: string | null | undefined, path: string): string | null {
  const trimmedPath = path?.trim();
  if (!trimmedPath || trimmedPath.length > 600 || trimmedPath.includes('\n')) {
    return null;
  }
  const source = typeof sourceId === 'string' && sourceId.trim() ? sourceId.trim() : 'local';
  return `${NOTES_KEY_PREFIX}${source}::${trimmedPath}`;
}

function readDocNotes(key: string): DocNoteRecord[] {
  const db = getEntityDatabase(ensureAppSettingsTable);
  const stored = getSettingJson(db, key);
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter(
    (entry): entry is DocNoteRecord =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as DocNoteRecord).id === 'string' &&
      typeof (entry as DocNoteRecord).text === 'string',
  );
}

function writeDocNotes(key: string, notes: DocNoteRecord[]): void {
  const db = getEntityDatabase(ensureAppSettingsTable);
  setSettingJson(db, key, notes, 'doc-intelligence');
}

export interface DocAskInput {
  question: string;
  content: string;
  path?: string;
  filename?: string;
  /** Caller-supplied required field names; the answer must address each by exact name. */
  schema?: string[];
}

export type DocAskValidation =
  | { ok: true; input: DocAskInput }
  | { ok: false; error: string; code?: string };

export type DocSchemaExtractionDecision =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; missingFields: string[]; reason: string };

export function validateDocAskInput(body: unknown): DocAskValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const record = body as Record<string, unknown>;
  const question = typeof record.question === 'string' ? record.question.trim() : '';
  if (!question) {
    return { ok: false, error: 'question is required.' };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: `question must be at most ${MAX_QUESTION_CHARS} characters.` };
  }

  const content = typeof record.content === 'string' ? record.content : '';
  if (!content.trim()) {
    return { ok: false, error: 'content is required.' };
  }

  // THE-934: fail-closed schema validation BEFORE any model call.
  const schemaResult = validateDocSchemaShape(record.schema);
  if (!schemaResult.ok) {
    return { ok: false, error: schemaResult.error, code: 'schema_invalid' };
  }

  return {
    ok: true,
    input: {
      question,
      content: content.slice(0, MAX_DOC_CHARS),
      path: typeof record.path === 'string' ? record.path.slice(0, 500) : undefined,
      filename: typeof record.filename === 'string' ? record.filename.slice(0, 200) : undefined,
      schema: schemaResult.fields,
    },
  };
}

function validateDocSchemaShape(
  value: unknown,
): { ok: true; fields: string[] | undefined } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, fields: undefined };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: 'schema must be an array of field name strings.' };
  }
  if (value.length === 0) {
    return { ok: false, error: 'schema must contain at least one field name.' };
  }
  if (value.length > MAX_SCHEMA_FIELDS) {
    return { ok: false, error: `schema must contain at most ${MAX_SCHEMA_FIELDS} fields.` };
  }

  const seen = new Set<string>();
  const fields: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { ok: false, error: 'schema field names must be strings.' };
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      return { ok: false, error: 'schema field names must not be empty.' };
    }
    if (trimmed.length > MAX_SCHEMA_FIELD_LEN) {
      return { ok: false, error: `schema field names must be at most ${MAX_SCHEMA_FIELD_LEN} characters.` };
    }
    if (seen.has(trimmed)) {
      return { ok: false, error: `schema field names must be unique (duplicate: "${trimmed}").` };
    }
    seen.add(trimmed);
    fields.push(trimmed);
  }
  return { ok: true, fields };
}

/**
 * THE-934: exact-match post-validation of a schema extraction.
 *
 * Requires the model answer to be a JSON object whose own-properties include
 * every required field name exactly. A required `Owner` is NOT satisfied by a
 * `Homeowner` key (no substring/prefix/case folding). Null and non-scalar
 * values count as missing.
 */
export function validateDocSchemaExtraction(
  answer: string,
  requiredFields: string[] | undefined,
): DocSchemaExtractionDecision {
  if (!requiredFields || requiredFields.length === 0) {
    return { ok: true, data: {} };
  }

  const data = tryParseJsonObject(answer);
  if (!data) {
    return {
      ok: false,
      missingFields: requiredFields.slice(),
      reason: 'Model answer was not a JSON object keyed by the requested schema fields.',
    };
  }

  const missing: string[] = [];
  for (const field of requiredFields) {
    const value = data[field];
    if (value === undefined || value === null || typeof value === 'object') {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    return { ok: false, missingFields: missing, reason: 'Required schema fields are missing.' };
  }
  return { ok: true, data };
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  // Tolerate ```json fences and leading prose, but require a top-level object.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function buildDocAskPrompt(input: DocAskInput): { system: string; user: string } {
  const docLabel = input.filename || input.path || 'the document';
  const schemaLines = Array.isArray(input.schema) && input.schema.length > 0
    ? [
        '',
        'Answer as a single JSON object keyed EXACTLY by these field names (case-sensitive, no aliases):',
        input.schema.map((name) => `- "${name}"`).join('\n'),
        'If a field is not present in the document, set its value to an empty string. Do not rename keys.',
      ].join('\n')
    : '';
  return {
    system: [
      'You are Entity Doc Intelligence, a focused assistant that answers questions about a single document.',
      'Only use information from the provided document content. If the answer is not in the document, say so plainly.',
      'Be concise. Use short paragraphs or bullets. Do not invent facts, links, or metadata.',
    ].join('\n'),
    user: [
      `Document: ${docLabel}`,
      '',
      '--- DOCUMENT CONTENT START ---',
      input.content,
      '--- DOCUMENT CONTENT END ---',
      '',
      `Question: ${input.question}`,
      schemaLines,
    ].filter(Boolean).join('\n'),
  };
}

interface RegisterDocIntelligenceRoutesDeps {
  /** Injectable for tests. */
  generateAnswer?: (prompt: { system: string; user: string }) => Promise<string | null>;
}

async function defaultGenerateAnswer(prompt: { system: string; user: string }): Promise<string | null> {
  const model = getTaskAgentLanguageModel();
  if (!model) {
    return null;
  }

  const result = await generateText({
    model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: 0.2,
  });

  return result.text.trim() || null;
}

export function registerDocIntelligenceRoutes(
  app: Express,
  prefix: '' | '/api',
  deps: RegisterDocIntelligenceRoutesDeps = {},
): void {
  const base = `${prefix}/doc-intelligence`;
  const generateAnswer = deps.generateAnswer ?? defaultGenerateAnswer;

  app.get(`${base}/settings`, (_req, res) => {
    try {
      res.json({ settings: getDocIntelligenceSettings() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read settings';
      res.status(500).json({ error: message });
    }
  });

  app.patch(`${base}/settings`, (req, res) => {
    try {
      const settings = updateDocIntelligenceSettings({ enabled: req.body?.enabled });
      res.json({ settings });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update settings';
      res.status(500).json({ error: message });
    }
  });

  app.get(`${base}/notes`, (req, res) => {
    const key = buildDocNotesKey(
      typeof req.query.sourceId === 'string' ? req.query.sourceId : null,
      typeof req.query.path === 'string' ? req.query.path : '',
    );
    if (!key) {
      res.status(400).json({ error: 'path query parameter is required.' });
      return;
    }

    try {
      res.json({ notes: readDocNotes(key) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read notes';
      res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/notes`, (req, res) => {
    const key = buildDocNotesKey(
      typeof req.body?.sourceId === 'string' ? req.body.sourceId : null,
      typeof req.body?.path === 'string' ? req.body.path : '',
    );
    if (!key) {
      res.status(400).json({ error: 'path is required.' });
      return;
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'text is required.' });
      return;
    }
    if (text.length > MAX_NOTE_CHARS) {
      res.status(400).json({ error: `text must be at most ${MAX_NOTE_CHARS} characters.` });
      return;
    }

    try {
      const notes = readDocNotes(key);
      if (notes.length >= MAX_NOTES_PER_DOC) {
        res.status(400).json({ error: `A document can have at most ${MAX_NOTES_PER_DOC} notes.` });
        return;
      }
      const note: DocNoteRecord = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        text,
        createdAt: new Date().toISOString(),
      };
      const next = [...notes, note];
      writeDocNotes(key, next);
      res.status(201).json({ note, notes: next });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save note';
      res.status(500).json({ error: message });
    }
  });

  app.delete(`${base}/notes/:noteId`, (req, res) => {
    const key = buildDocNotesKey(
      typeof req.query.sourceId === 'string' ? req.query.sourceId : null,
      typeof req.query.path === 'string' ? req.query.path : '',
    );
    if (!key) {
      res.status(400).json({ error: 'path query parameter is required.' });
      return;
    }

    try {
      const notes = readDocNotes(key);
      const next = notes.filter((note) => note.id !== req.params.noteId);
      if (next.length === notes.length) {
        res.status(404).json({ error: 'Note not found.' });
        return;
      }
      writeDocNotes(key, next);
      res.json({ notes: next });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete note';
      res.status(500).json({ error: message });
    }
  });

  app.post(`${base}/ask`, async (req, res) => {
    const settings = getDocIntelligenceSettings();
    if (!settings.enabled) {
      res.status(403).json({
        error: 'Doc Intelligence is disabled. Enable it in Admin → Docs.',
        code: 'disabled',
      });
      return;
    }

    if (!settings.apiKeyConfigured) {
      res.status(503).json({
        error: 'No model API key configured. Set one in Admin → Task Master.',
        code: 'no-model',
      });
      return;
    }

    const validated = validateDocAskInput(req.body);
    if (!validated.ok) {
      const status = validated.code === 'schema_invalid' ? 400 : 400;
      res.status(status).json({ error: validated.error, code: validated.code ?? 'invalid_input' });
      return;
    }

    try {
      const answer = await generateAnswer(buildDocAskPrompt(validated.input));
      if (!answer) {
        res.status(503).json({
          error: 'The model did not return an answer. Check the provider configuration in Admin → Task Master.',
          code: 'no-answer',
        });
        return;
      }

      // THE-934: exact-match schema validation AFTER the model call. Fail closed
      // (no silent partial extraction) but never leak model internals beyond the
      // caller-supplied field names.
      if (validated.input.schema && validated.input.schema.length > 0) {
        const extraction = validateDocSchemaExtraction(answer, validated.input.schema);
        if (!extraction.ok) {
          res.status(422).json({
            error: 'The model answer did not satisfy the required document schema.',
            code: 'schema_incomplete',
            missingFields: extraction.missingFields,
          });
          return;
        }
      }

      res.json({
        answer,
        provider: settings.provider,
        model: settings.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model request failed';
      res.status(502).json({ error: message, code: 'model-error' });
    }
  });
}
