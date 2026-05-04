import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';

type FileVersionMeta = {
  id: string;
  author: string;
  timestamp: string;
  summary: string;
  content?: string;
};

type FileVersion = FileVersionMeta & {
  content: string;
};

type DiffLine =
  | { type: 'context'; value: string }
  | { type: 'add'; value: string }
  | { type: 'del'; value: string };

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function splitLines(value: string): string[] {
  return normalizeNewlines(value).split('\n');
}

function formatRelativeTime(timestamp: string): string {
  const ms = new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return '';

  const deltaSeconds = Math.floor((Date.now() - ms) / 1000);
  if (deltaSeconds < 5) return 'just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;

  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays}d ago`;

  const deltaWeeks = Math.floor(deltaDays / 7);
  if (deltaWeeks < 5) return `${deltaWeeks}w ago`;

  const deltaMonths = Math.floor(deltaDays / 30);
  if (deltaMonths < 12) return `${deltaMonths}mo ago`;

  const deltaYears = Math.floor(deltaDays / 365);
  return `${deltaYears}y ago`;
}

function buildLocalApiFallbackUrls(apiBase: string, path: string): string[] {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  return Array.from(
    new Set([
      ...buildApiCandidates(normalizedPath, apiBase),
      `http://localhost:3001/api${normalizedPath}`,
      `http://127.0.0.1:3001/api${normalizedPath}`,
      `http://${host}:3001/api${normalizedPath}`,
    ])
  );
}

// Myers diff for line arrays, returning a flat list of diff lines.
function diffLines(previous: string[], next: string[]): DiffLine[] {
  const a = previous;
  const b = next;
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((value) => ({ type: 'add' as const, value }));
  if (m === 0) return a.map((value) => ({ type: 'del' as const, value }));

  const max = n + m;
  const v = new Map<number, number>();
  v.set(1, 0);
  const trace: Array<Map<number, number>> = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(new Map(v));

    for (let k = -d; k <= d; k += 2) {
      const vKMinus = v.get(k - 1) ?? 0;
      const vKPlus = v.get(k + 1) ?? 0;

      let x: number;
      if (k === -d || (k !== d && vKMinus < vKPlus)) {
        x = vKPlus;
      } else {
        x = vKMinus + 1;
      }

      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }

      v.set(k, x);

      if (x >= n && y >= m) {
        // Backtrack to build edit script.
        const edits: DiffLine[] = [];
        let backX = n;
        let backY = m;

        for (let backD = trace.length - 1; backD >= 0; backD -= 1) {
          const backV = trace[backD];
          const backK = backX - backY;

          const backVKMinus = backV.get(backK - 1) ?? 0;
          const backVKPlus = backV.get(backK + 1) ?? 0;

          let prevK: number;
          if (backK === -backD || (backK !== backD && backVKMinus < backVKPlus)) {
            prevK = backK + 1;
          } else {
            prevK = backK - 1;
          }

          const prevX = backV.get(prevK) ?? 0;
          const prevY = prevX - prevK;

          while (backX > prevX && backY > prevY) {
            edits.push({ type: 'context', value: a[backX - 1] });
            backX -= 1;
            backY -= 1;
          }

          if (backD === 0) {
            break;
          }

          if (backX === prevX) {
            edits.push({ type: 'add', value: b[backY - 1] });
            backY -= 1;
          } else {
            edits.push({ type: 'del', value: a[backX - 1] });
            backX -= 1;
          }
        }

        edits.reverse();
        return edits;
      }
    }
  }

  // Fallback: should be unreachable.
  return [
    ...a.map((value) => ({ type: 'del' as const, value })),
    ...b.map((value) => ({ type: 'add' as const, value })),
  ];
}

function countDiffLines(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === 'add') added += 1;
    if (line.type === 'del') removed += 1;
  }
  return { added, removed };
}

