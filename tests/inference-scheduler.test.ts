import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InferenceScheduler } from '../src/core/inference-scheduler.ts';

test('the first fresh run does not wait for a previous session deadline', () => {
  const scheduler = new InferenceScheduler();
  assert.equal(scheduler.take(0), true);
  assert.equal(scheduler.take(1), false);
  assert.equal(scheduler.take(67), true);
  scheduler.reset();
  assert.equal(scheduler.take(68), true);
});

for (const refreshHz of [60, 120, 144]) {
  test(`15 Hz deadlines do not lose their fractional remainder at ${refreshHz} Hz`, () => {
    const scheduler = new InferenceScheduler();
    const accepted: number[] = [];
    for (let frame = 0; frame < refreshHz * 10; frame++) {
      const at = frame * 1000 / refreshHz;
      if (scheduler.take(at)) accepted.push(at);
    }
    assert.equal(accepted.length, 150);
    // Each deadline is served on the first display tick at or after it.
    // Quantization may vary adjacent intervals; it must not accumulate drift.
    accepted.forEach((at, index) => {
      const deadline = index * 1000 / 15;
      assert.ok(at >= deadline - 1e-8);
      assert.ok(at - deadline < 1000 / refreshHz + 1e-8);
    });
  });
}

for (const refreshHz of [30, 60]) {
  test(`ideal ${refreshHz} Hz ticks stay evenly spaced over ten minutes`, () => {
    const scheduler = new InferenceScheduler();
    const framesPerInference = refreshHz / 15;
    let accepted = 0;
    for (let frame = 0; frame < refreshHz * 600; frame++) {
      const at = frame * 1000 / refreshHz;
      const expected = frame % framesPerInference === 0;
      const actual = scheduler.take(at);
      assert.equal(actual, expected, `display frame ${frame} at ${at} ms`);
      if (actual) accepted++;
    }
    assert.equal(accepted, 9000);
  });
}

test('a full-period stall resets phase without replaying missed deadlines', () => {
  const scheduler = new InferenceScheduler();
  assert.equal(scheduler.take(0), true);
  assert.equal(scheduler.take(500), true);
  for (const at of [500, 501, 520, 550]) assert.equal(scheduler.take(at), false);
  assert.equal(scheduler.take(567), true);
});

test('partial lateness retains phase even when the next interval is shorter', () => {
  const scheduler = new InferenceScheduler();
  assert.equal(scheduler.take(0), true);
  assert.equal(scheduler.take(100), true);
  assert.equal(scheduler.take(101), false);
  // The next original deadline is 133 1/3 ms, rather than 166 2/3 ms.
  assert.equal(scheduler.take(134), true);
  assert.equal(scheduler.take(134), false);
  assert.equal(scheduler.take(199), false);
  assert.equal(scheduler.take(200), true);
});

test('bad or backwards times cannot poison the next deadline', () => {
  const scheduler = new InferenceScheduler();
  for (const at of [NaN, Infinity, -1]) assert.equal(scheduler.take(at), false);
  assert.equal(scheduler.take(0), true);
  assert.equal(scheduler.take(100), true);
  for (const at of [90, 100, 101, NaN, Infinity]) assert.equal(scheduler.take(at), false);
  assert.equal(scheduler.take(134), true);
});

test('frequency is explicit and invalid settings fail before scheduling', () => {
  const scheduler = new InferenceScheduler(10);
  assert.equal(scheduler.take(10), true);
  assert.equal(scheduler.take(109), false);
  assert.equal(scheduler.take(110), true);
  for (const hz of [0, -1, NaN, Infinity, Number.MIN_VALUE]) {
    assert.throws(() => new InferenceScheduler(hz), RangeError);
  }
});
