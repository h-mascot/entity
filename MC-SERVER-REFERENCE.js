#!/usr/bin/env node
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Agent gateway webhooks for task triggers
const AGENT_WEBHOOKS = {
  Ada: {
    type: 'cron-wake',
    gateway: 'http://localhost:18789',  // Same gateway
  },
  Spock: {
    type: 'cron-wake', 
    gateway: 'http://localhost:18789',  // Same gateway
  },
  Scotty: {
    type: 'webhook',
    url: 'http://100.68.207.75:18789/hooks/agent',
    token: 'd0e6825b3acacec19cafc6746747ba3a',
  },
  Henry: null, // Human - no auto-trigger
  Unassigned: null,
};

// Trigger agent to start working on task
async function triggerAgentForTask(task) {
  const config = AGENT_WEBHOOKS[task.assignee];
  if (!config) return; // Human or unassigned
  
  const payload = {
    event: 'task_started',
    task: {
      id: task.id,
      name: task.name,
      description: task.description,
      assignee: task.assignee,
      priority: task.priority,
      due_date: task.due_date,
      model: task.model,
    },
    message: `🚀 Task #${task.id} moved to Doing: "${task.name}"

Description: ${task.description || 'None'}
Priority: ${task.priority || 'P2'}
Due: ${task.due_date || 'Not set'}
Model: ${task.model || 'Default'}

IMPORTANT: Log your progress to Mission Control (http://100.106.69.9:3000)

✅ FIRST - Acknowledge you started:
curl -X POST http://100.106.69.9:3000/api/tasks/${task.id}/activity -H "Content-Type: application/json" -d '{"action": "started", "user": "${task.assignee}", "details": "Beginning work on task", "type": "human"}'

📝 Log progress as you work:
curl -X POST http://100.106.69.9:3000/api/tasks/${task.id}/activity -H "Content-Type: application/json" -d '{"action": "progress", "user": "${task.assignee}", "details": "What you did", "type": "human"}'

❌ IF YOU HIT AN ERROR - Mark blocked immediately:
curl -X PATCH http://100.106.69.9:3000/api/tasks/${task.id} -H "Content-Type: application/json" -d '{"blocked": true, "blocker_reason": "ERROR: <describe the error>"}'

✅ When done - Move to review:
curl -X PATCH http://100.106.69.9:3000/api/tasks/${task.id} -H "Content-Type: application/json" -d '{"column": "review"}'

If you cannot complete this task for ANY reason, mark it blocked with the reason. Do NOT leave tasks spinning.`,
  };

  try {
    let res;
    if (config.type === 'webhook') {
      // Cross-gateway webhook (Scotty)
      res = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify({ message: payload.message }),
      });
      console.log(`[MC] Triggered ${task.assignee} via webhook: ${res.status}`);
    } else if (config.type === 'cron-wake') {
      // Same gateway - use cron wake endpoint
      res = await fetch(`${config.gateway}/cron/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: payload.message,
          mode: 'now',
        }),
      });
      console.log(`[MC] Triggered ${task.assignee} via cron wake: ${res.status}`);
    }
    
    // Check for non-success status
    if (res && res.status >= 400) {
      markTaskBlocked(task.id, `Agent trigger failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[MC] Failed to trigger ${task.assignee}:`, err.message);
    // Mark task as blocked if trigger fails
    markTaskBlocked(task.id, `Agent trigger failed: ${err.message}`);
  }
}

// Helper to mark task as blocked
function markTaskBlocked(taskId, reason) {
  try {
    db.prepare('UPDATE tasks SET blocked = 1, blocker_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(reason, taskId);
    db.prepare('INSERT INTO activity (task_id, action, user, details, type) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, 'blocked', 'System', reason, 'human');
    console.log(`[MC] Task ${taskId} marked blocked: ${reason}`);
  } catch (e) {
    console.error(`[MC] Failed to mark task blocked:`, e.message);
  }
}

const app = express();
const PORT = 3000;
const db = new Database(path.join(__dirname, 'tasks.db'));
const AUTH_ENABLED = false; // TODO: Enable when ready for login UI
const AGENT_API_KEYS = [
  process.env.MC_AGENT_KEY || 'agent-dev-key',
];
const SESSION_SECRET = process.env.MC_SESSION_SECRET || 'mission-control-secret';

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 60 * 1000 } // 30 minutes
}));
app.use(express.static('public'));

// ---------- DB bootstrap ----------
function addColumnIfMissing(table, column, ddl, defaultValue = undefined) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    if (defaultValue !== undefined) {
      const value = typeof defaultValue === 'string' ? `'${defaultValue}'` : defaultValue;
      db.exec(`UPDATE ${table} SET ${column} = ${value} WHERE ${column} IS NULL`);
    }
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    output TEXT,
    output_type TEXT,
    due_date TEXT,
    column TEXT NOT NULL DEFAULT 'backlog',
    recurring BOOLEAN DEFAULT 0,
    recurring_config TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT DEFAULT 'Henry',
    assignee TEXT DEFAULT 'Henry',
    priority TEXT DEFAULT 'P2',
    archived INTEGER DEFAULT 0,
    parent_task_id INTEGER,
    roadmap_id INTEGER,
    estimate_hours REAL,
    time_spent REAL DEFAULT 0,
    blocked INTEGER DEFAULT 0,
    blocker_reason TEXT,
    progress_status TEXT DEFAULT 'backlog'
  );
  
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    user TEXT NOT NULL,
    details TEXT,
    type TEXT DEFAULT 'human',
    session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    parent_id INTEGER,
    user TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_projects (
    task_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, project_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    name TEXT,
    path TEXT,
    type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS roadmaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    theme TEXT,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS roadmap_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roadmap_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT,
    target_period TEXT,
    status TEXT DEFAULT 'planned',
    linked_task_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    depends_on_task_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS auth_users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    label TEXT,
    user TEXT
  );
`);

addColumnIfMissing('tasks', 'assignee', "TEXT DEFAULT 'Henry'");
addColumnIfMissing('tasks', 'due_date', 'TEXT');
addColumnIfMissing('tasks', 'priority', "TEXT DEFAULT 'P2'");
addColumnIfMissing('tasks', 'recurring_config', 'TEXT');
addColumnIfMissing('tasks', 'archived', 'INTEGER DEFAULT 0', 0);
addColumnIfMissing('tasks', 'parent_task_id', 'INTEGER');
addColumnIfMissing('tasks', 'roadmap_id', 'INTEGER');
addColumnIfMissing('tasks', 'estimate_hours', 'REAL');
addColumnIfMissing('tasks', 'time_spent', 'REAL DEFAULT 0', 0);
addColumnIfMissing('tasks', 'blocked', 'INTEGER DEFAULT 0', 0);
addColumnIfMissing('tasks', 'blocker_reason', 'TEXT');
addColumnIfMissing('tasks', 'progress_status', "TEXT DEFAULT 'backlog'");
addColumnIfMissing('tasks', 'output', 'TEXT');
addColumnIfMissing('tasks', 'output_type', 'TEXT');
db.exec(`UPDATE tasks SET due_date = COALESCE(due_date, date(created_at)) WHERE due_date IS NULL OR due_date = ''`);

const activityColumns = db.prepare('PRAGMA table_info(activity)').all().map(column => column.name);
if (!activityColumns.includes('type')) {
  db.exec(`ALTER TABLE activity ADD COLUMN type TEXT DEFAULT 'human'`);
}
if (!activityColumns.includes('session_id')) {
  db.exec(`ALTER TABLE activity ADD COLUMN session_id TEXT`);
}

// Seed basic users if table is empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM auth_users').get().count;
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}
if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO auth_users (username, password_hash, role) VALUES (?, ?, ?)');
  ['Henry', 'Ada', 'Spock', 'Scotty'].forEach(user => {
    insertUser.run(user, hashPassword(process.env.MC_DEFAULT_PASSWORD || 'mission'), 'user');
  });
}

