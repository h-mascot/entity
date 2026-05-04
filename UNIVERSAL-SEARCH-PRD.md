# Entity Universal Search (qmd Integration)

## Summary

Add universal semantic + keyword search to Entity, powered by the existing qmd index (25,687 files across 6 collections). One search bar to find anything across the Obsidian vault, agent workspaces, session transcripts, and memory files. Results open directly in Entity's editor.

## Problem

- Obsidian search only works inside Obsidian (and crashes with heavy plugins on 20K+ notes)
- qmd exists and works great, but only via CLI/SSH
- Entity has a file browser but no cross-source search
- No way to search session transcripts or agent workspaces from the same UI

## Solution

A `Cmd+Shift+F` universal search inside Entity that queries qmd and presents results inline.

## Architecture

```
┌─────────────────────────────────────┐
│         Entity Frontend              │
│  ┌─────────────────────────────┐    │
│  │   Universal Search Bar       │    │
│  │   Cmd+Shift+F / Search tab  │    │
│  └──────────┬──────────────────┘    │
│             │ GET /api/search        │
│  ┌──────────▼──────────────────┐    │
│  │   Search Results Panel       │    │
│  │   - Snippets with highlights │    │
│  │   - Collection badges        │    │
│  │   - Click → open in editor   │    │
│  └─────────────────────────────┘    │
└──────────────┬──────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────┐
│         Entity Server                │
│  GET /api/search                     │
│  - Validates query                   │
│  - Calls qmd via SSH or local exec   │
│  - Parses JSON results               │
│  - Returns normalized response       │
└──────────────┬──────────────────────┘
               │ SSH / exec
┌──────────────▼──────────────────────┐
│         qmd (Mac)                    │
│  ~/.local/bin/qmd search|vsearch     │
│  --json -n 20 -c <collection>        │
│  SQLite index: ~/.cache/qmd/         │
│  25,687 files across 6 collections   │
└─────────────────────────────────────┘
```

## Collections Available

| Collection | Files | Content |
|------------|-------|---------|
| obsidian | 20,664 | Full Obsidian vault (notes, briefs, guides) |
| superada | 3,820 | Ada workspace (memory, skills, scripts) |
| sessions | 597 | Cleaned session transcripts |
| scotty | 201 | Scotty workspace |
| spock | 278 | Spock workspace |
| memory | 127 | Memory files (daily notes, context) |

## API Design

### `GET /api/search`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Search query |
| `collection` | string | `all` | Filter to collection (obsidian, superada, sessions, scotty, spock, memory, all) |
| `mode` | string | `keyword` | Search mode: `keyword` (BM25), `semantic` (vector), `hybrid` (combined+rerank) |
| `limit` | number | `20` | Max results |
| `full` | boolean | `false` | Return full document content (not just snippet) |

**Response:**
```json
{
  "query": "soteria healthcare",
  "mode": "keyword",
  "collection": "all",
  "count": 15,
  "results": [
    {
      "id": "obsidian/DailyBriefs/2026-02-08.md",
      "collection": "obsidian",
      "path": "DailyBriefs/2026-02-08.md",
      "score": 0.89,
      "snippet": "...Soteria AI healthcare segment analysis showed 4 out of 150 TPA leads...",
      "lines": [42, 45]
    }
  ]
}
```

### `GET /api/search/collections`

Returns available collections with file counts.

```json
{
  "collections": [
    {"name": "obsidian", "files": 20664, "updated": "2026-02-08T10:00:00Z"},
    {"name": "superada", "files": 3820, "updated": "2026-02-08T10:00:00Z"}
  ]
}
```

### `GET /api/search/document`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Document ID from search results (e.g., `obsidian/DailyBriefs/2026-02-08.md`) |
| `lines` | string | Optional line range (e.g., `40-50`) |

Returns full document content for opening in editor.

## Frontend Components

### 1. UniversalSearchBar (`Cmd+Shift+F`)

