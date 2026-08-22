import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LocalBridgeSecurity,
  LocalBridgeSecurityError,
  LOCAL_BRIDGE_PROTOCOL_VERSION,
  localBridgeHandshakeProof,
} from './bridge';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'entity-bridge-'));
  const file = path.join(root, 'managed.docx');
  await writeFile(file, 'fixture');
  const secret = 'test-only-secret';
  const bridge = new LocalBridgeSecurity({
    sharedSecret: secret, allowedOrigins: ['http://localhost:3000'], allowedRoots: [root],
    sessionTtlMs: 1000,
  });
  await bridge.allowDocument({ documentRef: 'doc-1', managedPath: file });
  const clientNonce = 'nonce-1';
  const handshake = {
    protocolVersion: LOCAL_BRIDGE_PROTOCOL_VERSION,
    origin: 'http://localhost:3000', clientNonce,
    proof: localBridgeHandshakeProof({ protocolVersion: LOCAL_BRIDGE_PROTOCOL_VERSION, origin: 'http://localhost:3000', clientNonce }, secret),
  };
  return { bridge, file, handshake };
}

describe('local bridge security skeleton', () => {
  it('performs authenticated handshake and reports explicit readiness', async () => {
    const { bridge, handshake } = await fixture();
    bridge.setReadiness('ready');
    const result = bridge.handshake(handshake);
    expect(result.sessionToken).toHaveLength(64);
    expect(result.readiness).toBe('ready');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects untrusted origins, bad proof, and unsupported protocol', async () => {
    const { bridge, handshake } = await fixture();
    expect(() => bridge.handshake({ ...handshake, origin: 'http://evil.test' })).toThrowError(LocalBridgeSecurityError);
    expect(() => bridge.handshake({ ...handshake, proof: 'bad' })).toThrowError(LocalBridgeSecurityError);
    expect(() => bridge.handshake({ ...handshake, protocolVersion: 99 })).toThrowError(LocalBridgeSecurityError);
  });

  it('authorizes an allowlisted document without exposing a raw secret or path input API', async () => {
    const { bridge, handshake, file } = await fixture();
    const session = bridge.handshake(handshake);
    await expect(bridge.authorize({ ...session, requestId: 'request-1', documentRef: 'doc-1', operation: 'open' }))
      .resolves.toMatchObject({ documentRef: 'doc-1', operation: 'open', canonicalPath: expect.stringContaining(path.basename(file)) });
  });

  it('rejects arbitrary paths, unknown documents, invalid operations, replay, expiry, and revocation', async () => {
    const { bridge, handshake } = await fixture();
    const session = bridge.handshake(handshake);
    await expect(bridge.authorize({ ...session, requestId: 'r1', documentRef: '/etc/passwd', operation: 'open' }))
      .rejects.toMatchObject({ code: 'unknown_document' });
    await expect(bridge.authorize({ ...session, requestId: 'r2', documentRef: 'doc-1', operation: 'delete' as never }))
      .rejects.toMatchObject({ code: 'invalid_operation' });
    await bridge.authorize({ ...session, requestId: 'r3', documentRef: 'doc-1', operation: 'open' });
    await expect(bridge.authorize({ ...session, requestId: 'r3', documentRef: 'doc-1', operation: 'open' }))
      .rejects.toMatchObject({ code: 'replayed_request' });
    bridge.revokeSession(session.sessionId);
    await expect(bridge.authorize({ ...session, requestId: 'r4', documentRef: 'doc-1', operation: 'open' }))
      .rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects traversal and symlink escapes at registration', async () => {
    const { bridge, file } = await fixture();
    await expect(bridge.allowDocument({ documentRef: 'outside', managedPath: path.join(path.dirname(file), '..', 'secret.docx') }))
      .rejects.toMatchObject({ code: 'file_unavailable' });
    await expect(bridge.allowDocument({ documentRef: 'traversal', managedPath: path.join(path.dirname(file), 'sub', '..', 'managed.docx') }))
      .resolves.toBeUndefined();
    const link = path.join(path.dirname(file), 'link.docx');
    await symlink(file, link);
    await expect(bridge.allowDocument({ documentRef: 'symlink', managedPath: link }))
      .rejects.toMatchObject({ code: 'symlink_forbidden' });
  });

  it('rejects an expired session', async () => {
    let now = 10_000;
    const { bridge, handshake } = await fixture();
    // The fixture uses the real clock; this separate boundary test uses a deterministic clock.
    const clocked = new LocalBridgeSecurity({
      sharedSecret: 'clock-secret', allowedOrigins: ['http://localhost:3000'], allowedRoots: [],
      sessionTtlMs: 10, now: () => now,
    });
    const session = clocked.handshake({ ...handshake, proof: localBridgeHandshakeProof({ protocolVersion: 1, origin: 'http://localhost:3000', clientNonce: 'nonce-1' }, 'clock-secret') });
    now += 11;
    await expect(clocked.authorize({ ...session, requestId: 'expired', documentRef: 'doc-1', operation: 'open' }))
      .rejects.toMatchObject({ code: 'expired_session' });
  });
});
