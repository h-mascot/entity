/**
 * EEPC-A-02 — Zod shape + pure validateExecutionEngineManifest().
 *
 * Does not register providers or mutate Swarm runtime state.
 */

import { z } from 'zod';
import { SWARM_JOB_STATUSES } from '../types';
import {
  ACTIVITY_EVENT_KINDS,
  CALLBACK_EVENTS,
  CONFIG_SOURCES,
  EXECUTION_ENGINE_KIND,
  EXECUTION_ENGINE_MANIFEST_SCHEMA_VERSION,
  EXECUTION_MODES,
  LIFECYCLE_CAPABILITIES,
  PROVIDER_CATEGORIES,
  PUBLIC_HEALTH_FIELDS,
  type ExecutionEnginePluginManifest,
  type ManifestValidationIssue,
  type ManifestValidationResult,
} from './types';

const PROVIDER_NAME_RE = /^[a-z][a-z0-9_-]*$/;
const MANIFEST_ID_RE = /^[a-z][a-z0-9_.-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PATH_TEMPLATE_RE = /^\/api\/swarm\/[A-Za-z0-9_.:\-\/]+$/;

const SECRET_KEY_HINT_RE =
  /(api[_-]?key|token|secret|password|authorization|bearer|credential)/i;

const SECRET_VALUE_RE =
  /^(Bearer\s+)?[A-Za-z0-9_\-]{32,}$|api[_-]?key\s*=|token\s*=|sk-[A-Za-z0-9]{10,}/i;

const LifecycleSchema = z.object({
  dispatch: z.boolean(),
  status: z.boolean(),
  cancel: z.boolean(),
  collectProof: z.boolean(),
  claimCallback: z.boolean(),
  releaseCallback: z.boolean(),
  proofCallback: z.boolean(),
  completeCallback: z.boolean(),
  failCallback: z.boolean(),
});

const CallbackIntakeSchema = z.object({
  event: z.enum(CALLBACK_EVENTS),
  method: z.literal('POST'),
  pathTemplate: z.string().regex(PATH_TEMPLATE_RE, 'pathTemplate must be under /api/swarm/'),
  activityEventKind: z.enum(ACTIVITY_EVENT_KINDS).optional(),
  authRequired: z.boolean(),
  idempotent: z.boolean(),
});

const StatusMappingSchema = z.object({
  afterDispatch: z.enum(SWARM_JOB_STATUSES).optional(),
  // Partial map: do not require every RunState key (Zod record+enum would).
  runStateToJobStatus: z
    .object({
      queued: z.enum(SWARM_JOB_STATUSES).optional(),
      running: z.enum(SWARM_JOB_STATUSES).optional(),
      completed: z.enum(SWARM_JOB_STATUSES).optional(),
      failed: z.enum(SWARM_JOB_STATUSES).optional(),
      cancelled: z.enum(SWARM_JOB_STATUSES).optional(),
    })
    .strict()
    .default({}),
});

const HealthSchema = z.object({
  publicFields: z.array(z.enum(PUBLIC_HEALTH_FIELDS)).min(1),
  privateFields: z.array(z.string().min(1)).default([]),
  allowUrlsInPublicMessage: z.boolean(),
  allowPathsInPublicMessage: z.boolean(),
});

const ConfigBindingSchema = z.object({
  key: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/, 'config key must be ENV_STYLE'),
  source: z.enum(CONFIG_SOURCES),
  required: z.boolean(),
  secret: z.boolean(),
  description: z.string().max(500).optional(),
});

const DangerousActionSchema = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().min(1),
  method: z.literal('POST'),
  pathTemplate: z.string().regex(PATH_TEMPLATE_RE),
  requiresExplicitAllow: z.literal(true),
  shells: z.boolean(),
  description: z.string().max(500).optional(),
});

