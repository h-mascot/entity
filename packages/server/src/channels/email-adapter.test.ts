/**
 * THE-932 (blocker 3) — SMTP backend health is enforced at the live channel
 * adapter configuration/registration boundary, not an orphan validator.
 *
 * `createEmailChannelAdapter` validates the SMTP backend config at construction
 * via `validateSmtpBackendConfig` and fails closed on plaintext SMTP AUTH. The
 * production `/api/channel-adapters` route exposes the registry snapshot
 * (public-safe, no secrets). Because the codebase has no SMTP execution path,
 * a configured email adapter honestly reports it cannot deliver (degraded) — it
 * never invents a live send and never echoes credentials.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'http';
import { createEmailChannelAdapter, EmailAdapterConfigError } from './email-adapter';
import { createChannelAdapterRegistry } from './registry';
import { createChannelAdapterRouter } from './router';

describe('email channel adapter — SMTP fail-closed at config boundary (THE-932)', () => {
  it('rejects plaintext SMTP AUTH at construction (port 25 + auth)', () => {
    expect(() =>
      createEmailChannelAdapter({ smtp: { host: 'mail.example', port: 25, auth: { user: 'u', pass: 'p' } } }),
    ).toThrowError(EmailAdapterConfigError);
    expect(() =>
      createEmailChannelAdapter({ smtp: { host: 'mail.example', port: 25, auth: { user: 'u', pass: 'p' } } }),
    ).toThrow();
  });

  it('rejects plaintext SMTP AUTH when secure:false without STARTTLS', () => {
    expect(() =>
      createEmailChannelAdapter({ smtp: { host: 'mail.example', port: 587, secure: false, auth: { user: 'u', pass: 'p' } } }),
    ).toThrowError(EmailAdapterConfigError);
  });

  it('accepts TLS-protected SMTP AUTH (implicit TLS 465 / STARTTLS) and projects available', () => {
    const tlsAdapter = createEmailChannelAdapter({
      smtp: { host: 'mail.example', port: 465, secure: true, auth: { user: 'u', pass: 'hunter2' } },
    });
    expect(tlsAdapter.getAvailability()).toBe('available');
    const starttlsAdapter = createEmailChannelAdapter({
      smtp: { host: 'mail.example', port: 587, secure: false, requireTls: true, auth: { user: 'u', pass: 'hunter2' } },
    });
    expect(starttlsAdapter.getAvailability()).toBe('available');
  });

  it('is not_configured when no SMTP backend is supplied', () => {
    const adapter = createEmailChannelAdapter({});
    expect(adapter.getAvailability()).toBe('not_configured');
  });

  it('never leaks SMTP credentials through availability, notify, or a registration attempt', async () => {
    const secret = 'super-secret-password-12345';
    const adapter = createEmailChannelAdapter({
      smtp: { host: 'mail.example', port: 465, secure: true, auth: { user: 'u', pass: secret } },
    });
    // Availability is a single enum string — no config/secret surface.
    expect(adapter.getAvailability()).toBe('available');

    // notifyStatus has no SMTP execution path: honest degraded, no live send,
    // and metadata must not contain the password.
    const result = await adapter.notifyStatus({
      kind: 'email',
      adapterId: adapter.id,
      taskId: 7,
      status: 'done',
      title: 'Task done',
    });
    expect(['degraded', 'skipped', 'failed']).toContain(result.status);
    expect(JSON.stringify(result)).not.toContain(secret);

    // Registering into a registry and snapshotting must not leak the secret.
    const registry = createChannelAdapterRegistry([adapter]);
    const snapshot = await registry.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(snapshot.adapters.some((a) => a.kind === 'email')).toBe(true);
  });

  it('a plaintext-auth email adapter can never be registered/used (fail closed)', () => {
    const registry = createChannelAdapterRegistry();
    expect(() =>
      createEmailChannelAdapter({ smtp: { port: 25, auth: { user: 'u', pass: 'p' } } }),
    ).toThrow();
    // Nothing was registered.
    expect(registry.list()).toHaveLength(0);
  });
});

describe('GET /api/channel-adapters — public-safe production route (THE-932)', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use('/api/channel-adapters', createChannelAdapterRouter());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server failed to bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it('returns a public-safe registry snapshot that never includes secrets', async () => {
    const res = await fetch(`${baseUrl}/api/channel-adapters`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { adapters: Array<{ id: string; kind: string; availability: string }> };
    expect(Array.isArray(payload.adapters)).toBe(true);
    // No adapter exposes credentials — the snapshot shape is id/kind/displayName/enabled/availability.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/pass|password|secret|token|credential/i);
  });
});
