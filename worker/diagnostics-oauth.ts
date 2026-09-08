import { cookieValue, constantTimeEqual } from './oauth-cookie-values.ts';
import { handleCookieProbe, COOKIE_PROBE_SCRIPT } from './oauth-cookie-probe.ts';
import { buildAuthorizationCsp } from './oauth-csp.ts';
import OAuthProvider, {
  AuthorizationError,
  type AuthRequest,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { handleDiagnosticRequest, type DiagnosticWorkerEnv } from './diagnostics-worker.ts';
import { handlePrivateDiagnosticRequest, type DiagnosticReaderEnv } from './private-diagnostics.ts';
import { buildCsrfDiagnostics, buildGitHubCallbackUrl, buildOAuthCookie, GITHUB_CALLBACK_PATH, isAllowedGitHubIdentity, normalizeGitHubIdentity, requestedDiagnosticScopes } from './diagnostics-oauth-contract.ts';
import { diagnosticMcpApi } from './diagnostics-mcp-stateless.ts';

export interface DiagnosticsOAuthEnv extends Omit<DiagnosticWorkerEnv, 'DIAGNOSTICS'>, Omit<DiagnosticReaderEnv, 'DIAGNOSTICS'> {
  DIAGNOSTICS: DiagnosticWorkerEnv['DIAGNOSTICS'] & DiagnosticReaderEnv['DIAGNOSTICS'];
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  COOKIE_ENCRYPTION_KEY?: string;
  ALLOWED_GITHUB_USER_ID?: string;
  READ_BEARER_TOKEN?: string;
}

interface GitHubOAuthState {
  oauthRequest: AuthRequest;
  aiRead: boolean;
}

const OAUTH_STATE_TTL_SECONDS = 600;
const CSRF_COOKIE = '__Host-GAZE-CSRFTOKEN';
const STATE_COOKIE = '__Host-GAZE-OAUTHSTATE';
const STATE_PREFIX = 'oauth:github:state:';
const DUMMY_SCOPE = 'mcp:read';
const MCP_ORIGIN = 'https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
}

function setCookie(name: string, value: string, maxAge: number): string {
  return buildOAuthCookie(name, value, maxAge);
}