- Modal overlay (like QuickSwitcher but for search)
- Text input with collection dropdown filter
- Search mode toggle: Keyword | Semantic | Hybrid
- Debounced search (300ms)
- Keyboard navigation (arrow keys, Enter to open)

### 2. SearchResultsPanel (sidebar or inline)

- List of results with:
  - File name + path
  - Collection badge (color-coded: obsidian=purple, sessions=blue, superada=gold)
  - Score indicator
  - Snippet with query terms highlighted
  - Line number reference
- Click result → opens file in editor, scrolls to line
- "Open in new tab" option

### 3. Search Tab (left sidebar)

- Persistent search panel (like VS Code's search sidebar)
- Shows recent searches
- Collection filter checkboxes
- Results grouped by collection

## Stories (for Ralph/Codex)

| # | Story | Scope | Est |
|---|-------|-------|-----|
| SEARCH-001 | Server endpoint: `GET /api/search` - executes qmd via child_process/SSH, returns JSON | Backend | S |
| SEARCH-002 | Server endpoint: `GET /api/search/collections` - lists available collections | Backend | XS |
| SEARCH-003 | Server endpoint: `GET /api/search/document` - fetches full document by ID | Backend | S |
| SEARCH-004 | UniversalSearchBar component - `Cmd+Shift+F` modal with input, collection filter, mode toggle | Frontend | M |
| SEARCH-005 | SearchResultsPanel - result list with snippets, badges, click-to-open | Frontend | M |
| SEARCH-006 | Search Tab in left sidebar - persistent search panel with history | Frontend | M |
| SEARCH-007 | Editor integration - open search result in editor, scroll to line, highlight matches | Frontend | S |
| SEARCH-008 | E2E test - search flow from query to opening result in editor | Test | S |

**Sizes:** XS=<1h, S=1-2h, M=2-4h

## Implementation Notes

### qmd Execution

**Option A: SSH from Entity server to Mac (current setup)**
```typescript
import { exec } from 'child_process';

async function searchQmd(query: string, collection: string, mode: string, limit: number) {
  const cmd = mode === 'semantic' ? 'vsearch' : mode === 'hybrid' ? 'query' : 'search';
  const collFlag = collection !== 'all' ? `-c ${collection}` : '';
  const sshCmd = `ssh henrymascot@100.86.150.96 "~/.local/bin/qmd ${cmd} '${query}' --json -n ${limit} ${collFlag}"`;
  
  return new Promise((resolve, reject) => {
    exec(sshCmd, { timeout: 10000 }, (err, stdout) => {
      if (err) reject(err);
      resolve(JSON.parse(stdout));
    });
  });
}
```

**Option B: qmd MCP server (future)**
- qmd already has `qmd mcp` command
- Could run as a persistent service on Mac
- Entity server connects via MCP protocol
- Lower latency, no SSH overhead per query

**Recommendation:** Start with Option A (SSH). Migrate to MCP later if latency matters.

### File Opening

When user clicks a search result:
1. Check if file is from a registered file source in Entity
2. If yes → open directly in editor via existing file source adapter
3. If no → fetch content via `/api/search/document`, open as read-only buffer
4. Scroll to matching line, highlight search terms in CodeMirror

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+F` | Open Universal Search modal |
| `Escape` | Close search |
| `↑/↓` | Navigate results |
| `Enter` | Open selected result |
| `Cmd+Enter` | Open in split pane |
| `Tab` | Cycle collection filter |

## Security

- Search queries are sanitized before passing to shell
- No arbitrary command execution (parameterized qmd calls only)
- SSH key auth (no passwords in code)
- Rate limit: 10 searches/sec per client

## Success Criteria

- [ ] Can search 25K+ files and get results in <2 seconds
- [ ] Results accurately match across all 6 collections
- [ ] Click-to-open works for obsidian vault files AND agent workspace files
- [ ] Keyboard-only workflow (Cmd+Shift+F → type → Enter → editing)
- [ ] No impact on Entity editor performance

---

*Spec created: 2026-02-09*
*Author: Ada*
*For: Entity v0.3 — Universal Search*
