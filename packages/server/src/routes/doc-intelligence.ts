import type { Express } from 'express';
import { generateText } from 'ai';
import { getEntityDatabase } from '../../../db/src/entity-db';
import { ensureAppSettingsTable, getSettingJson, setSettingJson } from '../config/settings-store';
import { getTaskAgentLanguageModel, getTaskAgentSettings } from '../agent/settings';

const SETTINGS_KEY = 'docIntelligence.settings';
const MAX_DOC_CHARS = 24_000;
const MAX_QUESTION_CHARS = 2_000;

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

export interface DocAskInput {
  question: string;
  content: string;
  path?: string;
  filename?: string;
}

export function validateDocAskInput(body: unknown): { ok: true; input: DocAskInput } | { ok: false; error: string } {
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

  return {
    ok: true,
    input: {
      question,
      content: content.slice(0, MAX_DOC_CHARS),
      path: typeof record.path === 'string' ? record.path.slice(0, 500) : undefined,
      filename: typeof record.filename === 'string' ? record.filename.slice(0, 200) : undefined,
    },
  };
}

export function buildDocAskPrompt(input: DocAskInput): { system: string; user: string } {
  const docLabel = input.filename || input.path || 'the document';
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
    ].join('\n'),
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
      res.status(400).json({ error: validated.error });
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
