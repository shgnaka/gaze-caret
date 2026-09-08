import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthorizationCsp } from '../worker/oauth-csp.ts';

test('authorization CSP permits the opaque-origin form post and GitHub redirect', () => {
  const policy = buildAuthorizationCsp('https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev', 'nonce-value');
  assert.match(policy, /form-action https:\/\/gaze-caret-diagnostics\.shogonakamurawppt\.workers\.dev https:\/\/github\.com/);
  assert.match(policy, /connect-src https:\/\/gaze-caret-diagnostics\.shogonakamurawppt\.workers\.dev/);
  assert.match(policy, /script-src 'nonce-nonce-value'/);
  assert.doesNotMatch(policy, /form-action 'self'/);
  assert.doesNotMatch(policy, /connect-src 'self'/);
});