// Helper: Log activity
function logActivity(taskId, action, user, details = null, type = 'human', sessionId = null) {
  return db
    .prepare('INSERT INTO activity (task_id, action, user, details, type, session_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(taskId, action, user, details, type, sessionId);
}

function recordHistory(taskId, field, oldValue, newValue, changedBy = 'system') {
  db.prepare('INSERT INTO task_history (task_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)')
    .run(taskId, field, oldValue !== undefined ? String(oldValue ?? '') : '', newValue !== undefined ? String(newValue ?? '') : '', changedBy);
}

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (req.session?.user) return next();
  const apiKey = req.headers['x-api-key'];
  if (apiKey && AGENT_API_KEYS.includes(apiKey)) {
    req.session.user = { username: 'agent', role: 'system' };
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function currentUser(req) {
  if (!AUTH_ENABLED) {
    return { username: 'Henry', role: 'admin' };
  }
  return req.session?.user || { username: 'guest', role: 'guest' };
}

function hydrateTask(task) {
  if (!task) return null;
  const projects = db.prepare(`
    SELECT p.* FROM projects p
    INNER JOIN task_projects tp ON tp.project_id = p.id
    WHERE tp.task_id = ?
    ORDER BY p.name ASC
  `).all(task.id);
  const attachments = db.prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at DESC').all(task.id);
  const dependencies = db.prepare(`
    SELECT d.depends_on_task_id as id, t.name FROM task_dependencies d
    LEFT JOIN tasks t ON t.id = d.depends_on_task_id
    WHERE d.task_id = ?
  `).all(task.id);
  const activity = db.prepare('SELECT * FROM activity WHERE task_id = ? ORDER BY created_at DESC LIMIT 50').all(task.id);
  const comments = db.prepare('SELECT COUNT(*) as count FROM comments WHERE task_id = ?').get(task.id).count;
  return {
    ...task,
    projects,
    attachments,
    dependencies,
    activity,
    comments_count: comments,
  };
}

function getTaskById(id) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return hydrateTask(task);
}

function applyProjectAssignments(taskId, projectIds = []) {
  db.prepare('DELETE FROM task_projects WHERE task_id = ?').run(taskId);
  const stmt = db.prepare('INSERT OR IGNORE INTO task_projects (task_id, project_id) VALUES (?, ?)');
  projectIds.filter(Boolean).forEach(pid => stmt.run(taskId, pid));
}

function applyDependencies(taskId, dependsOn = []) {
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(taskId);
  const stmt = db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)');
  dependsOn.filter(Boolean).forEach(depId => stmt.run(taskId, depId));
}

