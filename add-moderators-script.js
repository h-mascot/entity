const fs = require('fs');

const dbPath = 'packages/db/src/index.ts';
let dbFile = fs.readFileSync(dbPath, 'utf8');

if (!dbFile.includes('crew_moderators')) {
  const tableSql = "\n    CREATE TABLE IF NOT EXISTS crew_moderators (\n      crew_id TEXT NOT NULL,\n      agent_id TEXT NOT NULL,\n      role TEXT NOT NULL CHECK(role IN ('owner', 'moderator')),\n      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n      PRIMARY KEY (crew_id, agent_id),\n      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE\n    );";
  dbFile = dbFile.replace(/CREATE TABLE IF NOT EXISTS crews[^;]+;/, match => match + tableSql);

  const methods = "\nexport interface CrewModerator {\n  crew_id: string;\n  agent_id: string;\n  role: 'owner' | 'moderator';\n  created_at: string;\n}\n\nexport function getModerators(crewId: string): CrewModerator[] {\n  const db = openEntityDatabase();\n  return db.prepare('SELECT * FROM crew_moderators WHERE crew_id = ?').all(crewId) as CrewModerator[];\n}\n\nexport function addModerator(crewId: string, agentId: string, role: 'owner' | 'moderator'): void {\n  const db = openEntityDatabase();\n  db.prepare('INSERT OR REPLACE INTO crew_moderators (crew_id, agent_id, role) VALUES (?, ?, ?)').run(crewId, agentId, role);\n}\n\nexport function removeModerator(crewId: string, agentId: string): void {\n  const db = openEntityDatabase();\n  db.prepare('DELETE FROM crew_moderators WHERE crew_id = ? AND agent_id = ?').run(crewId, agentId);\n}\n";
  dbFile += methods;
  fs.writeFileSync(dbPath, dbFile);
  console.log('Added crew_moderators to DB');
} else {
  console.log('crew_moderators already in DB');
}

const routesPath = 'packages/server/src/crews-routes.ts';
let routesFile = fs.readFileSync(routesPath, 'utf8');

if (!routesFile.includes('/api/crews/:name/moderators')) {
  const endpoints = "\n  app.get(, (req, res) => {\n    const crew = getCrews().find(c => c.name === req.params.name);\n    if (!crew) return res.status(404).json({ error: 'Crew not found' });\n    res.json(getModerators(crew.id));\n  });\n\n  app.post(, (req, res) => {\n    const crew = getCrews().find(c => c.name === req.params.name);\n    if (!crew) return res.status(404).json({ error: 'Crew not found' });\n    const { agent_id, role } = req.body;\n    if (!agent_id || !['owner', 'moderator'].includes(role)) {\n      return res.status(400).json({ error: 'Invalid agent_id or role' });\n    }\n    addModerator(crew.id, agent_id, role);\n    res.status(201).json({ success: true });\n  });\n\n  app.delete(, (req, res) => {\n    const crew = getCrews().find(c => c.name === req.params.name);\n    if (!crew) return res.status(404).json({ error: 'Crew not found' });\n    removeModerator(crew.id, req.params.agent_id);\n    res.json({ success: true });\n  });\n";
  routesFile = routesFile.replace('import { createCrew, getCrews } from', 'import { createCrew, getCrews, getModerators, addModerator, removeModerator } from');
  routesFile = routesFile.replace(/(app\.post\(crewsBase.*?\}\);)/s, match => match + endpoints);
  fs.writeFileSync(routesPath, routesFile);
  console.log('Added moderator endpoints to server');
} else {
  console.log('Moderator endpoints already in server');
}
