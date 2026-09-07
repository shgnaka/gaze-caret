import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GITHUB_CALLBACK_PATH,
  buildCsrfDiagnostics,
  buildGitHubCallbackUrl,
  buildOAuthCookie,
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

test('OAuth transaction cookies support embedded authorization flows', () => {
  const cookie = buildOAuthCookie('__Host-GAZE-CSRFTOKEN', 'csrf-token', 600);
  assert.match(cookie, /^__Host-GAZE-CSRFTOKEN=csrf-token;/);
  assert.match(cookie, /; HttpOnly;/);
  assert.match(cookie, /; Secure;/);
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; SameSite=None;/);
  assert.match(cookie, /; Partitioned;/);
  assert.match(cookie, /; Max-Age=600$/);
  assert.doesNotMatch(cookie, /; Domain=/);
});

test('CSRF diagnostics identify a missing form token without exposing values', () => {
  const diagnostics = buildCsrfDiagnostics({
    formToken: null,
    csrfCookie: null,
    oauthStateCookie: 'state-value',
    cookieHeader: '__Host-GAZE-OAUTHSTATE=state-value',
    tokensMatch: false,
    origin: 'null',
    fetchSite: 'same-origin',
  });

  assert.deepEqual(diagnostics, {
    schemaVersion: 1,
    state: 'form-token-missing',
    formToken: 'missing',
    csrfCookie: 'missing',
    oauthStateCookie: 'present',
    cookieHeader: 'present',
    origin: 'opaque-null',
    fetchSite: 'same-origin',
  });
  assert.equal(JSON.stringify(diagnostics).includes('state-value'), false);
});

test('CSRF diagnostics identify a missing cookie', () => {
  const diagnostics = buildCsrfDiagnostics({
    formToken: 'csrf-token',
    csrfCookie: null,
    oauthStateCookie: null,
    cookieHeader: null,
    tokensMatch: false,
    origin: 'https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev',
    fetchSite: null,
  });

  assert.equal(diagnostics.state, 'csrf-cookie-missing');
  assert.equal(diagnostics.formToken, 'present');
  assert.equal(diagnostics.csrfCookie, 'missing');
  assert.equal(diagnostics.cookieHeader, 'missing');
  assert.equal(diagnostics.origin, 'present');
  assert.equal(diagnostics.fetchSite, 'missing');
});

test('CSRF diagnostics identify a token mismatch without exposing values', () => {
  const diagnostics = buildCsrfDiagnostics({
    formToken: 'form-token',
    csrfCookie: 'cookie-token',
    oauthStateCookie: null,
    cookieHeader: '__Host-GAZE-CSRFTOKEN=cookie-token',
    tokensMatch: false,
    origin: 'https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev',
    fetchSite: 'cross-site',
  });

  assert.equal(diagnostics.state, 'token-mismatch');
  assert.equal(JSON.stringify(diagnostics).includes('form-token'), false);
  assert.equal(JSON.stringify(diagnostics).includes('cookie-token'), false);
});

test('CSRF diagnostics mark a valid pair as valid', () => {
  const diagnostics = buildCsrfDiagnostics({
    formToken: 'same-token',
    csrfCookie: 'same-token',
    oauthStateCookie: null,
    cookieHeader: '__Host-GAZE-CSRFTOKEN=same-token',
    tokensMatch: true,
    origin: 'https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev',
    fetchSite: 'same-origin',
  });

  assert.equal(diagnostics.state, 'valid');
  assert.equal(diagnostics.formToken, 'present');
  assert.equal(diagnostics.csrfCookie, 'present');
});