function ensureRecurringClone(task, sessionId = null) {
  if (!task.recurring) return null;
  let config = {};
  try {
    config = task.recurring_config ? JSON.parse(task.recurring_config) : {};
  } catch {
    config = {};
  }
  const cadenceDays = Number(config.everyDays || (config.frequency === 'weekly' ? 7 : 1));
  const nextDueDate = (() => {
    if (task.due_date) {
      const next = new Date(task.due_date);
      next.setDate(next.getDate() + (cadenceDays || 7));
      return next.toISOString().slice(0, 10);
    }
    const now = new Date();
    now.setDate(now.getDate() + (cadenceDays || 7));
    return now.toISOString().slice(0, 10);
  })();
  const clone = db.prepare(`
    INSERT INTO tasks (name, description, due_date, column, created_by, assignee, recurring, recurring_config, priority, estimate_hours, progress_status)
    VALUES (?, ?, ?, 'backlog', ?, ?, 1, ?, ?, ?, 'backlog')
  `).run(task.name, task.description, nextDueDate, task.created_by, task.assignee, task.recurring_config, task.priority || 'P2', task.estimate_hours || null);
  const newId = clone.lastInsertRowid;
  logActivity(newId, 'created', task.created_by, `${task.name} (recurring)`, 'human', sessionId);
  const linkedProjects = db.prepare('SELECT project_id FROM task_projects WHERE task_id = ?').all(task.id).map(p => p.project_id);
  applyProjectAssignments(newId, linkedProjects);
  return newId;
}

// -------- Auth endpoints --------
app.get('/api/auth/session', (req, res) => {
  res.json({ user: currentUser(req), authEnabled: AUTH_ENABLED });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password, apiKey } = req.body;
  if (apiKey && AGENT_API_KEYS.includes(apiKey)) {
    req.session.user = { username: 'agent', role: 'system' };
    return res.json({ user: req.session.user });
  }
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = db.prepare('SELECT * FROM auth_users WHERE username = ?').get(username);
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.user = { username: user.username, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session?.destroy(() => {
    res.json({ ok: true });
  });
});

// ---------- Tasks ----------
app.get('/api/tasks', requireAuth, (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const tasks = db.prepare(
    `SELECT * FROM tasks WHERE ${includeArchived ? '1=1' : 'archived = 0'} ORDER BY created_at DESC`
  ).all();
  res.json(tasks.map(hydrateTask));
});

