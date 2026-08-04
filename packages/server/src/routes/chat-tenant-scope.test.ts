/**
 * THE-931 — repository-boundary tenant isolation (pure-logic).
 *
 * The scoped chat repository is the authoritative org/team boundary. These
 * cases seed resources with KNOWN org/team ownership (incl. legacy unowned rows
 * and cross-org/cross-team "foreign" ids) and assert that every read/write
 * resolves ownership at the repository boundary: foreign ids are
 * indistinguishable from missing, legacy rows fail closed for non-admins, and
 * writes inherit the owned parent scope while ignoring any caller teamId.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChatRepository } from '../../../db/src/chat';
import { createScopedChatRepository, principalCanReadChatHistory } from './chat';
import { LOCAL_ADMIN_PRINCIPAL_ID } from '../principals/admin-identity';
import type { PrincipalGrant, PrincipalPermissionContext } from '../permissions';
import type { RequestOrgBinding } from '../request-permissions';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-tenant-scope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
  const repo = createChatRepository();
  repo.createCategory({ id: 'cat-a1', name: 'Cat A1', org_id: 'org-a', team_id: 'team-a1' });
  repo.createCategory({ id: 'cat-a2', name: 'Cat A2', org_id: 'org-a', team_id: 'team-a2' });
  repo.createCategory({ id: 'cat-a-orgwide', name: 'Cat A Orgwide', org_id: 'org-a' });
  repo.createCategory({ id: 'cat-b1', name: 'Cat B1', org_id: 'org-b', team_id: 'team-b1' });
  repo.createCategory({ id: 'cat-legacy', name: 'Cat Legacy' });
  // Seed channels with explicit ownership across two orgs / multiple teams.
  repo.createChannel({ id: 'ch-a1', name: 'ch-a1', category_id: 'cat-a1', org_id: 'org-a', team_id: 'team-a1' });
  repo.createChannel({ id: 'ch-a2', name: 'ch-a2', category_id: 'cat-a2', org_id: 'org-a', team_id: 'team-a2' });
  repo.createChannel({ id: 'ch-a-orgwide', name: 'ch-a-orgwide', category_id: 'cat-a-orgwide', org_id: 'org-a', team_id: undefined });
  repo.createChannel({ id: 'ch-b1', name: 'ch-b1', category_id: 'cat-b1', org_id: 'org-b', team_id: 'team-b1' });
  // A legacy unowned channel (org_id null) — preserved but fails closed.
  repo.createChannel({ id: 'ch-legacy', name: 'ch-legacy', category_id: 'cat-legacy' });
  // Seed a parent message + thread under ch-a1 (owned by org-a/team-a1).
  repo.createMessage({ id: 'msg-a1', channel_id: 'ch-a1', sender: 'user', content: 'hi', org_id: 'org-a', team_id: 'team-a1' });
  repo.createThread({ id: 'thr-a1', channel_id: 'ch-a1', parent_message_id: 'msg-a1', title: 'T', org_id: 'org-a', team_id: 'team-a1' });
});

afterAll(() => {
  if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  else delete process.env.ENTITY_TASK_DB_PATH;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(tmpDbPath + suffix, { force: true }); } catch {}
  }
});

function principal(id: string, grants: PrincipalGrant[]): PrincipalPermissionContext {
  return { principal_id: id, grants };
}

function binding(orgId: string, p: PrincipalPermissionContext): RequestOrgBinding {
  return { orgId, principal: p };
}

const ORG_ADMIN_A = principal('admin-a', [{ role: 'admin', org_id: 'org-a' }]);
const TEAM_CONTRIB_A1 = principal('contrib-a1', [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a1' }]);
const TEAM_CONTRIB_A2 = principal('contrib-a2', [{ role: 'contributor', org_id: 'org-a', team_id: 'team-a2' }]);
const NO_GRANT = principal('no-grant', []);
const ORG_B_MEMBER = principal('contrib-b1', [{ role: 'contributor', org_id: 'org-b', team_id: 'team-b1' }]);
const LOCAL_ADMIN = principal(LOCAL_ADMIN_PRINCIPAL_ID, [{ role: 'admin', org_id: 'org-a' }]);

const access = principalCanReadChatHistory;

describe('THE-931 — scoped chat repository tenant isolation', () => {
  it('historyAllowed is false for a no-grant principal and true for any org-scoped grant', () => {
    expect(access(binding('org-a', NO_GRANT)).allowed).toBe(false);
    expect(access(binding('org-a', TEAM_CONTRIB_A1)).allowed).toBe(true);
    expect(access(binding('org-a', ORG_ADMIN_A)).allowed).toBe(true);
  });

  it('listChannels returns only owned channels (org-wide admin sees all org teams; team-only sees one team)', () => {
    const repo = createChatRepository();
    const admin = createScopedChatRepository(repo, binding('org-a', ORG_ADMIN_A), access);
    const adminIds = admin.listChannels().map((c) => c.id).sort();
    // org-wide admin sees every org-a team channel + the org-wide channel; never
    // the foreign org-b channel nor the legacy unowned channel.
    expect(adminIds).toEqual(['ch-a-orgwide', 'ch-a1', 'ch-a2']);

    const teamA1 = createScopedChatRepository(repo, binding('org-a', TEAM_CONTRIB_A1), access);
    expect(teamA1.listChannels().map((c) => c.id)).toEqual(['ch-a1']);
  });

  it('treats a known foreign id as indistinguishable from a missing one (no-leak)', () => {
    const repo = createChatRepository();
    const a1 = createScopedChatRepository(repo, binding('org-a', TEAM_CONTRIB_A1), access);
    // Cross-team (same org) foreign id vs a genuinely missing id: both undefined.
    expect(a1.getChannel('ch-a2')).toBeUndefined();
    expect(a1.getChannel('does-not-exist')).toBeUndefined();
    // Cross-org foreign id.
    expect(a1.getChannel('ch-b1')).toBeUndefined();
    // A message under a foreign-team channel is hidden (no-leak) while one under
    // the owned channel is visible — proving ownership, not existence, governs.
    expect(a1.getMessage('msg-a1')).toBeDefined();
    const repo2 = createChatRepository();
    const foreignMsg = repo2.createMessage({ id: 'msg-a2', channel_id: 'ch-a2', sender: 'user', content: 'x', org_id: 'org-a', team_id: 'team-a2' });
    expect(a1.getMessage(foreignMsg.id)).toBeUndefined();
  });

  it('a team-only principal cannot read an org-wide (team-less) channel or another team', () => {
    const repo = createChatRepository();
    const a1 = createScopedChatRepository(repo, binding('org-a', TEAM_CONTRIB_A1), access);
    expect(a1.getChannel('ch-a-orgwide')).toBeUndefined(); // team grant ≠ org-wide resource
    expect(a1.getChannel('ch-a2')).toBeUndefined(); // different team
    expect(a1.getChannel('ch-a1')).toBeDefined(); // matching team
  });

  it('legacy unowned rows fail closed for every non-local-admin principal', () => {
    const repo = createChatRepository();
    expect(createScopedChatRepository(repo, binding('org-a', ORG_ADMIN_A), access).getChannel('ch-legacy')).toBeUndefined();
    expect(createScopedChatRepository(repo, binding('org-a', TEAM_CONTRIB_A1), access).getChannel('ch-legacy')).toBeUndefined();
    // The local admin compatibility principal may read legacy rows.
    expect(createScopedChatRepository(repo, binding('org-a', LOCAL_ADMIN), access).getChannel('ch-legacy')).toBeDefined();
  });

  it('writes inherit the owned parent scope and ignore caller teamId', () => {
    const repo = createChatRepository();
    const a1 = createScopedChatRepository(repo, binding('org-a', TEAM_CONTRIB_A1), access);
    // Creating a message in the owned channel inherits team-a1; the scoped API
    // accepts no caller teamId at all, so it cannot be spoofed.
    const created = a1.createMessage({ channel_id: 'ch-a1', sender: 'user', content: 'derived' });
    expect(created).toBeDefined();
    expect(created!.team_id).toBe('team-a1');
    expect(created!.org_id).toBe('org-a');

    // A message written by A1 is NOT visible to A2 (foreign team) — derivation
    // is correct and the read boundary enforces it.
    const a2 = createScopedChatRepository(repo, binding('org-a', TEAM_CONTRIB_A2), access);
    expect(a2.getMessage(created!.id)).toBeUndefined();

    // Writing into a foreign-team channel is rejected at the boundary.
    expect(a1.createMessage({ channel_id: 'ch-a2', sender: 'user', content: 'x' })).toBeUndefined();
    // Writing into a foreign-org channel is rejected.
    expect(a1.createMessage({ channel_id: 'ch-b1', sender: 'user', content: 'x' })).toBeUndefined();
  });

  it('thread creation resolves parent ownership and inherits the channel team scope', () => {
    const repo = createChatRepository();
    const a1 = createScopedChatRepository(repo, binding('org-a', TEAM_CONTRIB_A1), access);
    // Parent message in the owned channel → thread created with team-a1.
    const parent = a1.createMessage({ channel_id: 'ch-a1', sender: 'user', content: 'parent' })!;
    const thread = a1.createThread({ channel_id: 'ch-a1', parent_message_id: parent.id, title: 'New' });
    expect(thread).toBeDefined();
    expect(thread!.team_id).toBe('team-a1');
    expect(thread!.org_id).toBe('org-a');

    // Thread creation against a foreign-team parent message is rejected.
    const foreignParent = repo.createMessage({ id: 'msg-a2-thread', channel_id: 'ch-a2', sender: 'user', content: 'p', org_id: 'org-a', team_id: 'team-a2' });
    expect(a1.createThread({ channel_id: 'ch-a2', parent_message_id: foreignParent.id, title: 'X' })).toBeUndefined();
  });

  it('object-ref links and channel mutations are bounded by ownership', () => {
    const repo = createChatRepository();
    const a1 = createScopedChatRepository(repo, binding('org-a', TEAM_CONTRIB_A1), access);
    const ref = { object_type: 'task', object_id: '1', link_role: 'context' };
    expect(a1.linkChannelObject('ch-a1', ref)).toBeDefined();
    // Foreign channel link is rejected (no-leak).
    expect(a1.linkChannelObject('ch-a2', ref)).toBeUndefined();
    // Mutations on a foreign channel are rejected.
    expect(a1.updateChannel('ch-a2', { name: 'hacked' })).toBeUndefined();
    expect(a1.deleteChannel('ch-a2')).toBe(false);
    expect(a1.markChannelRead('ch-a2')).toBe(false);
    // listMessagesByChannel on a foreign channel returns [] (not a leak).
    expect(a1.listMessagesByChannel('ch-a2')).toEqual([]);
  });
});
