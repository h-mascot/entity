# MB Knowledge Base — Product Requirements Document (PRD)

**Project:** MB Knowledge Base
**Created:** 2026-02-23
**Owner:** Zora (Knowledge Manager)
**Version:** 1.0

---

## 1. Overview

### 1.1 Purpose
A centralized knowledge management system for the MascotBot (MB) ecosystem, enabling agents and council members to store, search, and retrieve knowledge efficiently.

### 1.2 Goals
- Single source of truth for MB knowledge
- Fast, accurate search across all sources
- Prevent research duplication
- Enable knowledge sharing

---

## 2. Features

### 2.1 Knowledge Aggregation

**Priority:** P0

**Description:** Automatically ingest knowledge from multiple sources.

**Sources:**
| Source | Format | Frequency |
|--------|--------|-----------|
| MEMORY.md files | Markdown | Real-time |
| Daily notes | Markdown | Daily |
| Session transcripts | Markdown | Per session |
| MB feature docs | Markdown | On change |
| External docs | Various | Manual |

**Requirements:**
- [ ] Parse MEMORY.md from all agents
- [ ] Parse daily notes (date-based)
- [ ] Parse session transcripts
- [ ] Handle markdown formatting
- [ ] Extract metadata (date, agent, project)

### 2.2 Search & Retrieval

**Priority:** P0

**Description:** Search across all knowledge from a single interface.

**Search Types:**
- **Full-text search:** Keyword matching
- **Filtered search:** By agent, project, date, type
- **Semantic search:** Vector-based similarity (Phase 2)

**Requirements:**
- [ ] Full-text search with ranking
- [ ] Filter by: agent, project, date range, content type
- [ ] Results show: title, snippet, source, date
- [ ] <500ms response time
- [ ] 70%+ relevance rate

### 2.3 Categories & Tags

**Priority:** P1

**Description:** Organize knowledge by category and tags.

**Default Categories:**
- **By Agent:** Ada, Spock, Scotty, Zora, Geordi
- **By Project:** Soteria, Curacel, HCAA, EB-1, MB
- **By Type:** Decision, Pattern, Research, Content, Contact
- **By Feature:** MB-01 through MB-26

**Requirements:**
- [ ] Pre-defined categories
- [ ] Custom tag support
- [ ] Multi-category assignment
- [ ] Category browsing

### 2.4 Access Controls

**Priority:** P1

**Description:** Control who can view and edit knowledge.

**Roles:**
| Role | Permissions |
|------|-------------|
| **Admin** | Full access, manage users |
| **Editor** | View, add, edit entries |
| **Viewer** | View only |

**Requirements:**
- [ ] Role-based access control
- [ ] Default role for new users
- [ ] Entry-level permissions (optional)

### 2.5 Contribution Workflow

**Priority:** P1

**Description:** Process for adding new knowledge entries.

**Workflow:**
1. Create entry (title, content, tags)
2. Auto-extract metadata
3. Index for search
4. Available immediately

**Requirements:**
- [ ] Manual entry creation
- [ ] Bulk import (CSV, JSON)
- [ ] Auto-extract from files
- [ ] Edit existing entries
- [ ] Delete entries

### 2.6 API

**Priority:** P1

**Description:** REST API for agent integration.

**Endpoints:**
```
GET  /api/kb/search?q=keyword&agent=ada&limit=20
GET  /api/kb/entries/:id
POST /api/kb/entries
PUT  /api/kb/entries/:id
DELETE /api/kb/entries/:id
GET  /api/kb/categories
GET  /api/kb/stats
```

**Requirements:**
- [ ] RESTful API
- [ ] JSON responses
- [ ] Authentication (API key)
- [ ] Rate limiting

---

## 3. Technical Architecture

### 3.1 Stack Recommendations

**Option A: Obsidian-based (Recommended for MVP)**
- **Pros:** Zero build time, markdown-native, familiar UI
- **Cons:** Limited search, no API
- **Best for:** Quick start, personal use

**Option B: Custom (SQLite + Chroma)**
- **Pros:** Full control, API support, semantic search
- **Cons:** Build time, maintenance
- **Best for:** Long-term, multi-user

