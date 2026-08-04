/**
 * EEPC-A-04 — Swarm provider adapter against the execution-engine contract.
 *
 * Bridges legacy SwarmProvider seams to EEPC-A-02 manifests + EEPC-A-03
 * callback payload shapes without wiring production OAuth/secrets.
 */

import type { ExecutionEnginePluginManifest } from '../manifest/types';
import type { SwarmJobStatus } from '../types';
import type {
  ExecutionCallbackPayload,
  ExecutionCallbackProofBody,
  ExecutionCallbackStatusBody,
} from '../callback-intake/types';
import type {
  BuildJobPayload,
  DispatchResult,
  ProofBundle,
  ProviderHealth,
  RunState,
  RunStatus,
  SwarmProvider,
  SwarmProviderMetadata,
} from './interface';

const SECRET_VALUE_RE =
  /^(Bearer\s+)?[A-Za-z0-9_\-]{32,}$|api[_-]?key\s*=|token\s*=|sk-[A-Za-z0-9]{10,}/i;
const URL_RE = /https?:\/\/[^\s)'"]+/gi;
const PATH_RE = /(?:^|[\s"'=(])(\/(?:Users|home|var|tmp|opt|etc|private)\/[^\s'")]+)/gi;

export type AdapterBindIssue = {
  path: string;
  code: string;
  message: string;
};

export type AdapterBindResult =
  | { ok: true; adapter: SwarmContractAdapter; issues: [] }
  | { ok: false; adapter?: undefined; issues: AdapterBindIssue[] };

export type StatusCallbackMapResult =
  | { ok: true; payload: ExecutionCallbackPayload }
  | { ok: false; code: string; message: string };

export type ProofCallbackMapResult =
  | { ok: true; payload: ExecutionCallbackPayload }
  | { ok: false; code: string; message: string };

export interface SwarmContractAdapter extends SwarmProvider {
  readonly manifest: ExecutionEnginePluginManifest;
  readonly engineId: string;
  readonly inner: SwarmProvider;
  /** Preferred Swarm job status after a successful dispatch per manifest. */
  afterDispatchStatus(): SwarmJobStatus | undefined;
  /** Map provider RunState → Swarm job status using manifest.statusMapping. */
  mapRunStateToJobStatus(state: RunState): SwarmJobStatus | undefined;
  /** Public-safe health projection (EEPC-B-01 precursor). */
  projectPublicHealth(health?: ProviderHealth): Promise<ProviderHealth>;
  /** Map a provider status snapshot into an EEPC-A-03 status callback payload. */
  toStatusCallbackPayload(input: {
    jobId: string;
    runStatus: RunStatus;
    summary?: string;
    occurredAt?: string;
  }): StatusCallbackMapResult;
  /** Map a proof bundle into an EEPC-A-03 proof callback payload. */
  toProofCallbackPayload(input: {
    jobId: string;
    proof: ProofBundle;
    summary?: string;
    occurredAt?: string;
  }): ProofCallbackMapResult;
}

function issue(path: string, code: string, message: string): AdapterBindIssue {
  return { path, code, message };
}

function lifecycleCapabilities(manifest: ExecutionEnginePluginManifest): string[] {
  return Object.entries(manifest.lifecycle)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .sort();
}

function metaFromManifest(manifest: ExecutionEnginePluginManifest): SwarmProviderMetadata {
  const mode = manifest.execution.mode;
  return {
    category: manifest.identity.category,
    ...(mode === 'push' || mode === 'pull' || mode === 'hybrid'
      ? { executionMode: mode }
      : {}),
    acceptsDispatch: manifest.execution.acceptsDispatch,
    description: manifest.identity.description,
    capabilities: lifecycleCapabilities(manifest),
  };
}

export function redactPublicHealthMessage(
  message: string,
  manifest: ExecutionEnginePluginManifest,
): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  // Entire message is secret-shaped — refuse wholesale before partial rewrite.
  if (SECRET_VALUE_RE.test(trimmed)) {
    return '[redacted]';
  }

  let out = message;
  if (!manifest.health.allowUrlsInPublicMessage) {
    out = out.replace(URL_RE, '[redacted-url]');
  }
  if (!manifest.health.allowPathsInPublicMessage) {
    out = out.replace(PATH_RE, (match, pathPart: string) =>
      match.replace(pathPart, '[redacted-path]'),
    );
  }
  // Never echo bearer/long opaque tokens on public surfaces.
  out = out.replace(/\bBearer\s+[A-Za-z0-9_\-.+/=]{8,}/gi, 'Bearer [redacted]');
  out = out.replace(/\bsk-[A-Za-z0-9]{10,}\b/g, '[redacted-secret]');
  return out;
}

