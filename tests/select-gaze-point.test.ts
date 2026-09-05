import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  selectGazePoint,
  DEFAULT_SELECTION_SETTINGS,
  type GazeSample,
} from '../src/core/select-gaze-point.ts';

const request = { pressedAt: 1000, contextId: 'viewport-1', modelId: 'model-1' };

function sample(sampledAt: number, x: number, y: number, overrides: Partial<GazeSample> = {}): GazeSample {
  return {
    sampledAt,
    producedAt: sampledAt + 20,
    contextId: 'viewport-1',
    modelId: 'model-1',
    valid: true,
    invalidReason: null,
    x,
    y,
    ...overrides,
  };
}

test('A-09: selects coordinate medians from three available pre-key samples', () => {
  const result = selectGazePoint([
    sample(800, 30, 80),
    sample(850, 10, 100),
    sample(900, 20, 60),
  ], request);

  assert.deepEqual(result, {
    ...request,
    window: { startAt: 750, endAt: 950 },
    sampleCount: 3,
    newestSampleAgeMs: 100,
    oldestSampleAgeMs: 200,
    point: { x: 20, y: 80 },
    mad: { x: 10, y: 20 },
    reason: null,
  });
});

test('A-09: includes both window endpoints and excludes samples just outside them', () => {
  const result = selectGazePoint([
    sample(750, 0, 0), sample(850, 10, 10), sample(950, 20, 20),
    sample(749.999, 300, 300), sample(950.001, 300, 300),
  ], request);
  assert.equal(result.sampleCount, 3);
  assert.deepEqual(result.point, { x: 10, y: 10 });
  assert.equal(result.oldestSampleAgeMs, 250);
  assert.equal(result.newestSampleAgeMs, 50);
});

test('A-09: uses only results available by the key time, including equality', () => {
  const result = selectGazePoint([
    sample(800, 10, 10), sample(850, 20, 20),
    sample(900, 30, 30, { producedAt: 1000 }),
    sample(840, -100, -100, { producedAt: 1000.001 }),
    sample(1001, -100, -100),
  ], request);
  assert.equal(result.sampleCount, 3);
  assert.deepEqual(result.point, { x: 20, y: 20 });
});

test('A-09: excludes coordinates from another viewport or calibration model', () => {
  const result = selectGazePoint([
    sample(800, 10, 10), sample(850, 20, 20), sample(900, 30, 30),
    sample(810, -100, -100, { contextId: 'old-viewport' }),
    sample(820, -100, -100, { modelId: 'old-model' }),
  ], request);
  assert.equal(result.sampleCount, 3);
  assert.deepEqual(result.point, { x: 20, y: 20 });
});

test('A-09: excludes invalid coordinates and impossible sample timestamps', () => {
  const result = selectGazePoint([
    sample(800, 10, 10), sample(850, 20, 20), sample(900, 30, 30),
    sample(810, 0, 0, { x: null }),
    sample(811, 0, NaN), sample(812, Infinity, 0),
    sample(813, 0, 0, { valid: false, invalidReason: 'eyes-closed' }),
    sample(814, 0, 0, { invalidReason: 'invalid-features' }),
    sample(815, 0, 0, { producedAt: 814 }),
    sample(NaN, 0, 0), sample(816, 0, 0, { producedAt: Infinity }),
  ], request);
  assert.equal(result.sampleCount, 3);
  assert.deepEqual(result.point, { x: 20, y: 20 });
});

test('A-09: reports missing data as insufficient, with null metrics rather than zeros', () => {
  const result = selectGazePoint([], request);
  assert.equal(result.reason, 'insufficient-samples');
  assert.equal(result.sampleCount, 0);
  assert.equal(result.point, null);
  assert.equal(result.mad, null);
  assert.equal(result.newestSampleAgeMs, null);
  assert.equal(result.oldestSampleAgeMs, null);
});

test('A-09: two usable samples remain insufficient even if a third arrives late', () => {
  const result = selectGazePoint([
    sample(800, 10, 10), sample(850, 20, 20),
    sample(900, 30, 30, { producedAt: 1001 }),
  ], request);
  assert.equal(result.reason, 'insufficient-samples');
  assert.equal(result.point, null);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.newestSampleAgeMs, 150);
  assert.equal(result.oldestSampleAgeMs, 200);
});

