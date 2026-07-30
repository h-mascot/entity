import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { ProviderRegistryError } from './errors';
import type {
  AuthMode,
  BindingScopeKind,
  HealthCheckStatus,
  HealthTestKind,
  InferenceProviderBindingRecord,
  InferenceProviderHealthCheckRecord,
  InferenceProviderModelRecord,
  InferenceProviderProfileRecord,
  ProviderCapability,
  ProviderErrorCode,
  ProviderKind,
  ProviderConsumerKey,
} from './types';
import {
  isAuthMode,
  isProviderCapability,
  isProviderConsumerKey,
  isProviderErrorCode,
  isProviderKind,
} from './types';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ProviderRegistryError('PROVIDER_CONFIGURATION_INVALID', {
        message: `${label} must be a JSON object`,
      });
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ProviderRegistryError) throw error;
    throw new ProviderRegistryError('PROVIDER_CONFIGURATION_INVALID', {
      message: `${label} is not valid JSON`,
      cause: error,
    });
  }
}

function asBool(value: number | boolean): boolean {
  return value === 1 || value === true;
}

const FORBIDDEN_SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'apikeys',
  'secret',
  'secretref',
  'secret_ref',
  'authorization',
  'token',
  'password',
  'rawkey',
  'raw_key',
]);

function secretKeyName(key: string): boolean {
  const normalized = key.replace(/[-_]/g, '').toLowerCase();
  if (FORBIDDEN_SECRET_KEYS.has(normalized) || FORBIDDEN_SECRET_KEYS.has(key.toLowerCase())) {
    return true;
  }
  return (
    normalized.includes('secret') ||
    normalized.includes('apikey') ||
    normalized.endsWith('token') ||
    normalized.endsWith('password') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('credentials') ||
    normalized.endsWith('privatekey') ||
    normalized.endsWith('clientsecret') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken')
  );
}

function assertNoSecretMaterial(value: unknown, path = 'providerConfig'): void {
  if (value == null) return;
  if (typeof value === 'string') {
    if (looksLikeRawSecret(value) || /bearer\s+[A-Za-z0-9._\-]{12,}/i.test(value)) {
      throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
        message: `${path} must not contain raw credentials`,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretMaterial(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (secretKeyName(key)) {
        throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
          message: `${path}.${key} must be stored as a secret reference, not providerConfig`,
        });
      }
      assertNoSecretMaterial(child, `${path}.${key}`);
    }
  }
}

function assertModelSupportsCapability(
  db: Database.Database,
  profileId: string,
  modelId: string,
  capability: ProviderCapability,
): void {
  const model = db
    .prepare(`
      SELECT 1 AS ok FROM inference_provider_model_capabilities
      WHERE profile_id = ? AND model_id = ? AND capability = ?
    `)
    .get(profileId, modelId, capability) as { ok: number } | undefined;
  if (!model) {
    throw new ProviderRegistryError('PROVIDER_CAPABILITY_UNSUPPORTED');
  }
}

function assertCapabilitiesCanReplace(
  db: Database.Database,
  profileId: string,
  modelId: string,
  nextCapabilities: ProviderCapability[],
): void {
  const next = new Set(nextCapabilities);
  const rows = db
    .prepare(`
      SELECT capability FROM inference_provider_profile_defaults
      WHERE profile_id = ? AND model_id = ?
      UNION
      SELECT capability FROM inference_provider_bindings
      WHERE profile_id = ? AND model_id = ?
    `)
    .all(profileId, modelId, profileId, modelId) as Array<{ capability: string }>;
  const removedUsed = rows.some((row) =>
    isProviderCapability(row.capability) && !next.has(row.capability),
  );
  if (removedUsed) {
    throw new ProviderRegistryError('PROVIDER_IN_USE', {
      message: 'Cannot remove a capability referenced by defaults or bindings',
    });
  }
}

function sanitizeSecretValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (looksLikeRawSecret(value) || /bearer\s+[A-Za-z0-9._\-]{12,}/i.test(value)) {
      return '[redacted]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeSecretValue(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_DETAIL_KEYS.has(key) || secretKeyName(key)) continue;
      const sanitized = sanitizeSecretValue(child);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }
  return value;
}

export function redactFreeformMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  return message
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|password|secret|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(sk-|rk-|xai-|AIza)[A-Za-z0-9._\-]{12,}/gi, '[redacted]');
}


function validateBaseUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new ProviderRegistryError('PROVIDER_CONFIGURATION_INVALID', {
      message: 'base_url must be a valid URL',
      cause: error,
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProviderRegistryError('PROVIDER_ENDPOINT_BLOCKED', {
      message: 'base_url must use http or https',
    });
  }
  if (parsed.username || parsed.password) {
    throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
      message: 'base_url must not contain embedded credentials',
    });
  }
  for (const segment of parsed.pathname.split('/')) {
    if (looksLikeRawSecret(decodeURIComponent(segment))) {
      throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
        message: 'base_url path must not contain credentials',
      });
    }
  }
  for (const [key, val] of parsed.searchParams.entries()) {
    if (secretKeyName(key) || looksLikeRawSecret(val)) {
      throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
        message: 'base_url query parameters must not contain credentials',
      });
    }
  }
  return trimmed;
}

type ProfileRow = {
  id: string;
  name: string;
  display_label: string;
  provider_kind: string;
  base_url: string | null;
  auth_mode: string;
  secret_ref: string | null;
  provider_config_json: string;
  enabled: number;
  migration_source: string | null;
  migration_fingerprint: string | null;
  last_used_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export function mapProfileRow(row: ProfileRow): InferenceProviderProfileRecord {
  if (!isProviderKind(row.provider_kind)) {
    throw new ProviderRegistryError('PROVIDER_CONFIGURATION_INVALID', {
      message: `Unknown provider_kind: ${row.provider_kind}`,
    });
  }
  if (!isAuthMode(row.auth_mode)) {
    throw new ProviderRegistryError('PROVIDER_CONFIGURATION_INVALID', {
      message: `Unknown auth_mode: ${row.auth_mode}`,
    });
  }
  return {
    id: row.id,
    name: row.name,
    displayLabel: row.display_label,
    providerKind: row.provider_kind,
    baseUrl: row.base_url,
    authMode: row.auth_mode,
    secretRef: row.secret_ref,
    providerConfig: parseJsonObject(row.provider_config_json, 'provider_config_json'),
    enabled: asBool(row.enabled),
    migrationSource: row.migration_source,
    migrationFingerprint: row.migration_fingerprint,
    lastUsedAt: row.last_used_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateProfileInput {
  id?: string;
  name: string;
  displayLabel: string;
  providerKind: ProviderKind;
  baseUrl?: string | null;
  authMode: AuthMode;
  /** Opaque reference only — never a raw API key. */
  secretRef?: string | null;
  providerConfig?: Record<string, unknown>;
  enabled?: boolean;
  migrationSource?: string | null;
  migrationFingerprint?: string | null;
}

export interface UpdateProfileInput {
  expectedVersion: number;
  displayLabel?: string;
  baseUrl?: string | null;
  authMode?: AuthMode;
  secretRef?: string | null;
  providerConfig?: Record<string, unknown>;
  enabled?: boolean;
  lastUsedAt?: string | null;
}

export interface InferenceProviderProfileRepository {
  create(input: CreateProfileInput): InferenceProviderProfileRecord;
  getById(id: string): InferenceProviderProfileRecord | null;
  getByName(name: string): InferenceProviderProfileRecord | null;
  list(options?: { enabledOnly?: boolean }): InferenceProviderProfileRecord[];
  update(id: string, input: UpdateProfileInput): InferenceProviderProfileRecord;
  setEnabled(id: string, enabled: boolean, expectedVersion: number): InferenceProviderProfileRecord;
}

export function createProfileRepository(db: Database.Database): InferenceProviderProfileRepository {
  const selectById = db.prepare(`
    SELECT * FROM inference_provider_profiles WHERE id = ?
  `);
  const selectByName = db.prepare(`
    SELECT * FROM inference_provider_profiles WHERE name = ? COLLATE NOCASE
  `);
  const insert = db.prepare(`
    INSERT INTO inference_provider_profiles (
      id, name, display_label, provider_kind, base_url, auth_mode, secret_ref,
      provider_config_json, enabled, migration_source, migration_fingerprint,
      last_used_at, version, created_at, updated_at
    ) VALUES (
      @id, @name, @display_label, @provider_kind, @base_url, @auth_mode, @secret_ref,
      @provider_config_json, @enabled, @migration_source, @migration_fingerprint,
      NULL, 1, @created_at, @updated_at
    )
  `);
  const updateStmt = db.prepare(`
    UPDATE inference_provider_profiles SET
      display_label = @display_label,
      base_url = @base_url,
      auth_mode = @auth_mode,
      secret_ref = @secret_ref,
      provider_config_json = @provider_config_json,
      enabled = @enabled,
      last_used_at = @last_used_at,
      version = version + 1,
      updated_at = @updated_at
    WHERE id = @id AND version = @expected_version
  `);

  function assertAuthConsistency(authMode: AuthMode, secretRef: string | null): void {
    if (authMode === 'none' && secretRef !== null) {
      throw new ProviderRegistryError('PROVIDER_CONFIGURATION_INVALID', {
        message: 'auth_mode none requires secret_ref to be null',
      });
    }
    if (authMode !== 'none' && (!secretRef || !secretRef.trim())) {
      throw new ProviderRegistryError('PROVIDER_SECRET_MISSING', {
        message: 'auth_mode requires a non-empty secret_ref',
      });
    }
    if (secretRef && looksLikeRawSecret(secretRef)) {
      throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
        message: 'secret_ref must be a reference, not a raw credential',
      });
    }
    if (secretRef && authMode === 'env_ref' && !/^[A-Z][A-Z0-9_]*$/.test(secretRef)) {
      throw new ProviderRegistryError('PROVIDER_CONFIGURATION_INVALID', {
        message: 'env_ref secret_ref must be an environment variable name',
      });
    }
    if (
      secretRef &&
      authMode === 'legacy_setting_ref' &&
      !/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(secretRef)
    ) {
      throw new ProviderRegistryError('PROVIDER_CONFIGURATION_INVALID', {
        message: 'legacy_setting_ref secret_ref must be a dotted settings path',
      });
    }
  }

  return {
    create(input) {
      const name = input.name.trim();
      const displayLabel = input.displayLabel.trim();
      if (!name || !displayLabel) {
        throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
          message: 'name and displayLabel are required',
        });
      }
      if (selectByName.get(name)) {
        throw new ProviderRegistryError('PROVIDER_NAME_EXISTS');
      }

      const authMode = input.authMode;
      const secretRef =
        authMode === 'none' ? null : (input.secretRef?.trim() || null);
      assertAuthConsistency(authMode, secretRef);

      const now = nowIso();
      const id = input.id?.trim() || newId('profile');
      try {
        insert.run({
          id,
          name,
          display_label: displayLabel,
          provider_kind: input.providerKind,
          base_url: validateBaseUrl(input.baseUrl),
          auth_mode: authMode,
          secret_ref: secretRef,
          provider_config_json: JSON.stringify((assertNoSecretMaterial(input.providerConfig ?? {}), input.providerConfig ?? {})),
          enabled: input.enabled === false ? 0 : 1,
          migration_source: input.migrationSource ?? null,
          migration_fingerprint: input.migrationFingerprint ?? null,
          created_at: now,
          updated_at: now,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('UNIQUE') && message.toLowerCase().includes('name')) {
          throw new ProviderRegistryError('PROVIDER_NAME_EXISTS', { cause: error });
        }
        throw error;
      }

      const created = selectById.get(id) as ProfileRow | undefined;
      if (!created) {
        throw new ProviderRegistryError('PROVIDER_UNKNOWN_ERROR', {
          message: 'Profile insert succeeded but row was not readable',
        });
      }
      return mapProfileRow(created);
    },

    getById(id) {
      const row = selectById.get(id) as ProfileRow | undefined;
      return row ? mapProfileRow(row) : null;
    },

    getByName(name) {
      const row = selectByName.get(name.trim()) as ProfileRow | undefined;
      return row ? mapProfileRow(row) : null;
    },

    list(options) {
      const rows = (
        options?.enabledOnly
          ? db.prepare(`
              SELECT * FROM inference_provider_profiles
              WHERE enabled = 1
              ORDER BY name COLLATE NOCASE ASC
            `).all()
          : db.prepare(`
              SELECT * FROM inference_provider_profiles
              ORDER BY name COLLATE NOCASE ASC
            `).all()
      ) as ProfileRow[];
      return rows.map(mapProfileRow);
    },

    update(id, input) {
      const existing = selectById.get(id) as ProfileRow | undefined;
      if (!existing) {
        throw new ProviderRegistryError('PROVIDER_NOT_FOUND');
      }
      if (existing.version !== input.expectedVersion) {
        throw new ProviderRegistryError('PROVIDER_VERSION_CONFLICT');
      }

      const nextAuthMode = input.authMode ?? (existing.auth_mode as AuthMode);
      let nextSecretRef =
        input.secretRef !== undefined ? input.secretRef : existing.secret_ref;
      if (nextAuthMode === 'none') {
        nextSecretRef = null;
      }
      assertAuthConsistency(nextAuthMode, nextSecretRef);

      const result = updateStmt.run({
        id,
        expected_version: input.expectedVersion,
        display_label: (() => {
          if (input.displayLabel === undefined) return existing.display_label;
          const nextDisplayLabel = input.displayLabel.trim();
          if (!nextDisplayLabel) {
            throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
              message: 'displayLabel must not be empty',
            });
          }
          return nextDisplayLabel;
        })(),
        base_url: input.baseUrl !== undefined ? validateBaseUrl(input.baseUrl) : existing.base_url,
        auth_mode: nextAuthMode,
        secret_ref: nextSecretRef,
        provider_config_json:
          input.providerConfig !== undefined
            ? JSON.stringify((assertNoSecretMaterial(input.providerConfig), input.providerConfig))
            : existing.provider_config_json,
        enabled:
          input.enabled !== undefined
            ? input.enabled
              ? 1
              : 0
            : existing.enabled,
        last_used_at:
          input.lastUsedAt !== undefined ? input.lastUsedAt : existing.last_used_at,
        updated_at: nowIso(),
      });

      if (result.changes !== 1) {
        throw new ProviderRegistryError('PROVIDER_VERSION_CONFLICT');
      }

      return mapProfileRow(selectById.get(id) as ProfileRow);
    },

    setEnabled(id, enabled, expectedVersion) {
      return this.update(id, { expectedVersion, enabled });
    },
  };
}

