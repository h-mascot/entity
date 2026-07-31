/**
 * THE-879 / WP2-A-04 — Copyable invite prompt + setup/manifest/bundle/skill/progress URLs.
 *
 * Builds absolute URL bundles and the full agent invite prompt from an
 * InviteKitPreview-shaped kit (THE-878). Durable invite HTTP remains WP2-A-05;
 * this module only shapes copyable text from already-minted (including
 * local_preview) kits. Kept free of local package imports so node:test can load
 * it under --experimental-strip-types without Vite path rewriting.
 */

export const INVITE_URL_KEYS = [
  'setup',
  'manifest',
  'bundle',
  'skill',
  'progress',
] as const;

export type InviteUrlKey = (typeof INVITE_URL_KEYS)[number];

export type InviteUrlBundle = Record<InviteUrlKey, string>;

export type InvitePromptCopyTarget = 'prompt' | InviteUrlKey;

export type InvitePromptCopyState = {
  lastCopied: InvitePromptCopyTarget | null;
  error: string | null;
};

/** Structural invite fields required for prompt/URL shaping (THE-878 preview). */
export type InvitePromptSource = {
  id: string;
  status: string;
  agentName: string;
  role: string;
  creationSource: string;
  expiresAt: string;
  selectedModules: string[];
  permissionsScope: string[];
  safeStopConditions: string[];
  projectId: string | null;
  workplaneId: string | null;
  taskId: number | null;
  setupPath: string;
  manifestPath: string;
  bundlePath: string;
  skillPath: string;
  progressPath: string;
  persistence: string;
};

export type InvitePromptBuildInput = {
  invite: InvitePromptSource;
  /** Origin used to absolutize relative paths (e.g. window.location.origin). */
  origin: string;
  /** Optional workspace display name; falls back to a generic label. */
  workspaceName?: string;
  /** Chief routing disclosure for slice-2 readiness (default disabled). */
  chiefRouting?: 'disabled' | 'chief' | 'worker';
  /** Optional display label for role (defaults to raw role id). */
  roleDisplay?: string;
};

export type InvitePromptBuildResult =
  | {
      ok: true;
      urls: InviteUrlBundle;
      prompt: string;
      degraded: false;
      warnings: string[];
    }
  | {
      ok: false;
      urls: Partial<InviteUrlBundle>;
      prompt: string;
      degraded: true;
      error: string;
      warnings: string[];
    };

const URL_LABELS: Record<InviteUrlKey, string> = {
  setup: 'Setup URL',
  manifest: 'Manifest URL',
  bundle: 'Bundle URL',
  skill: 'Skill/Context URL',
  progress: 'Progress URL',
};

export function createInitialCopyState(): InvitePromptCopyState {
  return { lastCopied: null, error: null };
}

