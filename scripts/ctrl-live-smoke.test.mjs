import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const smokeScript = fileURLToPath(new URL('./ctrl-live-smoke.mjs', import.meta.url));

function runSmoke(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [smokeScript], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('live smoke authenticates every API probe with ENTITY_API_TOKEN', async (t) => {
  const expectedAuthorization = 'Bearer sandbox-smoke-token';
  const receivedRequests = [];
  const server = createServer((req, res) => {
    receivedRequests.push({
      path: req.url,
      authorization: req.headers.authorization,
    });

    if (req.headers.authorization !== expectedAuthorization) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(
      req.url === '/api/tasks'
        ? { tasks: [{ id: 1 }] }
        : { settings: {}, sources: {} },
    ));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const result = await runSmoke({
    CTRL_LIVE_BASE_URL: `http://127.0.0.1:${address.port}`,
    CTRL_LIVE_MIN_TASKS: '1',
    CTRL_LIVE_SKIP: '',
    ENTITY_API_TOKEN: 'sandbox-smoke-token',
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.deepEqual(receivedRequests, [
    { path: '/api/tasks', authorization: expectedAuthorization },
    { path: '/api/config/effective', authorization: expectedAuthorization },
  ]);
});
