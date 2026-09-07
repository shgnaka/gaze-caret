import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GITHUB_CALLBACK_PATH,
  buildGitHubCallbackUrl,
  isAllowedGitHubIdentity,
  normalizeGitHubIdentity,
  requestedDiagnosticScopes,
} from '../worker/diagnostics-oauth-contract.ts';

test('GitHub access is bound to the immutable numeric user ID', () => {
  const identity = normalizeGitHubIdentity({ id: 90955191, login: 'shgnaka', name: 'owner' });
  assert.deepEqual(identity, { id: '90955191', login: 'shgnaka', name: 'owner' });
  assert.equal(isAllowedGitHubIdentity(identity, '90955191'), true);
  assert.equal(isAllowedGitHubIdentity({ id: '90955191', login: 'attacker', name: null }, '90955191'), true);
  assert.equal(isAllowedGitHubIdentity({ id: '123', login: 'shgnaka', name: null }, '90955191'), false);
});

test('malformed GitHub identities fail closed', () => {
  assert.equal(normalizeGitHubIdentity(null), null);
  assert.equal(normalizeGitHubIdentity({ id: 0, login: 'shgnaka' }), null);
  assert.equal(normalizeGitHubIdentity({ id: 90955191.5, login: 'shgnaka' }), null);
  assert.equal(normalizeGitHubIdentity({ id: 90955191, login: '' }), null);
  assert.equal(isAllowedGitHubIdentity(null, '90955191'), false);
  assert.equal(isAllowedGitHubIdentity({ id: '90955191', login: 'shgnaka', name: null }, ''), false);
});

test('GitHub callback uses the registered path without accepting a path override', () => {
  assert.equal(GITHUB_CALLBACK_PATH, '/oauth/github/callback');
  assert.equal(
    buildGitHubCallbackUrl('https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev'),
    'https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev/oauth/github/callback',
  );
  assert.equal(buildGitHubCallbackUrl('https://example.test/other'), 'https://example.test/oauth/github/callback');
});

test('only the diagnostic read scope can be granted', () => {
  assert.deepEqual(requestedDiagnosticScopes(['mcp:read', 'repo', 'admin']), ['mcp:read']);
  assert.deepEqual(requestedDiagnosticScopes(['repo']), []);
  assert.deepEqual(requestedDiagnosticScopes([]), []);
});
