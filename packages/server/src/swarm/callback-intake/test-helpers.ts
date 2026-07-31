/**
 * Shared fixtures for EEPC-A-03 / EEPC-A-07 callback intake tests.
 */

import type { CallbackAuthContext } from './types';

/** Test-only callback secret (header-presented; never embedded in JSON bodies). */
export const TEST_CALLBACK_SECRET = 'test-eepc-a07-callback-secret-00000001';

export const TEST_AUTH: CallbackAuthContext = {
  authorization: `Bearer ${TEST_CALLBACK_SECRET}`,
};