**Option C: Off-the-shelf (Notion, Coda)**
- **Pros:** Feature-rich, collaborative
- **Cons:** Subscription cost, lock-in
- **Best for:** Non-technical users

**Recommendation:** Start with **Option A** (Obsidian) for MVP, migrate to **Option B** (Custom) for Phase 2.

### 3.2 Data Model

```json
{
  "id": "uuid",
  "title": "string",
  "content": "text",
  "source": "memory.md|daily-note|session|manual",
  "agent": "ada|spock|scotty|zora|geordi|henry",
  "project": "soteria|curacel|hcaa|eb1|mb",
  "type": "decision|pattern|research|content|contact",
  "tags": ["tag1", "tag2"],
  "created_at": "datetime",
  "updated_at": "datetime",
  "embedding": "vector[1536]",
  "metadata": {}
}
```

### 3.3 Integration Points

| System | Integration | Purpose |
|--------|-------------|---------|
| Entity MC | API | Task knowledge sync |
| Agent Memory | File watch | Auto-ingest MEMORY.md |
| Daily Notes | Cron | Daily aggregation |
| Sessions | Post-session | Transcript indexing |

---

## 4. MVP Scope

### What to Build First (2 weeks)

**P0 Features:**
- [ ] MEMORY.md aggregation
- [ ] Daily notes aggregation
- [ ] Full-text search
- [ ] Basic web UI
- [ ] Manual entry creation

**Deferred to Phase 2:**
- Semantic search
- API for agents
- Advanced permissions
- External integrations
- AI suggestions

### MVP Success Criteria

- [ ] 200+ entries indexed
- [ ] Search working with 70%+ relevance
- [ ] Henry using daily
- [ ] All agent memory files included

---

## 5. User Stories

### Story 1: Quick Search
**As** Henry  
**I want** to search all knowledge from one place  
**So that** I can find answers without checking multiple files

**Acceptance Criteria:**
- [ ] Single search box
- [ ] Results from all sources
- [ ] <500ms response time
- [ ] Results ranked by relevance

### Story 2: Pattern Discovery
**As** Ada  
**I want** to see related knowledge when I search  
**So that** I can discover patterns I might miss

**Acceptance Criteria:**
- [ ] Related entries shown
- [ ] Patterns highlighted
- [ ] Links to source files

### Story 3: Knowledge Contribution
**As** Zora  
**I want** to easily add new knowledge entries  
**So that** the KB stays current

**Acceptance Criteria:**
- [ ] Simple entry form
- [ ] Auto-tagging suggestions
- [ ] Immediate availability

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Data model design
- [ ] SQLite setup
- [ ] MEMORY.md parser
- [ ] Daily notes parser
- [ ] Basic search
- [ ] Simple UI

### Phase 2: Integration (Week 3-4)
- [ ] REST API
- [ ] Agent integration
- [ ] Auto-sync cron
- [ ] Category management
- [ ] Access controls

### Phase 3: Enhancement (Week 5-8)
- [ ] Semantic search (Chroma)
- [ ] AI suggestions
- [ ] External integrations
- [ ] Advanced analytics
- [ ] Performance optimization

---

## 7. Success Metrics

| Metric | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|
| Entries | 200 | 500 | 1000 |
| Daily queries | 10 | 30 | 50 |
| Success rate | 70% | 80% | 90% |
| Time saved/week | 1 hr | 2 hrs | 3 hrs |

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Low adoption | Medium | High | Agent integration, clear value |
| Data quality | Medium | High | Validation, deduplication |
| Search accuracy | Medium | High | Hybrid search, feedback loop |
| Build complexity | Low | Medium | Start simple, iterate |

---

## 9. Appendix

### A. File Locations
- **KB Root:** `~/clawd/kb/`
- **Config:** `~/clawd/kb/config.json`
- **Data:** `~/clawd/kb/data/kb.db`
- **API:** `~/clawd/kb/api/`

### B. Related Documents
- MB-01 through MB-26 feature specs
- Agent MEMORY.md files
- Daily notes format

---

*MB Knowledge Base PRD by Zora — MC #306* 🌌