export const ExecutionEnginePluginManifestSchema = z.object({
  schemaVersion: z.literal(EXECUTION_ENGINE_MANIFEST_SCHEMA_VERSION),
  kind: z.literal(EXECUTION_ENGINE_KIND),
  identity: z.object({
    id: z.string().min(1).regex(MANIFEST_ID_RE),
    name: z.string().min(1).regex(PROVIDER_NAME_RE),
    label: z.string().min(1).max(120),
    version: z.string().regex(SEMVER_RE, 'identity.version must be semver'),
    category: z.enum(PROVIDER_CATEGORIES),
    description: z.string().max(1000).optional(),
  }),
  execution: z.object({
    mode: z.enum(EXECUTION_MODES),
    acceptsDispatch: z.boolean(),
    entityPollsProvider: z.boolean(),
    expectsClaimCallbacks: z.boolean(),
  }),
  lifecycle: LifecycleSchema,
  callbacks: z.object({
    intake: z.array(CallbackIntakeSchema).default([]),
  }),
  statusMapping: StatusMappingSchema,
  health: HealthSchema,
  config: z.object({
    bindings: z.array(ConfigBindingSchema).default([]),
  }),
  dangerousActions: z.array(DangerousActionSchema).default([]),
  activityEvents: z.object({
    emits: z.array(z.enum(ACTIVITY_EVENT_KINDS)).default([]),
  }),
});

function issue(path: string, code: string, message: string): ManifestValidationIssue {
  return { path, code, message };
}