app.get('/api/tasks/:id', requireAuth, (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const {
    name,
    description,
    due_date,
    column = 'backlog',
    created_by,
    assignee,
    recurring = false,
    recurring_config = null,
    priority = 'P2',
    projectIds = [],
    estimate_hours = null,
    parent_task_id = null,
    session_id = null,
    blocked = 0,
    blocker_reason = null,
    dependsOn = [],
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Task name required' });
  }

  const autoAssignee = (() => {
    if (assignee) return assignee;
    const lowered = name.toLowerCase();
    if (lowered.includes('research')) return 'Spock';
    if (lowered.includes('build') || lowered.includes('fix') || lowered.includes('code')) return 'Scotty';
    return 'Ada';
  })();
  const dueDateValue = due_date || new Date().toISOString().slice(0, 10);

  const stmt = db.prepare(`
    INSERT INTO tasks (name, description, due_date, column, created_by, assignee, recurring, recurring_config, priority, estimate_hours, parent_task_id, blocked, blocker_reason, progress_status, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    name,
    description,
    dueDateValue,
    column,
    created_by || currentUser(req).username || 'Henry',
    autoAssignee,
    recurring ? 1 : 0,
    recurring_config ? JSON.stringify(recurring_config) : null,
    priority || 'P2',
    estimate_hours,
    parent_task_id,
    blocked ? 1 : 0,
    blocker_reason,
    column,
    model || null
  );
  const taskId = result.lastInsertRowid;

  if (projectIds?.length) {
    applyProjectAssignments(taskId, projectIds);
  }
  if (dependsOn?.length) {
    applyDependencies(taskId, dependsOn);
  }

  logActivity(taskId, 'created', currentUser(req).username || 'Henry', name, 'human', session_id);
  if (autoAssignee && autoAssignee !== created_by) {
    logActivity(taskId, 'assigned', currentUser(req).username || 'Henry', autoAssignee, 'human', session_id);
  }

  res.json(getTaskById(taskId));
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const {
    column,
    name,
    description,
    assignee,
    due_date,
    priority,
    recurring,
    recurring_config,
    archived,
    estimate_hours,
    time_spent,
    blocked,
    blocker_reason,
    output,
    output_type,
    progress_status,
    parent_task_id,
    roadmap_id,
    model,
    projectIds,
    dependsOn,
    session_id = null,
  } = req.body;

  const oldTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!oldTask) return res.status(404).json({ error: 'Task not found' });

  const updates = [];
  const values = [];

  const currentUserName = currentUser(req).username || 'Henry';

  function pushUpdate(field, value, logLabel) {
    updates.push(`${field} = ?`);
    values.push(value);
    if (logLabel) {
      recordHistory(req.params.id, field, oldTask[field], value, currentUserName);
      logActivity(req.params.id, 'updated', currentUserName, logLabel, 'human', session_id);
    }
  }

  if (column) {
    pushUpdate('column', column, `${oldTask.column} → ${column}`);
    pushUpdate('progress_status', column, null);
    if (column === 'complete' || column === 'done') {
      logActivity(req.params.id, 'completed', currentUserName, oldTask.name, 'human', session_id);
    } else {
      logActivity(req.params.id, 'moved', currentUserName, `${oldTask.column} → ${column}`, 'human', session_id);
    }
  }
  if (name) {
    pushUpdate('name', name, 'changed name');
  }
  if (description !== undefined) {
    pushUpdate('description', description, 'updated description');
  }
  if (assignee !== undefined) {
    pushUpdate('assignee', assignee, 'changed assignee');
    if (assignee !== oldTask.assignee) {
      logActivity(req.params.id, 'assigned', currentUserName, assignee, 'human', session_id);
    }
  }
  if (due_date !== undefined) {
    const dueDateValue = due_date || new Date().toISOString().slice(0, 10);
    pushUpdate('due_date', dueDateValue, 'changed due date');
  }
  if (priority !== undefined) {
    pushUpdate('priority', priority, 'changed priority');
  }
  if (recurring !== undefined) {
    pushUpdate('recurring', recurring ? 1 : 0, 'changed recurring');
  }
  if (recurring_config !== undefined) {
    pushUpdate('recurring_config', recurring_config ? JSON.stringify(recurring_config) : null, 'changed recurrence config');
  }
  if (archived !== undefined) {
    pushUpdate('archived', archived ? 1 : 0, archived ? 'archived' : 'unarchived');
  }
  if (estimate_hours !== undefined) {
    pushUpdate('estimate_hours', estimate_hours, 'estimate updated');
  }
  if (time_spent !== undefined) {
    pushUpdate('time_spent', time_spent, 'time spent updated');
  }
  if (blocked !== undefined) {
    pushUpdate('blocked', blocked ? 1 : 0, blocked ? 'marked blocked' : 'unblocked');
  }
  if (blocker_reason !== undefined) {
    pushUpdate('blocker_reason', blocker_reason, 'blocker reason updated');
  }
  if (output !== undefined) {
    pushUpdate('output', output, 'output updated');
  }
  if (output_type !== undefined) {
    pushUpdate('output_type', output_type, 'output type updated');
  }
  if (progress_status !== undefined) {
    pushUpdate('progress_status', progress_status, 'progress updated');
  }
  if (parent_task_id !== undefined) {
    pushUpdate('parent_task_id', parent_task_id, 'parent linked');
  }
  if (roadmap_id !== undefined) {
    pushUpdate('roadmap_id', roadmap_id, 'roadmap linked');
  }
  if (model !== undefined) {
    pushUpdate('model', model, 'model updated');
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id);

  if (updates.length) {
    const stmt = db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  if (Array.isArray(projectIds)) {
    applyProjectAssignments(req.params.id, projectIds);
  }
  if (Array.isArray(dependsOn)) {
    applyDependencies(req.params.id, dependsOn);
  }

  const task = getTaskById(req.params.id);

  // Auto-clone recurring on completion
  if ((column === 'complete' || column === 'done') && task?.recurring) {
    ensureRecurringClone(task, session_id);
  }

  // Trigger agent when task moves TO "doing"
  if (column === 'doing' && oldTask.column !== 'doing' && task?.assignee) {
    triggerAgentForTask(task);
  }

  res.json(task);
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE tasks SET archived = 1 WHERE id = ?').run(req.params.id);
  res.json({ archived: true });
});

// Add note to task
app.post('/api/tasks/:id/note', requireAuth, (req, res) => {
  const { note, user = currentUser(req).username || 'Henry', session_id = null } = req.body;
  if (!note) {
    return res.status(400).json({ error: 'Note required' });
  }
  logActivity(req.params.id, 'noted', user, note, 'human', session_id);
  res.json(getTaskById(req.params.id));
});

// Activity logging API
app.post('/api/tasks/:id/activity', requireAuth, (req, res) => {
  const { action, user = currentUser(req).username || 'Henry', details = null, type = 'human', session_id = null } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Action required' });
  }

  const normalizedType = type === 'technical' ? 'technical' : 'human';
  const result = logActivity(req.params.id, action, user, details, normalizedType, session_id);
  
  // Auto-move task based on action keywords
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  const actionLower = action.toLowerCase();
  
  if (task) {
    // Auto-move to "doing" when started
    if ((actionLower.includes('started') || actionLower.includes('beginning')) && task.column === 'backlog') {
      db.prepare('UPDATE tasks SET column = ?, progress_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('doing', 'doing', req.params.id);
      logActivity(req.params.id, 'moved', 'System', 'backlog → doing (auto)', 'human', session_id);
    }
    
    // Auto-move to "review" when completed
    if ((actionLower.includes('completed') || actionLower.includes('finished') || actionLower.includes('done')) 
        && task.column !== 'review' && task.column !== 'done') {
      db.prepare('UPDATE tasks SET column = ?, progress_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('review', 'review', req.params.id);
      logActivity(req.params.id, 'moved', 'System', `${task.column} → review (auto-completed)`, 'human', session_id);
    }
  }
  
  const activity = db.prepare('SELECT * FROM activity WHERE id = ?').get(result.lastInsertRowid);
  res.json(activity);
});

app.get("/api/activity-log", requireAuth, (req, res) => {
  const results = [];
  const scanDirs = [
    { base: "/home/henrymascot/clawd/output", agent: "Ada" },
    { base: "/home/henrymascot/clawd-spock/output", agent: "Spock" }
  ];
  
  function categorize(filename) {
    const f = filename.toLowerCase();
    if (f.includes("strategic-review")) return "Strategic Reviews";
    if (f.includes("overnight")) return "Overnight Work";
    if (f.includes("daytime-surprise") || f.includes("daytime_surprise")) return "Daytime Surprises";
    if (f.includes("research-digest")) return "Research Digests";
    if (f.includes("discord") || f.includes("insight")) return "Discord Insights";
    if (f.includes("business-ideas")) return "Business Ideas";
    if (f.includes("soteria")) return "Soteria Reports";
    if (f.includes("market") || f.includes("competitive")) return "Market Research";
    if (f.includes("curacel")) return "Curacel Reports";
    if (f.includes("weekly-analysis") || f.includes("daily-brief")) return "Recurring Reports";
    return "One-off Reports";
  }
  
  function scanDir(dir, agent) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir, { recursive: true });
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, "utf8").slice(0, 200);
        results.push({
          filename: path.basename(file),
          path: file,
          agent,
          category: categorize(file),
          mtime: stat.mtime.toISOString(),
          size: stat.size,
          preview: content.replace(/[#*\n]/g, " ").trim()
        });
      } catch (e) {}
    }
  }
  
  scanDirs.forEach(d => scanDir(d.base, d.agent));
  results.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  res.json(results);
});

// Sync session logs from Clawdbot
app.post('/api/tasks/:id/sync-session', requireAuth, async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Try to find session file in Clawdbot sessions directories
  const sessionPaths = [
    path.join(process.env.HOME, '.clawdbot/agents/main/sessions', `${session_id}.jsonl`),
    path.join(process.env.HOME, '.clawdbot/agents/spock/sessions', `${session_id}.jsonl`),
  ];

  let sessionFile = null;
  for (const p of sessionPaths) {
    if (fs.existsSync(p)) {
      sessionFile = p;
      break;
    }
  }

  if (!sessionFile) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const lines = fs.readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean);
    const toolCalls = [];

    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'message' && entry.message?.role === 'assistant') {
        const content = entry.message.content || [];
        for (const block of content) {
          if (block.type === 'toolCall') {
            toolCalls.push({
              timestamp: entry.timestamp,
              tool: block.name,
              args: block.arguments,
            });
          }
        }
      }
      // Also capture tool results
      if (entry.type === 'message' && entry.message?.role === 'user') {
        const content = entry.message.content || [];
        for (const block of content) {
          if (block.type === 'toolResult') {
            const lastCall = toolCalls[toolCalls.length - 1];
            if (lastCall && !lastCall.result) {
              lastCall.result = typeof block.content === 'string' 
                ? block.content.slice(0, 500) 
                : JSON.stringify(block.content).slice(0, 500);
            }
          }
        }
      }
    }

    // Log tool calls as technical activity
    let added = 0;
    for (const tc of toolCalls) {
      const details = `${tc.tool}: ${JSON.stringify(tc.args).slice(0, 200)}${tc.result ? '\n→ ' + tc.result.slice(0, 200) : ''}`;
      logActivity(req.params.id, tc.tool, task.assignee || 'Agent', details, 'technical', session_id);
      added++;
    }

    res.json({ synced: added, toolCalls: toolCalls.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-sync: scan recent sessions for tool calls mentioning task
app.post('/api/tasks/:id/auto-sync', requireAuth, async (req, res) => {
  const { agent } = req.body;
  const taskId = req.params.id;
  
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const agentDirs = {
    'Ada': path.join(process.env.HOME, '.clawdbot/agents/main/sessions'),
    'Spock': path.join(process.env.HOME, '.clawdbot/agents/spock/sessions'),
  };

  const sessionsDir = agentDirs[agent];
  if (!sessionsDir || !fs.existsSync(sessionsDir)) {
    return res.json({ synced: 0, message: 'No sessions directory' });
  }

  try {
    // Get sessions modified in last 2 hours
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(sessionsDir, f),
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime
      }))
      .filter(f => Date.now() - f.mtime.getTime() < 2 * 60 * 60 * 1000) // Last 2 hours
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5); // Check last 5 recent sessions

    let totalSynced = 0;
    const taskPattern = new RegExp(`task.*${taskId}|#${taskId}|tasks/${taskId}`, 'i');

    for (const file of files) {
      const lines = fs.readFileSync(file.path, 'utf8').split('\n').filter(Boolean);
      const toolCalls = [];

      // Check if session mentions this task
      const sessionContent = lines.join(' ');
      if (!taskPattern.test(sessionContent) && !sessionContent.includes(task.name)) {
        continue; // Skip sessions that don't mention this task
      }

      const sessionId = file.name.replace('.jsonl', '');
      
      // Check if we already synced this session
      const existing = db.prepare('SELECT COUNT(*) as count FROM activity WHERE task_id = ? AND session_id = ? AND type = ?')
        .get(taskId, sessionId, 'technical');
      if (existing.count > 0) continue; // Already synced

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'message' && entry.message?.role === 'assistant') {
            const content = entry.message.content || [];
            for (const block of content) {
              if (block.type === 'toolCall' && ['exec', 'Edit', 'Write', 'Read'].includes(block.name)) {
                toolCalls.push({
                  timestamp: entry.timestamp,
                  tool: block.name,
                  args: block.arguments,
                });
              }
            }
          }
          if (entry.type === 'message' && entry.message?.role === 'user') {
            const content = entry.message.content || [];
            for (const block of content) {
              if (block.type === 'toolResult') {
                const lastCall = toolCalls[toolCalls.length - 1];
                if (lastCall && !lastCall.result) {
                  lastCall.result = typeof block.content === 'string'
                    ? block.content.slice(0, 300)
                    : JSON.stringify(block.content).slice(0, 300);
                }
              }
            }
          }
        } catch (e) { /* skip malformed lines */ }
      }

      // Log tool calls
      for (const tc of toolCalls.slice(0, 20)) { // Max 20 per session
        const argStr = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args);
        const details = `${tc.tool}: ${argStr.slice(0, 150)}${tc.result ? '\n→ ' + tc.result.slice(0, 150) : ''}`;
        logActivity(taskId, tc.tool, agent, details, 'technical', sessionId);
        totalSynced++;
      }
    }

    res.json({ synced: totalSynced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent Activity API - Get recent activity from Clawdbot sessions
app.get('/api/agents/:agent/activity', requireAuth, (req, res) => {
  const agent = req.params.agent.toLowerCase();
  const agentDirs = {
    'ada': path.join(process.env.HOME, '.clawdbot/agents/main/sessions'),
    'spock': path.join(process.env.HOME, '.clawdbot/agents/spock/sessions'),
    'scotty': null, // Remote - would need SSH or API call
  };

  const sessionsDir = agentDirs[agent];
  if (!sessionsDir) {
    // For Scotty, return task-based activity instead
    const recentActivity = db.prepare(`
      SELECT a.*, t.name as task_name FROM activity a 
      LEFT JOIN tasks t ON a.task_id = t.id 
      WHERE a.user = ? 
      ORDER BY a.created_at DESC LIMIT 20
    `).all(agent.charAt(0).toUpperCase() + agent.slice(1));
    
    return res.json({
      agent,
      source: 'tasks',
      entries: recentActivity.map(a => ({
        tool: a.action,
        details: a.details,
        timestamp: a.created_at,
        taskId: a.task_id,
        taskName: a.task_name,
      }))
    });
  }

  if (!fs.existsSync(sessionsDir)) {
    return res.json({ agent, source: 'sessions', entries: [], error: 'Sessions directory not found' });
  }

  try {
    // Get most recent session file
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(sessionsDir, f),
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 1);

    if (!files.length) {
      return res.json({ agent, source: 'sessions', entries: [] });
    }

    const sessionFile = files[0];
    const lines = fs.readFileSync(sessionFile.path, 'utf8').split('\n').filter(Boolean);
    const entries = [];

    // Parse last 50 lines for tool calls
    const recentLines = lines.slice(-100);
    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message?.role === 'assistant') {
          const content = entry.message.content || [];
          for (const block of content) {
            if (block.type === 'toolCall') {
              entries.push({
                tool: block.name,
                details: typeof block.arguments === 'string' 
                  ? block.arguments.slice(0, 200)
                  : JSON.stringify(block.arguments).slice(0, 200),
                timestamp: entry.timestamp,
              });
            }
          }
        }
      } catch (e) { /* skip malformed */ }
    }

    res.json({
      agent,
      source: 'sessions',
      sessionId: sessionFile.name.replace('.jsonl', ''),
      entries: entries.slice(-20).reverse(), // Last 20, newest first
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comments API
app.get('/api/tasks/:id/comments', requireAuth, (req, res) => {
  const comments = db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(comments);
});

app.post('/api/tasks/:id/comments', requireAuth, (req, res) => {
  const { body, user = currentUser(req).username || 'Henry', parent_id = null, session_id = null } = req.body;

  if (!body) {
    return res.status(400).json({ error: 'Comment body required' });
  }

  const stmt = db.prepare('INSERT INTO comments (task_id, parent_id, user, body) VALUES (?, ?, ?, ?)');
  const result = stmt.run(req.params.id, parent_id, user, body);

  logActivity(req.params.id, 'commented', user, body.slice(0, 120), 'human', session_id);

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid);
  res.json(comment);
});

// Attachments
app.get('/api/tasks/:id/attachments', requireAuth, (req, res) => {
  const attachments = db.prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(attachments);
});

app.post('/api/tasks/:id/attachments', requireAuth, (req, res) => {
  const { name, path: attachmentPath, type = 'link' } = req.body;
  if (!attachmentPath) return res.status(400).json({ error: 'Attachment path or URL required' });
  const result = db.prepare('INSERT INTO attachments (task_id, name, path, type) VALUES (?, ?, ?, ?)').run(req.params.id, name || attachmentPath, attachmentPath, type);
  logActivity(req.params.id, 'attached', currentUser(req).username || 'Henry', attachmentPath);
  res.json(db.prepare('SELECT * FROM attachments WHERE id = ?').get(result.lastInsertRowid));
});

// Dependencies
app.get('/api/tasks/:id/dependencies', requireAuth, (req, res) => {
  const deps = db.prepare(`
    SELECT d.depends_on_task_id as id, t.name FROM task_dependencies d
    LEFT JOIN tasks t ON t.id = d.depends_on_task_id
    WHERE d.task_id = ?
  `).all(req.params.id);
  res.json(deps);
});

app.post('/api/tasks/:id/dependencies', requireAuth, (req, res) => {
  const { dependsOn = [] } = req.body;
  applyDependencies(req.params.id, dependsOn);
  res.json(getTaskById(req.params.id));
});

// Projects
app.get('/api/projects', requireAuth, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY name ASC').all();
  res.json(projects);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, color = null } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const result = db.prepare('INSERT INTO projects (name, color) VALUES (?, ?)').run(name, color);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid));
});

