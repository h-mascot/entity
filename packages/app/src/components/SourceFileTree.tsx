import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFileSources } from '../hooks/useFileSources';
import type { SourceNode } from '../types/filesystem';

function getFileIcon(name: string, isDir: boolean, expanded?: boolean): string {
  if (isDir) return expanded ? '📂' : '📁';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, string> = {
    md: '📝', mdx: '📝',
    ts: '🔷', tsx: '⚛️',
    js: '🟨', jsx: '⚛️',
    py: '🐍',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    html: '🌐', css: '🎨', scss: '🎨',
    sh: '⚙️', bash: '⚙️', zsh: '⚙️',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    pdf: '📕',
    zip: '🗜️', gz: '🗜️', tar: '🗜️', tgz: '🗜️',
    txt: '📄', log: '📜', csv: '📊',
    env: '🔒',
    lock: '🔒',
    git: '🔀', gitignore: '🔀',
  };
  return icons[ext] || '📎';
}

const EXPANDED_SOURCES_KEY = 'entity.fs.tree.expandedSources.v1';
const EXPANDED_FOLDERS_KEY = 'entity.fs.tree.expandedFolders.v1';
const SORT_KEY = 'entity.fs.tree.sort.v1';
const SORT_DIR_KEY = 'entity.fs.tree.sortDir.v1';
const PINNED_FOLDERS_KEY = 'entity.fs.tree.pinnedFolders.v1';

type SortBy = 'name' | 'modified';
type SortDir = 'asc' | 'desc';

interface PinnedFolderEntry {
  sourceId: string;
  path: string;
  pinnedAt: string;
  lastSyncedAt: string | null;
}

type PinnedFolderMap = Record<string, PinnedFolderEntry>;

interface FolderCacheProgress {
  running: boolean;
  current: number;
  total: number;
  error: string | null;
}

function readStringArray(key: string): { hasValue: boolean; value: string[] } {
  if (typeof window === 'undefined') {
    return { hasValue: false, value: [] };
  }

  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return { hasValue: false, value: [] };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        hasValue: true,
        value: parsed.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())),
      };
    }
  } catch {
    // ignore
  }

  // Treat invalid data as "preference exists but empty" so we don't auto-expand again.
  return { hasValue: true, value: [] };
}

function persistStringArray(key: string, values: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Ignore persistence errors (private mode/quota/etc).
  }
}

function readString(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistString(key: string, value: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readPinnedFolders(): PinnedFolderMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PINNED_FOLDERS_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const output: PinnedFolderMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const record = value as Record<string, unknown>;
      const sourceId = typeof record.sourceId === 'string' ? record.sourceId : '';
      const path = typeof record.path === 'string' ? record.path : '';
      if (!sourceId || !path) {
        continue;
      }
      output[key] = {
        sourceId,
        path,
        pinnedAt: typeof record.pinnedAt === 'string' ? record.pinnedAt : new Date().toISOString(),
        lastSyncedAt: typeof record.lastSyncedAt === 'string' ? record.lastSyncedAt : null,
      };
    }

    return output;
  } catch {
    return {};
  }
}

function persistPinnedFolders(pinned: PinnedFolderMap) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(PINNED_FOLDERS_KEY, JSON.stringify(pinned));
  } catch {
    // Ignore persistence failures.
  }
}

interface SourceFileTreeProps {
  apiBase?: string;
  selectedSourceId: string | null;
  selectedPath: string | null;
  onSelect: (sourceId: string, path: string) => void;
}

interface TreeState {
  loading: boolean;
  error: string | null;
  capabilities?: {
    read: boolean;
    write: boolean;
    rename: boolean;
    delete: boolean;
    list: boolean;
    search: boolean;
  };
  nodes: SourceNode[];
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx) : '';
}

function isValidLeafName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes('\0')) return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (trimmed.includes('..')) return false;
  return true;
}

function joinPath(parent: string, leaf: string): string {
  const p = parent.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const l = leaf.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return p ? `${p}/${l}` : l;
}

