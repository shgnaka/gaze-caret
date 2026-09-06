import type { DiagnosticEvent, DiagnosticReport, PublicDiagnosticReport } from './diagnostics.ts';

export interface DiagnosticUploadContext {
  build: string;
  mode: 'camera' | 'demo';
  fixture: string;
  plannedTrials: number;
}

export interface DiagnosticUploadEnvelope {
  schemaVersion: 1;
  type: 'basic-diagnostic';
  sessionId: string;
  sentAt: string;
  context: DiagnosticUploadContext;
  diagnostics: PublicDiagnosticReport;
}

export interface BuildBasicDiagnosticEnvelopeInput {
  sessionId: string;
  sentAt?: string;
  context: DiagnosticUploadContext;
  report: DiagnosticReport | PublicDiagnosticReport;
}

export type DiagnosticUploadResult =
  | { status: 'sent'; attempts: number; statusCode: number }
  | { status: 'skipped'; reason: 'endpoint-missing' | 'endpoint-invalid' | 'payload-too-large' | 'duplicate' }
  | { status: 'failed'; reason: 'network-error' | 'timeout' | 'http-error'; attempts: number; statusCode?: number };

export interface DiagnosticUploadClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  maxPayloadBytes?: number;
}

const safeText = (value: string, maximum = 200): string => value.slice(0, maximum);
const safeCount = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
const safeMilliseconds = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;

function safeNumberRecord(input: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
      .map(([key, value]) => [safeText(key, 100), safeCount(value)]),
  );
}

function safeEvents(events: readonly DiagnosticEvent[]): DiagnosticEvent[] {
  return events.slice(-100).map(event => {
    const copy: DiagnosticEvent = {
      at: safeMilliseconds(event.at),
      type: safeText(event.type, 100),
    };
    if (event.detail) copy.detail = safeText(event.detail, 200);
    return copy;
  });
}

/** Remove all frame-level data before a report can cross the upload boundary. */
export function toPublicDiagnosticReport(report: DiagnosticReport | PublicDiagnosticReport): PublicDiagnosticReport {
  const counters = report.counters;
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(report.metadata)) {
    if (typeof value === 'string') metadata[safeText(key, 100)] = safeText(value);
  }
  return {
    schemaVersion: 1,
    mode: 'basic',
    metadata,
    counters: {
      frames: safeCount(counters.frames),
      validFeatures: safeCount(counters.validFeatures),
      faceCount: {
        zero: safeCount(counters.faceCount.zero),
        one: safeCount(counters.faceCount.one),
        twoOrMore: safeCount(counters.faceCount.twoOrMore),
      },
      rejectionReasons: safeNumberRecord(counters.rejectionReasons),
      skipped: safeNumberRecord(counters.skipped),
      errors: safeNumberRecord(counters.errors),
      inferenceTotalMs: safeMilliseconds(counters.inferenceTotalMs),
      inferenceMaxMs: safeMilliseconds(counters.inferenceMaxMs),
    },
    timings: safeNumberRecord(report.timings),
    events: safeEvents(report.events),
  };
}

export function buildBasicDiagnosticEnvelope(input: BuildBasicDiagnosticEnvelopeInput): DiagnosticUploadEnvelope {
  return {
    schemaVersion: 1,
    type: 'basic-diagnostic',
    sessionId: safeText(input.sessionId, 100),
    sentAt: safeText(input.sentAt ?? new Date().toISOString(), 40),
    context: {
      build: safeText(input.context.build, 100),
      mode: input.context.mode === 'demo' ? 'demo' : 'camera',
      fixture: safeText(input.context.fixture, 100),
      plannedTrials: Math.min(300, safeCount(input.context.plannedTrials)),
    },
    diagnostics: toPublicDiagnosticReport(input.report),
  };
}

function endpointUrl(endpoint: string): string | null {
  const value = endpoint.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0 ? new Promise(resolve => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

export class DiagnosticUploadClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly maxPayloadBytes: number;
  private readonly sentSessions = new Set<string>();

  constructor(options: DiagnosticUploadClientOptions) {
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = Math.min(3, Math.max(1, Math.floor(options.maxAttempts ?? 2)));
    this.timeoutMs = Math.min(30_000, Math.max(1, Math.floor(options.timeoutMs ?? 5_000)));
    this.retryDelayMs = Math.min(5_000, Math.max(0, Math.floor(options.retryDelayMs ?? 0)));
    this.maxPayloadBytes = Math.max(1, Math.floor(options.maxPayloadBytes ?? 64 * 1024));
  }

  async send(envelope: DiagnosticUploadEnvelope): Promise<DiagnosticUploadResult> {
    if (this.sentSessions.has(envelope.sessionId)) return { status: 'skipped', reason: 'duplicate' };
    const endpoint = endpointUrl(this.endpoint);
    if (this.endpoint.trim() === '') return { status: 'skipped', reason: 'endpoint-missing' };
    if (!endpoint) return { status: 'skipped', reason: 'endpoint-invalid' };

    const safeEnvelope: DiagnosticUploadEnvelope = {
      ...envelope,
      diagnostics: toPublicDiagnosticReport(envelope.diagnostics),
    };
    const body = JSON.stringify(safeEnvelope);
    if (new TextEncoder().encode(body).byteLength > this.maxPayloadBytes) {
      return { status: 'skipped', reason: 'payload-too-large' };
    }

    let lastStatus: number | undefined;
    for (let attempts = 1; attempts <= this.maxAttempts; attempts++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
          credentials: 'omit',
          keepalive: true,
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        lastStatus = response.status;
        if (response.ok) {
          this.sentSessions.add(envelope.sessionId);
          return { status: 'sent', attempts, statusCode: response.status };
        }
        if (!retryableStatus(response.status) || attempts === this.maxAttempts) {
          return { status: 'failed', reason: 'http-error', attempts, statusCode: response.status };
        }
      } catch {
        if (attempts === this.maxAttempts) {
          return controller.signal.aborted
            ? { status: 'failed', reason: 'timeout', attempts }
            : { status: 'failed', reason: 'network-error', attempts };
        }
      } finally {
        clearTimeout(timer);
      }
      await wait(this.retryDelayMs);
    }
    return { status: 'failed', reason: 'http-error', attempts: this.maxAttempts, ...(lastStatus === undefined ? {} : { statusCode: lastStatus }) };
  }
}