app.post('/api/tasks/:id/projects', requireAuth, (req, res) => {
  const { projectIds = [] } = req.body;
  applyProjectAssignments(req.params.id, projectIds);
  res.json(getTaskById(req.params.id));
});

// Roadmaps
app.get('/api/roadmaps', requireAuth, (req, res) => {
  const roadmaps = db.prepare('SELECT * FROM roadmaps ORDER BY created_at DESC').all();
  const items = db.prepare('SELECT * FROM roadmap_items').all();
  const roadmapWithItems = roadmaps.map(r => ({
    ...r,
    items: items.filter(i => i.roadmap_id === r.id),
  }));
  res.json(roadmapWithItems);
});

app.post('/api/roadmaps', requireAuth, (req, res) => {
  const { name, theme = null, color = null } = req.body;
  if (!name) return res.status(400).json({ error: 'Roadmap name required' });
  const result = db.prepare('INSERT INTO roadmaps (name, theme, color) VALUES (?, ?, ?)').run(name, theme, color);
  res.json(db.prepare('SELECT * FROM roadmaps WHERE id = ?').get(result.lastInsertRowid));
});

app.post('/api/roadmaps/:id/items', requireAuth, (req, res) => {
  const { title, description = null, priority = 'P2', target_period = null, status = 'planned' } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const result = db.prepare(`
    INSERT INTO roadmap_items (roadmap_id, title, description, priority, target_period, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, title, description, priority, target_period, status);
  res.json(db.prepare('SELECT * FROM roadmap_items WHERE id = ?').get(result.lastInsertRowid));
});

app.patch('/api/roadmap-items/:id', requireAuth, (req, res) => {
  const { title, description, priority, target_period, status, linked_task_id } = req.body;
  const updates = [];
  const values = [];
  if (title !== undefined) { updates.push('title = ?'); values.push(title); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
  if (target_period !== undefined) { updates.push('target_period = ?'); values.push(target_period); }
  if (status !== undefined) { updates.push('status = ?'); values.push(status); }
  if (linked_task_id !== undefined) { updates.push('linked_task_id = ?'); values.push(linked_task_id); }
  values.push(req.params.id);
  if (updates.length) {
    db.prepare(`UPDATE roadmap_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  res.json(db.prepare('SELECT * FROM roadmap_items WHERE id = ?').get(req.params.id));
});

app.delete('/api/roadmap-items/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM roadmap_items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/roadmap-items/:id/promote', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM roadmap_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const createdBy = currentUser(req).username || 'Henry';
  const taskResult = db.prepare(`
    INSERT INTO tasks (name, description, due_date, column, created_by, assignee, priority, roadmap_id)
    VALUES (?, ?, ?, 'backlog', ?, ?, ?, ?)
  `).run(
    item.title,
    item.description,
    new Date().toISOString().slice(0, 10),
    createdBy,
    createdBy,
    item.priority || 'P2',
    item.roadmap_id
  );
  const newTaskId = taskResult.lastInsertRowid;
  db.prepare('UPDATE roadmap_items SET linked_task_id = ? WHERE id = ?').run(newTaskId, req.params.id);
  logActivity(newTaskId, 'created', createdBy, `Promoted from roadmap: ${item.title}`);
  res.json(getTaskById(newTaskId));
});

