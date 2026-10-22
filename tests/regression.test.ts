import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitRidge, predict, balancedSamples } from '../src/core/regression.ts';
import type { RidgeModel } from '../src/core/regression.ts';
test('CPU ridge recovers held-out coordinates with a constant feature and unpenalized intercept', () => {
  const samples = Array.from({ length: 21 }, (_, i) => { const x = (i - 10) / 10; return { features: [x, 99], target: { x: 2 + 3 * x, y: 1 - 2 * x }, group: i }; });
  const model = fitRidge(samples, 0.000001); const point = predict(model, [0.35, 99]);
  assert.ok(point); assert.ok(Math.abs(point.x - 3.05) < 0.00001); assert.ok(Math.abs(point.y - 0.3) < 0.00001);
});

test('default regularization preserves independent feature effects across units and an unpenalized intercept (EST-01)', () => {
  const samples = [-1, 1].flatMap(a => [-1, 1].map(b => ({
    features: [1000 + 100 * a, 0.001 * b, 99],
    target: { x: 10 + 2 * a - 3 * b, y: -4 + a + 4 * b }, group: a + b,
  })));
  const model = fitRidge(samples);
  const point = predict(model, [1025, -0.0005, 99]);
  assert.ok(point);
  // Orthogonal standardized columns each have sum of squares 4: slopes shrink by 4/5.
  assert.ok(Math.abs(point.x - 11.6) < 1e-12);
  assert.ok(Math.abs(point.y - -5.4) < 1e-12);
  assert.ok(Math.abs(model.weights[0]![0]! - 10) < 1e-12);
  assert.ok(Math.abs(model.weights[0]![1]! - -4) < 1e-12);
});
test('missing or nonfinite features never become zero-filled valid predictions', () => {
  const s = [{ features: [1], target: { x: 2, y: 3 }, group: 0 }, { features: [2], target: { x: 3, y: 4 }, group: 1 }];
  const model = fitRidge(s); assert.equal(predict(model, [NaN]), null); assert.equal(predict(model, []), null);
  assert.throws(() => fitRidge([{ ...s[0]!, features: [Infinity] }]), RangeError);
});

test('positive small regularization preserves a constant feature and the unpenalized intercept (EST-01)', () => {
  const lambda = 1e-14;
  const samples = [-1, 1].map(x => ({
    features: [x, 99], target: { x: 5 + 3 * x, y: 7 - 2 * x }, group: x,
  }));
  const model = fitRidge(samples, lambda);
  const point = predict(model, [0.5, 99]);
  assert.ok(point);
  // The centered feature has sum of squares 2; the constant feature has zero slope.
  assert.ok(Math.abs(point.x - (5 + 3 / (2 + lambda))) < 1e-12);
  assert.ok(Math.abs(point.y - (7 - 2 / (2 + lambda))) < 1e-12);
});

test('positive small regularization supports duplicate features with an analytic held-out prediction (EST-01)', () => {
  const lambda = 1e-14;
  const samples = [-1, 0, 1].map(x => ({
    features: [x, x], target: { x: 5 + 3 * x, y: 7 - 2 * x }, group: x,
  }));
  const point = predict(fitRidge(samples, lambda), [0.5, 0.5]);
  assert.ok(point);
  // Each standardized column has sum of squares 3. Equal coefficients share the penalty.
  assert.ok(Math.abs(point.x - (5 + 9 / (6 + lambda))) < 1e-12);
  assert.ok(Math.abs(point.y - (7 - 6 / (6 + lambda))) < 1e-12);
});

test('nearly unregularized duplicate features retain the symmetric ridge solution outside their training relationship (EST-01)', () => {
  const lambda = 1e-14;
  const samples = [-1, 0, 1].map(x => ({
    features: [x, x], target: { x: 5 + 3 * x, y: 7 - 2 * x }, group: x,
  }));
  const point = predict(fitRidge(samples, lambda), [0.5, 0]);
  assert.ok(point);
  // Identical standardized columns must have equal ridge coefficients. Only one varies here.
  assert.ok(Math.abs(point.x - (5 + 4.5 / (6 + lambda))) < 1e-8);
  assert.ok(Math.abs(point.y - (7 - 3 / (6 + lambda))) < 1e-8);
});

