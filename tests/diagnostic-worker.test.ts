import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleDiagnosticRequest } from '../worker/diagnostics-worker.ts';
import type { DiagnosticWorkerEnv, R2BucketLike, R2PutOptions } from '../worker/diagnostics-worker.ts';

type StoredWrite = { key: string; value: string; options: R2PutOptions | undefined };

const report = {
  schemaVersion: 1 as const,
  mode: 'basic' as const,
  metadata: { build: 'build-1' },
  counters: {
    frames: 3,
    validFeatures: 1,
    faceCount: { zero: 1, one: 2, twoOrMore: 0 },
    rejectionReasons: { 'no-face': 1 },
    skipped: {},
    errors: {},
    inferenceTotalMs: 12,
    inferenceMaxMs: 6,
  },
  timings: { modelLoadMs: 30 },
  events: [{ at: 1, type: 'run-started' }],
};

function payload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: 'basic-diagnostic',
    sessionId: 'session-1',
    sentAt: '2026-09-06T00:00:00.000Z',
    context: { build: 'build-1', mode: 'camera', fixture: 'baseline', plannedTrials: 12 },
    diagnostics: structuredClone(report),
  };
}

function makeEnv(writes: StoredWrite[]): DiagnosticWorkerEnv {
  const bucket: R2BucketLike = {
    put: async (key, value, options) => { writes.push({ key, value, options }); },
  };
  return { DIAGNOSTICS: bucket, ALLOWED_ORIGIN: 'https://shgnaka.github.io' };
}

test('worker accepts a basic diagnostic, stores one deterministic private object, and returns CORS headers', async () => {
  const writes: StoredWrite[] = [];
  const response = await handleDiagnosticRequest(
    new Request('https://worker.example.test/ingest', {
      method: 'POST',
      headers: { Origin: 'https://shgnaka.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    }),
    makeEnv(writes),
  );
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://shgnaka.github.io');
  assert.deepEqual(writes.map(write => write.key), ['basic/session-1.json']);
  const stored = JSON.parse(writes[0]!.value) as Record<string, unknown>;
  assert.equal((stored.diagnostics as Record<string, unknown>).mode, 'basic');
  assert.equal('frames' in (stored.diagnostics as Record<string, unknown>), false);
});

test('worker keeps only the allowlisted aggregate metadata and event names', async () => {
  const writes: StoredWrite[] = [];
  const unsafe = payload();
  const diagnostics = unsafe.diagnostics as Record<string, unknown>;
  diagnostics.metadata = { build: 'build-1', raw: 'must-not-persist' };
  diagnostics.timings = { modelLoadMs: 30, raw: 999 };
  diagnostics.events = [{ at: 1, type: 'run-started', detail: 'must-not-persist' }, { at: 2, type: 'raw-event', detail: 'must-not-persist' }];
  const response = await handleDiagnosticRequest(
    new Request('https://worker.example.test/ingest', {
      method: 'POST',
      headers: { Origin: 'https://shgnaka.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify(unsafe),
    }),
    makeEnv(writes),
  );
  assert.equal(response.status, 202);
  const stored = JSON.parse(writes[0]!.value) as { diagnostics: { metadata: Record<string, string>; timings: Record<string, number>; events: Record<string, unknown>[] } };
  assert.deepEqual(stored.diagnostics.metadata, { build: 'build-1' });
  assert.deepEqual(stored.diagnostics.timings, { modelLoadMs: 30 });
  assert.deepEqual(stored.diagnostics.events, [{ at: 1, type: 'run-started' }]);
});

test('worker rejects raw frame data and an origin outside the configured Pages origin', async () => {
  const writes: StoredWrite[] = [];
  const unsafe = payload();
  (unsafe.diagnostics as Record<string, unknown>).frames = [{ landmarks: [{ x: 0.1, y: 0.2 }] }];
  const unsafeResponse = await handleDiagnosticRequest(
    new Request('https://worker.example.test/ingest', {
      method: 'POST',
      headers: { Origin: 'https://shgnaka.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify(unsafe),
    }),
    makeEnv(writes),
  );
  assert.equal(unsafeResponse.status, 400);
  assert.equal(writes.length, 0);

  const originResponse = await handleDiagnosticRequest(
    new Request('https://worker.example.test/ingest', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    }),
    makeEnv(writes),
  );
  assert.equal(originResponse.status, 403);
  assert.equal(writes.length, 0);
});

test('worker exposes only preflight and ingest, with no public read or delete route', async () => {
  const writes: StoredWrite[] = [];
  const env = makeEnv(writes);
  const options = await handleDiagnosticRequest(new Request('https://worker.example.test/ingest', {
    method: 'OPTIONS',
    headers: { Origin: 'https://shgnaka.github.io' },
  }), env);
  assert.equal(options.status, 204);
  assert.match(options.headers.get('Access-Control-Allow-Methods') ?? '', /POST/);

  const get = await handleDiagnosticRequest(new Request('https://worker.example.test/ingest', {
    method: 'GET',
    headers: { Origin: 'https://shgnaka.github.io' },
  }), env);
  assert.equal(get.status, 405);
  assert.equal(writes.length, 0);
});
