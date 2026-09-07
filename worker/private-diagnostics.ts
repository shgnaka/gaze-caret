export interface R2DiagnosticObjectSummary {
  key: string;
  size?: number;
  uploaded?: Date;
}

export interface R2DiagnosticObject {
  text(): Promise<string>;
}

export interface R2DiagnosticBucket {
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: R2DiagnosticObjectSummary[];
    truncated: boolean;
    cursor?: string;
  }>;
  get(key: string): Promise<R2DiagnosticObject | null>;
}

export interface DiagnosticReaderEnv {
  DIAGNOSTICS: R2DiagnosticBucket;
  READ_BEARER_TOKEN?: string;
}

type UnknownRecord = Record<string, unknown>;

const MAX_LIST_LIMIT = 20;
const BASIC_KEY = /^basic\/([A-Za-z0-9-]+)\.json$/;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

function jsonResponse(value: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(value), { status, headers });
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = actualBytes.length ^ expectedBytes.length;
  const length = Math.max(actualBytes.length, expectedBytes.length);
  for (let index = 0; index < length; index++) difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  return difference === 0;
}

function authenticate(request: Request, env: DiagnosticReaderEnv): Response | null {
  const expected = env.READ_BEARER_TOKEN?.trim() ?? '';
  if (!expected) return jsonResponse({ error: 'reader-not-configured' }, 503);
  const header = request.headers.get('Authorization') ?? '';
  const actual = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!actual || !constantTimeEqual(actual, expected)) {
    return jsonResponse({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
  }
  return null;
}

function listLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(MAX_LIST_LIMIT, parsed) : MAX_LIST_LIMIT;
}

function reportSummary(object: R2DiagnosticObjectSummary): { sessionId: string; kind: 'basic'; size: number | null; uploadedAt: string | null } | null {
  const match = BASIC_KEY.exec(object.key);
  if (!match) return null;
  return {
    sessionId: match[1]!,
    kind: 'basic',
    size: typeof object.size === 'number' && Number.isSafeInteger(object.size) && object.size >= 0 ? object.size : null,
    uploadedAt: object.uploaded instanceof Date && Number.isFinite(object.uploaded.getTime()) ? object.uploaded.toISOString() : null,
  };
}

function isStoredBasicEnvelope(value: unknown, sessionId: string): value is {
  schemaVersion: 1;
  type: 'basic-diagnostic';
  sessionId: string;
  sentAt: string;
  context: UnknownRecord;
  diagnostics: UnknownRecord;
} {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.type !== 'basic-diagnostic' || value.sessionId !== sessionId) return false;
  if (!isRecord(value.context) || !isRecord(value.diagnostics) || value.diagnostics.schemaVersion !== 1 || value.diagnostics.mode !== 'basic') return false;
  return !('frames' in value || 'landmarks' in value || 'features' in value || 'frames' in value.diagnostics);
}

function safeBasicEnvelope(value: {
  schemaVersion: 1;
  type: 'basic-diagnostic';
  sessionId: string;
  sentAt: string;
  context: UnknownRecord;
  diagnostics: UnknownRecord;
}): Record<string, unknown> {
  return {
    schemaVersion: value.schemaVersion,
    type: value.type,
    sessionId: value.sessionId,
    sentAt: value.sentAt,
    context: value.context,
    diagnostics: value.diagnostics,
  };
}

export async function handlePrivateDiagnosticRequest(request: Request, env: DiagnosticReaderEnv): Promise<Response> {
  const authenticationError = authenticate(request, env);
  if (authenticationError) return authenticationError;
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method-not-allowed' }, 405, { Allow: 'GET' });
  }

  const url = new URL(request.url);
  if (url.pathname === '/v2/diagnostics') {
    let listing: Awaited<ReturnType<R2DiagnosticBucket['list']>>;
    try {
      listing = await env.DIAGNOSTICS.list({
        prefix: 'basic/',
        limit: listLimit(url.searchParams.get('limit')),
        ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor')! } : {}),
      });
    } catch {
      return jsonResponse({ error: 'reader-failed' }, 500);
    }
    const reports = listing.objects.map(reportSummary).filter((report): report is NonNullable<typeof report> => report !== null);
    return jsonResponse({ schemaVersion: 1, reports, truncated: listing.truncated, nextCursor: listing.truncated ? listing.cursor ?? null : null }, 200);
  }

  const match = /^\/v2\/diagnostics\/([A-Za-z0-9-]+)$/.exec(url.pathname);
  if (!match) return jsonResponse({ error: 'not-found' }, 404);
  const sessionId = match[1]!;
  let object: R2DiagnosticObject | null;
  try {
    object = await env.DIAGNOSTICS.get(`basic/${sessionId}.json`);
  } catch {
    return jsonResponse({ error: 'reader-failed' }, 500);
  }
  if (!object) return jsonResponse({ error: 'not-found' }, 404);

  let parsed: unknown;
  try {
    parsed = JSON.parse(await object.text());
  } catch {
    return jsonResponse({ error: 'invalid-stored-report' }, 422);
  }
  if (!isStoredBasicEnvelope(parsed, sessionId)) return jsonResponse({ error: 'invalid-stored-report' }, 422);
  return jsonResponse(safeBasicEnvelope(parsed), 200);
}