function collectSecretValueLeaks(
  value: unknown,
  trail: string,
  out: ManifestValidationIssue[],
): void {
  if (typeof value === 'string') {
    if (SECRET_VALUE_RE.test(value.trim())) {
      out.push(
        issue(trail, 'secret_value_leak', 'Manifest must not embed secret-like values'),
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectSecretValueLeaks(entry, `${trail}[${index}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_HINT_RE.test(key) && typeof child === 'string' && child.length > 0) {
        out.push(
          issue(
            `${trail}.${key}`,
            'secret_key_with_value',
            `Key "${key}" looks secret-bearing and must not carry a value in the manifest`,
          ),
        );
      }
      collectSecretValueLeaks(child, `${trail}.${key}`, out);
    }
  }
}

/** Cross-field rules grounded in EEPC-A-01 inventory. */
export function applyManifestSemantics(
  manifest: ExecutionEnginePluginManifest,
): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];
  const { execution, lifecycle, health, config, callbacks, dangerousActions, identity } =
    manifest;

  if (execution.mode === 'stub') {
    if (execution.acceptsDispatch) {
      issues.push(
        issue(
          'execution.acceptsDispatch',
          'stub_accepts_dispatch',
          'stub engines must set acceptsDispatch=false',
        ),
      );
    }
    if (lifecycle.dispatch) {
      issues.push(
        issue(
          'lifecycle.dispatch',
          'stub_lifecycle_dispatch',
          'stub engines must set lifecycle.dispatch=false',
        ),
      );
    }
  }

  if (execution.acceptsDispatch && !lifecycle.dispatch) {
    issues.push(
      issue(
        'lifecycle.dispatch',
        'accepts_dispatch_without_lifecycle',
        'acceptsDispatch=true requires lifecycle.dispatch=true',
      ),
    );
  }

  if (!execution.acceptsDispatch && lifecycle.dispatch) {
    issues.push(
      issue(
        'lifecycle.dispatch',
        'lifecycle_dispatch_without_accept',
        'lifecycle.dispatch=true requires acceptsDispatch=true',
      ),
    );
  }

  if (execution.mode === 'push' && !execution.entityPollsProvider) {
    issues.push(
      issue(
        'execution.entityPollsProvider',
        'push_requires_poll',
        'push engines must set entityPollsProvider=true',
      ),
    );
  }

  if (
    (execution.mode === 'pull' || execution.mode === 'hybrid') &&
    execution.acceptsDispatch &&
    !execution.expectsClaimCallbacks
  ) {
    issues.push(
      issue(
        'execution.expectsClaimCallbacks',
        'pull_hybrid_requires_claim',
        'pull/hybrid engines that accept dispatch must expect claim callbacks',
      ),
    );
  }

  if (execution.expectsClaimCallbacks && !lifecycle.claimCallback) {
    issues.push(
      issue(
        'lifecycle.claimCallback',
        'claim_expectation_without_capability',
        'expectsClaimCallbacks=true requires lifecycle.claimCallback=true',
      ),
    );
  }

  if (execution.expectsClaimCallbacks) {
    const hasClaim = callbacks.intake.some((entry) => entry.event === 'claim');
    if (!hasClaim) {
      issues.push(
        issue(
          'callbacks.intake',
          'missing_claim_mapping',
          'expectsClaimCallbacks=true requires a claim callback intake mapping',
        ),
      );
    }
  }

  for (const [index, entry] of callbacks.intake.entries()) {
    if (!entry.pathTemplate.includes(':id') && entry.event !== 'status') {
      // status may be engine-level; job callbacks should include :id
      if (['claim', 'release', 'proof', 'complete', 'fail'].includes(entry.event)) {
        issues.push(
          issue(
            `callbacks.intake[${index}].pathTemplate`,
            'missing_job_id_param',
            `Job callback "${entry.event}" pathTemplate must include :id`,
          ),
        );
      }
    }
  }

  for (const field of health.publicFields) {
    if (SECRET_KEY_HINT_RE.test(field)) {
      issues.push(
        issue(
          'health.publicFields',
          'secret_public_health_field',
          `Public health field "${field}" is secret-like and forbidden`,
        ),
      );
    }
  }

  for (const [index, privateField] of health.privateFields.entries()) {
    if (health.publicFields.includes(privateField as (typeof PUBLIC_HEALTH_FIELDS)[number])) {
      issues.push(
        issue(
          `health.privateFields[${index}]`,
          'private_overlaps_public',
          `Private field "${privateField}" cannot also be public`,
        ),
      );
    }
  }

  for (const [index, binding] of config.bindings.entries()) {
    if (SECRET_KEY_HINT_RE.test(binding.key) && !binding.secret) {
      issues.push(
        issue(
          `config.bindings[${index}].secret`,
          'secret_key_unclassified',
          `Config key "${binding.key}" looks secret-bearing and must set secret=true`,
        ),
      );
    }
  }

  for (const [index, action] of dangerousActions.entries()) {
    if (action.requiresExplicitAllow !== true) {
      issues.push(
        issue(
          `dangerousActions[${index}].requiresExplicitAllow`,
          'dangerous_allow_missing',
          'Dangerous actions must set requiresExplicitAllow=true',
        ),
      );
    }
    if (action.shells && !action.pathTemplate.includes('/control')) {
      issues.push(
        issue(
          `dangerousActions[${index}].pathTemplate`,
          'shell_action_path',
          'Shelling dangerous actions should use an explicit /control path',
        ),
      );
    }
  }

  // Identity.name should be the last segment of identity.id when namespaced.
  const idTail = identity.id.includes('.')
    ? identity.id.slice(identity.id.lastIndexOf('.') + 1)
    : identity.id;
  if (idTail !== identity.name) {
    issues.push(
      issue(
        'identity.id',
        'id_name_mismatch',
        `identity.id tail "${idTail}" must match identity.name "${identity.name}"`,
      ),
    );
  }

  // Ensure declared lifecycle keys stay complete (defensive against partial objects).
  for (const key of LIFECYCLE_CAPABILITIES) {
    if (typeof lifecycle[key] !== 'boolean') {
      issues.push(
        issue(`lifecycle.${key}`, 'lifecycle_incomplete', `Missing lifecycle capability "${key}"`),
      );
    }
  }

  collectSecretValueLeaks(manifest, 'manifest', issues);
  return issues;
}

export function validateExecutionEngineManifest(
  input: unknown,
): ManifestValidationResult {
  const parsed = ExecutionEnginePluginManifestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((zodIssue) =>
      issue(
        zodIssue.path.length ? zodIssue.path.join('.') : '(root)',
        'schema',
        zodIssue.message,
      ),
    );
    return { ok: false, issues };
  }

  const manifest = parsed.data as ExecutionEnginePluginManifest;
  const semanticIssues = applyManifestSemantics(manifest);
  if (semanticIssues.length > 0) {
    return { ok: false, issues: semanticIssues };
  }

  return { ok: true, manifest, issues: [] };
}

/** Convenience: throws with aggregated message (tests / future loaders). */
export function parseExecutionEngineManifest(
  input: unknown,
): ExecutionEnginePluginManifest {
  const result = validateExecutionEngineManifest(input);
  if (!result.ok) {
    const detail = result.issues
      .map((entry) => `${entry.path}: ${entry.message} (${entry.code})`)
      .join('; ');
    throw new Error(`Invalid execution-engine manifest: ${detail}`);
  }
  return result.manifest;
}
