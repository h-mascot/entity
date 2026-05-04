import type { SwarmJobStatus } from '../types';
import type { EforgeEvent } from './eforge-client';

export interface EforgeStageUpdate {
  status?: SwarmJobStatus;
  feedback?: string;
  commitSha?: string;
  timestamp?: string;
  proofReady?: boolean;
}

const EVENT_STATUS_MAP: Record<string, SwarmJobStatus> = {
  'queue:enqueue': 'dispatched',
  'session:start': 'running',
  'phase:compile_start': 'running',
  'phase:build_start': 'running',
  'build:review_start': 'proof',
  'build:evaluate_complete': 'review',
  'merge:complete': 'done',
  'session:complete': 'done',
  'session:failed': 'failed',
  'cleanup:complete': 'done',
};

function eventKey(event: EforgeEvent): string {
  const category = typeof event.category === 'string' ? event.category : undefined;
  const action = typeof event.action === 'string' ? event.action : undefined;
  if (category && action) return `${category}:${action}`;
  if (typeof event.type === 'string') return event.type;
  if (typeof event.name === 'string') return event.name;
  return '';
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

function findFirstMatching(value: unknown, predicate: (text: string) => boolean): string | undefined {
  return collectStrings(value).find(predicate);
}

function extractFeedback(event: EforgeEvent): string | undefined {
  const preferred = [
    event.message,
    event.text,
    event.data?.feedback,
    event.data?.message,
    event.data?.summary,
    event.data?.result,
    event.payload?.feedback,
    event.payload?.message,
    event.payload?.summary,
    event.meta?.message,
  ];

  for (const candidate of preferred) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  const found = findFirstMatching([event.data, event.payload, event.meta], (text) => text.length > 8);
  return found;
}

function extractCommitSha(event: EforgeEvent): string | undefined {
  const shaPattern = /\b[0-9a-f]{7,40}\b/i;
  const preferred = [
    event.data?.commitSha,
    event.data?.commit_sha,
    event.data?.sha,
    event.payload?.commitSha,
    event.payload?.commit_sha,
    event.payload?.sha,
    event.meta?.commitSha,
    event.meta?.commit_sha,
  ];

  for (const candidate of preferred) {
    if (typeof candidate === 'string' && shaPattern.test(candidate)) return candidate.match(shaPattern)?.[0];
  }

  return findFirstMatching([event.message, event.text, event.data, event.payload, event.meta], (text) => shaPattern.test(text))?.match(shaPattern)?.[0];
}

export function mapEforgeEvent(event: EforgeEvent): EforgeStageUpdate {
  const key = eventKey(event);
  const status = EVENT_STATUS_MAP[key];
  return {
    status,
    feedback: extractFeedback(event),
    commitSha: extractCommitSha(event),
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : typeof event.createdAt === 'string' ? event.createdAt : undefined,
    proofReady: key === 'build:review_start' || key === 'build:evaluate_complete' || key === 'merge:complete',
  };
}

export function deriveEforgeStage(events: EforgeEvent[]): EforgeStageUpdate {
  const aggregate: EforgeStageUpdate = {};

  for (const event of events) {
    const mapped = mapEforgeEvent(event);
    if (mapped.status) aggregate.status = mapped.status;
    if (mapped.feedback) aggregate.feedback = mapped.feedback;
    if (mapped.commitSha) aggregate.commitSha = mapped.commitSha;
    if (mapped.timestamp) aggregate.timestamp = mapped.timestamp;
    if (mapped.proofReady) aggregate.proofReady = true;
  }

  return aggregate;
}
