import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityEntry } from './useActivityStream';

export interface WatchModeFollowEvent {
  entryId: string;
  agentName: string;
  agentEmoji: string;
  sourceId: string | null;
  orgId: string | null;
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
  currentFileOrgId?: string | null;
  fallbackOrgId?: string | null;
  onSwitchFile?: (filePath: string, event: WatchModeFollowEvent) => void;
}

export function resolveWatchModeOrgId(
  eventOrgId: string | null | undefined,
  fallbackOrgId: string | null | undefined,
): string | null {
  return eventOrgId?.trim() || fallbackOrgId?.trim() || null;
}

export function isWatchModeFileTargetCurrent(
  filePath: string,
  currentFile: string | null,
  sourceId: string | null,
  currentSourceId: string | null | undefined,
  eventOrgId: string | null | undefined,
  fallbackOrgId: string | null | undefined,
  currentFileOrgId: string | null | undefined,
): boolean {
  return filePath === currentFile &&
    (sourceId ?? null) === (currentSourceId ?? null) &&
    resolveWatchModeOrgId(eventOrgId, fallbackOrgId) === (currentFileOrgId ?? null);
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
      orgId: entry.orgId ?? null,
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
  currentFileOrgId,
  fallbackOrgId,
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

    const isSameTarget = isWatchModeFileTargetCurrent(
      latest.filePath,
      currentFile,
      latest.sourceId,
      currentSourceId,
      latest.orgId,
      fallbackOrgId,
      currentFileOrgId,
    );

    if (latest.filePath && !isSameTarget) {
      onSwitchFile(latest.filePath, latest);
    }
  }, [currentFile, currentFileOrgId, currentSourceId, enabled, fallbackOrgId, latest, onSwitchFile]);

  return { followEvent };
}
