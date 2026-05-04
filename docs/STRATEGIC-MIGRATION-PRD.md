# Entity Strategic Tab Migration PRD

## Goal
Migrate the roadmaps, projects, and recurring tasks features from the old Mission Control DB into Entity. The MC-SOURCE.html already has frontend code calling these APIs — we just need the server endpoints and DB tables.

## Old MC Database (source)
Location: `/home/henrymascot/clawd/backups/MC-backups/tasks-latest.db`

### Tables to Migrate

**roadmaps** (4 rows)
```sql
CREATE TABLE roadmaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  theme TEXT,
  color TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**roadmap_items** (12 rows)
```sql
CREATE TABLE roadmap_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'P2',
  target_period TEXT,
  status TEXT DEFAULT 'planned',
  linked_task_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id)
);
```

**projects** (10 rows)
```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**task_projects** (4 rows)
```sql
CREATE TABLE task_projects (
  task_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, project_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

**task_history** (153 rows)
```sql
CREATE TABLE task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### Data to Seed

**Roadmaps:**
1. Curacel Enterprise AI/AGI (Product, #3B82F6)
2. Personal Website (Personal, #10B981)
3. Clawdbot Infrastructure (Technical, #8B5CF6)
4. Fun Todos - Enterprise Crew (Fun, #F59E0B)

**Projects:**
1. Soteria AI (#8B5CF6)
2. Curacel (#3B82F6)
3. Enterprise Crew (#F59E0B)
4. Mission Control (#10B981)
5. Clawdbot (#6366F1)
6. BD/Sales (#EC4899)
7. Outreach & Marketing (#F43F5E)
8. Personal (#14B8A6)
9. Immigration (#0EA5E9)
10. Technical Debt (#6B7280)

## Required Server API Endpoints

The MC-SOURCE.html already calls these — they just need to exist in `packages/server/src/index.ts`:

### Roadmaps
- `GET /api/roadmaps` — List all roadmaps with their items
- `POST /api/roadmaps` — Create roadmap `{ name, theme?, color? }`
- `DELETE /api/roadmaps/:id` — Delete roadmap

### Roadmap Items
- `POST /api/roadmaps/:roadmapId/items` — Create item `{ title, description?, priority?, target_period?, status? }`
- `PATCH /api/roadmap-items/:id` — Update item
- `DELETE /api/roadmap-items/:id` — Delete item

### Projects
- `GET /api/projects` — List all projects
- `POST /api/projects` — Create project `{ name, color? }`
- `DELETE /api/projects/:id` — Delete project

### Task-Project Links
- `GET /api/tasks/:taskId/projects` — Get projects for a task
- `POST /api/tasks/:taskId/projects` — Add project to task `{ project_id }`
- `DELETE /api/tasks/:taskId/projects` — Remove project from task `{ project_id }`

### Task History
- `GET /api/tasks/:taskId/history` — Get change history for a task

## Required DB Changes

In `packages/db/src/index.ts`, add:
1. CREATE TABLE statements for roadmaps, roadmap_items, projects, task_projects, task_history
2. CRUD functions for each table
3. Migration logic (ensureSchema already handles ALTER TABLE pattern)

## Implementation Steps

1. **DB Schema** — Add 5 new tables to `packages/db/src/index.ts` ensureSchema
2. **DB Functions** — Add CRUD functions for roadmaps, roadmap_items, projects, task_projects, task_history
3. **Server Endpoints** — Add all API routes to `packages/server/src/index.ts`
4. **Seed Data** — Write a migration script to copy data from old MC DB into Entity DB
5. **Build & Test** — `npx tsc --noEmit && npx vite build`
6. **Deploy** — scp dist/ to ada-gateway, restart server, run seed script

## Acceptance Criteria
- [ ] `GET /api/roadmaps` returns roadmaps with items
- [ ] `GET /api/projects` returns all 10 projects
- [ ] Strategic tab shows roadmaps with items
- [ ] Tasks can be linked to projects
- [ ] Task history is tracked
- [ ] All data from old MC DB is migrated
- [ ] Build passes with zero errors

## CRITICAL RULES
- Build on Mac (dev), deploy dist/ to ada-gateway (production)
- NEVER git checkout/stash on ada-gateway
- DB on ada-gateway is production — gitignored
- Seed script runs on ada-gateway against production DB
