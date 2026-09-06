import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitRidge, predict, balancedSamples } from '../src/core/regression.ts';
test('CPU ridge recovers held-out coordinates with a constant feature and unpenalized intercept', () => {
  const samples = Array.from({ length: 21 }, (_, i) => { const x = (i - 10) / 10; return { features: [x, 99], target: { x: 2 + 3 * x, y: 1 - 2 * x }, group: i }; });
  const model = fitRidge(samples, 0.000001); const point = predict(model, [0.35, 99]);
  assert.ok(point); assert.ok(Math.abs(point.x - 3.05) < 0.00001); assert.ok(Math.abs(point.y - 0.3) < 0.00001);
});
test('missing or nonfinite features never become zero-filled valid predictions', () => {
  const s = [{ features: [1], target: { x: 2, y: 3 }, group: 0 }, { features: [2], target: { x: 3, y: 4 }, group: 1 }];
  const model = fitRidge(s); assert.equal(predict(model, [NaN]), null); assert.equal(predict(model, []), null);
  assert.throws(() => fitRidge([{ ...s[0]!, features: [Infinity] }]), RangeError);
});
test('each calibration location has equal weight without pushing out early groups', () => {
  const groups = [5, 9, 7].map((n, group) => Array.from({ length: n }, (_, i) => ({ features: [i], target: { x: group, y: 0 }, group })));
  const samples = balancedSamples(groups); assert.equal(samples.length, 15);
  assert.deepEqual([0, 1, 2].map(g => samples.filter(s => s.group === g).length), [5, 5, 5]);
  assert.throws(() => balancedSamples([groups[0]!, []]), RangeError);
});
