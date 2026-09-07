export const GITHUB_CALLBACK_PATH = '/oauth/github/callback';
export const DIAGNOSTIC_READ_SCOPE = 'mcp:read';

export interface GitHubIdentity {
  id: string;
  login: string;
  name: string | null;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