// Recent activity
app.get('/api/activity/recent', requireAuth, (req, res) => {
  const limit = Number(req.query.limit || 30);
  const rows = db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(rows);
});

// Global search
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  
  if (!q) {
    return res.json({ results: [], total: 0, query: q });
  }
  
  const pattern = `%${q}%`;
  const lowerQ = q.toLowerCase();
  
  // Search tasks + activity
  const rows = db.prepare(`
    SELECT DISTINCT t.id as task_id, t.name as task_name, t.column, t.assignee,
           t.description,
           (SELECT details FROM activity WHERE task_id = t.id AND LOWER(details) LIKE LOWER(?) LIMIT 1) as matched_activity
    FROM tasks t
    LEFT JOIN activity a ON t.id = a.task_id
    WHERE t.archived = 0 AND (
      LOWER(t.name) LIKE LOWER(?)
      OR LOWER(t.description) LIKE LOWER(?)
      OR LOWER(t.assignee) LIKE LOWER(?)
      OR LOWER(a.details) LIKE LOWER(?)
    )
    ORDER BY t.updated_at DESC
    LIMIT ?
  `).all(pattern, pattern, pattern, pattern, pattern, limit);
  
  // Build results with snippets
  const results = rows.map(row => {
    let match_source = 'name';
    let snippet = row.task_name;
    
    if (row.task_name.toLowerCase().includes(lowerQ)) {
      match_source = 'name';
      snippet = row.task_name;
    } else if (row.description && row.description.toLowerCase().includes(lowerQ)) {
      match_source = 'description';
      snippet = row.description.substring(0, 150);
    } else if (row.matched_activity) {
      match_source = 'activity';
      snippet = row.matched_activity.substring(0, 150);
    } else if (row.assignee && row.assignee.toLowerCase().includes(lowerQ)) {
      match_source = 'assignee';
      snippet = `Assigned to ${row.assignee}`;
    }
    
    // Highlight match
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    snippet = snippet.replace(regex, '<mark>$1</mark>');
    
    return {
      task_id: row.task_id,
      task_name: row.task_name,
      match_source,
      snippet,
      column: row.column,
      assignee: row.assignee
    };
  });
  
  res.json({ results, total: results.length, query: q });
});

