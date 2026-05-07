#!/usr/bin/env node
/**
 * entity-dev.js
 * Local-only development startup script
 * No hardcoded enterprise IPs or remote connections
 */
const { spawn } = require('child_process');
const path = require('path');

console.log('Starting Entity local development...');
console.log('==================================');

// Check local DB exists
const dbPath = path.join(__dirname, '..', 'packages', 'db', 'entity-tasks.db');
const fs = require('fs');
if (!fs.existsSync(dbPath)) {
  console.error('ERROR: Local DB not found at ' + dbPath);
  console.error('Run npm run setup first');
  process.exit(1);
}

// Set local-only environment
const env = { ...process.env };
env.ENTITY_DB_MODE = 'LOCAL';
env.ENTITY_CLOUD_API_BASE = 'http://localhost:3000';
env.VITE_MC_ORIGIN = 'http://localhost:3000';
env.VITE_ENTITY_API_BASE = 'http://localhost:3000';

// Start server
const server = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, '..', 'packages', 'server'),
  env,
  stdio: 'inherit'
});

server.on('error', e => { console.error(e); process.exit(1); });
