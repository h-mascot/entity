import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendOrgScope,
  buildOrgScopedRequestIdentity,
  isOrgScopedRequestCurrent,
  orgScopeHeaders,
  resolveLegacyFileOrgSelection,
  withOrgScope,
} from './legacyFileScope.ts';

test('legacy file scope preserves unscoped requests and scopes URL plus header when selected', () => {
  assert.equal(appendOrgScope('/files?path=docs%2Fguide.md'), '/files?path=docs%2Fguide.md');
  assert.equal(
    appendOrgScope('/files?path=docs%2Fguide.md', ' org/beta '),
    '/files?path=docs%2Fguide.md&orgId=org%2Fbeta',
  );
  assert.equal(withOrgScope(undefined), undefined);
  assert.deepEqual(withOrgScope({ method: 'GET' }, 'org-beta'), {
    method: 'GET',
    headers: { 'x-entity-org-id': 'org-beta' },
  });
});

test('legacy file scope omits the compatibility header for Unicode and control IDs', () => {
  assert.deepEqual(orgScopeHeaders('org-beta'), { 'x-entity-org-id': 'org-beta' });
  assert.deepEqual(orgScopeHeaders('  组织/😀  '), {});
  assert.deepEqual(orgScopeHeaders('org\u0001'), {});

  const unicodeInit = withOrgScope({ method: 'GET' }, '组织/😀');
  assert.equal(new Headers(unicodeInit?.headers).has('x-entity-org-id'), false);

  const replacedInit = withOrgScope(
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-entity-org': 'old-org',
        'x-entity-org-id': 'org-a',
      },
    },
    '组织/😀',
  );
  const replacedHeaders = new Headers(replacedInit?.headers);
  assert.equal(replacedHeaders.has('x-entity-org'), false);
  assert.equal(replacedHeaders.has('x-entity-org-id'), false);
  assert.equal(replacedHeaders.get('accept'), 'application/json');
});

test('legacy file request identity separates organizations and rejects late responses', () => {
  const orgA = buildOrgScopedRequestIdentity('org-a', 'versions', 'guide.md');
  const orgB = buildOrgScopedRequestIdentity('org-b', 'versions', 'guide.md');
  assert.notEqual(orgA, orgB);
  assert.equal(isOrgScopedRequestCurrent(1, 1, orgA, orgA), true);
  assert.equal(isOrgScopedRequestCurrent(1, 2, orgA, orgB), false);
  assert.equal(isOrgScopedRequestCurrent(2, 2, orgA, orgB), false);
});

test('legacy file org selection preserves valid scope, auto-selects only one org, and never guesses among many', () => {
  assert.equal(resolveLegacyFileOrgSelection(' org-b ', ['org-a', 'org-b']), 'org-b');
  assert.equal(resolveLegacyFileOrgSelection(null, ['org-a']), 'org-a');
  assert.equal(resolveLegacyFileOrgSelection(null, ['org-a', 'org-b']), undefined);
  assert.equal(resolveLegacyFileOrgSelection('org-missing', ['org-a', 'org-b']), undefined);
});
