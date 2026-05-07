#!/usr/bin/env node
/**
 * entity-setup.js
 * Interactive setup script that generates entity.config.yaml from prompts
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_PATH = path.join(__dirname, '..', 'entity.config.yaml');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('Entity Workspace Setup');
  console.log('======================
');

  const displayName = await ask('Display name for this workspace: ') || 'My Entity Workspace';
  const description = await ask('Description (optional): ') || '';
  const serverPort = (await ask('Server port (default 3000): ')) || '3000';

  const yaml = [
    'profile:',
    '  displayName: "' + displayName + '"',
    '  description: "' + description + '"',
    '',
    'server:',
    '  host: localhost',
    '  port: ' + serverPort,
    '  cors:',
    '    origins:',
    '      - http://localhost:' + serverPort,
    '  db:',
    '    mode: LOCAL',
    '    path: ./data/entity-tasks.db',
    '',
    'agents:',
    '  - name: assistant',
    '    description: "General purpose AI assistant"',
    '    model: local',
    '    capabilities:',
    '      - chat',
    '      - code',
    '      - search',
    '',
    'fileSources: []',
    '',
    'services: []',
    '',
    'logging:',
    '  level: info',
    '  format: json'
  ].join('
');

  fs.writeFileSync(CONFIG_PATH, yaml);
  console.log('
Created ' + CONFIG_PATH);
  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
