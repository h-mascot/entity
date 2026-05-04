#!/usr/bin/env node
import path from 'path';
import { spawn } from 'child_process';
import process from 'process';

const cwd = process.cwd();
const port = Number(process.env.ENTITY_FS_SMOKE_PORT ?? 3311);
const baseUrl = `http://127.0.0.1:${port}`;
const workspace = process.env.WORKSPACE ?? cwd;
const smokeFile = path.join(workspace, 'artifacts', 'fs-regression-smoke.md');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(url, attempts = 30, delayMs = 300) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(delayMs);
  }

  throw new Error('Server did not become ready in time.');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = parseJson(text);
  return { status: response.status, payload, text };
}

async function main() {
  const server = spawn('node', ['packages/server/dist/server/src/index.js'], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      ENTITY_FS_MULTISOURCE: 'true',
      ENTITY_FS_INDEXER_ENABLED: 'false',
      WORKSPACE: workspace,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  server.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const cleanup = async () => {
    if (!server.killed) {
      server.kill('SIGTERM');
      await sleep(150);
      if (!server.killed) {
        server.kill('SIGKILL');
      }
    }
  };

  try {
    await waitForServerReady(`${baseUrl}/api/db-mode`);

    // Legacy file flow regression: create -> read -> update -> read -> delete.
    const createFileRes = await request('POST', `${baseUrl}/api/file`, {
      path: smokeFile,
      content: '# FS Regression Smoke\n\nCreated by regression suite.\n',
    });
    const readFileRes = await request('GET', `${baseUrl}/api/file?path=${encodeURIComponent(smokeFile)}`);
    const updateFileRes = await request('PUT', `${baseUrl}/api/file?path=${encodeURIComponent(smokeFile)}`, {
      content: '# FS Regression Smoke\n\nUpdated by regression suite.\n',
    });
    const readFileAfterRes = await request('GET', `${baseUrl}/api/file?path=${encodeURIComponent(smokeFile)}`);
    const deleteFileRes = await request('DELETE', `${baseUrl}/api/file?path=${encodeURIComponent(smokeFile)}`);

    // Multi-source flow regression.
    const createSourceRes = await request('POST', `${baseUrl}/api/sources`, {
      displayName: 'Regression Local Source',
      type: 'local',
      basePath: workspace,
      enabled: true,
    });
    const sourceId = createSourceRes.payload?.id;

    const testSourceRes = await request('POST', `${baseUrl}/api/sources/${sourceId}/test`);
    const treeRes = await request('GET', `${baseUrl}/api/fs/tree?sourceId=${encodeURIComponent(sourceId)}&path=`);
    const sourceFileRes = await request(
      'GET',
      `${baseUrl}/api/fs/file?sourceId=${encodeURIComponent(sourceId)}&path=${encodeURIComponent('docs/context.md')}`
    );
    const traversalRes = await request(
      'GET',
      `${baseUrl}/api/fs/file?sourceId=${encodeURIComponent(sourceId)}&path=${encodeURIComponent('../.env')}`
    );
    const searchRes = await request('GET', `${baseUrl}/api/fs/search?q=&sourceId=${encodeURIComponent(sourceId)}&limit=10`);
    const metricsRes = await request('GET', `${baseUrl}/api/fs/metrics`);

    const deleteSourceRes = await request('DELETE', `${baseUrl}/api/sources/${sourceId}`);

    const summary = {
      legacyFile: {
        create: createFileRes.status,
        read: readFileRes.status,
        update: updateFileRes.status,
        readAfter: readFileAfterRes.status,
        delete: deleteFileRes.status,
      },
      sourceFlow: {
        create: createSourceRes.status,
        test: testSourceRes.status,
        tree: treeRes.status,
        file: sourceFileRes.status,
        traversal: traversalRes.status,
        search: searchRes.status,
        metrics: metricsRes.status,
        delete: deleteSourceRes.status,
      },
      checks: {
        sourceTestStatus: testSourceRes.payload?.status,
        sourceTreeNodes: Array.isArray(treeRes.payload?.nodes) ? treeRes.payload.nodes.length : -1,
        sourceFileReadOnly: sourceFileRes.payload?.readOnly === true,
        searchResults: Array.isArray(searchRes.payload?.results) ? searchRes.payload.results.length : -1,
        metricsHasOperations: Boolean(metricsRes.payload?.operations),
      },
    };

    const pass =
      summary.legacyFile.create === 200 &&
      summary.legacyFile.read === 200 &&
      summary.legacyFile.update === 200 &&
      summary.legacyFile.readAfter === 200 &&
      summary.legacyFile.delete === 200 &&
      summary.sourceFlow.create === 201 &&
      summary.sourceFlow.test === 200 &&
      summary.sourceFlow.tree === 200 &&
      summary.sourceFlow.file === 200 &&
      summary.sourceFlow.traversal === 400 &&
      summary.sourceFlow.search === 200 &&
      summary.sourceFlow.metrics === 200 &&
      summary.sourceFlow.delete === 204 &&
      summary.checks.sourceTestStatus === 'ok' &&
      summary.checks.sourceTreeNodes > 0 &&
      summary.checks.sourceFileReadOnly === true &&
      summary.checks.searchResults > 0 &&
      summary.checks.metricsHasOperations;

    console.log(JSON.stringify(summary, null, 2));

    if (!pass) {
      throw new Error('Regression smoke assertions failed.');
    }
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
