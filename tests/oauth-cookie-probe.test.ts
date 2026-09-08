import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCookieProbe } from '../worker/oauth-cookie-probe.ts';

for (const [cookie, expected] of [
  ['__Host-GAZE-CSRFTOKEN=sample-secret', 'valid'],
  ['__Host-GAZE-OAUTHSTATE=other-secret', 'csrf-cookie-missing'],
  ['__Host-GAZE-CSRFTOKEN=different-secret', 'token-mismatch'],
] as const) {
  test(`immediate cookie probe reports ${expected} without exposing or changing cookies`, async () => {
    const response = await handleCookieProbe(new Request('https://example.test/authorize/cookie-check', {
      method: 'POST', headers: { Cookie: cookie }, body: new URLSearchParams({ csrf_token: 'sample-secret' }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    const body = await response.text();
    assert.equal(JSON.parse(body).state, expected);
    assert.doesNotMatch(body, /sample-secret|other-secret|different-secret/);
  });
}
test('probe rejects GET and malformed bodies', async () => {
  assert.equal((await handleCookieProbe(new Request('https://example.test/authorize/cookie-check'))).status, 405);
  assert.equal((await handleCookieProbe(new Request('https://example.test/authorize/cookie-check', { method: 'POST', body: 'bad' }))).status, 400);
});

import { runInNewContext } from 'node:vm';
import { COOKIE_PROBE_SCRIPT } from '../worker/oauth-cookie-probe.ts';

for (const scenario of ['valid', 'missing', 'network-error', 'timeout'] as const) {
  test(`page automatically probes and displays ${scenario} without user interaction`, async () => {
    const output = { textContent: '' };
    let calls = 0;
    let cleared = false;
    let timeout: (() => void) | undefined;
    await runInNewContext(COOKIE_PROBE_SCRIPT, {
      document: {
        getElementById: () => output,
        querySelector: () => ({ value: 'sample-secret' }),
      },
      AbortController, URLSearchParams,
      setTimeout(callback: () => void, delay: number) {
        assert.equal(delay, 5000);
        timeout = callback;
        return 1;
      },
      clearTimeout() { cleared = true; },
      async fetch(url: string, init: RequestInit) {
        calls++;
        assert.equal(url, '/authorize/cookie-check');
        assert.equal(init.credentials, 'include');
        assert.equal(init.cache, 'no-store');
        if (scenario === 'timeout') timeout!();
        if (scenario === 'network-error' || scenario === 'timeout') throw new Error('secret-error');
        return handleCookieProbe(new Request('https://example.test' + url, {
          ...init, headers: scenario === 'valid' ? { Cookie: '__Host-GAZE-CSRFTOKEN=sample-secret' } : {},
        }));
      },
    });
    assert.equal(calls, 1);
    assert.equal(cleared, true);
    const expected = { valid: '送信と一致', missing: '届いていません', 'network-error': '通信に失敗', timeout: '時間切れ' };
    assert.ok(output.textContent.includes(expected[scenario]));
    assert.doesNotMatch(output.textContent, /sample-secret|secret-error/);
  });
}
