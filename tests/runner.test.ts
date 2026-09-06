import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Experiment, GazeHistory, issueBody, issueUrl, interruptedValidation } from '../src/core/runner.ts';
import type { Target, RunConfig } from '../src/core/runner.ts';
const config: RunConfig = { mode: 'demo', total: 4, blockSize: 2, fixture: 'baseline', seed: 42 };
const target: Target = { id: 'a', x: 200, y: 300, text: '本', block: 'p1', region: 'main', line: 1 };
test('a fresh validation gates trials; early/repeated keys cannot add trials', () => {
  const run = new Experiment(config);
  assert.equal(run.begin(target, 0), false);
  run.validate(); assert.equal(run.begin(target, 100), true);
  assert.equal(run.decide(target, target, null, 599), false);
  assert.equal(run.decide(target, target, null, 600), true);
  assert.equal(run.decide(target, target, null, 700), false);
  assert.equal(run.trials.length, 1); assert.equal(run.trials[0]!.outcome, 'exact');
});
test('automatic advancement stops at a block boundary until validation', () => {
  const run = new Experiment(config); run.validate();
  for (let i = 0; i < 2; i++) { run.begin(target, i * 1000); run.decide(null, null, 'missing', i * 1000 + 600); run.advance(); }
  assert.equal(run.phase, 'break'); assert.equal(run.begin(target, 3000), false);
  run.validate(); assert.equal(run.phase, 'ready');
  for (let i = 0; i < 2; i++) { run.begin(target, 4000 + i * 1000); run.decide(target, target, null, 4600 + i * 1000); run.advance(); }
  assert.equal(run.phase, 'results'); assert.equal(run.trials.length, 4);
});
test('reflow/stop abort the active trial once and require revalidation', () => {
  const run = new Experiment(config); run.validate(); run.begin(target, 10);
  run.interrupt('layout-changed', 20); run.interrupt('hidden', 25);
  assert.equal(run.trials.length, 1); assert.equal(run.trials[0]!.outcome, 'aborted');
  assert.equal(run.trials[0]!.reason, 'layout-changed'); assert.equal(run.phase, 'validation');
});
test('an adjacent line in a different column is not counted as adjacent', () => {
  const run = new Experiment(config); run.validate(); run.begin(target, 0);
  run.decide(target, { ...target, id: 'b', region: 'sidebar', line: 2 }, null, 600);
  assert.equal(run.trials[0]!.outcome, 'other-line');
});
test('the run freezes its config and rejects invalid counts', () => {
  const mutable = { ...config }; const run = new Experiment(mutable); mutable.total = 100;
  assert.equal(run.config.total, 4); assert.equal(Object.isFrozen(run.config), true);
  assert.throws(() => new Experiment({ ...config, total: 0 }), RangeError);
});
test('history is bounded by age and count and deduplicates acquisition times', () => {
  const h = new GazeHistory();
  for (let i = 0; i < 100; i++) h.add({ x: 1, y: 2, sampledAt: i * 10, producedAt: i * 10 + 1, contextId: 'c', modelId: 'm', valid: true, invalidReason: null });
  h.add({ x: 9, y: 9, sampledAt: 990, producedAt: 995, contextId: 'c', modelId: 'm', valid: true, invalidReason: null });
  assert.equal(h.snapshot(1000).length, 60); assert.equal(h.snapshot(1000).at(-1)!.x, 1);
  assert.equal(h.snapshot(2000).length, 0); h.clear(); assert.equal(h.snapshot(1000).length, 0);
});
test('sharing is an explicit GitHub draft with aggregates; no raw gaze or feature data', () => {
  const run = new Experiment(config); run.validate(); run.begin(target, 0); run.decide(target, target, null, 600);
  const body = issueBody('session-1', config, run.trials, '読みやすい');
  assert.match(body, /DEMO/); assert.match(body, /exact: 1/); assert.match(body, /読みやすい/);
  assert.doesNotMatch(body, /200|300|deviceId|features|presentedAt/);
  const url = new URL(issueUrl(body, 'session-1'));
  assert.equal(url.origin, 'https://github.com'); assert.equal(url.pathname, '/shgnaka/gaze-caret/issues/new');
  assert.equal(url.searchParams.get('body'), body);
});
test('a presented coordinate validation target remains in the report when interrupted', () => {
  const points=[{target:{x:1,y:2},point:{x:2,y:3},reason:null,error:Math.SQRT2}];
  const ended=interruptedValidation(points,{x:4,y:5},'hidden');
  assert.equal(ended.length,2);assert.equal(ended[1]!.reason,'aborted:hidden');assert.equal(ended[1]!.point,null);
  assert.equal(points.length,1);
});
test('interrupting coordinate feedback does not invent another presented target', () => {
  const points=[{target:{x:1,y:2},point:null,reason:'missing',error:null}];
  assert.deepEqual(interruptedValidation(points,null,'hidden'),points);
});
