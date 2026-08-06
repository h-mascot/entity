/**
 * R4: durable repository-bound org ownership for chat — repository-level proof.
 *
 * The route layer (curacel-r4-chat-org-ownership) already exercises this end to
 * end against a fresh DB. This colocated test pins the foundational schema
 * claims the migration introduces, independent of HTTP: (1) two orgs may each
 * own a same-named category/channel (per-org unique name, not global), (2)
 * org-scoped queries exclude foreign rows, and (3) legacy workspace-global
 * (org_id NULL) rows are excluded from any customer (org-scoped) query.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createChatRepository } from './chat';

const tmpDbPath = path.join(os.tmpdir(), `entity-chat-db-r4-${process.pid}-${randomUUID()}.sqlite`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;

beforeAll(() => {
  process.env.ENTITY_TASK_DB_PATH = tmpDbPath;
});

afterAll(() => {
  if (originalDbPath === undefined) delete process.env.ENTITY_TASK_DB_PATH;
  else process.env.ENTITY_TASK_DB_PATH = originalDbPath;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(tmpDbPath + suffix, { force: true }); } catch { /* best effort */ }
  }
});

describe('R4 chat repository — durable org ownership', () => {
  it('lets two orgs each own a same-named category and channel (per-org unique name)', () => {
    const repo = createChatRepository();
    const acmeCat = repo.createCategory({ id: 'org-acme::general', name: 'General', org_id: 'org-acme' });
    const betaCat = repo.createCategory({ id: 'org-beta::general', name: 'General', org_id: 'org-beta' });
    expect(acmeCat.org_id).toBe('org-acme');
    expect(betaCat.org_id).toBe('org-beta');

    // Same name, distinct orgs — the legacy global UNIQUE(name) would have rejected this.
    const acmeChannel = repo.createChannel({ id: 'org-acme::cmd', name: 'command-deck', category_id: acmeCat.id, org_id: 'org-acme' });
    const betaChannel = repo.createChannel({ id: 'org-beta::cmd', name: 'command-deck', category_id: betaCat.id, org_id: 'org-beta' });
    expect(acmeChannel.org_id).toBe('org-acme');
    expect(betaChannel.org_id).toBe('org-beta');
  });

  it('org-scoped lookups exclude foreign rows (getChannel/getCategoryByName/list)', () => {
    const repo = createChatRepository();
    // Foreign id is invisible to the other org's scope.
    expect(repo.getChannel('org-acme::cmd', 'org-beta')).toBeUndefined();
    expect(repo.getChannelByName('command-deck', 'org-beta')?.id).toBe('org-beta::cmd');
    expect(repo.getCategoryByName('General', 'org-beta')?.id).toBe('org-beta::general');

    const acmeChannels = repo.listChannels('org-acme').map((c) => c.id);
    const betaChannels = repo.listChannels('org-beta').map((c) => c.id);
    expect(acmeChannels).toContain('org-acme::cmd');
    expect(acmeChannels).not.toContain('org-beta::cmd');
    expect(betaChannels).toContain('org-beta::cmd');
    expect(betaChannels).not.toContain('org-acme::cmd');
  });

  it('legacy workspace-global (org_id NULL) rows fail closed for any customer scope', () => {
    const repo = createChatRepository();
    // Seed a legacy-unowned category/channel/message directly (no org_id).
    const unownedCat = repo.createCategory({ id: 'legacy-cat', name: 'Legacy Cat', org_id: null });
    const unownedChannel = repo.createChannel({ id: 'legacy-chan', name: 'legacy-channel', category_id: unownedCat.id, org_id: null });
    repo.createMessage({ id: 'legacy-msg', channel_id: unownedChannel.id, sender: 'user', content: 'legacy', org_id: null });

    expect(unownedChannel.org_id).toBeNull();
    // Unowned rows are excluded from every org-scoped (customer) query.
    expect(repo.getChannel('legacy-chan', 'org-acme')).toBeUndefined();
    expect(repo.getMessage('legacy-msg', 'org-acme')).toBeUndefined();
    expect(repo.listCategories('org-acme').map((c) => c.id)).not.toContain('legacy-cat');
    expect(repo.listChannels('org-acme').map((c) => c.id)).not.toContain('legacy-chan');
    // ...but remain visible to the unfiltered trusted path (orgId omitted).
    expect(repo.getChannel('legacy-chan')?.id).toBe('legacy-chan');
    expect(repo.getMessage('legacy-msg')?.id).toBe('legacy-msg');
  });

  it('a foreign channel id is never mutated through org-scoped update/delete/link', () => {
    const repo = createChatRepository();
    const before = repo.getChannel('org-beta::cmd', 'org-beta');
    expect(before).toBeTruthy();
    // Org-acme attempts against the org-beta channel: all no-ops.
    expect(repo.updateChannel('org-beta::cmd', { name: 'hijacked' }, 'org-acme')).toBeUndefined();
    expect(repo.deleteChannel('org-beta::cmd', 'org-acme')).toBe(false);
    expect(repo.linkChannelObject('org-beta::cmd', { object_type: 'task', object_id: '1', link_role: 'x' }, 'org-acme')).toBeUndefined();
    // The org-beta channel is untouched.
    const after = repo.getChannel('org-beta::cmd', 'org-beta');
    expect(after?.name).toBe('command-deck');
    expect(after?.linked_object_refs).toEqual([]);
  });
});
