import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryIsScoped,
  channelIsScoped,
  refreshedMutationNotice,
  validSelection,
} from './communicationControlsModel.ts';

test('selects a valid scoped option and replaces stale selections', () => {
  const options = [{ id: 'org-a' }, { id: 'org-b' }];
  assert.equal(validSelection('org-b', options), 'org-b');
  assert.equal(validSelection('stale-org', options), 'org-a');
  assert.equal(validSelection('stale-org', []), '');
});

test('requires saved channel scope before channel or category noise controls', () => {
  const channels = [
    { id: 'channel-a', category_id: 'category-a' },
    { id: 'channel-b', category_id: 'category-a' },
  ];
  assert.equal(channelIsScoped('channel-a', []), false);
  assert.equal(channelIsScoped('channel-a', [{ channel_id: 'channel-a' }]), true);
  assert.equal(categoryIsScoped('category-a', channels, [{ channel_id: 'channel-a' }]), false);
  assert.equal(categoryIsScoped('category-a', channels, [
    { channel_id: 'channel-a' },
    { channel_id: 'channel-b' },
  ]), true);
});

test('confirms a mutation only after refreshed state loads successfully', async () => {
  assert.equal(
    await refreshedMutationNotice(async () => true),
    'Change saved. Updated state is shown below.',
  );
  assert.equal(await refreshedMutationNotice(async () => false), '');
});
