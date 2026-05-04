import fs from 'fs/promises';
import path from 'path';
import { createSwarmProof, listSwarmJobs, listSwarmProofs, updateSwarmJob } from '../db';
import type { SwarmJob } from '../types';
import { getRuns, getSessionEvents, type EforgeEvent, type EforgeRun } from './eforge-client';
import { deriveEforgeStage } from './eforge-mapper';

let pollerTimer: NodeJS.Timeout | null = null;
let pollerRunning = false;
let lastSyncAt: string | null = null;
let lastSyncSummary = 'idle';

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getApiUrl(): string {
  return readEnv('EFORGE_API_URL') || 'http://localhost:4567';
}

function getPollIntervalMs(): number {
  const raw = Number(readEnv('EFORGE_POLL_INTERVAL_MS') || '15000');
  return Number.isFinite(raw) && raw > 0 ? raw : 15000;
}

function getQueueDir(): string | undefined {
  return readEnv('EFORGE_QUEUE_DIR');
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStrings(entry, out);
  }
  return out;
}

function getRunIdentifiers(run: EforgeRun): string[] {
  const values = collectStrings(run);
  const identifiers = new Set<string>();
  for (const value of values) {
    identifiers.add(value);
    identifiers.add(path.basename(value));
  }
  return [...identifiers];
}

async function readFrontmatter(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const separator = line.indexOf(':');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const rawValue = line.slice(separator + 1).trim();
      frontmatter[key] = rawValue.replace(/^"|"$/g, '');
    }
    return frontmatter;
  } catch {
    return {};
  }
}

async function getQueuedFileMap(queueDir: string | undefined): Promise<Map<string, string[]>> {
  const matches = new Map<string, string[]>();
  if (!queueDir) return matches;

  try {
    const entries = await fs.readdir(queueDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const fullPath = path.join(queueDir, entry.name);
      const frontmatter = await readFrontmatter(fullPath);
      const jobId = frontmatter.job_id;
      if (!jobId) continue;
      const values = matches.get(jobId) ?? [];
      values.push(fullPath, entry.name);
      matches.set(jobId, values);
    }
  } catch {
    return matches;
  }

  return matches;
}

function extractSessionId(run: EforgeRun): string | undefined {
  const sessionId = run.sessionId ?? run.session_id ?? run.session?.id ?? run.session?.sessionId;
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : undefined;
}

function extractRunId(run: EforgeRun): string | undefined {
  const runId = run.id ?? run.runId;
  return typeof runId === 'string' && runId.trim() ? runId : undefined;
}

function extractRunStatus(run: EforgeRun): string | undefined {
  const status = run.status ?? run.state ?? run.session?.status;
  return typeof status === 'string' ? status.toLowerCase() : undefined;
}

function fallbackStageFromRun(run: EforgeRun): { status?: SwarmJob['status']; feedback?: string } {
  const status = extractRunStatus(run);
  switch (status) {
    case 'queued':
    case 'pending':
      return { status: 'dispatched', feedback: `eforge ${status}` };
    case 'running':
    case 'active':
    case 'building':
      return { status: 'running', feedback: `eforge ${status}` };
    case 'review':
      return { status: 'review', feedback: 'eforge review complete' };
    case 'completed':
    case 'merged':
    case 'done':
      return { status: 'done', feedback: 'eforge completed' };
    case 'failed':
    case 'error':
      return { status: 'failed', feedback: 'eforge failed' };
    default:
      return {};
  }
}

function matchRunToJob(job: SwarmJob, run: EforgeRun, queueHints: string[]): boolean {
  const identifiers = getRunIdentifiers(run);
  if (identifiers.some((value) => value.includes(job.id) || value.includes(`eforge:${job.id}`))) {
    return true;
  }
  if (queueHints.some((hint) => identifiers.some((value) => value.includes(hint)))) {
    return true;
  }
  // Match by session ID stored in job feedback
  const sessionMatch = job.feedback?.match(/session[:\s]+([a-f0-9-]+)/i);
  if (sessionMatch && extractSessionId(run) === sessionMatch[1]) {
    return true;
  }
  // Match by planSet slug derived from job title
  const titleSlug = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const planSet = (run as any).planSet ?? (run as any).plan_set ?? "";
  if (planSet && titleSlug && (planSet.includes(titleSlug) || titleSlug.includes(planSet))) {
    return true;
  }
  return false;
}