/** Heuristic: reject values that look like pasted API keys rather than refs. */
export function looksLikeRawSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(sk-|rk-|xai-|AIza|ghp_|gho_)/i.test(trimmed) && trimmed.length > 20) return true;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return true;
  if (/^[A-Za-z0-9_\-]{40,}$/.test(trimmed) && !/^[A-Z][A-Z0-9_]*$/.test(trimmed)) return true;
  return false;
}

type ModelRow = {
  profile_id: string;
  model_id: string;
  display_label: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export interface UpsertModelInput {
  profileId: string;
  modelId: string;
  displayLabel?: string | null;
  enabled?: boolean;
  capabilities: ProviderCapability[];
}

export interface InferenceProviderModelRepository {
  upsert(input: UpsertModelInput): InferenceProviderModelRecord;
  get(profileId: string, modelId: string): InferenceProviderModelRecord | null;
  listByProfile(profileId: string): InferenceProviderModelRecord[];
  setEnabled(profileId: string, modelId: string, enabled: boolean): InferenceProviderModelRecord;
  setCapabilities(
    profileId: string,
    modelId: string,
    capabilities: ProviderCapability[],
  ): InferenceProviderModelRecord;
}

export function createModelRepository(db: Database.Database): InferenceProviderModelRepository {
  const selectModel = db.prepare(`
    SELECT * FROM inference_provider_models WHERE profile_id = ? AND model_id = ?
  `);
  const listCaps = db.prepare(`
    SELECT capability FROM inference_provider_model_capabilities
    WHERE profile_id = ? AND model_id = ?
    ORDER BY capability ASC
  `);
  const insertModel = db.prepare(`
    INSERT INTO inference_provider_models (
      profile_id, model_id, display_label, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, model_id) DO UPDATE SET
      display_label = excluded.display_label,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  const updateEnabled = db.prepare(`
    UPDATE inference_provider_models
    SET enabled = ?, updated_at = ?
    WHERE profile_id = ? AND model_id = ?
  `);
  const deleteCaps = db.prepare(`
    DELETE FROM inference_provider_model_capabilities
    WHERE profile_id = ? AND model_id = ?
  `);
  const insertCap = db.prepare(`
    INSERT INTO inference_provider_model_capabilities (
      profile_id, model_id, capability, created_at
    ) VALUES (?, ?, ?, ?)
  `);

  function load(profileId: string, modelId: string): InferenceProviderModelRecord | null {
    const row = selectModel.get(profileId, modelId) as ModelRow | undefined;
    if (!row) return null;
    const caps = (listCaps.all(profileId, modelId) as Array<{ capability: string }>)
      .map((c) => c.capability)
      .filter(isProviderCapability);
    return {
      profileId: row.profile_id,
      modelId: row.model_id,
      displayLabel: row.display_label,
      enabled: asBool(row.enabled),
      capabilities: caps,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function replaceCapabilities(
    profileId: string,
    modelId: string,
    capabilities: ProviderCapability[],
  ): void {
    const unique = [...new Set(capabilities)];
    for (const capability of unique) {
      if (!isProviderCapability(capability)) {
        throw new ProviderRegistryError('PROVIDER_CAPABILITY_UNSUPPORTED', {
          message: `Unknown capability: ${String(capability)}`,
        });
      }
    }
    assertCapabilitiesCanReplace(db, profileId, modelId, unique);
    deleteCaps.run(profileId, modelId);
    const createdAt = nowIso();
    for (const capability of unique) {
      insertCap.run(profileId, modelId, capability, createdAt);
    }
  }

  return {
    upsert(input) {
      const modelId = input.modelId.trim();
      if (!modelId) {
        throw new ProviderRegistryError('PROVIDER_MODEL_INVALID', {
          message: 'modelId is required',
        });
      }
      const profile = db
        .prepare('SELECT id FROM inference_provider_profiles WHERE id = ?')
        .get(input.profileId) as { id: string } | undefined;
      if (!profile) {
        throw new ProviderRegistryError('PROVIDER_NOT_FOUND');
      }

      const now = nowIso();
      const existing = selectModel.get(input.profileId, modelId) as ModelRow | undefined;
      const createdAt = existing?.created_at ?? now;

      const tx = db.transaction(() => {
        insertModel.run(
          input.profileId,
          modelId,
          input.displayLabel !== undefined ? input.displayLabel : (existing?.display_label ?? null),
          input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing?.enabled ?? 1),
          createdAt,
          now,
        );
        replaceCapabilities(input.profileId, modelId, input.capabilities);
      });
      tx();

      const loaded = load(input.profileId, modelId);
      if (!loaded) {
        throw new ProviderRegistryError('PROVIDER_UNKNOWN_ERROR', {
          message: 'Model upsert succeeded but row was not readable',
        });
      }
      return loaded;
    },

    get: load,

    listByProfile(profileId) {
      const rows = db
        .prepare(`
          SELECT * FROM inference_provider_models
          WHERE profile_id = ?
          ORDER BY model_id ASC
        `)
        .all(profileId) as ModelRow[];
      return rows.map((row) => load(row.profile_id, row.model_id)!);
    },

    setEnabled(profileId, modelId, enabled) {
      const result = updateEnabled.run(enabled ? 1 : 0, nowIso(), profileId, modelId);
      if (result.changes !== 1) {
        throw new ProviderRegistryError('PROVIDER_MODEL_NOT_FOUND');
      }
      return load(profileId, modelId)!;
    },

    setCapabilities(profileId, modelId, capabilities) {
      if (!selectModel.get(profileId, modelId)) {
        throw new ProviderRegistryError('PROVIDER_MODEL_NOT_FOUND');
      }
      const tx = db.transaction(() => {
        replaceCapabilities(profileId, modelId, capabilities);
        db.prepare(`
          UPDATE inference_provider_models SET updated_at = ? WHERE profile_id = ? AND model_id = ?
        `).run(nowIso(), profileId, modelId);
      });
      tx();
      return load(profileId, modelId)!;
    },
  };
}

export interface ProfileDefaultRecord {
  profileId: string;
  capability: ProviderCapability;
  modelId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InferenceProviderDefaultsRepository {
  setDefault(profileId: string, capability: ProviderCapability, modelId: string): ProfileDefaultRecord;
  getDefault(profileId: string, capability: ProviderCapability): ProfileDefaultRecord | null;
  listByProfile(profileId: string): ProfileDefaultRecord[];
}

export function createDefaultsRepository(db: Database.Database): InferenceProviderDefaultsRepository {
  const select = db.prepare(`
    SELECT profile_id, capability, model_id, created_at, updated_at
    FROM inference_provider_profile_defaults
    WHERE profile_id = ? AND capability = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO inference_provider_profile_defaults (
      profile_id, capability, model_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, capability) DO UPDATE SET
      model_id = excluded.model_id,
      updated_at = excluded.updated_at
  `);

  function mapRow(row: {
    profile_id: string;
    capability: string;
    model_id: string;
    created_at: string;
    updated_at: string;
  }): ProfileDefaultRecord {
    if (!isProviderCapability(row.capability)) {
      throw new ProviderRegistryError('PROVIDER_CAPABILITY_UNSUPPORTED');
    }
    return {
      profileId: row.profile_id,
      capability: row.capability,
      modelId: row.model_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    setDefault(profileId, capability, modelId) {
      if (!isProviderCapability(capability)) {
        throw new ProviderRegistryError('PROVIDER_CAPABILITY_UNSUPPORTED');
      }
      const model = db
        .prepare(`
          SELECT 1 AS ok FROM inference_provider_models
          WHERE profile_id = ? AND model_id = ?
        `)
        .get(profileId, modelId) as { ok: number } | undefined;
      if (!model) {
        throw new ProviderRegistryError('PROVIDER_MODEL_NOT_FOUND');
      }
      assertModelSupportsCapability(db, profileId, modelId, capability);
      const existing = select.get(profileId, capability) as
        | { created_at: string }
        | undefined;
      const now = nowIso();
      upsert.run(profileId, capability, modelId, existing?.created_at ?? now, now);
      return mapRow(select.get(profileId, capability) as {
        profile_id: string;
        capability: string;
        model_id: string;
        created_at: string;
        updated_at: string;
      });
    },

    getDefault(profileId, capability) {
      const row = select.get(profileId, capability) as
        | {
            profile_id: string;
            capability: string;
            model_id: string;
            created_at: string;
            updated_at: string;
          }
        | undefined;
      return row ? mapRow(row) : null;
    },

    listByProfile(profileId) {
      const rows = db
        .prepare(`
          SELECT profile_id, capability, model_id, created_at, updated_at
          FROM inference_provider_profile_defaults
          WHERE profile_id = ?
          ORDER BY capability ASC
        `)
        .all(profileId) as Array<{
        profile_id: string;
        capability: string;
        model_id: string;
        created_at: string;
        updated_at: string;
      }>;
      return rows.map(mapRow);
    },
  };
}

export interface UpsertBindingInput {
  id?: string;
  consumerKey: ProviderConsumerKey;
  scopeKind?: BindingScopeKind;
  scopeId?: string;
  capability: ProviderCapability;
  profileId: string;
  modelId: string;
  enabled?: boolean;
  expectedVersion?: number;
}

export interface InferenceProviderBindingRepository {
  upsert(input: UpsertBindingInput): InferenceProviderBindingRecord;
  getById(id: string): InferenceProviderBindingRecord | null;
  getByConsumer(options: {
    consumerKey: ProviderConsumerKey;
    capability: ProviderCapability;
    scopeKind?: BindingScopeKind;
    scopeId?: string;
  }): InferenceProviderBindingRecord | null;
  list(options?: { consumerKey?: ProviderConsumerKey; profileId?: string }): InferenceProviderBindingRecord[];
  setEnabled(id: string, enabled: boolean, expectedVersion: number): InferenceProviderBindingRecord;
}

type BindingRow = {
  id: string;
  consumer_key: string;
  scope_kind: string;
  scope_id: string;
  capability: string;
  profile_id: string;
  model_id: string;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
};

function mapBindingRow(row: BindingRow): InferenceProviderBindingRecord {
  if (!isProviderCapability(row.capability)) {
    throw new ProviderRegistryError('PROVIDER_CAPABILITY_UNSUPPORTED');
  }
  return {
    id: row.id,
    consumerKey: row.consumer_key,
    scopeKind: row.scope_kind as BindingScopeKind,
    scopeId: row.scope_id,
    capability: row.capability,
    profileId: row.profile_id,
    modelId: row.model_id,
    enabled: asBool(row.enabled),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBindingRepository(db: Database.Database): InferenceProviderBindingRepository {
  const selectById = db.prepare(`SELECT * FROM inference_provider_bindings WHERE id = ?`);
  const selectByConsumer = db.prepare(`
    SELECT * FROM inference_provider_bindings
    WHERE consumer_key = ? AND scope_kind = ? AND scope_id = ? AND capability = ?
  `);
  const insert = db.prepare(`
    INSERT INTO inference_provider_bindings (
      id, consumer_key, scope_kind, scope_id, capability,
      profile_id, model_id, enabled, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE inference_provider_bindings SET
      profile_id = ?,
      model_id = ?,
      enabled = ?,
      version = version + 1,
      updated_at = ?
    WHERE id = ? AND version = ?
  `);

  return {
    upsert(input) {
      if (!isProviderCapability(input.capability)) {
        throw new ProviderRegistryError('PROVIDER_CAPABILITY_UNSUPPORTED');
      }
      if (!isProviderConsumerKey(input.consumerKey)) {
        throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
          message: `Unknown provider consumer key: ${String(input.consumerKey)}`,
        });
      }
      const scopeKind = input.scopeKind ?? 'global';
      const suppliedScopeId = input.scopeId?.trim() ?? '';
      if (scopeKind === 'global' && suppliedScopeId !== '') {
        throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
          message: 'global scope requires empty scopeId',
        });
      }
      const scopeId = scopeKind === 'global' ? '' : suppliedScopeId;
      if (scopeKind !== 'global' && !scopeId) {
        throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
          message: 'scoped bindings require scopeId',
        });
      }

      const model = db
        .prepare(`
          SELECT 1 AS ok FROM inference_provider_models
          WHERE profile_id = ? AND model_id = ?
        `)
        .get(input.profileId, input.modelId) as { ok: number } | undefined;
      if (!model) {
        throw new ProviderRegistryError('PROVIDER_MODEL_NOT_FOUND');
      }
      assertModelSupportsCapability(db, input.profileId, input.modelId, input.capability);

      const existing = selectByConsumer.get(
        input.consumerKey,
        scopeKind,
        scopeId,
        input.capability,
      ) as BindingRow | undefined;

      const now = nowIso();
      if (!existing) {
        const id = input.id?.trim() || newId('binding');
        insert.run(
          id,
          input.consumerKey,
          scopeKind,
          scopeId,
          input.capability,
          input.profileId,
          input.modelId,
          input.enabled === false ? 0 : 1,
          now,
          now,
        );
        return mapBindingRow(selectById.get(id) as BindingRow);
      }

      if (
        input.expectedVersion !== undefined &&
        existing.version !== input.expectedVersion
      ) {
        throw new ProviderRegistryError('PROVIDER_VERSION_CONFLICT');
      }

      const result = update.run(
        input.profileId,
        input.modelId,
        input.enabled === false ? 0 : input.enabled === true ? 1 : existing.enabled,
        now,
        existing.id,
        existing.version,
      );
      if (result.changes !== 1) {
        throw new ProviderRegistryError('PROVIDER_VERSION_CONFLICT');
      }
      return mapBindingRow(selectById.get(existing.id) as BindingRow);
    },

    getById(id) {
      const row = selectById.get(id) as BindingRow | undefined;
      return row ? mapBindingRow(row) : null;
    },

    getByConsumer(options) {
      const scopeKind = options.scopeKind ?? 'global';
      const scopeId = scopeKind === 'global' ? '' : (options.scopeId ?? '');
      const row = selectByConsumer.get(
        options.consumerKey,
        scopeKind,
        scopeId,
        options.capability,
      ) as BindingRow | undefined;
      return row ? mapBindingRow(row) : null;
    },

    list(options) {
      let rows: BindingRow[];
      if (options?.consumerKey) {
        rows = db
          .prepare(`
            SELECT * FROM inference_provider_bindings
            WHERE consumer_key = ?
            ORDER BY capability ASC
          `)
          .all(options.consumerKey) as BindingRow[];
      } else if (options?.profileId) {
        rows = db
          .prepare(`
            SELECT * FROM inference_provider_bindings
            WHERE profile_id = ?
            ORDER BY consumer_key ASC, capability ASC
          `)
          .all(options.profileId) as BindingRow[];
      } else {
        rows = db
          .prepare(`
            SELECT * FROM inference_provider_bindings
            ORDER BY consumer_key ASC, capability ASC
          `)
          .all() as BindingRow[];
      }
      return rows.map(mapBindingRow);
    },

    setEnabled(id, enabled, expectedVersion) {
      const existing = selectById.get(id) as BindingRow | undefined;
      if (!existing) {
        throw new ProviderRegistryError('PROVIDER_NOT_FOUND');
      }
      if (existing.version !== expectedVersion) {
        throw new ProviderRegistryError('PROVIDER_VERSION_CONFLICT');
      }
      const result = update.run(
        existing.profile_id,
        existing.model_id,
        enabled ? 1 : 0,
        nowIso(),
        id,
        expectedVersion,
      );
      if (result.changes !== 1) {
        throw new ProviderRegistryError('PROVIDER_VERSION_CONFLICT');
      }
      return mapBindingRow(selectById.get(id) as BindingRow);
    },
  };
}

export interface CreateHealthCheckInput {
  id?: string;
  profileId: string;
  modelId?: string | null;
  testKind: HealthTestKind;
  capability?: ProviderCapability | null;
  status?: Extract<HealthCheckStatus, 'queued' | 'running'>;
  initiatedBy?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
  startedAt?: string;
}

export interface CompleteHealthCheckInput {
  status: Extract<HealthCheckStatus, 'healthy' | 'unhealthy' | 'cancelled'>;
  errorCode?: ProviderErrorCode | null;
  safeMessage?: string | null;
  latencyMs?: number | null;
  details?: Record<string, unknown>;
  completedAt?: string;
}

export interface InferenceProviderHealthCheckRepository {
  create(input: CreateHealthCheckInput): InferenceProviderHealthCheckRecord;
  getById(id: string): InferenceProviderHealthCheckRecord | null;
  complete(id: string, input: CompleteHealthCheckInput): InferenceProviderHealthCheckRecord;
  listByProfile(
    profileId: string,
    options?: { limit?: number },
  ): InferenceProviderHealthCheckRecord[];
  latestForProfile(profileId: string): InferenceProviderHealthCheckRecord | null;
}

type HealthRow = {
  id: string;
  profile_id: string;
  model_id: string | null;
  test_kind: string;
  capability: string | null;
  status: string;
  error_code: string | null;
  safe_message: string | null;
  latency_ms: number | null;
  initiated_by: string | null;
  request_id: string | null;
  details_json: string;
  started_at: string;
  completed_at: string | null;
};

function mapHealthRow(row: HealthRow): InferenceProviderHealthCheckRecord {
  const capability =
    row.capability && isProviderCapability(row.capability) ? row.capability : null;
  const errorCode =
    row.error_code && isProviderErrorCode(row.error_code) ? row.error_code : null;
  return {
    id: row.id,
    profileId: row.profile_id,
    modelId: row.model_id,
    testKind: row.test_kind as HealthTestKind,
    capability,
    status: row.status as HealthCheckStatus,
    errorCode,
    safeMessage: row.safe_message,
    latencyMs: row.latency_ms,
    initiatedBy: row.initiated_by,
    requestId: row.request_id,
    details: parseJsonObject(row.details_json, 'details_json'),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function createHealthCheckRepository(
  db: Database.Database,
): InferenceProviderHealthCheckRepository {
  const selectById = db.prepare(`SELECT * FROM inference_provider_health_checks WHERE id = ?`);
  const insert = db.prepare(`
    INSERT INTO inference_provider_health_checks (
      id, profile_id, model_id, test_kind, capability, status,
      error_code, safe_message, latency_ms, initiated_by, request_id,
      details_json, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL)
  `);
  const completeStmt = db.prepare(`
    UPDATE inference_provider_health_checks SET
      status = ?,
      error_code = ?,
      safe_message = ?,
      latency_ms = ?,
      details_json = ?,
      completed_at = ?
    WHERE id = ? AND status IN ('queued', 'running')
  `);

  return {
    create(input) {
      const profile = db
        .prepare('SELECT id FROM inference_provider_profiles WHERE id = ?')
        .get(input.profileId) as { id: string } | undefined;
      if (!profile) {
        throw new ProviderRegistryError('PROVIDER_NOT_FOUND');
      }
      if (input.modelId) {
        const model = db
          .prepare(`
            SELECT 1 AS ok FROM inference_provider_models
            WHERE profile_id = ? AND model_id = ?
          `)
          .get(input.profileId, input.modelId) as { ok: number } | undefined;
        if (!model) {
          throw new ProviderRegistryError('PROVIDER_MODEL_NOT_FOUND');
        }
        if (input.capability) {
          assertModelSupportsCapability(db, input.profileId, input.modelId, input.capability);
        }
      }

      const id = input.id?.trim() || newId('health');
      const status = input.status ?? 'queued';
      insert.run(
        id,
        input.profileId,
        input.modelId ?? null,
        input.testKind,
        input.capability ?? null,
        status,
        input.initiatedBy ?? null,
        input.requestId ?? null,
        JSON.stringify(sanitizeHealthDetails(input.details ?? {})),
        input.startedAt ?? nowIso(),
      );
      return mapHealthRow(selectById.get(id) as HealthRow);
    },

    getById(id) {
      const row = selectById.get(id) as HealthRow | undefined;
      return row ? mapHealthRow(row) : null;
    },

    complete(id, input) {
      const existing = selectById.get(id) as HealthRow | undefined;
      if (!existing) {
        throw new ProviderRegistryError('PROVIDER_NOT_FOUND');
      }
      if (existing.status !== 'queued' && existing.status !== 'running') {
        throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
          message: 'Health check is already completed',
        });
      }
      const details =
        input.details !== undefined
          ? sanitizeHealthDetails(input.details)
          : parseJsonObject(existing.details_json, 'details_json');
      const result = completeStmt.run(
        input.status,
        input.errorCode ?? null,
        redactFreeformMessage(input.safeMessage),
        input.latencyMs ?? null,
        JSON.stringify(details),
        input.completedAt ?? nowIso(),
        id,
      );
      if (result.changes !== 1) {
        throw new ProviderRegistryError('PROVIDER_REQUEST_INVALID', {
          message: 'Health check could not be completed',
        });
      }
      return mapHealthRow(selectById.get(id) as HealthRow);
    },

    listByProfile(profileId, options) {
      const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
      const rows = db
        .prepare(`
          SELECT * FROM inference_provider_health_checks
          WHERE profile_id = ?
          ORDER BY started_at DESC
          LIMIT ?
        `)
        .all(profileId, limit) as HealthRow[];
      return rows.map(mapHealthRow);
    },

    latestForProfile(profileId) {
      const row = db
        .prepare(`
          SELECT * FROM inference_provider_health_checks
          WHERE profile_id = ?
          ORDER BY started_at DESC
          LIMIT 1
        `)
        .get(profileId) as HealthRow | undefined;
      return row ? mapHealthRow(row) : null;
    },
  };
}

const FORBIDDEN_DETAIL_KEYS = new Set([
  'apiKey',
  'api_key',
  'secret',
  'secretRef',
  'secret_ref',
  'authorization',
  'Authorization',
  'token',
  'password',
  'prompt',
  'responseBody',
  'response_body',
  'raw',
]);

export function sanitizeHealthDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeSecretValue(details) as Record<string, unknown>;
}
