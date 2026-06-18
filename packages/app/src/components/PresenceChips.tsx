import { useEffect, useMemo, useState } from 'react';
import type { DocumentPresenceRecord, DocumentPresenceStatus } from '../types/collaboration';

const ACTIVE_WINDOW_MS = 60_000;
const IDLE_WINDOW_MS = 5 * 60_000;

function normalizeActorId(value: string): string {
  return value.trim().toLowerCase();
}

function actorColorClass(actorId: string): string {
  switch (normalizeActorId(actorId)) {
    case 'assistant':
      return 'bg-purple-500';
    case 'human':
      return 'bg-white';
    default:
      return 'bg-gray-500';
  }
}

function statusDotClass(tone: DocumentPresenceStatus): string {
  switch (tone) {
    case 'active':
      return 'bg-green-400';
    case 'idle':
      return 'bg-yellow-400';
    default:
      return 'bg-gray-500';
  }
}

function statusRank(status: DocumentPresenceStatus): number {
  switch (status) {
    case 'active':
      return 0;
    case 'idle':
      return 1;
    default:
      return 2;
  }
}

function maxStatus(a: DocumentPresenceStatus, b: DocumentPresenceStatus): DocumentPresenceStatus {
  return statusRank(a) >= statusRank(b) ? a : b;
}

function resolveAgedStatus(lastActivityAt: string | null, nowMs: number): DocumentPresenceStatus {
  if (!lastActivityAt) {
    return 'disconnected';
  }

  const ts = Date.parse(lastActivityAt);
  if (!Number.isFinite(ts)) {
    return 'disconnected';
  }

  const ageMs = nowMs - ts;
  if (ageMs <= ACTIVE_WINDOW_MS) {
    return 'active';
  }
  if (ageMs <= IDLE_WINDOW_MS) {
    return 'idle';
  }
  return 'disconnected';
}

function resolvePresenceTone(presence: DocumentPresenceRecord, nowMs: number): DocumentPresenceStatus {
  const explicit = presence.status ?? 'active';
  const aged = resolveAgedStatus(presence.last_activity_at ?? null, nowMs);
  // Never show a "more active" state than the last-activity window would imply.
  // This preserves explicit disconnects while still aging active->idle->disconnected.
  return maxStatus(explicit, aged);
}

function msUntilNextToneChange(presence: DocumentPresenceRecord, nowMs: number): number | null {
  const lastActivity = Date.parse(presence.last_activity_at ?? '');
  if (!Number.isFinite(lastActivity)) {
    return null;
  }

  const currentTone = resolvePresenceTone(presence, nowMs);
  const boundaries = [lastActivity + ACTIVE_WINDOW_MS, lastActivity + IDLE_WINDOW_MS].filter((t) => t > nowMs);
  boundaries.sort((a, b) => a - b);

  for (const boundary of boundaries) {
    // Cross the boundary so the aged status actually updates.
    const nextTone = resolvePresenceTone(presence, boundary + 1);
    if (nextTone !== currentTone) {
      return Math.max(0, boundary + 1 - nowMs);
    }
  }

  return null;
}

function resolveTypingLabel(presence: DocumentPresenceRecord): string | null {
  const cursor = presence.cursor_json;
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    return null;
  }

  const record = cursor as Record<string, unknown>;
  const action = typeof record.action === 'string' ? record.action.trim().toLowerCase() : '';
  if (action === 'typing') {
    return 'typing';
  }
  return null;
}

function actorLabel(actorId: string): string {
  switch (normalizeActorId(actorId)) {
    case 'assistant':
      return 'Assistant';
    case 'human':
      return 'Human';
    default:
      return actorId;
  }
}

export function PresenceChips({
  presence,
  onSelectActor,
  selectedActorId,
}: {
  presence: readonly DocumentPresenceRecord[];
  selectedActorId: string | null;
  onSelectActor: (actorId: string) => void;
}) {
  // Force periodic re-render at the precise moment a presence state should age.
  // Without this, `Date.now()`-based rendering won't transition unless another app state changes.
  const [ageTick, setAgeTick] = useState(0);
  const sorted = useMemo(() => {
    return [...presence].sort((a, b) => {
      const aId = normalizeActorId(a.agent_id);
      const bId = normalizeActorId(b.agent_id);
      if (aId === bId) return 0;
      if (aId === 'human') return -1;
      if (bId === 'human') return 1;
      return aId.localeCompare(bId);
    });
  }, [presence]);

  useEffect(() => {
    const nowMs = Date.now();
    let soonest: number | null = null;

    for (const entry of sorted) {
      const nextMs = msUntilNextToneChange(entry, nowMs);
      if (nextMs === null) {
        continue;
      }
      soonest = soonest === null ? nextMs : Math.min(soonest, nextMs);
    }

    if (soonest === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => setAgeTick((value) => value + 1), Math.max(250, soonest));
    return () => window.clearTimeout(timeoutId);
  }, [ageTick, sorted]);

  const nowMs = Date.now();
  const visible = sorted.filter((entry) => resolvePresenceTone(entry, nowMs) !== 'disconnected');

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5">
      {visible.map((entry) => {
        const tone = resolvePresenceTone(entry, nowMs);
        const typing = resolveTypingLabel(entry);
        const actorId = normalizeActorId(entry.agent_id);
        const active = selectedActorId && normalizeActorId(selectedActorId) === actorId;
        const dimmed = tone === 'idle';
        const title = `${actorLabel(actorId)} · ${tone}${typing ? ` · ${typing}` : ''}`;

        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelectActor(actorId)}
            className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
              active ? 'border-[var(--accent)] bg-[var(--bg-tertiary)]' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)]'
            } ${dimmed ? 'opacity-50' : ''}`}
            aria-label={title}
            title={title}
          >
            <span className={`h-4 w-4 rounded-full ${actorColorClass(actorId)}`} aria-hidden="true" />
            <span
              className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-[var(--bg-primary)] ${statusDotClass(
                tone
              )}`}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
