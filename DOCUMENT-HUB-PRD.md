# Document Hub PRD: Recursive Indexing + Multi-Agent Sources

## Problem
Entity's File System (FS) feature only indexes top-level files from docsify sources. Subdirectories (output/, memory/, projects/, skills/) are never crawled. This means 90%+ of agent workspace content is invisible to search and the file dashboard.

Additionally, only one agent source (Ada) is configured. All agents need their workspaces indexed.

## Current State
- **Working:** FS routes enabled, docsify adapter, search API, file dashboard UI
- **Broken:** `FileIndexRunner.indexSource()` calls `adapter.list('')` once and only processes non-directory nodes. Never recurses into subdirectories.
- **Docsify adapter:** `list()` parses `_sidebar.md` for links. Returns both files and directories. Already classifies `isDirectory` correctly.
- **Port:** `.env` has `VITE_ENTITY_API_BASE=http://100.86.150.96:3001` and `ENTITY_FS_MULTISOURCE=true` (both correct)

## Scope

### P0: Recursive Indexing (the main bug)

**File:** `packages/server/src/fs/index-runner.ts`

Fix `indexSource()` to recursively crawl directories:

```
Current flow:
  rootNodes = adapter.list('')
  fileNodes = rootNodes.filter(n => !n.isDirectory)
  // INDEX fileNodes only — directories ignored

Required flow:
  queue = ['']
  while queue not empty:
    path = queue.shift()
    nodes = adapter.list(path)
    for each node:
      if node.isDirectory:
        queue.push(node.path)
      else:
        index(node)
```

Constraints:
- Max depth: 5 levels (prevent infinite loops)
- Max total files: use existing `maxFilesPerSource` (default 250)
- Max directories: 50 per source (prevent runaway crawls)
- Track visited paths to prevent cycles
- Keep the existing parallel source processing

### P1: Add All Agent File Sources

**File:** Seed sources via the existing `POST /api/fs/sources` API or directly in DB bootstrap.

Sources to add (all docsify, read-only):

| Source ID | Display Name | Base URL | Icon |
|-----------|-------------|----------|------|
| ada | Ada 🔮 | http://100.106.69.9:8788 | 🔮 |
| spock | Spock 🖖 | http://100.106.69.9:8789 | 🖖 |
| scotty | Scotty 🔧 | http://100.68.207.75:8788 | 🔧 |
| vault | Obsidian Vault | http://100.86.150.96:8787 | 📚 |

Each docsify source serves markdown files. The adapter reads `_sidebar.md` to discover files.

Create a seed script: `scripts/seed-agent-sources.sh` that POSTs to the API to create these sources if they don't exist. The script should be idempotent (check before creating).

### P1: Search Fallback Also Needs Recursion

**File:** `packages/server/src/fs/routes-search.ts`

The fallback search path (when index has no matches) also only calls `adapter.list('')` without recursion. Apply the same recursive crawl pattern here, with the same depth/count limits.

### P2: Re-trigger Index After Source Add

**File:** `packages/server/src/fs/routes-sources.ts`

After a source is created via `POST /api/fs/sources`, trigger `FileIndexRunner.runOnce()` for that source (or all sources). Currently the indexer only runs on a timer/startup.

## Files to Modify
1. `packages/server/src/fs/index-runner.ts` — Add recursive directory crawl
2. `packages/server/src/fs/routes-search.ts` — Add recursive fallback crawl  
3. `packages/server/src/fs/routes-sources.ts` — Trigger reindex on source create
4. `scripts/seed-agent-sources.sh` — New file, seed all agent sources

## Do NOT Modify
- `packages/server/src/fs/adapters/*.ts` — Adapters are correct
- `packages/db/src/file-sources.ts` — DB layer is correct
- `packages/db/src/file-index.ts` — Index layer is correct
- `packages/app/` — No frontend changes needed
- `packages/server/src/editor/` — Unrelated

## Testing
1. `npx tsc --noEmit` passes in `packages/server/`
2. Run seed script to add all agent sources
3. Trigger reindex via `POST /api/fs/sources/:id/sync` (or restart server)
4. Verify: `GET /api/fs/search?q=proactive` returns files from subdirectories
5. Verify: source count shows significantly more files (should go from ~8 to 100+)

## Acceptance Criteria
- [ ] Recursive indexing crawls subdirectories up to 5 levels deep
- [ ] All 4 agent sources are seeded and indexable
- [ ] Search returns results from nested paths (e.g., `output/blog/`, `memory/sessions/`)
- [ ] No infinite loops or runaway crawls (depth + count limits enforced)
- [ ] TypeScript compiles clean