function clearCookie(name: string): string {
  return setCookie(name, '', 0);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function securityHeaders(origin: string, nonce?: string): Headers {
  return new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': buildAuthorizationCsp(origin, nonce),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
}

function htmlResponse(body: string, cookies: string[] = [], origin = MCP_ORIGIN, nonce?: string): Response {
  const headers = securityHeaders(origin, nonce);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(body, { status: 200, headers });
}

function jsonError(status: number, code: string, diagnostics?: unknown): Response {
  const body = diagnostics === undefined ? { error: code } : { error: code, diagnostics };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function oauthErrorResponse(error: unknown): Response {
  if (!(error instanceof AuthorizationError)) return jsonError(500, 'server-error');
  if (!error.redirectUri) return jsonError(400, error.code);
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set('error', error.code);
  redirect.searchParams.set('error_description', error.description);
  if (error.state) redirect.searchParams.set('state', error.state);
  if (error.issuer) redirect.searchParams.set('iss', error.issuer);
  return Response.redirect(redirect.toString(), 302);
}

async function parseOAuthRequest(request: Request, env: DiagnosticsOAuthEnv): Promise<AuthRequest | Response> {
  try {
    return await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return oauthErrorResponse(error);
    return jsonError(400, 'invalid-oauth-request');
  }
}

function authorizePage(request: Request, clientName: string, csrfToken: string): Response {
  const nonce = crypto.randomUUID();
  const query = escapeHtml(new URL(request.url).searchParams.toString());
  const title = escapeHtml(clientName || 'MCP client');
  const body = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>gaze-caret diagnostics の認証</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem">
  <h1>gaze-caret diagnostics</h1>
  <p>接続元 <strong>${title}</strong> に、この Worker の読み取りを許可します。</p>
  <p>GitHub で認証後、許可した診断データが MCP 経由で AI に渡る可能性があります。</p>
  <p id="cookie-check" role="status" aria-live="polite">Cookie の自動確認を準備しています。</p>
  <noscript>JavaScript が無効のため自動確認できません。続行時の認証検証は行われます。</noscript>
  <form method="post" action="/authorize">
    <input type="hidden" name="oauth_params" value="${query}">
    <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
    <label><input type="checkbox" name="ai_read" value="on"> 診断ログの AI 読み取りを許可する</label>
    <p><button type="submit">GitHub で続行</button></p>
  </form>
<script nonce="${nonce}">${COOKIE_PROBE_SCRIPT}</script>
</body></html>`;
  return htmlResponse(body, [setCookie(CSRF_COOKIE, csrfToken, OAUTH_STATE_TTL_SECONDS)], new URL(request.url).origin, nonce);
}

function callbackRequest(request: Request, query: string): Request {
  const url = new URL('/authorize', request.url);
  url.search = query.startsWith('?') ? query.slice(1) : query;
  return new Request(url, { method: 'GET', headers: request.headers });
}

async function authorize(request: Request, env: DiagnosticsOAuthEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });

  if (request.method === 'GET') {
    const parsed = await parseOAuthRequest(request, env);
    if (parsed instanceof Response) return parsed;
    const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
    if (!client) return jsonError(400, 'unknown-client');
    const csrfToken = crypto.randomUUID();
    return authorizePage(request, client.clientName ?? parsed.clientId, csrfToken);
  }

  const form = await request.formData();
  const csrfToken = form.get('csrf_token');
  const csrfCookie = cookieValue(request, CSRF_COOKIE);
  const csrfDiagnostics = buildCsrfDiagnostics({
    formToken: csrfToken,
    csrfCookie,
    oauthStateCookie: cookieValue(request, STATE_COOKIE),
    cookieHeader: request.headers.get('Cookie'),
    tokensMatch: typeof csrfToken === 'string' && csrfCookie !== null && constantTimeEqual(csrfToken, csrfCookie),
    origin: request.headers.get('Origin'),
    fetchSite: request.headers.get('Sec-Fetch-Site'),
  });
  if (csrfDiagnostics.state !== 'valid') return jsonError(400, 'csrf-failed', csrfDiagnostics);
  const query = form.get('oauth_params');
  if (typeof query !== 'string' || query.length === 0 || query.length > 8000) return jsonError(400, 'invalid-oauth-request');

  const parsed = await parseOAuthRequest(callbackRequest(request, query), env);
  if (parsed instanceof Response) return parsed;
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client) return jsonError(400, 'unknown-client');

  const upstreamState = crypto.randomUUID();
  const stateRecord: GitHubOAuthState = { oauthRequest: parsed, aiRead: form.get('ai_read') === 'on' };
  await env.OAUTH_KV.put(`${STATE_PREFIX}${upstreamState}`, JSON.stringify(stateRecord), { expirationTtl: OAUTH_STATE_TTL_SECONDS });
  const stateHash = await sha256Hex(upstreamState);
  const callbackUrl = buildGitHubCallbackUrl(request.url);
  const githubUrl = new URL('https://github.com/login/oauth/authorize');
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID ?? '');
  githubUrl.searchParams.set('redirect_uri', callbackUrl);
  githubUrl.searchParams.set('scope', 'read:user');
  githubUrl.searchParams.set('state', upstreamState);

  const headers = new Headers({ Location: githubUrl.toString(), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', setCookie(STATE_COOKIE, stateHash, OAUTH_STATE_TTL_SECONDS));
  headers.append('Set-Cookie', clearCookie(CSRF_COOKIE));
  return new Response(null, { status: 302, headers });
}

async function exchangeGitHubCode(code: string, env: DiagnosticsOAuthEnv, callbackUrl: string): Promise<string | null> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null;
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: callbackUrl }),
  });
  if (!response.ok) return null;
  const body = await response.json() as { access_token?: unknown };
  return typeof body.access_token === 'string' && body.access_token.length > 0 && body.access_token.length <= 500 ? body.access_token : null;
}

async function githubCallback(request: Request, env: DiagnosticsOAuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || state.length > 200 || !code || code.length > 1000) return jsonError(400, 'invalid-callback');

  const stateJson = await env.OAUTH_KV.get(`${STATE_PREFIX}${state}`);
  const stateCookie = cookieValue(request, STATE_COOKIE);
  const expectedCookie = await sha256Hex(state);
  if (!stateJson || !stateCookie || !constantTimeEqual(stateCookie, expectedCookie)) return jsonError(400, 'invalid-or-expired-state');
  await env.OAUTH_KV.delete(`${STATE_PREFIX}${state}`);

  let stored: GitHubOAuthState;
  try {
    stored = JSON.parse(stateJson) as GitHubOAuthState;
  } catch {
    return jsonError(500, 'invalid-state-data');
  }
  const callbackUrl = buildGitHubCallbackUrl(request.url);
  const accessToken = await exchangeGitHubCode(code, env, callbackUrl);
  if (!accessToken) return jsonError(502, 'github-token-exchange-failed');

  const userResponse = await fetch('https://api.github.com/user', {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!userResponse.ok) return jsonError(502, 'github-identity-failed');
  const identity = normalizeGitHubIdentity(await userResponse.json());
  if (!identity) return jsonError(502, 'invalid-github-identity');
  if (!isAllowedGitHubIdentity(identity, env.ALLOWED_GITHUB_USER_ID)) return jsonError(403, 'github-user-not-allowed');

  try {
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: stored.oauthRequest,
      userId: identity.id,
      metadata: { label: `GitHub: ${identity.login}` },
      scope: stored.aiRead ? requestedDiagnosticScopes(stored.oauthRequest.scope) : [],
      props: {
        githubUserId: identity.id,
        login: identity.login,
        displayName: identity.name ?? identity.login,
        aiRead: stored.aiRead,
      },
    });
    const headers = new Headers({ Location: redirectTo, 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', clearCookie(STATE_COOKIE));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return error instanceof AuthorizationError ? oauthErrorResponse(error) : jsonError(500, 'authorization-failed');
  }
}

const defaultHandler = {
  async fetch(request: Request, env: DiagnosticsOAuthEnv) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/authorize/cookie-check') return handleCookieProbe(request);
    if (pathname === '/authorize') return authorize(request, env);
    if (pathname === GITHUB_CALLBACK_PATH) return githubCallback(request, env);
    if (pathname === '/ingest') return handleDiagnosticRequest(request, env);
    if (pathname === '/v2/diagnostics' || pathname.startsWith('/v2/diagnostics/')) return handlePrivateDiagnosticRequest(request, env);
    return jsonError(404, 'not-found');
  },
};

export default new OAuthProvider<DiagnosticsOAuthEnv>({
  apiRoute: '/mcp',
  apiHandler: diagnosticMcpApi as never,
  defaultHandler: defaultHandler as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: [DUMMY_SCOPE],
  accessTokenTTL: 3600,
  refreshTokenTTL: 30 * 24 * 60 * 60,
  resourceMetadata: {
    resource: `${MCP_ORIGIN}/mcp`,
    authorization_servers: [MCP_ORIGIN],
    scopes_supported: [DUMMY_SCOPE],
    resource_name: 'gaze-caret diagnostics',
  },
});
