import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { buildApiCandidates, requestJsonWithFallback } from '../lib/http';

const DEFAULT_API_BASE = '';
const DEFAULT_POLL_INTERVAL_MS = 8000;
const STORAGE_KEY = 'entity.sync-status.v1';

export type SyncStatus = 'online' | 'offline';
type DbMode = 'LOCAL' | 'CLOUD';

interface PersistedSyncStatus {
  status: SyncStatus;
  mode: DbMode;
  cloudConfigured: boolean;
  lastChecked: string | null;
}

interface SyncStatusStore extends PersistedSyncStatus {
  setSnapshot: (snapshot: PersistedSyncStatus) => void;
}

interface DbModeResponse {
  mode: DbMode;
  cloudConfigured: boolean;
}

interface UseSyncStatusOptions {
  apiBase?: string;
  pollIntervalMs?: number;
}

const DEFAULT_SYNC_STATUS: PersistedSyncStatus = {
  status: 'offline',
  mode: 'LOCAL',
  cloudConfigured: false,
  lastChecked: null,
};

function normalizeDbMode(value: unknown): DbMode {
  return value === 'CLOUD' ? 'CLOUD' : 'LOCAL';
}

function normalizePersisted(value: unknown): PersistedSyncStatus | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    status: record.status === 'online' ? 'online' : 'offline',
    mode: normalizeDbMode(record.mode),
    cloudConfigured: record.cloudConfigured === true,
    lastChecked: typeof record.lastChecked === 'string' ? record.lastChecked : null,
  };
}

function readPersistedSyncStatus(): PersistedSyncStatus | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return normalizePersisted(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writePersistedSyncStatus(snapshot: PersistedSyncStatus) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function syncStatusLabel(status: SyncStatus): string {
  return status === 'online' ? 'Online • Cloud synced' : 'Offline • Local only';
}

function resolveSyncStatus(mode: DbMode, cloudConfigured: boolean, browserOnline: boolean): SyncStatus {
  if (!browserOnline) {
    return 'offline';
  }

  if (mode === 'CLOUD' && cloudConfigured) {
    return 'online';
  }

  return 'offline';
}

function parseDbModeResponse(payload: unknown): DbModeResponse {
  if (!payload || typeof payload !== 'object') {
    return { mode: 'LOCAL', cloudConfigured: false };
  }

  const record = payload as Record<string, unknown>;
  return {
    mode: normalizeDbMode(record.mode),
    cloudConfigured: record.cloudConfigured === true,
  };
}

async function fetchDbMode(apiBase: string): Promise<DbModeResponse> {
  const payload = await requestJsonWithFallback({
    urls: buildApiCandidates('/db-mode', apiBase),
    fallbackError: 'Unable to reach db mode endpoints.',
  });
  return parseDbModeResponse(payload);
}

const useSyncStatusStore = create<SyncStatusStore>((set) => ({
  ...DEFAULT_SYNC_STATUS,
  ...(readPersistedSyncStatus() ?? {}),
  setSnapshot: (snapshot) => set(snapshot),
}));

export function useSyncStatus({
  apiBase = DEFAULT_API_BASE,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseSyncStatusOptions = {}) {
  const status = useSyncStatusStore((state) => state.status);
  const mode = useSyncStatusStore((state) => state.mode);
  const cloudConfigured = useSyncStatusStore((state) => state.cloudConfigured);
  const lastChecked = useSyncStatusStore((state) => state.lastChecked);
  const setSnapshot = useSyncStatusStore((state) => state.setSnapshot);

  const refreshStatus = useCallback(async () => {
    const now = new Date().toISOString();
    const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

    if (!browserOnline) {
      setSnapshot({
        status: 'offline',
        mode: 'LOCAL',
        cloudConfigured: false,
        lastChecked: now,
      });
      return;
    }

    try {
      const dbMode = await fetchDbMode(apiBase);
      setSnapshot({
        status: resolveSyncStatus(dbMode.mode, dbMode.cloudConfigured, true),
        mode: dbMode.mode,
        cloudConfigured: dbMode.cloudConfigured,
        lastChecked: now,
      });
    } catch {
      setSnapshot({
        status: 'offline',
        mode: 'LOCAL',
        cloudConfigured: false,
        lastChecked: now,
      });
    }
  }, [apiBase, setSnapshot]);

  useEffect(() => {
    writePersistedSyncStatus({
      status,
      mode,
      cloudConfigured,
      lastChecked,
    });
  }, [cloudConfigured, lastChecked, mode, status]);

  useEffect(() => {
    void refreshStatus();

    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, Math.max(2000, pollIntervalMs));

    const handleOnline = () => {
      void refreshStatus();
    };

    const handleOffline = () => {
      setSnapshot({
        status: 'offline',
        mode: 'LOCAL',
        cloudConfigured: false,
        lastChecked: new Date().toISOString(),
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [pollIntervalMs, refreshStatus, setSnapshot]);

  return {
    status,
    mode,
    cloudConfigured,
    lastChecked,
    isOnline: status === 'online',
    label: syncStatusLabel(status),
    refreshStatus,
  };
}
