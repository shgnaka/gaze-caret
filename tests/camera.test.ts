import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CameraSession } from '../src/core/camera-session.ts';
import { extractFeatures, acceptsCalibrationFrame } from '../src/core/features.ts';
import type { Landmark } from '../src/core/features.ts';
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
test('stopping while permission is pending releases a late stream without loading a detector', async () => {
  let stopped = 0, loaded = 0; const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const pending = deferred<typeof stream>(); const session = new CameraSession();
  const start = session.start(() => pending.promise, async () => { loaded++; return { close() {} }; });
  session.stop(); pending.resolve(stream); assert.equal(await start, false);
  assert.equal(stopped, 1); assert.equal(loaded, 0);
});
test('stopping while loading a detector releases both resources and cannot revive the session', async () => {
  let stopped = 0, closed = 0; const detector = { close: () => { closed++; } }; const pending = deferred<typeof detector>();
  const session = new CameraSession(); const start = session.start(async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }), () => pending.promise);
  await Promise.resolve(); session.stop(); pending.resolve(detector); assert.equal(await start, false);
  assert.equal(stopped, 1); assert.equal(closed, 1); assert.equal(session.detector, null);
});
test('start is idempotent while pending and a load error releases tracks', async () => {
  let calls = 0, stopped = 0; const session = new CameraSession();
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const start = session.start(async () => { calls++; return stream; }, async () => { throw new Error('model'); });
  assert.equal(await session.start(async () => { calls++; return stream; }, async () => ({ close() {} })), false);
  await assert.rejects(start, /model/); assert.equal(calls, 1); assert.equal(stopped, 1);
});
function face(): Landmark[] {
  const f = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i,x,y] of [[33,.2,.4],[133,.4,.4],[468,.3,.4],[159,.3,.38],[145,.3,.42],[362,.6,.4],[263,.8,.4],[473,.7,.4],[386,.7,.38],[374,.7,.42],[234,.1,.5],[454,.9,.5],[1,.5,.55]] as const) f[i] = { x, y, z: 0 };
  return f;
}
test('eye-relative features survive translation while face position remains a useful feature', () => {
  const a = extractFeatures([face()], 640, 480); const b = extractFeatures([face().map(p => ({ ...p, x: p.x+.02 }))], 640, 480);
  assert.ok(a); assert.ok(b); assert.equal(a.length, 12);
  a.slice(0,4).forEach((v,i) => assert.ok(Math.abs(v-b[i]!) < 1e-10)); assert.notEqual(a[4],b[4]);
});
test('closed eyes, missing landmarks and multiple faces are invalid', () => {
  const f=face(); f[159]=f[145]!;
  assert.equal(extractFeatures([f],640,480),null); assert.equal(extractFeatures([[]],640,480),null);
  assert.equal(extractFeatures([face(),face()],640,480),null);
});
test('calibration excludes movement time, late old-point frames and excess samples', () => {
  assert.equal(acceptsCalibrationFrame(1000,1299,0),false);
  assert.equal(acceptsCalibrationFrame(1000,1300,0),true);
  assert.equal(acceptsCalibrationFrame(1000,2300,14),true);
  assert.equal(acceptsCalibrationFrame(1000,2301,14),false);
  assert.equal(acceptsCalibrationFrame(2400,2200,0),false);
  assert.equal(acceptsCalibrationFrame(1000,1500,15),false);
});