export function projectProviderHealth(
  health: ProviderHealth,
  manifest: ExecutionEnginePluginManifest,
): ProviderHealth {
  const publicFields = new Set(manifest.health.publicFields);
  const projected: ProviderHealth = {
    available: publicFields.has('available') ? Boolean(health.available) : false,
  };

  if (publicFields.has('latencyMs') && typeof health.latencyMs === 'number') {
    projected.latencyMs = health.latencyMs;
  }

  if (publicFields.has('message') && typeof health.message === 'string' && health.message.trim()) {
    projected.message = redactPublicHealthMessage(health.message, manifest);
  }

  return projected;
}

function isPublicArtifactRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (SECRET_VALUE_RE.test(trimmed)) return false;
  // Absolute local paths and file:// URIs are not public-safe proof refs.
  if (trimmed.startsWith('file:')) return false;
  if (trimmed.startsWith('/') || /^[A-Za-z]:\\/.test(trimmed)) return false;
  return true;
}

/**
 * Bind a concrete SwarmProvider to a validated EEPC-A-02 manifest.
 * Fail-closed on identity mismatch or missing required contract fields.
 */
export function createSwarmContractAdapter(
  inner: SwarmProvider,
  manifest: ExecutionEnginePluginManifest | null | undefined,
): AdapterBindResult {
  if (!manifest || typeof manifest !== 'object') {
    return {
      ok: false,
      issues: [issue('manifest', 'manifest_missing', 'Validated execution-engine manifest is required')],
    };
  }

  if (manifest.kind !== 'execution-engine') {
    return {
      ok: false,
      issues: [
        issue('manifest.kind', 'manifest_kind_invalid', 'Manifest kind must be execution-engine'),
      ],
    };
  }

  if (!manifest.identity?.name?.trim()) {
    return {
      ok: false,
      issues: [issue('identity.name', 'identity_name_missing', 'Manifest identity.name is required')],
    };
  }

  if (inner.name !== manifest.identity.name) {
    return {
      ok: false,
      issues: [
        issue(
          'identity.name',
          'provider_manifest_mismatch',
          `Provider name "${inner.name}" does not match manifest identity.name "${manifest.identity.name}"`,
        ),
      ],
    };
  }

  const meta = metaFromManifest(manifest);

  const adapter: SwarmContractAdapter = {
    name: manifest.identity.name,
    label: manifest.identity.label || inner.label,
    meta,
    manifest,
    engineId: manifest.identity.id,
    inner,

    afterDispatchStatus() {
      return manifest.statusMapping.afterDispatch;
    },

    mapRunStateToJobStatus(state: RunState) {
      return manifest.statusMapping.runStateToJobStatus[state];
    },

    async healthCheck() {
      // Legacy passthrough — public surfaces must use projectPublicHealth.
      return inner.healthCheck();
    },

    async projectPublicHealth(health?: ProviderHealth) {
      const raw = health ?? (await inner.healthCheck());
      return projectProviderHealth(raw, manifest);
    },

    async dispatch(job: BuildJobPayload): Promise<DispatchResult> {
      if (!manifest.execution.acceptsDispatch || !manifest.lifecycle.dispatch) {
        throw new Error(
          `Provider ${manifest.identity.name} refuses dispatch under execution-engine contract (acceptsDispatch=${manifest.execution.acceptsDispatch}, lifecycle.dispatch=${manifest.lifecycle.dispatch})`,
        );
      }
      const result = await inner.dispatch(job);
      if (!result || typeof result.runHandle !== 'string' || !result.runHandle.trim()) {
        throw new Error(
          `Provider ${manifest.identity.name} returned malformed dispatch result (missing runHandle)`,
        );
      }
      const jobStatus = result.jobStatus ?? manifest.statusMapping.afterDispatch;
      return jobStatus ? { ...result, jobStatus } : { ...result };
    },

    async status(runHandle: string): Promise<RunStatus> {
      if (!manifest.lifecycle.status) {
        throw new Error(
          `Provider ${manifest.identity.name} does not expose status under execution-engine contract`,
        );
      }
      return inner.status(runHandle);
    },

    async cancel(runHandle: string): Promise<void> {
      if (!manifest.lifecycle.cancel) {
        throw new Error(
          `Provider ${manifest.identity.name} does not expose cancel under execution-engine contract`,
        );
      }
      return inner.cancel(runHandle);
    },

    async collectProof(runHandle: string): Promise<ProofBundle> {
      if (!manifest.lifecycle.collectProof) {
        throw new Error(
          `Provider ${manifest.identity.name} does not expose collectProof under execution-engine contract`,
        );
      }
      const proof = await inner.collectProof(runHandle);
      return sanitizeProofBundle(proof);
    },

    toStatusCallbackPayload(input) {
      const mappedStatus = adapter.mapRunStateToJobStatus(input.runStatus.state);
      const summary =
        (input.summary && input.summary.trim()) ||
        input.runStatus.progress?.trim() ||
        `${manifest.identity.label} status: ${input.runStatus.state}`;

      if (SECRET_VALUE_RE.test(summary)) {
        return {
          ok: false,
          code: 'secret_value_leak',
          message: 'Status summary must not embed secret-like values',
        };
      }

      const statusBody: ExecutionCallbackStatusBody = {
        summary: redactPublicHealthMessage(summary, manifest),
        run_state: input.runStatus.state,
        ...(mappedStatus ? { status: mappedStatus } : {}),
      };

      const payload: ExecutionCallbackPayload = {
        event: 'status',
        provider: manifest.identity.name,
        jobId: input.jobId,
        occurredAt: input.occurredAt,
        status: statusBody,
      };
      return { ok: true, payload };
    },

    toProofCallbackPayload(input) {
      const summary =
        (input.summary && input.summary.trim()) ||
        (input.proof.commitSha
          ? `Proof collected (${input.proof.commitSha.slice(0, 12)})`
          : `${manifest.identity.label} proof collected`);

      if (SECRET_VALUE_RE.test(summary)) {
        return {
          ok: false,
          code: 'secret_value_leak',
          message: 'Proof summary must not embed secret-like values',
        };
      }

      const artifactRefs: string[] = [];
      if (Array.isArray(input.proof.screenshots)) {
        for (const shot of input.proof.screenshots) {
          if (typeof shot === 'string' && isPublicArtifactRef(shot)) {
            artifactRefs.push(shot.trim());
          }
        }
      }

      const proofBody: ExecutionCallbackProofBody = {
        summary,
        ...(input.proof.commitSha && !SECRET_VALUE_RE.test(input.proof.commitSha)
          ? { commit_sha: input.proof.commitSha }
          : {}),
        ...(input.proof.branch && !input.proof.branch.startsWith('/')
          ? { branch: input.proof.branch }
          : {}),
        ...(input.proof.testResult ? { test_result: input.proof.testResult } : {}),
        ...(artifactRefs.length ? { artifact_refs: artifactRefs } : {}),
      };

      // Fail closed if proof only carried private/local paths and no public fields remain.
      if (
        !proofBody.commit_sha &&
        !proofBody.branch &&
        !proofBody.test_result &&
        !(proofBody.artifact_refs && proofBody.artifact_refs.length) &&
        Array.isArray(input.proof.screenshots) &&
        input.proof.screenshots.length > 0
      ) {
        return {
          ok: false,
          code: 'proof_not_public_safe',
          message: 'Proof artifacts were not public-safe; refused to emit callback payload',
        };
      }

      const payload: ExecutionCallbackPayload = {
        event: 'proof',
        provider: manifest.identity.name,
        jobId: input.jobId,
        occurredAt: input.occurredAt,
        proof: proofBody,
      };
      return { ok: true, payload };
    },
  };

  return { ok: true, adapter, issues: [] };
}

function sanitizeProofBundle(proof: ProofBundle): ProofBundle {
  const sanitized: ProofBundle = { ...proof };
  if (Array.isArray(proof.screenshots)) {
    sanitized.screenshots = proof.screenshots.filter(
      (shot): shot is string => typeof shot === 'string' && isPublicArtifactRef(shot),
    );
  }
  if (proof.artifacts && typeof proof.artifacts === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(proof.artifacts)) {
      if (/(api[_-]?key|token|secret|password|authorization|bearer|credential)/i.test(key)) {
        continue;
      }
      if (typeof value === 'string' && SECRET_VALUE_RE.test(value.trim())) {
        continue;
      }
      next[key] = value;
    }
    sanitized.artifacts = next;
  }
  return sanitized;
}

/**
 * Parse helper that never throws — used by bootstrap fail-closed paths.
 */
export function tryCreateSwarmContractAdapter(
  inner: SwarmProvider,
  manifest: ExecutionEnginePluginManifest | null | undefined,
): SwarmContractAdapter | null {
  const result = createSwarmContractAdapter(inner, manifest);
  return result.ok ? result.adapter : null;
}
