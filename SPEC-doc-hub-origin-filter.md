# Doc Hub: Origin Filter + Better Search

**MC Task:** #315
**Priority:** P1
**Assignee:** Geordi (Codex on Mac)

## Problem
Henry can't see which files were created by crons vs tasks vs manual work. He wants to filter by agent (e.g. Zora) and see all cron-generated docs, or filter by "tasks" to see all outputs from completed MC tasks.

## Changes Required

### 1. DB Schema — `packages/db/src/file-index.ts`

Add `origin` column to `file_index` table:

```sql
ALTER TABLE file_index ADD COLUMN origin TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS idx_file_index_origin ON file_index(origin);
```

Values: `task` | `cron` | `manual` | `unknown`

In `ensureSchema()`, add the column + index (use `ALTER TABLE` with try/catch for idempotency since SQLite doesn't have `IF NOT EXISTS` for columns).

Add `origin` to:
- `FileIndexRecord` interface
- `UpsertFileIndexInput` interface
- `FileIndexSearchFilters` interface
- `mapIndexRow()` function
- `upsertStmt` prepared statement
- `search()` method (add WHERE clause for origin filter)

### 2. Classifier — `packages/server/src/fs/classify.ts`

Add `origin` to `FileClassification` interface:
```typescript
origin: 'task' | 'cron' | 'manual' | 'unknown';
```

Add `detectOrigin(path: string, content: string)` function:

**Cron detection** (path patterns):
- `memory/YYYY-MM-DD*.md` (daily notes from crons)
- `output/daily-*`, `output/weekly-*`, `output/monthly-*`
- `output/*-digest*`, `output/*-brief*`, `output/*-review*`
- Files with `## Daily`, `## Weekly` headers
- `output/discord-insights/`, `output/business-ideas-digest/`
- Path contains `cron` or content contains `[Cron]` or `scheduled run`

**Task detection** (content patterns):
- Content contains `MC Task #\d+` or `Task #\d+`
- Content contains `mission-control` or `task_id`
- Path contains `/task-output/` or `/tasks/`

**Manual detection:**
- Vault source files (Obsidian paths)
- Files in `notes/`, `docs/`, `projects/` without task/cron markers

**Default:** `unknown`

Also add `detectAgent()` entries for new agents:
```typescript
if (text.includes('zora')) return 'zora';
if (text.includes('geordi')) return 'geordi';
if (text.includes('midas')) return 'midas';
```

### 3. Index Runner — `packages/server/src/fs/index-runner.ts`

Pass `origin` from classification to `upsertRecord()`:
```typescript
origin: classification.origin,
```

### 4. Search API — `packages/server/src/fs/routes-search.ts`

Add `origin` query parameter:
```typescript
const origin = typeof req.query.origin === 'string' ? req.query.origin.trim().toLowerCase() : undefined;
```

Pass to `indexRepo.search()`:
```typescript
const indexedResults = indexRepo.search(query, { sourceId, type, agent, origin, from, to, limit });
```

Include `origin` in response:
```typescript
origin: entry.origin ?? 'unknown',
```

### 5. Frontend Types — `packages/app/src/types/filesystem.ts`

Add to `UnifiedSearchResult`:
```typescript
origin: string;
```

### 6. Frontend Hook — `packages/app/src/hooks/useFileSources.ts`

Add `origin` to search options:
```typescript
async (query: string, options?: { sourceId?: string; type?: string; agent?: string; origin?: string; from?: string; to?: string; limit?: number }) => {
```

Add to params:
```typescript
if (options?.origin) {
  params.set('origin', options.origin);
}
```

### 7. Frontend Dashboard — `packages/app/src/components/UnifiedFileDashboard.tsx`

Add state:
```typescript
const [origin, setOrigin] = useState('all');
```

Add origin dropdown (between type and agent dropdowns):
```html
<select value={origin} onChange={(event) => setOrigin(event.target.value)} className="mc-shell-input px-2 py-1 text-xs">
  <option value="all">All origins</option>
  <option value="cron">Crons</option>
  <option value="task">Tasks</option>
  <option value="manual">Manual</option>
</select>
```

Update agent dropdown — add Zora, Geordi, Midas:
```html
<option value="zora">Zora</option>
<option value="geordi">Geordi</option>
<option value="midas">Midas</option>
```

Pass origin to searchFiles:
```typescript
origin: origin !== 'all' ? origin : undefined,
```

Show origin badge on result cards:
```html
<span className="...">{result.origin}</span>
```

Change grid layout to accommodate the new filter (may need `md:grid-cols-5` or restructure).

## Acceptance Criteria
- [ ] Can filter by origin: task, cron, manual
- [ ] Can filter by Zora and see her cron-created docs
- [ ] Can combine origin + agent filters (e.g. "Zora + Crons")
- [ ] Results sorted by most recent (updated_at DESC) by default
- [ ] Origin badge visible on each result card
- [ ] New agents (Zora, Geordi, Midas) appear in agent dropdown
- [ ] Existing indexed files get `unknown` origin (no data loss)
- [ ] Re-index picks up origin for existing files

## Files to Touch
1. `packages/db/src/file-index.ts`
2. `packages/server/src/fs/classify.ts`
3. `packages/server/src/fs/classify.test.ts` (add origin tests)
4. `packages/server/src/fs/index-runner.ts`
5. `packages/server/src/fs/routes-search.ts`
6. `packages/app/src/types/filesystem.ts`
7. `packages/app/src/hooks/useFileSources.ts`
8. `packages/app/src/components/UnifiedFileDashboard.tsx`
