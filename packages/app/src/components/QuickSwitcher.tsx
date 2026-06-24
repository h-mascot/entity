import { useState, useEffect, useRef } from 'react';
import { buildApiCandidates, requestJsonWithFallback } from '../lib/http';

interface FileItem {
  name: string;
  path: string;
  sourceId?: string;
  sourceName?: string;
  restricted?: boolean;
}

interface LegacySearchPayload {
  results?: Array<{ name: string; path: string }>;
}

interface UnifiedSearchResultPayload {
  title: string | null;
  path: string;
  sourceId: string;
  sourceName: string;
  restricted?: boolean;
  placeholder?: boolean;
  permission_state?: string;
  entity_permission_state?: string;
}

interface UnifiedSearchPayload {
  results?: UnifiedSearchResultPayload[];
}

interface QuickSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string, sourceId?: string) => void;
  apiBase?: string;
  useUnifiedSearch?: boolean;
}

export default function QuickSwitcher({
  isOpen,
  onClose,
  onSelect,
  apiBase = '',
  useUnifiedSearch = false,
}: QuickSwitcherProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    setQuery('');
    setResults([]);
    setSelectedIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      const run = async () => {
        if (useUnifiedSearch) {
          const payload = await requestJsonWithFallback<UnifiedSearchPayload>({
            urls: buildApiCandidates(`/fs/search?q=${encodeURIComponent(query)}&limit=10`, apiBase),
            fallbackError: 'Failed to search files.',
          });
          const mapped = (payload.results || []).map((entry) => ({
            name: isRestrictedSearchEntry(entry) ? 'Restricted file' : entry.title ?? entry.path,
            path: entry.path,
            sourceId: entry.sourceId,
            sourceName: entry.sourceName,
            restricted: isRestrictedSearchEntry(entry),
          }));
          setResults(mapped.slice(0, 10));
          setSelectedIndex(0);
          return;
        }

        const payload = await requestJsonWithFallback<LegacySearchPayload>({
          urls: buildApiCandidates(`/search?q=${encodeURIComponent(query)}`, apiBase),
          fallbackError: 'Failed to search files.',
        });
        const mapped = (payload.results || []).map((entry) => ({
          name: entry.name,
          path: entry.path,
        }));
        setResults(mapped.slice(0, 10));
        setSelectedIndex(0);
      };

      run().catch(() => setResults([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [apiBase, query, useUnifiedSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      if (!results[selectedIndex].restricted) {
        onSelect(results[selectedIndex].path, results[selectedIndex].sourceId);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay-strong)] pt-20" onClick={onClose}>
      <div className="w-[min(92vw,64rem)] overflow-hidden rounded-[12px] border border-[var(--border-secondary)] bg-[var(--bg-secondary)]" onClick={e => e.stopPropagation()}>
        <div className="border-b border-[var(--border-primary)] p-4">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files..."
            className="mc-shell-input w-full px-4 py-2 placeholder:text-[var(--text-muted)]"
          />
        </div>
        <div className="max-h-96 overflow-auto">
          {results.length > 0 ? (
            results.map((file, i) => (
              <button
                key={`${file.sourceId ?? 'local'}:${file.path}`}
                onClick={() => {
                  if (!file.restricted) {
                    onSelect(file.path, file.sourceId);
                    onClose();
                  }
                }}
                disabled={file.restricted}
                data-testid={file.restricted ? 'quick-switcher-restricted-result' : undefined}
                className={`flex w-full items-center gap-3 border-b border-[var(--border-primary)] px-4 py-3 text-left transition-colors last:border-b-0 ${
                  i === selectedIndex ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                } ${file.restricted ? 'cursor-not-allowed opacity-80' : ''}`}
              >
                <span>{file.restricted ? '!' : '📄'}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{file.name}</div>
                  <div className="text-xs text-[var(--text-muted)] truncate">
                    {file.restricted
                      ? `${file.sourceName ? `${file.sourceName} • ` : ''}Restricted by Entity permissions. Snippets and previews are hidden.`
                      : `${file.sourceName ? `${file.sourceName} • ` : ''}${file.path}`}
                  </div>
                </div>
              </button>
            ))
          ) : query ? (
            <div className="p-4 text-center text-[var(--text-muted)]">No files found</div>
          ) : (
            <div className="p-4 text-center text-[var(--text-muted)]">Type to search...</div>
          )}
        </div>
        <div className="flex gap-4 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-xs text-[var(--text-muted)]">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}

function isRestrictedSearchEntry(entry: UnifiedSearchResultPayload): boolean {
  return entry.restricted === true ||
    entry.placeholder === true ||
    entry.permission_state === 'restricted' ||
    entry.entity_permission_state === 'restricted';
}