test('reordering differently scaled correlated features preserves the same ridge prediction (EST-01)', () => {
  for (const lambda of [1, 1e-14]) {
    const samples = [-1, 0, 1].map(x => ({
      features: [x, 2 * x, 99], target: { x: 5 + 3 * x, y: 7 - 2 * x }, group: x,
    }));
    const reordered = samples.map(s => ({ ...s, features: [s.features[1]!, s.features[0]!, 99] }));
    const originalPoint = predict(fitRidge(samples, lambda), [0.5, 0, 99]);
    const reorderedPoint = predict(fitRidge(reordered, lambda), [0, 0.5, 99]);
    assert.ok(originalPoint); assert.ok(reorderedPoint);
    assert.ok(Math.abs(originalPoint.x - (5 + 4.5 / (6 + lambda))) < 1e-8);
    assert.ok(Math.abs(originalPoint.y - (7 - 3 / (6 + lambda))) < 1e-8);
    assert.ok(Math.abs(originalPoint.x - reorderedPoint.x) < 1e-8);
    assert.ok(Math.abs(originalPoint.y - reorderedPoint.y) < 1e-8);
  }
});

test('finite calibration inputs that overflow training arithmetic cannot emit an unusable model (EST-04)', () => {
  const overflowingVariance = [1e200, 2e200, 3e200].map((x, i) => ({
    features: [x], target: { x: i + 1, y: 2 * (i + 1) }, group: i,
  }));
  assert.throws(() => fitRidge(overflowingVariance), RangeError);

  const overflowingMean = [1e308, 1e308].map((x, i) => ({
    features: [x], target: { x: i, y: i }, group: i,
  }));
  assert.throws(() => fitRidge(overflowingMean), RangeError);

  const overflowingProducts = [-1, 1].map(x => ({
    features: [x], target: { x: x * Number.MAX_VALUE, y: 0 }, group: x,
  }));
  assert.throws(() => fitRidge(overflowingProducts), RangeError);
});

test('malformed or nonfinite models produce no prediction instead of throwing or fabricating a point (EST-04)', () => {
  const valid: RidgeModel = { mean: [0], scale: [1], weights: [[5, 7], [3, -2]] };
  const invalidModels: RidgeModel[] = [
    { ...valid, mean: [NaN] },
    { ...valid, mean: Array<number>(1) },
    { ...valid, scale: [] },
    { ...valid, scale: [1, 1] },
    { ...valid, scale: [0] },
    { ...valid, scale: [-1] },
    { ...valid, scale: [Infinity] },
    { ...valid, scale: Array<number>(1) },
    { ...valid, weights: [[5, 7]] },
    { ...valid, weights: [[5, 7], [3, -2], [0, 0]] },
    { ...valid, weights: [[5, 7], [3]] },
    { ...valid, weights: [[5, 7], [3, -2, 0]] },
    { ...valid, weights: [[5, 7], [Infinity, -2]] },
    { ...valid, weights: Array<number[]>(2) },
    { ...valid, weights: [[5, 7], Array<number>(2)] },
  ];
  for (const model of invalidModels) assert.equal(predict(model, [0.5]), null);
  const missingFields: unknown[] = [null, undefined, {}, { ...valid, mean: undefined }, { ...valid, scale: null }, { ...valid, weights: undefined }];
  for (const model of missingFields) assert.equal(predict(model as RidgeModel, [0.5]), null);
  assert.equal(predict(valid, Array<number>(1)), null);
  assert.deepEqual(predict(valid, [0.5]), { x: 6.5, y: 6 });
});
test('each calibration location has equal weight without pushing out early groups', () => {
  const groups = [5, 9, 7].map((n, group) => Array.from({ length: n }, (_, i) => ({ features: [i], target: { x: group, y: 0 }, group })));
  const samples = balancedSamples(groups); assert.equal(samples.length, 15);
  assert.deepEqual([0, 1, 2].map(g => samples.filter(s => s.group === g).length), [5, 5, 5]);
  assert.throws(() => balancedSamples([groups[0]!, []]), RangeError);
});
