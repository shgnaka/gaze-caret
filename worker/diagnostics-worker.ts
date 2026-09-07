import { toPublicDiagnosticReport } from '../src/core/diagnostic-upload.ts';
import type { DiagnosticReport, PublicDiagnosticReport } from '../src/core/diagnostics.ts';
import { handlePrivateDiagnosticRequest } from './private-diagnostics.ts';
import type { DiagnosticReaderEnv } from './private-diagnostics.ts';
import { handleDiagnosticMcpRequest } from './diagnostics-mcp.ts';

export interface R2PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
  put(key: string, value: string, options?: R2PutOptions): Promise<unknown>;
}

export interface DiagnosticWorkerEnv {
  DIAGNOSTICS: R2BucketLike;
  ALLOWED_ORIGIN: string;
  MAX_PAYLOAD_BYTES?: string;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const ALLOWED_METADATA = new Set(['engine', 'featureVersion', 'build']);
const ALLOWED_TIMINGS = new Set(['permissionAndStreamMs', 'modelLoadMs', 'cameraSetupMs', 'firstValidFeatureAt']);
const ALLOWED_EVENTS = new Set(['run-started', 'camera-setup-started', 'camera-requested', 'stream-ready', 'model-load-started', 'model-ready', 'camera-ready', 'camera-start-error', 'first-valid-feature', 'detector-error']);

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOwn = (value: UnknownRecord, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isShortString = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function allowedOrigin(request: Request, env: DiagnosticWorkerEnv): boolean {
  const origin = request.headers.get('Origin');
  return typeof origin === 'string' && origin !== '' && origin === env.ALLOWED_ORIGIN;
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  });
}

function response(body: string, status: number, origin?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (origin) for (const [key, value] of corsHeaders(origin)) headers.set(key, value);
  return new Response(body, { status, headers });
}

function errorResponse(status: number, origin?: string): Response {
  return response(JSON.stringify({ error: status === 400 ? 'invalid-request' : status === 403 ? 'forbidden' : 'request-failed' }), status, origin);
}

function maxPayloadBytes(env: DiagnosticWorkerEnv): number {
  const configured = Number(env.MAX_PAYLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 && configured <= 256 * 1024 ? configured : DEFAULT_MAX_PAYLOAD_BYTES;
}

function isBasicReport(value: unknown): value is PublicDiagnosticReport {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.mode !== 'basic') return false;
  if (!isRecord(value.metadata) || !isRecord(value.counters) || !isRecord(value.timings) || !Array.isArray(value.events)) return false;
  if (hasOwn(value, 'frames')) return false;
  const counters = value.counters;
  if (!isNumber(counters.frames) || !isNumber(counters.validFeatures) || !isNumber(counters.inferenceTotalMs) || !isNumber(counters.inferenceMaxMs)) return false;
  if (!isRecord(counters.faceCount) || !isNumber(counters.faceCount.zero) || !isNumber(counters.faceCount.one) || !isNumber(counters.faceCount.twoOrMore)) return false;
  return isRecord(counters.rejectionReasons) && isRecord(counters.skipped) && isRecord(counters.errors);
}

function isBasicEnvelope(value: unknown): value is {
  schemaVersion: 1;
  type: 'basic-diagnostic';
  sessionId: string;
  sentAt: string;
  context: { build: string; mode: 'camera'; fixture: string; plannedTrials: number };
  diagnostics: PublicDiagnosticReport;
} {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.type !== 'basic-diagnostic') return false;
  if (!isShortString(value.sessionId, 100) || !/^[A-Za-z0-9-]+$/.test(value.sessionId)) return false;
  if (!isShortString(value.sentAt, 40) || !isRecord(value.context) || !isBasicReport(value.diagnostics)) return false;
  const context = value.context;
  return isShortString(context.build, 100) && context.mode === 'camera' && isShortString(context.fixture, 100) &&
    isNumber(context.plannedTrials) && Number.isSafeInteger(context.plannedTrials) && context.plannedTrials >= 1 && context.plannedTrials <= 300;
}

function normalizeEnvelope(input: {
  schemaVersion: 1;
  type: 'basic-diagnostic';
  sessionId: string;
  sentAt: string;
  context: { build: string; mode: 'camera'; fixture: string; plannedTrials: number };
  diagnostics: PublicDiagnosticReport;
}): string {
  const publicReport = toPublicDiagnosticReport(input.diagnostics as DiagnosticReport);
  const metadata = Object.fromEntries(Object.entries(publicReport.metadata).filter(([key]) => ALLOWED_METADATA.has(key)));
  const timings = Object.fromEntries(Object.entries(publicReport.timings).filter(([key]) => ALLOWED_TIMINGS.has(key)));
  const events = publicReport.events.filter(event => ALLOWED_EVENTS.has(event.type)).map(event => ({ at: event.at, type: event.type }));
  const normalized = {
    schemaVersion: 1 as const,
    type: 'basic-diagnostic' as const,
    sessionId: input.sessionId,
    sentAt: input.sentAt,
    context: {
      build: input.context.build,
      mode: input.context.mode,
      fixture: input.context.fixture,
      plannedTrials: input.context.plannedTrials,
    },
    diagnostics: { ...publicReport, metadata, timings, events },
  };
  return JSON.stringify(normalized);
}

export async function handleDiagnosticRequest(request: Request, env: DiagnosticWorkerEnv): Promise<Response> {
  const origin = request.headers.get('Origin') ?? '';
  if (!allowedOrigin(request, env)) return errorResponse(403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  const url = new URL(request.url);
  if (url.pathname !== '/ingest') return errorResponse(404, origin);
  if (request.method !== 'POST') {
    const result = errorResponse(405, origin);
    result.headers.set('Allow', 'POST, OPTIONS');
    return result;
  }

  const limit = maxPayloadBytes(env);
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) return errorResponse(413, origin);
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return errorResponse(400, origin);
  }
  if (bytes.byteLength > limit) return errorResponse(413, origin);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return errorResponse(400, origin);
  }
  if (!isBasicEnvelope(parsed)) return errorResponse(400, origin);

  try {
    await env.DIAGNOSTICS.put(`basic/${parsed.sessionId}.json`, normalizeEnvelope(parsed), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { kind: 'basic-diagnostic', schemaVersion: '1' },
    });
  } catch {
    return errorResponse(500, origin);
  }
  return response(JSON.stringify({ accepted: true }), 202, origin);
}

type DiagnosticWorkerRuntimeEnv = DiagnosticWorkerEnv & DiagnosticReaderEnv;

export default {
  fetch: (request: Request, env: DiagnosticWorkerRuntimeEnv): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/ingest') return handleDiagnosticRequest(request, env);
    if (pathname === '/mcp') return handleDiagnosticMcpRequest(request, env);
    if (pathname === '/v2/diagnostics' || pathname.startsWith('/v2/diagnostics/')) return handlePrivateDiagnosticRequest(request, env);
    return Promise.resolve(new Response(JSON.stringify({ error: 'not-found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }));
  },
};
