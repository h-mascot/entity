import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserProfile } from '../lib/userProfile.ts';
import {
  buildInboxRequestPaths,
  inboxRecipientPrincipalIds,
  unionNotificationsById,
  type EntityNotification,
} from './useEntityNotifications.ts';

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { displayName: 'User', handle: 'user', avatarUrl: '', email: '', ...overrides };
}

function notification(overrides: Partial<EntityNotification> = {}): EntityNotification {
  return {
    id: 'notification-1',
    org_id: 'org-a',
    recipient_principal_id: 'user',
    canonical_event_id: 'due-reminder:1:due-soon:2026-08-25T18:00:00.000Z',
    object_ref: { object_type: 'task', object_id: '1', link_role: 'target' },
    notification_type: 'task_nudge',
    inbox_state: 'unread',
    title: 'Due soon',
    body: '',
    policy_reason_chain_json: '[]',
    metadata_json: '{}',
    created_at: '2026-08-25T10:00:00.000Z',
    updated_at: '2026-08-25T10:00:00.000Z',
    deliveries: [],
    ...overrides,
  };
}

test('inbox recipients are the exact profile identities: displayName and handle', () => {
  // Mission Control stamps the displayName into UI-created task principal
  // fields, while API-created tasks may legitimately store the profile handle
  // in owner/initiator; reminders keep those exact values. The bell queries
  // each exact identity individually — never a folded or mapped substitute.
  assert.deepEqual(
    inboxRecipientPrincipalIds(profile({ displayName: 'Alice Smith', handle: 'alice' })),
    ['Alice Smith', 'alice'],
  );
  // Default profile: both exact strings, case-distinct ids stay distinct.
  assert.deepEqual(inboxRecipientPrincipalIds(profile()), ['User', 'user']);
});

test('identical identities collapse exactly once without case folding', () => {
  assert.deepEqual(inboxRecipientPrincipalIds(profile({ displayName: 'sam', handle: 'sam' })), ['sam']);
  // 'Ada' and 'ada' are distinct opaque ids: both queried, neither folded.
  assert.deepEqual(inboxRecipientPrincipalIds(profile({ displayName: 'Ada', handle: 'ada' })), ['Ada', 'ada']);
});

test('blank identities are dropped so loading can be skipped', () => {
  assert.deepEqual(inboxRecipientPrincipalIds(profile({ handle: '' })), ['User']);
  assert.deepEqual(inboxRecipientPrincipalIds(profile({ displayName: '  ', handle: '' })), []);
  assert.deepEqual(inboxRecipientPrincipalIds(profile({ displayName: ' Ada ', handle: ' ada ' })), ['Ada', 'ada']);
});

test('one exact-recipient query is built per identity', () => {
  const paths = buildInboxRequestPaths(['Alice Smith', 'alice']);
  // URLSearchParams form-encodes spaces as '+'; Express req.query decodes both
  // '+' and '%20' to the same exact recipient id.
  assert.deepEqual(paths, [
    '/notifications?recipientPrincipalId=Alice+Smith&inboxState=all',
    '/notifications?recipientPrincipalId=alice&inboxState=all',
  ]);
  assert.deepEqual(buildInboxRequestPaths([]), []);
});

test('unions mixed handle/displayName inboxes by notification id, newest first', () => {
  const displayNameRow = notification({
    id: 'row-display-name',
    recipient_principal_id: 'Alice Smith',
    created_at: '2026-08-25T10:00:00.000Z',
  });
  const handleRow = notification({
    id: 'row-handle',
    recipient_principal_id: 'alice',
    canonical_event_id: 'due-reminder:2:due-soon:2026-08-26T18:00:00.000Z',
    created_at: '2026-08-26T09:00:00.000Z',
  });
  const olderDisplayNameRow = notification({
    id: 'row-older',
    recipient_principal_id: 'Alice Smith',
    created_at: '2026-08-24T09:00:00.000Z',
  });

  const unioned = unionNotificationsById([[displayNameRow, olderDisplayNameRow], [handleRow]]);
  assert.deepEqual(unioned.map((n) => n.id), ['row-handle', 'row-display-name', 'row-older']);
});

test('identical identities yield no duplicate notifications in the union', () => {
  const row = notification({ id: 'row-only', recipient_principal_id: 'sam' });
  const unioned = unionNotificationsById([[row], [row], []]);
  assert.equal(unioned.length, 1);
  assert.equal(unioned[0].id, 'row-only');
});

test('union keeps org boundaries and read-state fields untouched per row', () => {
  const readRow = notification({ id: 'row-read', inbox_state: 'read', org_id: 'org-a' });
  const otherOrgRow = notification({ id: 'row-other-org', org_id: 'org-b' });
  const unioned = unionNotificationsById([[readRow], [otherOrgRow]]);
  const byId = new Map(unioned.map((n) => [n.id, n]));
  assert.equal(byId.get('row-read')?.inbox_state, 'read');
  assert.equal(byId.get('row-read')?.org_id, 'org-a');
  assert.equal(byId.get('row-other-org')?.org_id, 'org-b');
});
