import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiagnosticRecorder } from '../src/core/diagnostics.ts';

test('basic diagnostics aggregate face and feature rejection reasons without raw data', () => {
  const diagnostics = new DiagnosticRecorder({ mode: 'basic', maxFrames: 2 });
  diagnostics.setMetadata({ engine: 'test-engine', featureVersion: 'test-features' });
  diagnostics.recordFrame({ at: 10, phase: 'camera', faceCount: 0, reason: 'no-face', inferenceMs: 5 });
  diagnostics.recordFrame({ at: 20, phase: 'camera', faceCount: 1, reason: null, inferenceMs: 7, features: [1, 2] });
  diagnostics.recordFrame({ at: 30, phase: 'camera', faceCount: 2, reason: 'multiple-faces', inferenceMs: 9 });

  const report = diagnostics.snapshot();
  assert.equal(report.mode, 'basic');
  assert.equal(report.counters.frames, 3);
  assert.equal(report.counters.validFeatures, 1);
  assert.deepEqual(report.counters.faceCount, { zero: 1, one: 1, twoOrMore: 1 });
  assert.equal(report.counters.rejectionReasons['no-face'], 1);
  assert.equal(report.counters.rejectionReasons['multiple-faces'], 1);
  assert.equal(report.frames, undefined);
  assert.equal('frames' in report, false);
  assert.equal(JSON.stringify(report).includes('landmarks'), false);
});

test('detailed diagnostics keep bounded frame data and expose a redacted public snapshot', () => {
  const diagnostics = new DiagnosticRecorder({ mode: 'detailed', maxFrames: 2 });
  diagnostics.recordFrame({
    at: 10,
    phase: 'calibration',
    faceCount: 1,
    reason: null,
    inferenceMs: 6,
    features: [1, 2, 3],
    landmarks: [[{ x: 0.1, y: 0.2, z: 0.3 }]],
  });
  diagnostics.recordFrame({ at: 20, phase: 'calibration', faceCount: 1, reason: 'right-eye-geometry', inferenceMs: 8 });
  diagnostics.recordFrame({ at: 30, phase: 'calibration', faceCount: 1, reason: 'left-eye-geometry', inferenceMs: 9 });
  diagnostics.recordFrame({ at: 40, phase: 'calibration', faceCount: 1, reason: null, inferenceMs: 10, features: [2, 3] });
  diagnostics.recordSkip('video-not-ready');
  diagnostics.recordError('detector-error');

  const report = diagnostics.snapshot();
  assert.equal(report.mode, 'detailed');
  assert.equal(report.frames?.length, 2);
  assert.deepEqual(report.frames?.[1]?.features, [2, 3]);
  assert.equal(report.counters.skipped['video-not-ready'], 1);
  assert.equal(report.counters.errors['detector-error'], 1);

  const publicReport = diagnostics.publicSnapshot();
  assert.equal(publicReport.mode, 'basic');
  assert.equal('frames' in publicReport, false);
  assert.equal('frames' in publicReport, false);
  assert.equal(JSON.stringify(publicReport).includes('landmarks'), false);
});

test('diagnostic timing and events use relative values and do not keep arbitrary error objects', () => {
  const diagnostics = new DiagnosticRecorder({ mode: 'basic' });
  diagnostics.recordTiming('modelLoadMs', 123.5);
  diagnostics.recordEvent({ at: 40, type: 'model-ready' });
  diagnostics.recordEvent({ at: 41, type: 'error', detail: 'NotReadableError' });
  const report = diagnostics.snapshot();
  assert.equal(report.timings.modelLoadMs, 123.5);
  assert.deepEqual(report.events, [
    { at: 40, type: 'model-ready' },
    { at: 41, type: 'error', detail: 'NotReadableError' },
  ]);
  assert.equal(JSON.stringify(report).includes('stack'), false);
});