test('A-09: distinguishes stale data without widening the window', () => {
  const result = selectGazePoint([
    sample(650, 10, 10), sample(700, 20, 20), sample(749.999, 30, 30),
  ], request);
  assert.equal(result.reason, 'stale-data');
  assert.equal(result.point, null);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.newestSampleAgeMs, null);
});

test('A-09: reports an invalid context when all available samples belong elsewhere', () => {
  const result = selectGazePoint([
    sample(800, 10, 10), sample(850, 20, 20), sample(900, 30, 30),
  ], { ...request, contextId: 'viewport-2' });
  assert.equal(result.reason, 'invalid-context');
  assert.equal(result.point, null);
});

test('A-09: requires a current viewport and calibration model', () => {
  for (const missing of [{ contextId: null }, { modelId: null }, { contextId: '' }]) {
    assert.equal(selectGazePoint([], { ...request, ...missing }).reason, 'invalid-context');
  }
});

for (const axis of ['x', 'y'] as const) {
  test(`A-09: rejects MAD above the limit on the ${axis} axis`, () => {
    const result = selectGazePoint([
      sample(800, 0, 0, { [axis]: 0 }),
      sample(850, 0, 0, { [axis]: 50 }),
      sample(900, 0, 0, { [axis]: 100 }),
    ], request);
    assert.equal(result.reason, 'excessive-spread');
    assert.equal(result.point, null);
    assert.equal(result.sampleCount, 3);
    assert.equal(result.mad?.[axis], 50);
  });
}

test('A-09: accepts MAD equal to the configured limit', () => {
  const result = selectGazePoint([
    sample(800, 0, 0), sample(850, 40, 40), sample(900, 80, 80),
  ], request);
  assert.equal(result.reason, null);
  assert.deepEqual(result.point, { x: 40, y: 40 });
  assert.deepEqual(result.mad, { x: 40, y: 40 });
});

test('A-09: averages the two middle values for an even sample count', () => {
  const result = selectGazePoint([
    sample(800, 10, 100), sample(850, 20, 40),
    sample(900, 30, 30), sample(940, 100, 20),
  ], request);
  assert.deepEqual(result.point, { x: 25, y: 35 });
  assert.deepEqual(result.mad, { x: 10, y: 10 });
});

test('A-09: does not mutate inputs or revise a decision when the caller changes history', () => {
  const first = { ...sample(900, 30, 30) };
  const samples = [first, sample(800, 10, 10), sample(850, 20, 20)];
  const before = structuredClone(samples);
  const result = selectGazePoint(samples, request);
  assert.deepEqual(samples, before);
  first.x = 1000;
  samples.push(sample(890, 1000, 1000));
  assert.equal(result.sampleCount, 3);
  assert.deepEqual(result.point, { x: 20, y: 20 });
});

test('A-09: honors explicitly supplied experiment settings', () => {
  const result = selectGazePoint([
    sample(600, 20, 20), sample(900, 80, 80), sample(950, 1000, 1000),
  ], request, {
    windowStartAgeMs: 400, windowEndAgeMs: 100, minSamples: 2, maxMadCssPx: 100,
  });
  assert.deepEqual(result.window, { startAt: 600, endAt: 900 });
  assert.equal(result.sampleCount, 2);
  assert.deepEqual(result.point, { x: 50, y: 50 });
});

test('rejects invalid request times and settings instead of producing a misleading decision', () => {
  for (const pressedAt of [NaN, Infinity, -1]) {
    assert.throws(() => selectGazePoint([], { ...request, pressedAt }), RangeError);
  }
  for (const override of [
    { minSamples: 0 }, { minSamples: 2.5 }, { maxMadCssPx: -1 },
    { windowStartAgeMs: 40 }, { windowEndAgeMs: -1 }, { windowEndAgeMs: Infinity },
  ]) {
    assert.throws(() => selectGazePoint([], request, {
      ...DEFAULT_SELECTION_SETTINGS, ...override,
    }), RangeError);
  }
});
