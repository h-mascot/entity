#!/usr/bin/env node
import {
  apiJson,
  checkClickClackHealth,
  checkSidecarPrerequisites,
  ensureClickClackSidecar,
  ensureSidecarDataDir,
  failedRequiredChecks,
  loadSidecarPin,
  verifyClickClackCheckout,
} from './clickclack-sidecar-lib.mjs';

function printChecks(checks) {
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
    console.log(`[${label}] ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  }
}

function entityAuthInit(init = {}) {
  const token = process.env.ENTITY_API_TOKEN?.trim();
  if (!token) {
    return init;
  }
  return {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
}

async function verify() {
  const pin = loadSidecarPin();
  const checks = await checkSidecarPrerequisites();
  printChecks(checks);
  const failed = failedRequiredChecks(checks);
  if (failed.length > 0) {
    throw new Error('Missing required ClickClack prerequisites');
  }

  const checkout = await verifyClickClackCheckout({ pin, install: true });
  const dataDir = ensureSidecarDataDir(pin);
  console.log(`[PASS] ClickClack pinned at ${checkout.head}${checkout.clean ? '' : ' (checkout has local changes)'}`);
  console.log(`[PASS] Data dir ready: ${dataDir}`);
  console.log(`[INFO] ClickClack URL: ${pin.baseUrl}`);
}

async function serve() {
  const pin = loadSidecarPin();
  await verifyClickClackCheckout({ pin, install: true });
  const existing = await checkClickClackHealth(pin);
  if (existing.ok) {
    console.log(`[PASS] ClickClack already healthy at ${pin.baseUrl}`);
    return;
  }

  console.log(`Serving ClickClack on ${pin.baseUrl} with data ${pin.dataDir}`);
  const { child } = await ensureClickClackSidecar({
    pin,
    start: true,
    stdio: 'inherit',
  });
  if (!child) {
    return;
  }
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

async function smoke() {
  const pin = loadSidecarPin();
  await verifyClickClackCheckout({ pin, install: true });
  const me = await apiJson(`${pin.entityUrl}/api/clickclack/me`, entityAuthInit());
  await apiJson(`${pin.entityUrl}/api/chat/setup`, entityAuthInit({ method: 'POST' }));
  const bridgeResponse = await apiJson(`${pin.entityUrl}/api/chat/send`, entityAuthInit({
    method: 'POST',
    body: JSON.stringify({
      channelId: 'command-deck',
      targetAgent: 'geordi',
      agents: ['geordi'],
      content: `ClickClack sidecar smoke ${new Date().toISOString()}`,
      messageId: `entity-sidecar-smoke-${Date.now()}`,
    }),
  }), 30_000);
  const channelId = bridgeResponse.clickclack?.channelId;
  if (!channelId) {
    console.log(JSON.stringify({
      entityUrl: pin.entityUrl,
      clickclackUrl: pin.baseUrl,
      proxy: { me },
      chatBridge: {
        enabled: false,
        note: 'ENTITY_CHAT_CLICKCLACK_BRIDGE is disabled; /api/chat/send stayed on the normal Entity chat path.',
        send: bridgeResponse,
      },
    }, null, 2));
    return;
  }
  const transcript = await apiJson(
    `${pin.entityUrl}/api/clickclack/channels/${encodeURIComponent(channelId)}/messages?after_seq=0&limit=20`,
    entityAuthInit()
  );
  console.log(JSON.stringify({
    entityUrl: pin.entityUrl,
    clickclackUrl: pin.baseUrl,
    proxy: { me },
    chatBridge: { enabled: true },
    send: bridgeResponse,
    transcript,
  }, null, 2));
}

async function status() {
  const pin = loadSidecarPin();
  const health = await checkClickClackHealth(pin);
  if (!health.ok) {
    throw new Error(health.error || `ClickClack is not healthy at ${pin.baseUrl}`);
  }
  console.log(JSON.stringify({
    clickclackUrl: pin.baseUrl,
    user: health.user,
    workspaces: health.workspaces,
  }, null, 2));
}

async function main() {
  const command = process.argv[2] || 'verify';
  if (command === 'verify') {
    await verify();
    return;
  }
  if (command === 'serve') {
    await serve();
    return;
  }
  if (command === 'smoke') {
    await smoke();
    return;
  }
  if (command === 'status') {
    await status();
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
