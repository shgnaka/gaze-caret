import { buildCsrfDiagnostics } from './diagnostics-oauth-contract.ts';
import { cookieValue, constantTimeEqual } from './oauth-cookie-values.ts';

// Read-only: never changes cookies, writes KV, or grants authorization.
export async function handleCookieProbe(request: Request): Promise<Response> {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid-form' }), { status: 400, headers });
  }
  const token = form.get('csrf_token');
  const cookie = cookieValue(request, '__Host-GAZE-CSRFTOKEN');
  const diagnostics = buildCsrfDiagnostics({
    formToken: token,
    csrfCookie: cookie,
    oauthStateCookie: cookieValue(request, '__Host-GAZE-OAUTHSTATE'),
    cookieHeader: request.headers.get('Cookie'),
    tokensMatch: typeof token === 'string' && cookie !== null && constantTimeEqual(token, cookie),
    origin: request.headers.get('Origin'),
    fetchSite: request.headers.get('Sec-Fetch-Site'),
  });
  return new Response(JSON.stringify(diagnostics), { headers });
}

// Runs once at the end of the authorization page. Token stays in a same-origin
// POST body; only a fixed status is rendered, never cookies or response text.
export const COOKIE_PROBE_SCRIPT = `
(async () => {
  const output = document.getElementById('cookie-check');
  const token = document.querySelector('input[name="csrf_token"]');
  const messages = {
    valid: 'Cookie 確認: 表示直後の送信と一致を確認しました。',
    'csrf-cookie-missing': 'Cookie 確認: 表示直後から CSRF Cookie が届いていません。',
    'token-mismatch': 'Cookie 確認: 表示直後の CSRF Cookie が画面の値と一致しません。',
    'form-token-missing': 'Cookie 確認: 画面の確認情報がありません。接続を最初からやり直してください。'
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  output.textContent = 'Cookie の送信を確認しています…';
  try {
    const response = await fetch('/authorize/cookie-check', {
      method: 'POST', credentials: 'include', cache: 'no-store',
      body: new URLSearchParams({ csrf_token: token.value }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('probe-failed');
    const result = await response.json();
    output.textContent = Object.prototype.hasOwnProperty.call(messages, result.state)
      ? messages[result.state]
      : 'Cookie 確認: 応答を確認できませんでした。';
  } catch {
    output.textContent = controller.signal.aborted
      ? 'Cookie 確認: 時間切れで確認できませんでした。'
      : 'Cookie 確認: 通信に失敗しました。';
  } finally {
    clearTimeout(timer);
  }
})();
`;