export default function FileHistoryPanel({
  apiBase,
  filePath,
  latestSavedContent,
  currentContent,
  isOpen,
  onClose,
}: {
  apiBase: string;
  filePath: string | null;
  latestSavedContent: string;
  currentContent: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const ANIMATION_MS = 200;
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(isOpen);
  const closeTimeoutRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [versions, setVersions] = useState<FileVersionMeta[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<FileVersion | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<string | null>(null);

  const selectedIndex = useMemo(
    () => (selectedId ? versions.findIndex((entry) => entry.id === selectedId) : -1),
    [selectedId, versions]
  );

  const diff = useMemo(() => {
    if (!selectedVersion) return [];

    const newerSnapshot = selectedIndex > 0 ? versions[selectedIndex - 1] : null;
    const nextContent = newerSnapshot?.content ?? latestSavedContent;

    return diffLines(splitLines(selectedVersion.content), splitLines(nextContent));
  }, [latestSavedContent, selectedIndex, selectedVersion, versions]);

  const diffCounts = useMemo(() => countDiffLines(diff), [diff]);

  const effectivePath = filePath ?? null;
  const encodedPath = useMemo(() => (effectivePath ? encodeURIComponent(effectivePath) : ''), [effectivePath]);

  const fetchVersions = useCallback(async () => {
    if (!effectivePath) return;
    setVersionsLoading(true);
    setVersionsError(null);

    try {
      const urls = buildLocalApiFallbackUrls(apiBase, `/files/${encodedPath}/versions`);
      const payload = await requestJsonWithFallback<{ versions: FileVersionMeta[] }>({
        urls,
        init: { method: 'GET' },
        continueOnStatuses: [],
        fallbackError: 'Unable to load file history.',
      });

      const nextVersions = Array.isArray(payload.versions) ? payload.versions : [];
      setVersions(nextVersions);

      setSelectedId((current) => {
        if (current && nextVersions.some((item) => item.id === current)) {
          return current;
        }
        return nextVersions[0]?.id ?? null;
      });
    } catch (err) {
      setVersionsError(toErrorMessage(err, 'Unable to load file history.'));
      setVersions([]);
      setSelectedId(null);
      setSelectedVersion(null);
    } finally {
      setVersionsLoading(false);
    }
  }, [apiBase, encodedPath, effectivePath]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (panel.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (isOpen) {
      setMounted(true);
      if (!mounted) {
        setVisible(false);
        window.requestAnimationFrame(() => setVisible(true));
      } else {
        setVisible(true);
      }
      return;
    }

    setVisible(false);
    if (!mounted) return;
    closeTimeoutRef.current = window.setTimeout(() => {
      setMounted(false);
      closeTimeoutRef.current = null;
    }, ANIMATION_MS);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void fetchVersions();
  }, [isOpen, encodedPath, fetchVersions]);

  useEffect(() => {
    if (!isOpen) return;
    if (!effectivePath) return;
    if (!selectedId) {
      setSelectedVersion(null);
      return;
    }

    let cancelled = false;
    setSelectedLoading(true);
    setSelectedError(null);

    const run = async () => {
      try {
        const urls = buildLocalApiFallbackUrls(apiBase, `/files/${encodedPath}/versions/${encodeURIComponent(selectedId)}`);
        const payload = await requestJsonWithFallback<{ version: FileVersion }>({
          urls,
          init: { method: 'GET' },
          continueOnStatuses: [],
          fallbackError: 'Unable to load file version.',
        });

        if (cancelled) return;
        setSelectedVersion(payload.version ?? null);
      } catch (err) {
        if (cancelled) return;
        setSelectedError(toErrorMessage(err, 'Unable to load file version.'));
        setSelectedVersion(null);
      } finally {
        if (!cancelled) {
          setSelectedLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [apiBase, encodedPath, effectivePath, isOpen, selectedId]);

  if (!isOpen && !mounted) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`absolute right-0 top-0 flex h-full w-[min(34rem,94vw)] flex-col border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-[0_20px_60px_rgba(0,0,0,0.55)] transition-[transform,opacity] duration-200 ease-out ${
          visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="File history"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">History</div>
            <div className="truncate text-xs text-[var(--text-muted)]">{effectivePath ?? 'No file selected'}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="mc-shell-btn px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void fetchVersions()}
              disabled={!effectivePath || versionsLoading}
              aria-disabled={!effectivePath || versionsLoading}
              title="Refresh"
            >
              Refresh
            </button>
            <button type="button" className="mc-shell-btn px-2 py-1 text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-[var(--border-primary)] px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recent changes</div>
              {selectedVersion ? (
                <div className="text-xs text-[var(--text-muted)]">
                  Diff vs {selectedIndex > 0 ? 'next saved version' : 'latest saved version'}: <span className="text-green-200">+{diffCounts.added}</span>{' '}
                  <span className="text-red-200">-{diffCounts.removed}</span>
                </div>
              ) : null}
            </div>

            {!effectivePath ? (
              <div className="text-sm text-[var(--text-muted)]">Select a file to see its history.</div>
            ) : versionsLoading ? (
              <div className="text-sm text-[var(--text-muted)]">Loading history…</div>
            ) : versionsError ? (
              <div className="text-sm text-[var(--error)]">{versionsError}</div>
            ) : versions.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)]">No saved versions yet.</div>
            ) : (
              <div className="space-y-2">
                {versions.map((entry) => {
                  const selected = entry.id === selectedId;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`mc-shell-card w-full border px-3 py-2 text-left transition-colors hover:bg-[var(--bg-tertiary)] ${
                        selected ? 'border-[var(--accent)] bg-[var(--surface-accent)]' : 'border-[var(--border-secondary)]'
                      }`}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[var(--text-primary)]">{entry.summary || 'Saved'}</div>
                          <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                            {formatRelativeTime(entry.timestamp)} • {entry.author || 'You'}
                          </div>
                        </div>
                        <div className="shrink-0 text-[11px] text-[var(--text-muted)]">{new Date(entry.timestamp).toLocaleString()}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Diff</div>

            {selectedLoading ? (
              <div className="text-sm text-[var(--text-muted)]">Loading version…</div>
            ) : selectedError ? (
              <div className="text-sm text-[var(--error)]">{selectedError}</div>
            ) : !selectedVersion ? (
              <div className="text-sm text-[var(--text-muted)]">Choose a version to see the diff.</div>
            ) : (
              <div className="mc-shell-card border border-[var(--border-secondary)] bg-[var(--bg-primary)]/60">
                <div className="border-b border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  {selectedVersion.summary} • {selectedVersion.author || 'You'} • {new Date(selectedVersion.timestamp).toLocaleString()}
                  {currentContent !== latestSavedContent && selectedIndex === 0 ? (
                    <span className="ml-2 text-amber-200">Unsaved editor changes are excluded from this diff.</span>
                  ) : null}
                </div>
                <pre className="max-h-[55vh] overflow-auto px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                  {diff.length === 0 ? (
                    <div className="py-2 text-[var(--text-muted)]">No diff.</div>
                  ) : (
                    diff.map((line, idx) => {
                      const isAdd = line.type === 'add';
                      const isDel = line.type === 'del';
                      const prefix = isAdd ? '+' : isDel ? '-' : ' ';
                      const classes = isAdd
                        ? 'bg-green-500/15 text-green-100'
                        : isDel
                          ? 'bg-red-500/15 text-red-100'
                          : 'text-[var(--text-secondary)]';
                      return (
                        <div key={`${idx}-${prefix}`} className={`whitespace-pre ${classes}`}>
                          <span className="select-none pr-2 text-[var(--text-muted)]">{prefix}</span>
                          {line.value}
                        </div>
                      );
                    })
                  )}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
