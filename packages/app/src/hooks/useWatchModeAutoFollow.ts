import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityEntry } from './useActivityStream';

export interface WatchModeFollowEvent {
  entryId: string;
  agentName: string;
  agentEmoji: string;
  sourceId: string | null;
  filePath: string;
  cursor: unknown | null;
  timestamp: string;
}

export interface UseWatchModeAutoFollowOptions {
  enabled: boolean;
  followedActorId: string | null;
  activities: ActivityEntry[];
  currentFile: string | null;
  currentSourceId?: string | null;
  onSwitchFile?: (filePath: string, event: WatchModeFollowEvent) => void;
}

function normalizeActorId(value: string): string {
  return value.trim().toLowerCase();
}

function extractSourceId(metadata: string | undefined): string | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const candidate =
      typeof parsed.sourceId === 'string'
        ? parsed.sourceId
        : typeof parsed.source_id === 'string'
          ? parsed.source_id
          : null;

    return candidate?.trim() ? candidate.trim() : null;
  } catch {
    return null;
  }
}

function resolveLatestFileEdit(
  activities: ActivityEntry[],
  followedActorId: string | null
): WatchModeFollowEvent | null {
  if (!followedActorId) {
    return null;
  }

  const target = normalizeActorId(followedActorId);

  for (const entry of activities) {
    if (!entry || entry.source !== 'agent') {
      continue;
    }
    if (entry.type !== 'file_edit') {
      continue;
    }
    if (!entry.filePath) {
      continue;
    }

    const actor = normalizeActorId(entry.agentName);
    if (actor !== target) {
      continue;
    }

    return {
      entryId: entry.id,
      agentName: entry.agentName,
      agentEmoji: entry.agentEmoji,
      sourceId: extractSourceId(entry.metadata),
      filePath: entry.filePath,
      cursor: entry.cursor ?? null,
      timestamp: entry.timestamp,
    };
  }

  return null;
}

export function useWatchModeAutoFollow({
  enabled,
  followedActorId,
  activities,
  currentFile,
  currentSourceId,
  onSwitchFile,
}: UseWatchModeAutoFollowOptions) {
  const [followEvent, setFollowEvent] = useState<WatchModeFollowEvent | null>(null);
  const lastProcessedEntryIdRef = useRef<string | null>(null);

  const latest = useMemo(
    () => resolveLatestFileEdit(activities, followedActorId),
    [activities, followedActorId]
  );

  useEffect(() => {
    if (!enabled) {
      setFollowEvent(null);
      lastProcessedEntryIdRef.current = null;
      return;
    }

    if (!latest) {
      setFollowEvent(null);
      return;
    }

    setFollowEvent(latest);

    if (!onSwitchFile) {
      return;
    }

    if (lastProcessedEntryIdRef.current === latest.entryId) {
      return;
    }
    lastProcessedEntryIdRef.current = latest.entryId;

    const isSameTarget = latest.filePath === currentFile && (latest.sourceId ?? null) === (currentSourceId ?? null);

    if (latest.filePath && !isSameTarget) {
      onSwitchFile(latest.filePath, latest);
    }
  }, [currentFile, currentSourceId, enabled, latest, onSwitchFile]);

  return { followEvent };
}

