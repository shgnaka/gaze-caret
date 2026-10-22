import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFeaturesDetailed } from '../src/core/features.ts';
import type { Landmark } from '../src/core/features.ts';
import { fitRidge, predict } from '../src/core/regression.ts';
import { InferenceScheduler } from '../src/core/inference-scheduler.ts';
import { GazeHistory } from '../src/core/runner.ts';
import { selectGazePoint } from '../src/core/select-gaze-point.ts';

// Synthetic camera geometry with two independently varied iris coordinates.
// This is a contract test for the pipeline, not a model of human gaze accuracy.
function face(horizontal: number, vertical: number, closed = false): Landmark[] {
  const landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
  for (const [index, x, y] of [
    [33, .2, .4], [133, .4, .4], [362, .6, .4], [263, .8, .4],
    [159, .3, .38], [145, .3, .42], [386, .7, .38], [374, .7, .42],
    [234, .1, .5], [454, .9, .5], [1, .5, .55],
    [468, .2 + .2 * horizontal, .4 + vertical * 128 / 480],
    [473, .6 + .2 * horizontal, .4 + vertical * 128 / 480],
  ] as const) landmarks[index] = { x, y, z: 0 };
  if (closed) {
    landmarks[159] = { x: .29, y: .4, z: 0 };
    landmarks[145] = { x: .31, y: .4, z: 0 };
  }
  return landmarks;
}

function model() {
  const samples = [.25, .5, .75].flatMap(horizontal => [-.1, 0, .1].map(vertical => {
    const extracted = extractFeaturesDetailed([face(horizontal, vertical)], 640, 480);
    assert.ok(extracted.features);
    return { features: extracted.features, target: { x: horizontal, y: .5 + vertical }, group: 0 };
  }));
  return fitRidge(samples);
}

for (const dropout of [false, true]) {
  test(`synthetic features → ridge → cadence → history → selection${dropout ? ' rejects closed-eye frames' : ' preserves coordinate units'}`, () => {
    const regression = model(), scheduler = new InferenceScheduler(), history = new GazeHistory();
    for (let frame = 0; frame <= 36; frame++) {
      const at = frame * 1000 / 60;
      if (!scheduler.take(at)) continue;
      const extracted = extractFeaturesDetailed([face(.6, .04, dropout && at >= 350)], 640, 480);
      const normalized = extracted.features ? predict(regression, extracted.features) : null;
      history.add({
        x: normalized ? normalized.x * 1200 : null,
        y: normalized ? normalized.y * 900 : null,
        sampledAt: at, producedAt: at + 4, contextId: 'viewport', modelId: 'synthetic',
        valid: normalized !== null, invalidReason: normalized ? null : extracted.reason,
      });
    }
    const decision = selectGazePoint(history.snapshot(600), {
      pressedAt: 600, contextId: 'viewport', modelId: 'synthetic',
    });
    if (dropout) {
      assert.equal(decision.point, null);
      assert.equal(decision.reason, 'stale-data');
      assert.equal(decision.sampleCount, 0);
    } else {
      // Nine grid samples, two duplicate standardized features per axis and
      // lambda=1 give the analytic ridge shrinkage 2*9/(2*9+1) = 18/19.
      assert.ok(decision.point);
      assert.ok(Math.abs(decision.point.x - (.5 + .1 * 18 / 19) * 1200) < 1e-8);
      assert.ok(Math.abs(decision.point.y - (.5 + .04 * 18 / 19) * 900) < 1e-8);
      assert.equal(decision.reason, null);
      assert.equal(decision.sampleCount, 3);
    }
  });
}
