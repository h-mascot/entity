import { useState, useEffect, useRef, useCallback } from 'react';
import { runtime } from '../config/runtime';
import { buildApiCandidates, requestJsonWithFallback } from '../lib/http';

const POLL_INTERVAL = 5000;

interface FileItem {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface FileTreeProps {
  onSelect: (path: string) => void;
  selected: string | null;
}

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁';
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md': return '📝';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': return '🖼️';
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'py': case 'json': case 'yaml': case 'yml': return '💻';
    case 'txt': case 'mdx': case 'org': case 'rst': return '📄';
    default: return '📎';
  }
}

function getExtensionIcon(ext: string): string {
  const icons: Record<string, string> = {
    md: '📝', ts: '💻', js: '💻', py: '💻', json: '💻',
    png: '🖼️', jpg: '🖼️', svg: '🖼️',
    txt: '📄', mdx: '📄',
  };
  return icons[ext.toLowerCase()] || '📎';
}

async function fetchDir(dirPath: string): Promise<FileItem[]> {
  const encodedPath = encodeURIComponent(dirPath);
  const queryPath = `/files?path=${encodedPath}`;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  const urls = Array.from(
    new Set([
      ...buildApiCandidates(queryPath, runtime.apiBase),
      `http://localhost:3001/api/files?path=${encodedPath}`,
      `http://127.0.0.1:3001/api/files?path=${encodedPath}`,
      `http://${hostname}:3001/api/files?path=${encodedPath}`,
    ])
  );

  const data = await requestJsonWithFallback<FileItem[]>({
    urls,
    fallbackError: 'Failed to fetch files.',
  });

  if (!Array.isArray(data)) {
    throw new Error('Failed to fetch files.');
  }

  return data.sort((a: FileItem, b: FileItem) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}

function FolderNode({ item, depth, onSelect, selected, expandedPaths, currentPath, onToggle, onRefresh }: {
  item: FileItem;
  depth: number;
  onSelect: (p: string) => void;
  selected: string | null;
  expandedPaths: Set<string>;
  currentPath: string;
  onToggle: (path: string) => void;
  onRefresh: () => void;
}) {
  const [children, setChildren] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expanded = expandedPaths.has(item.path);
  const isSelected = selected === item.path;
  const pollRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!expanded) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    if (children.length === 0) {
      setLoading(true);
      fetchDir(item.path)
        .then(data => { setChildren(data); setError(null); })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }
    pollRef.current = setInterval(() => {
      fetchDir(item.path)
        .then(data => { setChildren(data); setError(null); })
        .catch(() => {});
    }, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [expanded, item.path]);

  const handleClick = () => {
    if (item.isDirectory) {
      onToggle(item.path);
    } else {
      onSelect(item.path);
    }
  };

  return (
    <div>
      <div
        className={`flex cursor-pointer items-center gap-1 rounded border border-transparent px-2 py-1 transition-colors ${
          isSelected
            ? 'border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          // TODO: Show context menu
        }}
      >
        <span className="text-xs">{item.isDirectory ? (expanded ? '📂' : '📁') : getFileIcon(item.name, false)}</span>
        <span className="truncate text-sm">{item.name}</span>
        {loading && <span className="ml-auto text-xs text-[var(--text-muted)] animate-pulse">...</span>}
      </div>
      {expanded && children.map(child => (
        <FolderNode
          key={child.path}
          item={child}
          depth={depth + 1}
          onSelect={onSelect}
          selected={selected}
          expandedPaths={expandedPaths}
          currentPath={currentPath}
          onToggle={onToggle}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

export default function FileTree({ onSelect, selected }: FileTreeProps) {
  const [root, setRoot] = useState<FileItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'name' | 'type'>('name');
  const [showContextMenu, setShowContextMenu] = useState<{x: number; y: number; path: string; isDir: boolean} | null>(null);

  const loadRoot = useCallback(() => {
    fetchDir('')
      .then(data => { setRoot(data); setLoading(false); setError(null); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    loadRoot();
    const interval = setInterval(loadRoot, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadRoot]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const filtered = filter
    ? root.filter(f => f.name.toLowerCase().includes(filter.toLowerCase()))
    : root;

  // Simple context menu handler
  useEffect(() => {
    const handleClick = () => setShowContextMenu(null);
    if (showContextMenu) window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [showContextMenu]);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-primary)] px-3 py-2">
        <div className="truncate text-xs text-[var(--text-muted)]">📁 Vault</div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {/* TODO: New file */}}
            className="mc-shell-btn px-2 py-1 text-xs font-medium"
            title="New File"
            aria-label="New File"
          >
            +📄
          </button>
          <button
            onClick={() => {/* TODO: New folder */}}
            className="mc-shell-btn px-2 py-1 text-xs font-medium"
            title="New Folder"
            aria-label="New Folder"
          >
            +📁
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex gap-1 overflow-x-hidden border-b border-[var(--border-primary)] p-2">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter..."
          className="mc-shell-input flex-1 px-2 py-1 text-sm placeholder:text-[var(--text-muted)]"
        />
        <button
          onClick={() => setSortBy(s => s === 'name' ? 'type' : 'name')}
          className="mc-shell-btn px-2 py-1 text-xs"
          title="Sort"
        >
          {sortBy === 'name' ? 'AZ' : 'Type'}
        </button>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-auto p-1">
        {loading && root.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
            <span className="animate-spin mr-2">⏳</span>
            <span className="text-sm">Loading...</span>
          </div>
        )}
        {error && root.length === 0 && (
          <div className="p-4 text-center">
            <div className="mb-2 text-sm text-[var(--error)]">⚠️ {error}</div>
            <button onClick={loadRoot} className="mc-shell-btn px-2 py-1 text-xs">Retry</button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-[var(--text-muted)] text-sm text-center py-4">
            {filter ? 'No matches' : 'Empty'}
          </div>
        )}
        {filtered.map(item => (
          <FolderNode
            key={item.path}
            item={item}
            depth={0}
            onSelect={onSelect}
            selected={selected}
            expandedPaths={expandedPaths}
            currentPath=""
            onToggle={togglePath}
            onRefresh={loadRoot}
          />
        ))}
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          className="fixed z-50 rounded-[10px] border border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1"
          style={{ left: showContextMenu.x, top: showContextMenu.y }}
        >
          <button className="w-full px-4 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]">📄 New File</button>
          <button className="w-full px-4 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]">📁 New Folder</button>
          <div className="my-1 border-t border-[var(--border-secondary)]"></div>
          <button className="w-full px-4 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]">✏️ Rename</button>
          <button className="w-full px-4 py-1.5 text-left text-sm text-[var(--error)] hover:bg-[var(--bg-tertiary)]">🗑️ Delete</button>
        </div>
      )}
    </div>
  );
}