// Recurring tasks
app.get('/api/recurring', requireAuth, (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks WHERE recurring = 1 ORDER BY due_date ASC').all();
  res.json(tasks.map(hydrateTask));
});

// Continue work / Follow-up
app.post('/api/tasks/:id/continue', requireAuth, (req, res) => {
  const user = currentUser(req).username || 'Henry';
  logActivity(req.params.id, 'continue', user, 'Continue work triggered', 'human', req.body.session_id || null);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/followup', requireAuth, (req, res) => {
  const { name, description = '', session_id = null } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const parent = getTaskById(req.params.id);
  if (!parent) return res.status(404).json({ error: 'Task not found' });
  const result = db.prepare(`
    INSERT INTO tasks (name, description, due_date, column, created_by, assignee, parent_task_id, priority)
    VALUES (?, ?, ?, 'backlog', ?, ?, ?, ?)
  `).run(name, description, new Date().toISOString().slice(0, 10), currentUser(req).username || 'Henry', parent.assignee || parent.created_by, req.params.id, parent.priority || 'P2');
  const newId = result.lastInsertRowid;
  logActivity(newId, 'created', currentUser(req).username || 'Henry', `Follow-up for task ${req.params.id}`, 'human', session_id);
  res.json(getTaskById(newId));
});

