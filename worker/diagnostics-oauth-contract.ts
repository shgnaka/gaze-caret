export const GITHUB_CALLBACK_PATH = '/oauth/github/callback';
export const DIAGNOSTIC_READ_SCOPE = 'mcp:read';

export interface GitHubIdentity {
  id: string;
  login: string;
  name: string | null;
}

export type CsrfDiagnosticState = 'valid' | 'form-token-missing' | 'csrf-cookie-missing' | 'token-mismatch';
export type CsrfPresence = 'present' | 'missing';
export type CsrfOrigin = 'missing' | 'opaque-null' | 'present';
export type CsrfFetchSite = 'missing' | 'same-origin' | 'same-site' | 'cross-site' | 'none' | 'other';

export interface CsrfDiagnosticInput {
  formToken: unknown;
  csrfCookie: string | null;
  oauthStateCookie: string | null;
  cookieHeader: string | null;
  tokensMatch: boolean;
  origin: string | null;
  fetchSite: string | null;
}

export interface CsrfDiagnostics {
  schemaVersion: 1;
  state: CsrfDiagnosticState;
  formToken: CsrfPresence;
  csrfCookie: CsrfPresence;
  oauthStateCookie: CsrfPresence;
  cookieHeader: CsrfPresence;
  origin: CsrfOrigin;
  fetchSite: CsrfFetchSite;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function presence(value: unknown): CsrfPresence {
  return typeof value === 'string' && value.length > 0 ? 'present' : 'missing';
}

function classifyOrigin(value: string | null): CsrfOrigin {
  if (value === null) return 'missing';
  if (value === 'null') return 'opaque-null';
  return 'present';
}

function classifyFetchSite(value: string | null): CsrfFetchSite {
  if (value === null) return 'missing';
  if (value === 'same-origin' || value === 'same-site' || value === 'cross-site' || value === 'none') return value;
  return 'other';
}

export function buildCsrfDiagnostics(input: CsrfDiagnosticInput): CsrfDiagnostics {
  const formToken = presence(input.formToken);
  const csrfCookie = presence(input.csrfCookie);
  let state: CsrfDiagnosticState = 'valid';

  if (formToken === 'missing') state = 'form-token-missing';
  else if (csrfCookie === 'missing') state = 'csrf-cookie-missing';
  else if (!input.tokensMatch) state = 'token-mismatch';

  return {
    schemaVersion: 1,
    state,
    formToken,
    csrfCookie,
    oauthStateCookie: presence(input.oauthStateCookie),
    cookieHeader: presence(input.cookieHeader),
    origin: classifyOrigin(input.origin),
    fetchSite: classifyFetchSite(input.fetchSite),
  };
}

export function normalizeGitHubIdentity(value: unknown): GitHubIdentity | null {
  if (!isRecord(value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) return null;
  if (typeof value.login !== 'string' || value.login.length === 0 || value.login.length > 100) return null;
  const name = value.name === null || typeof value.name === 'string' ? value.name : null;
  return { id: String(value.id), login: value.login, name };
}

export function isAllowedGitHubIdentity(identity: GitHubIdentity | null, allowedUserId: string | undefined): boolean {
  return identity !== null && typeof allowedUserId === 'string' && /^\d+$/.test(allowedUserId) && identity.id === allowedUserId;
}

export function buildGitHubCallbackUrl(origin: string): string {
  const url = new URL(origin);
  url.pathname = GITHUB_CALLBACK_PATH;
  url.search = '';
  url.hash = '';
  return url.href;
}

export function requestedDiagnosticScopes(scopes: readonly string[]): string[] {
  return scopes.includes(DIAGNOSTIC_READ_SCOPE) ? [DIAGNOSTIC_READ_SCOPE] : [];
}

export function buildOAuthCookie(name: string, value: string, maxAge: number): string {
  return name + '=' + value + '; HttpOnly; Secure; Path=/; SameSite=None; Partitioned; Max-Age=' + maxAge;
}
