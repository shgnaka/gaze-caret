import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  handlePrivateDiagnosticRequest,
  type DiagnosticReaderEnv,
  type R2DiagnosticObject,
  type R2DiagnosticObjectSummary,
} from '../worker/private-diagnostics.ts';

type StoredObject = R2DiagnosticObjectSummary & { body: string };

function makeEnv(objects: StoredObject[], token = 'reader-secret'): DiagnosticReaderEnv {
  const byKey = new Map(objects.map(object => [object.key, object]));
  return {
    READ_BEARER_TOKEN: token,
    DIAGNOSTICS: {
      list: async (options = {}) => {
        const prefix = options.prefix ?? '';
        const limit = options.limit ?? 20;
        const filtered = objects.filter(object => object.key.startsWith(prefix)).slice(0, limit);
        return { objects: filtered, truncated: objects.filter(object => object.key.startsWith(prefix)).length > limit };
      },
      get: async (key: string): Promise<R2DiagnosticObject | null> => {
        const object = byKey.get(key);
        return object ? { text: async () => object.body } : null;
      },
    },
  };
}

function basicBody(sessionId: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    type: 'basic-diagnostic',
    sessionId,
    sentAt: '2026-09-07T00:00:00.000Z',
    context: { build: 'build-1', mode: 'camera', fixture: 'baseline', plannedTrials: 12 },
    diagnostics: {
      schemaVersion: 1,
      mode: 'basic',
      metadata: { build: 'build-1' },
      counters: {
        frames: 2,
        validFeatures: 1,
        faceCount: { zero: 1, one: 1, twoOrMore: 0 },
        rejectionReasons: { 'no-face': 1 },
        skipped: {},
        errors: {},
        inferenceTotalMs: 8,
        inferenceMaxMs: 5,
      },
      timings: {},
      events: [],
    },
  });
}

const summary = (key: string, size = 100): StoredObject => ({
  key,
  size,
  uploaded: new Date('2026-09-07T00:00:00.000Z'),
  body: basicBody(key.slice('basic/'.length, -'.json'.length)),
});

test('reader rejects missing or invalid bearer credentials without touching R2', async () => {
  let listCalls = 0;
  const env = makeEnv([summary('basic/session-1.json')]);
  const originalList = env.DIAGNOSTICS.list;
  env.DIAGNOSTICS.list = async (...args) => { listCalls++; return originalList(...args); };

  const missing = await handlePrivateDiagnosticRequest(new Request('https://worker.example.test/v2/diagnostics'), env);
  const invalid = await handlePrivateDiagnosticRequest(new Request('https://worker.example.test/v2/diagnostics', {
    headers: { Authorization: 'Bearer wrong' },
  }), env);

  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
  assert.equal(listCalls, 0);
  assert.equal(invalid.headers.get('Cache-Control'), 'no-store');
});

test('reader lists only basic diagnostic metadata with bounded pagination', async () => {
  const env = makeEnv([
    summary('basic/session-1.json', 101),
    summary('basic/session-2.json', 102),
    { ...summary('detailed/session-3.json', 103), body: '{}' },
  ]);
  const response = await handlePrivateDiagnosticRequest(new Request('https://worker.example.test/v2/diagnostics?limit=1', {
    headers: { Authorization: 'Bearer reader-secret' },
  }), env);

  assert.equal(response.status, 200);
  const result = JSON.parse(await response.text()) as { reports: Record<string, unknown>[]; truncated: boolean };
  assert.equal(result.reports.length, 1);
  assert.deepEqual(result.reports[0], {
    sessionId: 'session-1',
    kind: 'basic',
    size: 101,
    uploadedAt: '2026-09-07T00:00:00.000Z',
  });
  assert.equal(result.truncated, true);
  assert.equal(JSON.stringify(result).includes('inferenceTotalMs'), false);
});

test('reader returns one basic report and never returns frames or arbitrary R2 keys', async () => {
  const env = makeEnv([
    summary('basic/session-1.json'),
    { ...summary('detailed/session-2.json'), body: JSON.stringify({ secret: true }) },
  ]);
  const response = await handlePrivateDiagnosticRequest(new Request('https://worker.example.test/v2/diagnostics/session-1', {
    headers: { Authorization: 'Bearer reader-secret' },
  }), env);
  assert.equal(response.status, 200);
  const result = JSON.parse(await response.text()) as Record<string, unknown>;
  assert.equal(result.sessionId, 'session-1');
  assert.equal((result.diagnostics as Record<string, unknown>).mode, 'basic');
  assert.equal('frames' in (result.diagnostics as Record<string, unknown>), false);

  const detailed = await handlePrivateDiagnosticRequest(new Request('https://worker.example.test/v2/diagnostics/../detailed/session-2', {
    headers: { Authorization: 'Bearer reader-secret' },
  }), env);
  assert.equal(detailed.status, 404);
});

test('reader fails closed when the server-side credential is not configured', async () => {
  const env = makeEnv([summary('basic/session-1.json')], '');
  const response = await handlePrivateDiagnosticRequest(new Request('https://worker.example.test/v2/diagnostics', {
    headers: { Authorization: 'Bearer reader-secret' },
  }), env);
  assert.equal(response.status, 503);
});
