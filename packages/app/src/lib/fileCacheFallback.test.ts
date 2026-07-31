import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldUseOfflineFileCache } from './fileCacheFallback.ts';

test('uses offline file cache only for network and server failures', () => {
  assert.equal(shouldUseOfflineFileCache(null), true);
  assert.equal(shouldUseOfflineFileCache(500), true);
  assert.equal(shouldUseOfflineFileCache(503), true);
  assert.equal(shouldUseOfflineFileCache(404), false);
  assert.equal(shouldUseOfflineFileCache(403), false);
  assert.equal(shouldUseOfflineFileCache(400), false);
});
