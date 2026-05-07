#!/usr/bin/env node
/**
 * entity-doctor.js
 * Health check script for Entity workspace
 * Verifies local configuration and connectivity
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const checks = [];

function check(name, fn) {
  return fn().then(pass => {
    checks.push({ name, pass });
    console.log((pass ? '[PASS]' : '[FAIL]') + ' ' + name);
    return pass;
  }).catch(e => {
    checks.push({ name, pass: false, error: e.message });
    console.log('[FAIL] ' + name + ': ' + e.message);
    return false;
  });
}

async function main() {
  console.log('Entity Doctor');
  console.log('=============');

  // Check config exists
  await check('entity.config.yaml exists', async () => {
    const cfg = path.join(__dirname, '..', 'entity.config.yaml');
    if (!fs.existsSync(cfg)) throw new Error('Run npm run setup first');
    return true;
  });

  // Check local DB
  await check('Local DB accessible', async () => {
    const db = path.join(__dirname, '..', 'packages', 'db', 'entity-tasks.db');
    if (!fs.existsSync(db)) throw new Error('DB not found');
    return true;
  });

  // Check server port
  await check('Server port 3000 available', async () => {
    return new Promise((resolve, reject) => {
      const req = http.get('http://localhost:3000/api/health', res => {
        resolve(res.statusCode === 200);
      });
      req.on('error', e => reject(e));
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  });

  const failed = checks.filter(c => !c.pass).length;
  console.log('\n' + (failed ? failed + ' checks failed' : 'All checks passed'));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
