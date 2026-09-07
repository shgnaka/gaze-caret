import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DATA_KINDS,
  DiagnosticConsentError,
  canCapture,
  canUpload,
  canAiRead,
  createDefaultDiagnosticConsent,
  updateDiagnosticConsent,
} from '../src/core/diagnostic-consent.ts';

test('default consent keeps basic local diagnostics available and sensitive sharing disabled', () => {
  const consent = createDefaultDiagnosticConsent('2026-09-07T00:00:00.000Z');

  assert.deepEqual(DATA_KINDS, ['basic', 'detail', 'landmarks', 'features', 'gaze', 'image', 'video']);
  assert.equal(consent.schemaVersion, 1);
  assert.equal(consent.revision, 0);
  assert.equal(canCapture(consent, 'basic'), true);
  assert.equal(canUpload(consent, 'basic'), false);
  assert.equal(canAiRead(consent, 'basic'), false);
  for (const kind of DATA_KINDS.filter(kind => kind !== 'basic')) {
    assert.equal(canCapture(consent, kind), false);
    assert.equal(canUpload(consent, kind), false);
    assert.equal(canAiRead(consent, kind), false);
  }
});

test('one explicit update can grant capture, upload, and AI read for a selected data kind', () => {
  const consent = createDefaultDiagnosticConsent('2026-09-07T00:00:00.000Z');
  const granted = updateDiagnosticConsent(consent, 'detail', {
    capture: true,
    upload: true,
    aiRead: true,
  }, {
    at: '2026-09-07T00:01:00.000Z',
    expectedRevision: 0,
  });

  assert.equal(granted.revision, 1);
  assert.equal(granted.updatedAt, '2026-09-07T00:01:00.000Z');
  assert.equal(canCapture(granted, 'detail'), true);
  assert.equal(canUpload(granted, 'detail'), true);
  assert.equal(canAiRead(granted, 'detail'), true);
  assert.equal(canCapture(consent, 'detail'), false);
});

test('AI read cannot be granted without capture and upload permission', () => {
  const consent = createDefaultDiagnosticConsent('2026-09-07T00:00:00.000Z');

  assert.throws(
    () => updateDiagnosticConsent(consent, 'image', { aiRead: true }, {
      at: '2026-09-07T00:01:00.000Z',
      expectedRevision: 0,
    }),
    (error: unknown) => error instanceof DiagnosticConsentError && error.code === 'permission-dependency',
  );
  assert.equal(consent.revision, 0);
  assert.equal(canAiRead(consent, 'image'), false);
});

test('revoking upload also revokes AI read while retaining local capture', () => {
  const initial = createDefaultDiagnosticConsent('2026-09-07T00:00:00.000Z');
  const granted = updateDiagnosticConsent(initial, 'landmarks', {
    capture: true,
    upload: true,
    aiRead: true,
  }, { at: '2026-09-07T00:01:00.000Z', expectedRevision: 0 });
  const revoked = updateDiagnosticConsent(granted, 'landmarks', { upload: false }, {
    at: '2026-09-07T00:02:00.000Z',
    expectedRevision: 1,
  });

  assert.equal(canCapture(revoked, 'landmarks'), true);
  assert.equal(canUpload(revoked, 'landmarks'), false);
  assert.equal(canAiRead(revoked, 'landmarks'), false);
});

test('revoking capture cascades to upload and AI read', () => {
  const initial = createDefaultDiagnosticConsent('2026-09-07T00:00:00.000Z');
  const granted = updateDiagnosticConsent(initial, 'video', {
    capture: true,
    upload: true,
    aiRead: true,
  }, { at: '2026-09-07T00:01:00.000Z', expectedRevision: 0 });
  const revoked = updateDiagnosticConsent(granted, 'video', { capture: false }, {
    at: '2026-09-07T00:02:00.000Z',
    expectedRevision: 1,
  });

  assert.equal(canCapture(revoked, 'video'), false);
  assert.equal(canUpload(revoked, 'video'), false);
  assert.equal(canAiRead(revoked, 'video'), false);
});

test('stale consent revisions are rejected without changing the current snapshot', () => {
  const initial = createDefaultDiagnosticConsent('2026-09-07T00:00:00.000Z');
  const current = updateDiagnosticConsent(initial, 'gaze', { capture: true }, {
    at: '2026-09-07T00:01:00.000Z',
    expectedRevision: 0,
  });

  assert.throws(
    () => updateDiagnosticConsent(current, 'gaze', { upload: true }, {
      at: '2026-09-07T00:02:00.000Z',
      expectedRevision: 0,
    }),
    (error: unknown) => error instanceof DiagnosticConsentError && error.code === 'stale-revision',
  );
  assert.equal(current.revision, 1);
  assert.equal(canUpload(current, 'gaze'), false);
});
