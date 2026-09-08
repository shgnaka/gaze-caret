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
    const submitStatus = { textContent: '' };
    const submitButton = { disabled: false, textContent: 'GitHub で続行' };
    let submitHandler: ((event: { preventDefault: () => void }) => void) | undefined;
    const form = {
      addEventListener(type: string, handler: (event: { preventDefault: () => void }) => void) {
        assert.equal(type, 'submit');
        submitHandler = handler;
      },
      querySelector(selector: string) {
        assert.equal(selector, 'button[type="submit"]');
        return submitButton;
      },
    };
    let calls = 0;
    let cleared = false;
    let timeout: (() => void) | undefined;
    await runInNewContext(COOKIE_PROBE_SCRIPT, {
      document: {
        getElementById(selector: string) {
          if (selector === 'cookie-check') return output;
          if (selector === 'submit-status') return submitStatus;
          throw new Error(`unexpected element id: ${selector}`);
        },
        querySelector(selector: string) {
          if (selector === 'input[name="csrf_token"]') return { value: 'sample-secret' };
          if (selector === 'form[action="/authorize"]') return form;
          throw new Error(`unexpected selector: ${selector}`);
        },
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
    assert.ok(submitHandler);
    let firstPrevented = false;
    submitHandler!({ preventDefault: () => { firstPrevented = true; } });
    assert.equal(firstPrevented, false);
    assert.equal(submitButton.disabled, true);
    assert.equal(submitButton.textContent, 'GitHub へ移動しています…');
    assert.match(submitStatus.textContent, /再読み込み/);
    let secondPrevented = false;
    submitHandler!({ preventDefault: () => { secondPrevented = true; } });
    assert.equal(secondPrevented, true);
    const expected = { valid: '送信と一致', missing: '届いていません', 'network-error': '通信に失敗', timeout: '時間切れ' };
    assert.ok(output.textContent.includes(expected[scenario]));
    assert.doesNotMatch(output.textContent, /sample-secret|secret-error/);
  });
}
