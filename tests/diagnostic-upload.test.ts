import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DiagnosticUploadClient,
  buildBasicDiagnosticEnvelope,
  toPublicDiagnosticReport,
} from '../src/core/diagnostic-upload.ts';
import type { DiagnosticReport } from '../src/core/diagnostics.ts';

const detailedReport: DiagnosticReport = {
  schemaVersion: 1,
  mode: 'detailed',
  metadata: { engine: 'test-engine', build: 'test-build' },
  counters: {
    frames: 2,
    validFeatures: 1,
    faceCount: { zero: 1, one: 1, twoOrMore: 0 },
    rejectionReasons: { 'no-face': 1 },
    skipped: {},
    errors: {},
    inferenceTotalMs: 12,
    inferenceMaxMs: 8,
  },
  timings: { modelLoadMs: 42 },
  events: [{ at: 1, type: 'run-started' }],
  frames: [{
    at: 2,
    phase: 'camera',
    faceCount: 1,
    reason: null,
    inferenceMs: 6,
    landmarks: [[{ x: 0.1, y: 0.2, z: 0.3 }]],
    features: [0.1, 0.2],
  }],
};

test('automatic payload is a basic aggregate even when detailed diagnostics are selected', () => {
  const report = toPublicDiagnosticReport(detailedReport);
  assert.equal(report.mode, 'basic');
  assert.equal('frames' in report, false);
  assert.equal(JSON.stringify(report).includes('landmarks'), false);
  assert.equal(JSON.stringify(report).includes('features'), false);

  const envelope = buildBasicDiagnosticEnvelope({
    sessionId: 'session-1',
    sentAt: '2026-09-06T00:00:00.000Z',
    context: { build: 'build-1', mode: 'camera', fixture: 'baseline', plannedTrials: 12 },
    report: detailedReport,
  });
  assert.equal(envelope.type, 'basic-diagnostic');
  assert.equal(envelope.diagnostics.mode, 'basic');
  assert.equal('frames' in envelope.diagnostics, false);
});

test('upload sends consented basic diagnostics without credentials and ignores duplicate sessions', async () => {
  const requests: RequestInit[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    requests.push(init ?? {});
    return new Response('{}', { status: 202 });
  };
  const client = new DiagnosticUploadClient({ endpoint: 'https://diagnostics.example.test/ingest', fetchImpl });
  const envelope = buildBasicDiagnosticEnvelope({
    sessionId: 'session-2',
    context: { build: 'build-1', mode: 'camera', fixture: 'baseline', plannedTrials: 12 },
    report: detailedReport,
  });

  const first = await client.send(envelope);
  const duplicate = await client.send(envelope);
  assert.equal(first.status, 'sent');
  assert.equal(duplicate.status, 'skipped');
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.credentials, 'omit');
  assert.equal((requests[0]?.headers as Record<string, string>)['Authorization'], undefined);
  const sent = JSON.parse(String(requests[0]?.body));
  assert.equal(sent.diagnostics.mode, 'basic');
  assert.equal('frames' in sent.diagnostics, false);
});

test('upload retries transient failures and skips when endpoint is not configured', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return calls === 1 ? new Response('{}', { status: 503 }) : new Response('{}', { status: 201 });
  };
  const envelope = buildBasicDiagnosticEnvelope({
    sessionId: 'session-3',
    context: { build: 'build-1', mode: 'camera', fixture: 'baseline', plannedTrials: 12 },
    report: detailedReport,
  });
  const client = new DiagnosticUploadClient({ endpoint: 'https://diagnostics.example.test/ingest', fetchImpl, maxAttempts: 2 });
  const result = await client.send(envelope);
  assert.equal(result.status, 'sent');
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);

  const skipped = await new DiagnosticUploadClient({ endpoint: '' }).send(envelope);
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.reason, 'endpoint-missing');
});
