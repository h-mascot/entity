#!/usr/bin/env node

if (process.env.CTRL_LIVE_SKIP === '1') {
  console.log('[ctrl-live] skipped by CTRL_LIVE_SKIP=1');
  process.exit(0);
}

const configuredBaseUrl = process.env.CTRL_LIVE_BASE_URL || process.env.ENTITY_PROD_HTTP_URL || process.env.ENTITY_PROD_HTTP_HOST;
if (!configuredBaseUrl) {
  console.error('[ctrl-live] CTRL_LIVE_BASE_URL or ENTITY_PROD_HTTP_HOST is required; refusing to use a private default.');
  process.exit(78);
}

const baseUrl = configuredBaseUrl.startsWith('http')
  ? configuredBaseUrl.replace(/\/$/, '')
  : `http://${configuredBaseUrl}:3000`;
const tasksTarget = process.env.CTRL_LIVE_SMOKE_URL || `${baseUrl}/api/tasks`;
const configTarget = process.env.CTRL_LIVE_CONFIG_URL || `${baseUrl}/api/config/effective`;
const minimumTaskCount = Number(process.env.CTRL_LIVE_MIN_TASKS || 10);

const fail = (message) => {
  console.error(`[ctrl-live] ${message}`);
  process.exit(1);
};

async function getJson(target) {
  let res;
  try {
    res = await fetch(target);
  } catch (error) {
    fail(`request failed for ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!res.ok) {
    fail(`${target} returned HTTP ${res.status}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    fail(`${target} did not return JSON`);
  }
}

const tasksPayload = await getJson(tasksTarget);
const tasks = Array.isArray(tasksPayload) ? tasksPayload : Array.isArray(tasksPayload?.tasks) ? tasksPayload.tasks : null;
if (!tasks) {
  fail(`${tasksTarget} JSON did not include a tasks array`);
}

if (tasks.length < minimumTaskCount) {
  fail(`${tasksTarget} returned only ${tasks.length} task(s), expected at least ${minimumTaskCount}`);
}

const configPayload = await getJson(configTarget);
if (!configPayload?.settings || !configPayload?.sources) {
  fail(`${configTarget} JSON did not include settings and sources`);
}

console.log(`[ctrl-live] ok: ${tasksTarget} returned ${tasks.length} task(s); ${configTarget} returned effective config`);