export default function SourceFileTree({
  apiBase = '',
  selectedSourceId,
  selectedPath,
  onSelect,
}: SourceFileTreeProps) {
  const { sources, loading, error, fetchTree, fetchFile, searchFiles, createFile, createFolder } = useFileSources({ apiBase, enabled: true });
  const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);
  const sourceExpansionBootstrap = useRef(readStringArray(EXPANDED_SOURCES_KEY));
  const folderExpansionBootstrap = useRef(readStringArray(EXPANDED_FOLDERS_KEY));
  const hasSourceExpansionPreference = sourceExpansionBootstrap.current.hasValue;
  const hasAutoExpandedInitialSource = useRef(false);
  const activeCacheRunsRef = useRef<Set<string>>(new Set());

  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    () => new Set(sourceExpansionBootstrap.current.value)
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(folderExpansionBootstrap.current.value)
  );
  const [treeByKey, setTreeByKey] = useState<Record<string, TreeState>>({});
  const [activeFolderBySource, setActiveFolderBySource] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState<SortBy>(() => (readString(SORT_KEY) === 'modified' ? 'modified' : 'name'));
  const [sortDir, setSortDir] = useState<SortDir>(() => (readString(SORT_DIR_KEY) === 'desc' ? 'desc' : 'asc'));

  const [searchQueryBySource, setSearchQueryBySource] = useState<Record<string, string>>({});
  const [searchBySource, setSearchBySource] = useState<Record<string, { loading: boolean; error: string | null; nodes: SourceNode[] }>>({});
  const [pinnedFolders, setPinnedFolders] = useState<PinnedFolderMap>(() => readPinnedFolders());
  const [cacheProgressByFolder, setCacheProgressByFolder] = useState<Record<string, FolderCacheProgress>>({});
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const pinnedFoldersRef = useRef<PinnedFolderMap>(pinnedFolders);

  const [createDraft, setCreateDraft] = useState<{
    sourceId: string;
    mode: 'file' | 'folder';
    name: string;
    error: string | null;
    submitting: boolean;
  } | null>(null);

  useEffect(() => {
    if (enabledSources.length === 0) {
      hasAutoExpandedInitialSource.current = false;
      return;
    }

    // Respect persisted preference, including "everything collapsed".
    if (hasSourceExpansionPreference) {
      hasAutoExpandedInitialSource.current = true;
    }

    if (!hasAutoExpandedInitialSource.current && expandedSources.size === 0) {
      hasAutoExpandedInitialSource.current = true;
      setExpandedSources(new Set([enabledSources[0].id]));
    }
  }, [enabledSources, expandedSources.size, hasSourceExpansionPreference]);

  // Prune expansion state when sources change.
  useEffect(() => {
    if (enabledSources.length === 0) {
      return;
    }

    const enabledIds = new Set(enabledSources.map((source) => source.id));

    setExpandedSources((prev) => {
      const next = new Set(Array.from(prev).filter((id) => enabledIds.has(id)));
      return next.size === prev.size ? prev : next;
    });

    setExpandedFolders((prev) => {
      const next = new Set(Array.from(prev).filter((key) => enabledIds.has(String(key).split('::')[0] ?? '')));
      return next.size === prev.size ? prev : next;
    });
  }, [enabledSources]);

  // Persist expansion state.
  useEffect(() => {
    persistStringArray(EXPANDED_SOURCES_KEY, Array.from(expandedSources));
  }, [expandedSources]);

  useEffect(() => {
    // Avoid unbounded growth if someone expands a lot of folders.
    const capped = Array.from(expandedFolders).slice(-800);
    persistStringArray(EXPANDED_FOLDERS_KEY, capped);
  }, [expandedFolders]);

  useEffect(() => {
    persistString(SORT_KEY, sortBy);
  }, [sortBy]);

  useEffect(() => {
    persistString(SORT_DIR_KEY, sortDir);
  }, [sortDir]);

  useEffect(() => {
    persistPinnedFolders(pinnedFolders);
    pinnedFoldersRef.current = pinnedFolders;
  }, [pinnedFolders]);

  useEffect(() => {
    const handleConnectivityChange = () => {
      setBrowserOnline(window.navigator.onLine);
    };

    window.addEventListener('online', handleConnectivityChange);
    window.addEventListener('offline', handleConnectivityChange);
    return () => {
      window.removeEventListener('online', handleConnectivityChange);
      window.removeEventListener('offline', handleConnectivityChange);
    };
  }, []);

  const treeKey = (sourceId: string, treePath: string) => `${sourceId}::${treePath}`;

  const loadTree = useCallback(
    async (sourceId: string, treePath = '') => {
      const key = treeKey(sourceId, treePath);
      setTreeByKey((prev) => ({
        ...prev,
        [key]: {
          loading: true,
          error: null,
          capabilities: prev[key]?.capabilities,
          nodes: prev[key]?.nodes ?? [],
        },
      }));

      try {
        const payload = await fetchTree(sourceId, treePath);
        setTreeByKey((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            error: null,
            capabilities: payload.capabilities,
            nodes: payload.nodes,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load folder.';
        setTreeByKey((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            error: message,
            capabilities: prev[key]?.capabilities,
            nodes: [],
          },
        }));
      }
    },
    [fetchTree]
  );

  useEffect(() => {
    for (const sourceId of expandedSources) {
      const key = treeKey(sourceId, '');
      if (!treeByKey[key]) {
        void loadTree(sourceId, '');
      }
    }
  }, [expandedSources, loadTree, treeByKey]);

  const toggleSource = (sourceId: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const toggleFolder = (sourceId: string, folderPath: string) => {
    const key = treeKey(sourceId, folderPath);
    setActiveFolderBySource((prev) => ({ ...prev, [sourceId]: folderPath }));
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

    if (!treeByKey[key]) {
      void loadTree(sourceId, folderPath);
    }
  };

  useEffect(() => {
    if (!selectedSourceId || !selectedPath) {
      return;
    }
    setActiveFolderBySource((prev) => ({ ...prev, [selectedSourceId]: dirname(selectedPath) }));
  }, [selectedSourceId, selectedPath]);

  const getSortedNodes = useCallback(
    (nodes: SourceNode[]) => {
      const dirFactor = sortDir === 'asc' ? 1 : -1;
      const toTime = (node: SourceNode) => {
        if (!node.updatedAt) return 0;
        const ms = new Date(node.updatedAt).getTime();
        return Number.isFinite(ms) ? ms : 0;
      };

      const compare = (a: SourceNode, b: SourceNode) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        if (sortBy === 'modified') {
          const delta = toTime(a) - toTime(b);
          if (delta !== 0) return delta * dirFactor;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * dirFactor;
      };

      return [...nodes].sort(compare);
    },
    [sortBy, sortDir]
  );

  const refreshFolder = useCallback(
    async (sourceId: string, folderPath: string) => {
      await loadTree(sourceId, folderPath);
      const parent = dirname(folderPath);
      if (parent !== folderPath) {
        // no-op, placeholder for potential multi-level refresh.
      }
    },
    [loadTree]
  );

  const cacheFolderRecursively = useCallback(
    async (sourceId: string, folderPath: string, options?: { background?: boolean }) => {
      const key = treeKey(sourceId, folderPath);
      if (activeCacheRunsRef.current.has(key)) {
        return;
      }

      activeCacheRunsRef.current.add(key);
      setCacheProgressByFolder((prev) => ({
        ...prev,
        [key]: {
          running: true,
          current: 0,
          total: 0,
          error: null,
        },
      }));

      try {
        const queue: string[] = [folderPath];
        const visited = new Set<string>();
        const files: string[] = [];

        while (queue.length > 0) {
          const nextFolder = queue.shift();
          if (typeof nextFolder !== 'string') {
            break;
          }
          if (visited.has(nextFolder)) {
            continue;
          }
          visited.add(nextFolder);

          const tree = await fetchTree(sourceId, nextFolder);
          for (const node of tree.nodes) {
            if (node.isDirectory) {
              queue.push(node.path);
            } else {
              files.push(node.path);
            }
          }
        }

        const total = files.length;
        setCacheProgressByFolder((prev) => ({
          ...prev,
          [key]: {
            running: true,
            current: 0,
            total,
            error: null,
          },
        }));

        for (let index = 0; index < files.length; index += 1) {
          await fetchFile(sourceId, files[index]);
          setCacheProgressByFolder((prev) => ({
            ...prev,
            [key]: {
              running: true,
              current: index + 1,
              total,
              error: null,
            },
          }));
        }

        const syncedAt = new Date().toISOString();
        setPinnedFolders((prev) => ({
          ...prev,
          [key]: {
            sourceId,
            path: folderPath,
            pinnedAt: prev[key]?.pinnedAt ?? syncedAt,
            lastSyncedAt: syncedAt,
          },
        }));

        setCacheProgressByFolder((prev) => ({
          ...prev,
          [key]: {
            running: false,
            current: total,
            total,
            error: null,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to cache folder.';
        setCacheProgressByFolder((prev) => ({
          ...prev,
          [key]: {
            running: false,
            current: prev[key]?.current ?? 0,
            total: prev[key]?.total ?? 0,
            error: message,
          },
        }));

        if (!options?.background) {
          setPinnedFolders((prev) => ({
            ...prev,
            [key]: {
              sourceId,
              path: folderPath,
              pinnedAt: prev[key]?.pinnedAt ?? new Date().toISOString(),
              lastSyncedAt: prev[key]?.lastSyncedAt ?? null,
            },
          }));
        }
      } finally {
        activeCacheRunsRef.current.delete(key);
      }
    },
    [fetchFile, fetchTree]
  );

  const togglePinnedFolder = useCallback(
    async (sourceId: string, folderPath: string) => {
      const key = treeKey(sourceId, folderPath);
      let removed = false;
      setPinnedFolders((prev) => {
        if (prev[key]) {
          removed = true;
          const next = { ...prev };
          delete next[key];
          return next;
        }

        return {
          ...prev,
          [key]: {
            sourceId,
            path: folderPath,
            pinnedAt: new Date().toISOString(),
            lastSyncedAt: null,
          },
        };
      });

      if (removed) {
        setCacheProgressByFolder((prev) => {
          if (!prev[key]) {
            return prev;
          }
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }

      await cacheFolderRecursively(sourceId, folderPath);
    },
    [cacheFolderRecursively]
  );

  const pinnedFolderKeysSignature = useMemo(
    () => Object.keys(pinnedFolders).sort().join('|'),
    [pinnedFolders]
  );

  useEffect(() => {
    if (!browserOnline) {
      return;
    }

    const pinnedEntries = Object.values(pinnedFoldersRef.current);
    if (pinnedEntries.length === 0) {
      return;
    }

    let cancelled = false;

    const refreshPinnedFolders = async () => {
      for (const entry of pinnedEntries) {
        if (cancelled) {
          return;
        }
        await cacheFolderRecursively(entry.sourceId, entry.path, { background: true });
      }
    };

    const timeoutId = window.setTimeout(() => {
      void refreshPinnedFolders();
    }, 1_200);
    const intervalId = window.setInterval(() => {
      void refreshPinnedFolders();
    }, 120_000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [browserOnline, cacheFolderRecursively, pinnedFolderKeysSignature]);

  const runSearch = useCallback(
    async (sourceId: string, query: string) => {
      const trimmed = query.trim();
      setSearchBySource((prev) => ({
        ...prev,
        [sourceId]: { loading: Boolean(trimmed), error: null, nodes: prev[sourceId]?.nodes ?? [] },
      }));

      if (!trimmed) {
        setSearchBySource((prev) => ({ ...prev, [sourceId]: { loading: false, error: null, nodes: [] } }));
        return;
      }

      try {
        const payload = await searchFiles(trimmed, { sourceId, limit: 80 });
        const nodes: SourceNode[] = payload.results.map((result) => ({
          sourceId: result.sourceId,
          path: result.path,
          name: result.title || result.path.split('/').pop() || result.path,
          isDirectory: false,
          updatedAt: result.updatedAt ?? undefined,
        }));
        setSearchBySource((prev) => ({ ...prev, [sourceId]: { loading: false, error: null, nodes } }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to search files.';
        setSearchBySource((prev) => ({ ...prev, [sourceId]: { loading: false, error: message, nodes: [] } }));
      }
    },
    [searchFiles]
  );

  useEffect(() => {
    const timers: number[] = [];
    for (const source of enabledSources) {
      const query = searchQueryBySource[source.id] ?? '';
      const timer = window.setTimeout(() => {
        void runSearch(source.id, query);
      }, 180);
      timers.push(timer);
    }
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [enabledSources, runSearch, searchQueryBySource]);

  const submitCreate = useCallback(
    async () => {
      if (!createDraft) {
        return;
      }

      const { sourceId, mode, name } = createDraft;
      const activeFolder = activeFolderBySource[sourceId] ?? '';
      const trimmed = name.trim();
      if (!isValidLeafName(trimmed)) {
        setCreateDraft((prev) => (prev ? { ...prev, error: 'Enter a valid name (no slashes).', submitting: false } : prev));
        return;
      }

      const targetPath = joinPath(activeFolder, trimmed);
      setCreateDraft((prev) => (prev ? { ...prev, error: null, submitting: true } : prev));

      try {
        if (mode === 'folder') {
          await createFolder(sourceId, targetPath);

          const parentKey = treeKey(sourceId, activeFolder);
          if (!treeByKey[parentKey]) {
            await loadTree(sourceId, activeFolder);
          } else {
            await refreshFolder(sourceId, activeFolder);
          }

          // Auto-expand the created folder.
          const folderKey = treeKey(sourceId, targetPath);
          setExpandedFolders((prev) => new Set(prev).add(folderKey));
          await loadTree(sourceId, targetPath);
        } else {
          await createFile(sourceId, targetPath, '');
          await refreshFolder(sourceId, activeFolder);
          onSelect(sourceId, targetPath);
        }

        setCreateDraft(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Create failed.';
        setCreateDraft((prev) => (prev ? { ...prev, error: message, submitting: false } : prev));
      }
    },
    [activeFolderBySource, createDraft, createFile, createFolder, loadTree, onSelect, refreshFolder, treeByKey]
  );

  const renderNodes = (sourceId: string, folderPath: string, depth: number) => {
    const key = treeKey(sourceId, folderPath);
    const tree = treeByKey[key];
    if (!tree) {
      return null;
    }

    if (tree.loading) {
      return <div className="px-3 py-1 text-xs text-[var(--text-muted)]">Loading...</div>;
    }

    if (tree.error) {
      return <div className="px-3 py-1 text-xs text-[var(--error)]">{tree.error}</div>;
    }

    return getSortedNodes(tree.nodes).map((node) => {
      const isSelected = selectedSourceId === sourceId && selectedPath === node.path;
      const folderKey = treeKey(sourceId, node.path);
      const expanded = expandedFolders.has(folderKey);
      const isPinned = Boolean(pinnedFolders[folderKey]);
      const cacheProgress = cacheProgressByFolder[folderKey];
      const cacheLabel = cacheProgress
        ? cacheProgress.running
          ? `Caching ${cacheProgress.current}/${cacheProgress.total} files...`
          : cacheProgress.error
            ? cacheProgress.error
            : cacheProgress.total > 0
              ? `Cached ${cacheProgress.current}/${cacheProgress.total} files`
              : null
        : null;

      return (
        <div key={`${sourceId}:${node.path}`}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => (node.isDirectory ? toggleFolder(sourceId, node.path) : onSelect(sourceId, node.path))}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                isSelected
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
            >
              <span>{getFileIcon(node.name, node.isDirectory, expanded)}</span>
              <span className="truncate">{node.name}</span>
              {node.isDirectory && isPinned && (
                <span className="text-[10px] text-[var(--accent)]" title="Pinned for offline">
                  ⬤
                </span>
              )}
            </button>
            {node.isDirectory && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void togglePinnedFolder(sourceId, node.path);
                }}
                className={`mc-shell-btn mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center px-0 py-0 text-[11px] ${
                  cacheProgress?.running ? 'cursor-wait opacity-70' : ''
                }`}
                title={isPinned ? 'Remove offline pin' : 'Make available offline'}
                aria-label={isPinned ? 'Remove offline pin' : 'Make available offline'}
                disabled={Boolean(cacheProgress?.running)}
              >
                {cacheProgress?.running ? '…' : isPinned ? '📌' : '⬇'}
              </button>
            )}
          </div>
          {node.isDirectory && cacheLabel && (
            <div
              className={`px-2 py-0.5 text-[10px] ${
                cacheProgress?.error ? 'text-[var(--error)]' : 'text-[var(--text-muted)]'
              }`}
              style={{ paddingLeft: `${depth * 14 + 26}px` }}
            >
              {cacheLabel}
            </div>
          )}
          {node.isDirectory && expanded && <div>{renderNodes(sourceId, node.path, depth + 1)}</div>}
        </div>
      );
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--border-primary)] px-3 py-2">
        <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Sources</div>
        <input
          value={Object.values(searchQueryBySource).find((v) => v) ?? ''}
          onChange={(event) => {
            const val = event.target.value;
            setSearchQueryBySource((prev) => {
              const next: Record<string, string> = {};
              for (const s of enabledSources) { next[s.id] = val; }
              return next;
            });
            // Auto-expand all sources when typing
            if (val.trim()) {
              setExpandedSources(new Set(enabledSources.map((s) => s.id)));
            }
          }}
          placeholder="Search files..."
          className="w-full rounded border border-[var(--border-secondary)] bg-transparent px-2 py-1 text-xs text-[var(--text-secondary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          aria-label="Search all sources"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading && <div className="text-xs text-[var(--text-muted)]">Loading sources...</div>}
        {error && <div className="text-xs text-[var(--error)]">{error}</div>}
        {!loading && !error && enabledSources.length === 0 && (
          <div className="text-xs text-[var(--text-muted)]">No enabled sources. Configure them in Admin.</div>
        )}
        {enabledSources.map((source) => {
          const expanded = expandedSources.has(source.id);
          const rootKey = treeKey(source.id, '');
          const rootTree = treeByKey[rootKey];
          const canWrite = Boolean(rootTree?.capabilities?.write);
          const pinnedCount = Object.values(pinnedFolders).filter((entry) => entry.sourceId === source.id).length;
          const query = searchQueryBySource[source.id] ?? '';
          const searchState = searchBySource[source.id] ?? { loading: false, error: null, nodes: [] };
          const isSearching = Boolean(query.trim());
          return (
            <div key={source.id} className="mb-2 rounded border border-[var(--border-primary)]">
              <button
                type="button"
                onClick={() => toggleSource(source.id)}
                className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs text-[var(--text-primary)]"
              >
                <span className="truncate">
                  {source.icon ? `${source.icon} ` : ''}{source.displayName}
                </span>
                <span className="flex items-center gap-2">
                  {pinnedCount > 0 && (
                    <span className="text-[10px] text-[var(--accent)]" title={`${pinnedCount} pinned folder(s)`}>
                      📌{pinnedCount}
                    </span>
                  )}
                  <span>{expanded ? '▾' : '▸'}</span>
                </span>
              </button>
              {expanded && (
                <div className="border-t border-[var(--border-primary)] pb-1">
                  <div className="flex items-center gap-2 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortDir === 'asc') { setSortDir('desc'); }
                        else { setSortBy((prev) => prev === 'name' ? 'modified' : 'name'); setSortDir('asc'); }
                      }}
                      className="mc-shell-btn shrink-0 px-2 py-1 text-[11px]"
                      title={`Sort: ${sortBy} ${sortDir}`}
                    >
                      {sortBy === 'name' ? 'A-Z' : 'New'}{sortDir === 'desc' ? '↓' : '↑'}
                    </button>
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => {
                        const active = activeFolderBySource[source.id] ?? '';
                        setCreateDraft({ sourceId: source.id, mode: 'file', name: '', error: null, submitting: false });
                        setActiveFolderBySource((prev) => ({ ...prev, [source.id]: active }));
                      }}
                      className={`mc-shell-btn shrink-0 px-2 py-1 text-[11px] ${!canWrite ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title={canWrite ? 'New file' : 'Read-only source'}
                      aria-label="New file"
                    >
                      📄
                    </button>
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => {
                        const active = activeFolderBySource[source.id] ?? '';
                        setCreateDraft({ sourceId: source.id, mode: 'folder', name: '', error: null, submitting: false });
                        setActiveFolderBySource((prev) => ({ ...prev, [source.id]: active }));
                      }}
                      className={`mc-shell-btn shrink-0 px-2 py-1 text-[11px] ${!canWrite ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title={canWrite ? 'New folder' : 'Read-only source'}
                      aria-label="New folder"
                    >
                      📁
                    </button>
                  </div>

                  {createDraft?.sourceId === source.id && (
                    <div className="px-2 pb-2">
                      <div className="mc-shell-card border border-[var(--border-primary)] p-2">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <div className="truncate text-[11px] text-[var(--text-muted)]">
                            Create {createDraft.mode === 'file' ? 'file' : 'folder'} in{' '}
                            <span className="text-[var(--text-secondary)]">{activeFolderBySource[source.id] || '/'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCreateDraft(null)}
                            className="mc-shell-btn px-2 py-0.5 text-[11px]"
                          >
                            Esc
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            value={createDraft.name}
                            onChange={(event) =>
                              setCreateDraft((prev) => (prev ? { ...prev, name: event.target.value, error: null } : prev))
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                setCreateDraft(null);
                                return;
                              }
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void submitCreate();
                              }
                            }}
                            placeholder={createDraft.mode === 'file' ? 'notes.md' : 'NewFolder'}
                            className="mc-shell-input min-w-0 flex-1 px-2 py-1 text-xs"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => void submitCreate()}
                            disabled={createDraft.submitting}
                            className={`mc-shell-btn mc-shell-btn-active px-2 py-1 text-[11px] ${
                              createDraft.submitting ? 'opacity-70 cursor-wait' : ''
                            }`}
                          >
                            Create
                          </button>
                        </div>
                        {createDraft.error && <div className="mt-1 text-[11px] text-[var(--error)]">{createDraft.error}</div>}
                      </div>
                    </div>
                  )}

                  <div className="pb-1">
                    {isSearching ? (
                      <div className="px-2 pb-1">
                        {searchState.loading && <div className="py-1 text-xs text-[var(--text-muted)]">Searching...</div>}
                        {searchState.error && <div className="py-1 text-xs text-[var(--error)]">{searchState.error}</div>}
                        {!searchState.loading && !searchState.error && searchState.nodes.length === 0 && (
                          <div className="py-1 text-xs text-[var(--text-muted)]">No matches.</div>
                        )}
                        <div className="mt-1 space-y-1">
                          {getSortedNodes(searchState.nodes).map((node) => (
                            <button
                              key={`${node.sourceId}:${node.path}`}
                              type="button"
                              onClick={() => onSelect(node.sourceId, node.path)}
                              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                              title={node.path}
                            >
                              <span>🔎</span>
                              <span className="min-w-0 flex-1 truncate">{node.name}</span>
                              <span className="truncate text-[11px] text-[var(--text-muted)]">{node.path}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      renderNodes(source.id, '', 0)
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
