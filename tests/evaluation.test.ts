import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeTrials } from '../src/core/evaluation.ts';
import type { Outcome, Target, Trial } from '../src/core/runner.ts';
import type { Point } from '../src/core/select-gaze-point.ts';

const target: Target = { id: 'line-1', x: 10, y: 20, block: 'paragraph-1', region: 'main', line: 1, text: '対象の行' };
function trial(outcome: Outcome, point: Point | null, id = 1): Trial {
  return { id, target: { ...target }, candidate: null, presentedAt: 0, decidedAt: 600, outcome, point, reason: null };
}

test('six outcomes retain unavailable and aborted trials in every rate denominator (EVAL-01, A-12)', () => {
  const samples = [
    trial('exact', { x: 10, y: 20 }, 1),
    trial('adjacent', { x: 13, y: 24 }, 2),
    trial('other-line', { x: 4, y: 12 }, 3),
    trial('other-block', { x: 19, y: 32 }, 4),
    trial('unavailable', null, 5),
    trial('aborted', null, 6),
  ];
  const summary = summarizeTrials(samples);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.outcomes, {
    exact: { count: 1, rate: 1 / 6 }, adjacent: { count: 1, rate: 1 / 6 },
    'other-line': { count: 1, rate: 1 / 6 }, 'other-block': { count: 1, rate: 1 / 6 },
    unavailable: { count: 1, rate: 1 / 6 }, aborted: { count: 1, rate: 1 / 6 },
  });
  assert.deepEqual(summary.exactOrAdjacent, { count: 2, rate: 2 / 6 });
  assert.deepEqual(summary.coordinateError, {
    validCount: 4, missingCount: 2,
    absoluteX: { p50: 3, p90: 9, p95: 9 },
    absoluteY: { p50: 4, p90: 12, p95: 12 },
    euclidean: { p50: 5, p90: 15, p95: 15 },
  });
});

test('nearest-rank percentiles use ranks 10, 18 and 19 for twenty errors (A-12)', () => {
  const samples = Array.from({ length: 20 }, (_, i) => trial('exact', { x: 11 + i, y: 20 }, i + 1)).reverse();
  const summary = summarizeTrials(samples);
  assert.deepEqual(summary.coordinateError.absoluteX, { p50: 10, p90: 18, p95: 19 });
  assert.deepEqual(summary.coordinateError.absoluteY, { p50: 0, p90: 0, p95: 0 });
  assert.deepEqual(summary.coordinateError.euclidean, { p50: 10, p90: 18, p95: 19 });
});

test('a finite raw point contributes coordinate error when no candidate line is available (EVAL-01)', () => {
  const sample = trial('unavailable', { x: 13, y: 24 });
  const summary = summarizeTrials([sample]);
  assert.deepEqual(summary.outcomes.unavailable, { count: 1, rate: 1 });
  assert.deepEqual(summary.coordinateError, {
    validCount: 1, missingCount: 0,
    absoluteX: { p50: 3, p90: 3, p95: 3 }, absoluteY: { p50: 4, p90: 4, p95: 4 }, euclidean: { p50: 5, p90: 5, p95: 5 },
  });
});

test('coordinate errors use the raw point rather than the selected candidate location (EVAL-04)', () => {
  const sample = { ...trial('exact', { x: 13, y: 24 }), candidate: { ...target } };
  assert.deepEqual(summarizeTrials([sample]).coordinateError.euclidean, { p50: 5, p90: 5, p95: 5 });
});

test('empty or entirely missing errors serialize as null while measured zero stays zero (EVAL-04, A-13)', () => {
  const empty = summarizeTrials([]);
  assert.equal(empty.total, 0);
  assert.ok(Object.values(empty.outcomes).every(outcome => outcome.count === 0 && outcome.rate === null));
  assert.deepEqual(empty.exactOrAdjacent, { count: 0, rate: null });
  assert.deepEqual(empty.coordinateError, {
    validCount: 0, missingCount: 0,
    absoluteX: { p50: null, p90: null, p95: null }, absoluteY: { p50: null, p90: null, p95: null }, euclidean: { p50: null, p90: null, p95: null },
  });
  const missing = JSON.parse(JSON.stringify(summarizeTrials([trial('unavailable', null), trial('aborted', null)])));
  assert.equal(missing.coordinateError.missingCount, 2);
  assert.equal(missing.coordinateError.euclidean.p50, null);
  assert.equal(missing.outcomes.exact.rate, 0);
  const measured = JSON.parse(JSON.stringify(summarizeTrials([trial('exact', { x: 10, y: 20 })])));
  assert.equal(measured.coordinateError.euclidean.p50, 0);
  assert.equal(measured.coordinateError.validCount, 1);
});

test('invalid coordinates and unrepresentable distances count as missing without changing outcome totals (EST-04, A-12)', () => {
  const samples = [
    trial('unavailable', { x: NaN, y: 20 }, 1),
    trial('unavailable', { x: 10, y: Infinity }, 2),
    { ...trial('unavailable', { x: 10, y: 20 }, 3), target: { ...target, x: NaN } },
    { ...trial('unavailable', { x: -Number.MAX_VALUE, y: 20 }, 4), target: { ...target, x: Number.MAX_VALUE } },
  ];
  const summary = summarizeTrials(samples);
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.outcomes.unavailable, { count: 4, rate: 1 });
  assert.equal(summary.coordinateError.validCount, 0);
  assert.equal(summary.coordinateError.missingCount, 4);
  assert.deepEqual(summary.coordinateError.euclidean, { p50: null, p90: null, p95: null });
});

test('unknown outcomes fail instead of silently falling outside the six counts (EVAL-01)', () => {
  assert.throws(() => summarizeTrials([trial('corrupt' as Outcome, null)]), RangeError);
});

test('summarizing does not reorder or mutate the recorded trials (EVAL-04)', () => {
  const samples = [trial('other-line', { x: 19, y: 32 }, 7), trial('exact', { x: 10, y: 20 }, 2)];
  for (const sample of samples) { Object.freeze(sample.target); Object.freeze(sample.point); Object.freeze(sample); }
  Object.freeze(samples);
  const before = JSON.stringify(samples);
  summarizeTrials(samples);
  assert.equal(JSON.stringify(samples), before);
});