// Webhook endpoint
app.post('/hook/task', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  // Simple parsing: first line = name, rest = description
  const lines = message.trim().split('\n');
  const name = lines[0];
  const description = lines.slice(1).join('\n') || null;

  const stmt = db.prepare('INSERT INTO tasks (name, description, column, created_by, assignee, due_date) VALUES (?, ?, ?, ?, ?, ?)');
  const result = stmt.run(name, description, 'backlog', 'Ada', 'Ada', new Date().toISOString().slice(0, 10));
  const taskId = result.lastInsertRowid;
  
  logActivity(taskId, 'created', 'Ada', name);
  res.json(getTaskById(taskId));
});

// Sync sessions from other agents
function listAgentSessions({ storePath, activeMinutes }) {
  return new Promise((resolve) => {
    if (!fs.existsSync(storePath)) {
      return resolve({ path: storePath, count: 0, sessions: [], error: 'missing_store' });
    }

    const args = [
      '/home/henrymascot/clawdbot/dist/index.js',
      'sessions',
      '--json',
      '--store',
      storePath,
    ];

    if (typeof activeMinutes === 'number' && !Number.isNaN(activeMinutes)) {
      args.push('--active', String(activeMinutes));
    }

    execFile('node', args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        return resolve({
          path: storePath,
          count: 0,
          sessions: [],
          error: 'exec_failed',
          details: (stderr || stdout || String(err)).toString().slice(0, 2000),
        });
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (parseErr) {
        resolve({
          path: storePath,
          count: 0,
          sessions: [],
          error: 'bad_json',
          details: (stdout || '').toString().slice(0, 2000),
        });
      }
    });
  });
}

app.get('/api/sync/agents', requireAuth, async (req, res) => {
  const activeMinutes = req.query.activeMinutes ? Number(req.query.activeMinutes) : 240;

  const agents = [
    {
      id: 'spock',
      name: 'Spock',
      storePath: '/home/henrymascot/.clawdbot/agents/spock/sessions/sessions.json',
    },
    {
      id: 'scotty',
      name: 'Scotty',
      storePath: '/home/henrymascot/.clawdbot/agents/scotty/sessions/sessions.json',
    },
  ];

  const results = await Promise.all(
    agents.map(async (agent) => ({
      ...agent,
      sessionStore: await listAgentSessions({ storePath: agent.storePath, activeMinutes }),
    }))
  );

  res.json({
    activeMinutes,
    agents: results.map(({ storePath, ...rest }) => rest),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mission Control running on http://0.0.0.0:${PORT}`);
});
