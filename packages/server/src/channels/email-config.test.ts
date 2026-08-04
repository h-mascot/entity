/**
 * THE-932 (blocker 2) — Email/SMTP adapter is wired through the live runtime
 * registry configuration path, not an orphan validator.
 *
 * `createChannelAdapterRegistryForRuntime` registers an email adapter ONLY when
 * explicitly configured via env. Configured plaintext SMTP AUTH can never
 * register or appear in `/api/channel-adapters` (fail closed at construction).
 * TLS/STARTTLS configs register with public-safe health. No credentials or raw
 * internal detail leak through the registry snapshot or the router error path.
 *
 * Authoritative boundary: this codebase has NO SMTP send client. Registration is
 * the only supported boundary; the adapter honestly reports it cannot deliver.
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'http';
import {
  createChannelAdapterRegistryForRuntime,
  createChannelAdapterRouter,
} from './router';
import { createChannelAdapterRegistry } from './registry';
import { loadEmailAdapterFromEnv, readEmailSmtpConfigFromEnv } from './email-config';

function tlsEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ENTITY_EMAIL_SMTP_HOST: 'mail.example',
    ENTITY_EMAIL_SMTP_PORT: '465',
    ENTITY_EMAIL_SMTP_SECURE: '1',
    ENTITY_EMAIL_SMTP_USER: 'alerts',
    ENTITY_EMAIL_SMTP_PASS: 'super-secret-password-12345',
    ...overrides,
  };
}

describe('email adapter runtime config loader (THE-932 blocker 2)', () => {
  it('returns null (not configured) when no host is supplied', () => {
    expect(readEmailSmtpConfigFromEnv({})).toBeNull();
    expect(loadEmailAdapterFromEnv({})).toBeNull();
  });

  it('constructs a TLS email adapter when securely configured', () => {
    const adapter = loadEmailAdapterFromEnv(tlsEnv());
    expect(adapter).not.toBeNull();
    expect(adapter!.kind).toBe('email');
    expect(adapter!.getAvailability()).toBe('available');
  });

  it('constructs a STARTTLS email adapter when requireTls is set on 587', () => {
    const adapter = loadEmailAdapterFromEnv(tlsEnv({
      ENTITY_EMAIL_SMTP_PORT: '587',
      ENTITY_EMAIL_SMTP_SECURE: undefined,
      ENTITY_EMAIL_SMTP_REQUIRE_TLS: '1',
    }));
    expect(adapter).not.toBeNull();
    expect(adapter!.getAvailability()).toBe('available');
  });

  it('fails closed (returns null) for configured plaintext SMTP AUTH', () => {
    // Port 25 with credentials in the clear — must never construct/register.
    const adapter = loadEmailAdapterFromEnv(tlsEnv({
      ENTITY_EMAIL_SMTP_PORT: '25',
      ENTITY_EMAIL_SMTP_SECURE: undefined,
      ENTITY_EMAIL_SMTP_REQUIRE_TLS: undefined,
    }));
    expect(adapter).toBeNull();
  });
});

describe('createChannelAdapterRegistryForRuntime — live wiring (THE-932 blocker 2)', () => {
  it('registers the email adapter when securely configured (public-safe, no secrets)', async () => {
    const registry = createChannelAdapterRegistryForRuntime({ env: tlsEnv() });
    const snapshot = await registry.snapshot();
    const email = snapshot.adapters.find((a) => a.kind === 'email');
    expect(email).toBeDefined();
    expect(email!.availability).toBe('available');
    // The snapshot is public-safe: no credentials ever surface.
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-password-12345');
  });

  it('configured plaintext AUTH never registers/appears (fail closed)', async () => {
    const registry = createChannelAdapterRegistryForRuntime({
      env: tlsEnv({
        ENTITY_EMAIL_SMTP_PORT: '25',
        ENTITY_EMAIL_SMTP_SECURE: undefined,
        ENTITY_EMAIL_SMTP_REQUIRE_TLS: undefined,
      }),
    });
    const snapshot = await registry.snapshot();
    expect(snapshot.adapters.find((a) => a.kind === 'email')).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-password-12345');
  });

  it('registers nothing when email is not configured', async () => {
    const registry = createChannelAdapterRegistryForRuntime({ env: {} });
    const snapshot = await registry.snapshot();
    expect(snapshot.adapters.find((a) => a.kind === 'email')).toBeUndefined();
  });

  it('never exposes credentials through the adapter notify path', async () => {
    const registry = createChannelAdapterRegistryForRuntime({ env: tlsEnv() });
    const email = registry.list().find((a) => a.kind === 'email')!;
    const result = await email.notifyStatus({
      kind: 'email',
      adapterId: email.id,
      taskId: 1,
      status: 'done',
      title: 'done',
    });
    expect(JSON.stringify(result)).not.toContain('super-secret-password-12345');
    // Authoritative no-send boundary: the adapter honestly reports it cannot deliver.
    expect(['degraded', 'skipped', 'failed']).toContain(result.status);
  });
});

describe('GET /api/channel-adapters — sanitized, public-safe (THE-932 blocker 2)', () => {
  it('serves a securely-configured email adapter with no credential leak', async () => {
    let server: http.Server;
    const app = express();
    app.use('/api/channel-adapters', createChannelAdapterRouter({
      registry: createChannelAdapterRegistryForRuntime({ env: tlsEnv() }),
    }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server failed to bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const res = await fetch(`${baseUrl}/api/channel-adapters`);
      expect(res.status).toBe(200);
      const payload = (await res.json()) as { adapters: Array<{ kind: string; availability: string }> };
      expect(payload.adapters.some((a) => a.kind === 'email')).toBe(true);
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('super-secret-password-12345');
      // No raw internal detail / config surface in the public snapshot.
      expect(serialized).not.toMatch(/pass|password|secret|token|credential|host|port/i);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it('does NOT leak raw internal detail when the registry snapshot throws', async () => {
    let server: http.Server;
    const throwingRegistry = createChannelAdapterRegistry();
    // Force snapshot() to throw an error carrying sensitive-looking detail.
    throwingRegistry.snapshot = async () => { throw new Error('internal: connection pool exploded for mail.example:465 user=alerts'); };
    const app = express();
    app.use('/api/channel-adapters', createChannelAdapterRouter({ registry: throwingRegistry }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server failed to bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const res = await fetch(`${baseUrl}/api/channel-adapters`);
      expect(res.status).toBe(500);
      const payload = (await res.json()) as { error?: string; detail?: string };
      expect(payload.error).toBe('Failed to read channel adapters');
      // Sanitized: no raw exception detail, no host/port/user leak.
      expect(payload.detail).toBeUndefined();
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/mail\.example|connection pool|user=alerts|465/i);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});

describe('live mount — createChannelAdapterRouter() reads process.env (THE-932 blocker 2)', () => {
  const preserved = new Map<string, string | undefined>();
  const emailKeys = [
    'ENTITY_EMAIL_SMTP_HOST',
    'ENTITY_EMAIL_SMTP_PORT',
    'ENTITY_EMAIL_SMTP_SECURE',
    'ENTITY_EMAIL_SMTP_REQUIRE_TLS',
    'ENTITY_EMAIL_SMTP_USER',
    'ENTITY_EMAIL_SMTP_PASS',
  ];

  beforeEach(() => {
    for (const key of emailKeys) preserved.set(key, process.env[key]);
  });
  afterEach(() => {
    for (const [key, value] of preserved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('the no-arg router mounts a securely-configured email adapter from process.env', async () => {
    process.env.ENTITY_EMAIL_SMTP_HOST = 'smtp.example.com';
    process.env.ENTITY_EMAIL_SMTP_PORT = '465';
    process.env.ENTITY_EMAIL_SMTP_SECURE = '1';
    process.env.ENTITY_EMAIL_SMTP_USER = 'alerts';
    process.env.ENTITY_EMAIL_SMTP_PASS = 'tls-only-live-secret';

    let server: http.Server;
    const app = express();
    // No args — exactly how index.ts mounts the live route.
    app.use('/api/channel-adapters', createChannelAdapterRouter());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server failed to bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const res = await fetch(`${baseUrl}/api/channel-adapters`);
      expect(res.status).toBe(200);
      const payload = (await res.json()) as { adapters: Array<{ kind: string; availability: string }> };
      expect(payload.adapters.some((a) => a.kind === 'email')).toBe(true);
      expect(payload.adapters.find((a) => a.kind === 'email')!.availability).toBe('available');
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('tls-only-live-secret');
      expect(serialized).not.toMatch(/smtp\.example|alerts|465|host|port|pass/i);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it('the no-arg router refuses configured plaintext AUTH (nothing registered, no leak)', async () => {
    process.env.ENTITY_EMAIL_SMTP_HOST = 'smtp.example.com';
    process.env.ENTITY_EMAIL_SMTP_PORT = '25';
    process.env.ENTITY_EMAIL_SMTP_USER = 'alerts';
    process.env.ENTITY_EMAIL_SMTP_PASS = 'plaintext-live-secret';

    let server: http.Server;
    const app = express();
    app.use('/api/channel-adapters', createChannelAdapterRouter());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server failed to bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const res = await fetch(`${baseUrl}/api/channel-adapters`);
      expect(res.status).toBe(200);
      const payload = (await res.json()) as { adapters: Array<{ kind: string }> };
      expect(payload.adapters.some((a) => a.kind === 'email')).toBe(false);
      expect(JSON.stringify(payload)).not.toContain('plaintext-live-secret');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});