/** Absolutize a path-or-URL against origin. Empty input → empty string. */
export function absolutizeInviteUrl(pathOrUrl: string, origin: string): string {
  const trimmed = (pathOrUrl ?? '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = (origin ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
  try {
    return new URL(trimmed, `${base}/`).toString();
  } catch {
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${base}${path}`;
  }
}

export function extractInviteToken(invite: Pick<InvitePromptSource, 'setupPath' | 'id'>): string | null {
  const fromSetup = invite.setupPath?.match(/\/onboard\/agent\/([^/?#]+)/i);
  if (fromSetup?.[1]) return decodeURIComponent(fromSetup[1]);
  const fromId = invite.id?.match(/^local-preview-(.+)$/i);
  if (fromId?.[1]) return fromId[1];
  return null;
}

export function buildInviteUrlBundle(
  invite: Pick<
    InvitePromptSource,
    'setupPath' | 'manifestPath' | 'bundlePath' | 'skillPath' | 'progressPath'
  >,
  origin: string,
): InviteUrlBundle {
  return {
    setup: absolutizeInviteUrl(invite.setupPath, origin),
    manifest: absolutizeInviteUrl(invite.manifestPath, origin),
    bundle: absolutizeInviteUrl(invite.bundlePath, origin),
    skill: absolutizeInviteUrl(invite.skillPath, origin),
    progress: absolutizeInviteUrl(invite.progressPath, origin),
  };
}

function bulletList(items: string[], emptyFallback: string): string[] {
  if (!items.length) return [`- ${emptyFallback}`];
  return items.map((item) => `- ${item}`);
}

function formatChiefRouting(mode: 'disabled' | 'chief' | 'worker'): string {
  switch (mode) {
    case 'chief':
      return 'chief';
    case 'worker':
      return 'worker';
    default:
      return 'disabled';
  }
}

/**
 * Validate that every invite URL path is present before claiming a complete kit.
 * Missing/blank paths are visible degraded state — never silently coerced.
 */
export function validateInviteUrlPaths(
  invite: Pick<
    InvitePromptSource,
    'setupPath' | 'manifestPath' | 'bundlePath' | 'skillPath' | 'progressPath'
  >,
): { ok: true } | { ok: false; error: string; missing: InviteUrlKey[] } {
  const missing: InviteUrlKey[] = [];
  if (!invite.setupPath?.trim()) missing.push('setup');
  if (!invite.manifestPath?.trim()) missing.push('manifest');
  if (!invite.bundlePath?.trim()) missing.push('bundle');
  if (!invite.skillPath?.trim()) missing.push('skill');
  if (!invite.progressPath?.trim()) missing.push('progress');
  if (missing.length) {
    return {
      ok: false,
      error: `Invite URL bundle incomplete — missing: ${missing.join(', ')}.`,
      missing,
    };
  }
  return { ok: true };
}

export function buildInvitePromptText(input: InvitePromptBuildInput): string {
  const { invite, origin } = input;
  const urls = buildInviteUrlBundle(invite, origin);
  const workspace = (input.workspaceName ?? '').trim() || 'Entity workspace';
  const project = invite.projectId?.trim() || '(none selected)';
  const workplaneTask =
    invite.workplaneId || invite.taskId != null
      ? [invite.workplaneId, invite.taskId != null ? `task ${invite.taskId}` : null]
          .filter(Boolean)
          .join(' / ')
      : '(none)';
  const chiefRouting = formatChiefRouting(input.chiefRouting ?? 'disabled');
  const roleDisplay = (input.roleDisplay ?? invite.role).trim() || invite.role;
  const modules = bulletList(invite.selectedModules, 'Default invite bundle');
  const installOrder = bulletList(invite.selectedModules, 'Default invite bundle');
  const permissions = bulletList(invite.permissionsScope, 'workspace_read');
  const safeStops = bulletList(
    invite.safeStopConditions,
    'Stop if verification fails or the manifest changes unexpectedly.',
  );

  return [
    `You are being invited to join Entity as ${invite.agentName}/${invite.role}.`,
    '',
    'Session',
    `- ${URL_LABELS.setup}: ${urls.setup}`,
    `- ${URL_LABELS.manifest}: ${urls.manifest}`,
    `- ${URL_LABELS.bundle}: ${urls.bundle}`,
    `- ${URL_LABELS.skill}: ${urls.skill}`,
    `- ${URL_LABELS.progress}: ${urls.progress}`,
    `- Expires: ${invite.expiresAt}`,
    '',
    'Target',
    `- Workspace: ${workspace}`,
    `- Work domain/project: ${project}`,
    `- Workplane/task: ${workplaneTask}`,
    `- Role: ${roleDisplay}`,
    `- Chief routing: ${chiefRouting}`,
    '',
    'Allowed modules',
    ...modules,
    '',
    'Install order',
    ...installOrder,
    '',
    'Permissions',
    ...permissions,
    '',
    'Safe stop conditions',
    ...safeStops,
    '',
    'Instructions',
    '1. Open setup URL or fetch manifest.',
    '2. Treat manifest as source of truth.',
    '3. Install only listed modules.',
    '4. Report progress after every meaningful step.',
    '5. Verify required modules.',
    '6. Return final setup receipt.',
    '',
    'Guardrails',
    '- Do not commit or print the raw token except where a setup command requires it.',
    '- Stop if manifest token is invalid/expired/revoked.',
    '- Stop if requested permissions exceed manifest scope.',
    '- Do not overwrite secrets, DB files, user files, or production runtime unless manifest explicitly allows it.',
    '',
    `Invite status: ${invite.status}`,
    `Creation source: ${invite.creationSource}`,
    `Persistence: ${invite.persistence}`,
  ].join('\n');
}

export function buildInvitePrompt(input: InvitePromptBuildInput): InvitePromptBuildResult {
  const warnings: string[] = [];
  if (!input.origin?.trim()) {
    warnings.push('Origin missing — URLs may remain relative until an origin is available.');
  }
  if (input.invite.persistence === 'local_preview_not_durable') {
    warnings.push(
      'Local preview kit — not durable. Prefer Agents → Add Agent durable create when the API is available.',
    );
  }
  if (input.invite.persistence === 'durable') {
    warnings.push(
      'Raw invite token is show-once (create/regenerate only). Copy URLs now; GET will not re-emit the token.',
    );
  }

  const pathCheck = validateInviteUrlPaths(input.invite);
  const urls = buildInviteUrlBundle(input.invite, input.origin);
  const prompt = pathCheck.ok
    ? buildInvitePromptText(input)
    : [
        'Invite prompt unavailable — URL bundle incomplete.',
        pathCheck.error,
        '',
        'Partial paths:',
        ...INVITE_URL_KEYS.map((key) => `- ${URL_LABELS[key]}: ${urls[key] || '(missing)'}`),
      ].join('\n');

  if (!pathCheck.ok) {
    return {
      ok: false,
      urls,
      prompt,
      degraded: true,
      error: pathCheck.error,
      warnings,
    };
  }

  return {
    ok: true,
    urls,
    prompt,
    degraded: false,
    warnings,
  };
}

export function inviteUrlLabel(key: InviteUrlKey): string {
  return URL_LABELS[key];
}

export type ClipboardWriter = (text: string) => Promise<void>;

export async function copyInviteText(
  text: string,
  target: InvitePromptCopyTarget,
  write: ClipboardWriter = defaultClipboardWrite,
): Promise<InvitePromptCopyState> {
  const value = (text ?? '').trim();
  if (!value) {
    return {
      lastCopied: null,
      error: `Nothing to copy for ${target}.`,
    };
  }
  try {
    await write(value);
    return { lastCopied: target, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Clipboard write failed';
    return { lastCopied: null, error: message };
  }
}

async function defaultClipboardWrite(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard API unavailable.');
  }
  await navigator.clipboard.writeText(text);
}

/** Resolve which text to copy for a given target from a successful build. */
export function textForCopyTarget(
  build: InvitePromptBuildResult,
  target: InvitePromptCopyTarget,
): string {
  if (target === 'prompt') return build.prompt;
  return build.urls[target] ?? '';
}