function maybeCreateProof(jobId: string, run: EforgeRun, events: EforgeEvent[], commitSha?: string): void {
  if (listSwarmProofs(jobId).some((proof) => commitSha ? proof.commit_sha === commitSha : proof.build_log === 'eforge build proof')) {
    return;
  }

  const buildLog = events
    .map((event) => {
      const key = [event.category, event.action].filter(Boolean).join(':') || event.type || event.name || 'event';
      const summary = typeof event.data?.summary === 'string' ? event.data.summary : undefined;
      const message = [event.message, event.text, summary]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' - ');
      return message ? `${key} ${message}` : key;
    })
    .slice(-10)
    .join('\n');

  const started = typeof run.startedAt === 'string' ? Date.parse(run.startedAt) : NaN;
  const finished = typeof run.finishedAt === 'string' ? Date.parse(run.finishedAt) : NaN;
  const durationSec = Number.isFinite(started) && Number.isFinite(finished) && finished >= started
    ? Math.round((finished - started) / 1000)
    : undefined;

  createSwarmProof({
    job_id: jobId,
    provider: 'eforge',
    commit_sha: commitSha,
    branch: typeof run['branch'] === 'string' ? run['branch'] : undefined,
    build_log: buildLog || 'eforge build proof',
    artifacts: {
      runId: extractRunId(run) || null,
      sessionId: extractSessionId(run) || null,
      status: extractRunStatus(run) || null,
    },
    duration_sec: durationSec,
  });
}

async function syncRunToJob(job: SwarmJob, run: EforgeRun): Promise<boolean> {
  const sessionId = extractSessionId(run);
  const events = sessionId ? await getSessionEvents(getApiUrl(), sessionId) : [];
  const fallback = fallbackStageFromRun(run);
  const mapped = events.length > 0 ? deriveEforgeStage(events) : {};
  const nextStatus = mapped.status ?? fallback.status;
  const feedback = mapped.feedback ?? fallback.feedback ?? job.feedback ?? undefined;

  const updates: Record<string, unknown> = {};
  if (nextStatus && nextStatus !== job.status) {
    updates.status = nextStatus;
    if (nextStatus === 'done' || nextStatus === 'failed') {
      updates.completed_at = mapped.timestamp || new Date().toISOString();
    }
  }
  if (feedback && feedback !== job.feedback) {
    updates.feedback = feedback;
  }
  const runHandle = `eforge:${job.id}`;
  if (job.run_handle !== runHandle) {
    updates.run_handle = runHandle;
  }
  if (Object.keys(updates).length > 0) {
    updateSwarmJob(job.id, updates);
  }

  if ((mapped.proofReady || nextStatus === 'review' || nextStatus === 'done') && (events.length > 0 || mapped.commitSha)) {
    maybeCreateProof(job.id, run, events, mapped.commitSha);
  }

  return Object.keys(updates).length > 0;
}

export async function syncEforgeRuns(): Promise<{ matched: number; updated: number; runs: number }> {
  const jobs = listSwarmJobs().filter((job) => job.provider === 'eforge' && ['queued', 'dispatched', 'running', 'proof', 'review'].includes(job.status));
  const queueMap = await getQueuedFileMap(getQueueDir());
  const runs = await getRuns(getApiUrl());

  let matched = 0;
  let updated = 0;

  for (const job of jobs) {
    const queueHints = queueMap.get(job.id) ?? [];
    const run = runs.find((candidate) => matchRunToJob(job, candidate, queueHints));
    if (!run) continue;
    matched += 1;
    if (await syncRunToJob(job, run)) updated += 1;
  }

  lastSyncAt = new Date().toISOString();
  lastSyncSummary = `runs=${runs.length} matched=${matched} updated=${updated}`;
  return { matched, updated, runs: runs.length };
}

async function pollLoop(): Promise<void> {
  if (pollerRunning) return;
  pollerRunning = true;
  try {
    await syncEforgeRuns();
  } catch (error) {
    lastSyncAt = new Date().toISOString();
    lastSyncSummary = `error=${error instanceof Error ? error.message : 'unknown'}`;
    console.warn('[swarm][eforge] poller sync failed:', error);
  } finally {
    pollerRunning = false;
  }
}

export function startEforgePoller(): void {
  if (pollerTimer || !readEnv('EFORGE_API_URL')) return;
  pollerTimer = setInterval(() => {
    void pollLoop();
  }, getPollIntervalMs());
  void pollLoop();
}

export function stopEforgePoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}

export function getEforgePollerStatus(): { running: boolean; intervalMs: number; apiUrl: string; lastSyncAt: string | null; lastSyncSummary: string } {
  return {
    running: Boolean(pollerTimer),
    intervalMs: getPollIntervalMs(),
    apiUrl: getApiUrl(),
    lastSyncAt,
    lastSyncSummary,
  };
}
