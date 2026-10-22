import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFeaturesDetailed } from '../src/core/features.ts';
import type { Landmark } from '../src/core/features.ts';

// Coordinates are specified in camera pixels so that a non-square frame cannot
// silently replace the physical eye geometry with normalized-image geometry.
const width = 640, height = 480;
function face(): Landmark[] {
  const points: Record<number, [number, number]> = {
    33: [120, 180], 133: [220, 180], 468: [155, 190],
    159: [165, 174], 145: [175, 186],
    362: [350, 180], 263: [450, 180], 473: [415, 175],
    386: [395, 174], 374: [405, 186],
    234: [80, 260], 454: [560, 260], 1: [280, 270],
  };
  const landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
  for (const [index, [x, y]] of Object.entries(points)) {
    landmarks[Number(index)] = { x: x / width, y: y / height, z: 0 };
  }
  return landmarks;
}

function rotate(landmarks: Landmark[]): Landmark[] {
  // A 3-4-5 rotation: 100 camera pixels along the eye axis become (80, 60).
  return landmarks.map(point => {
    const x = point.x * width - 320, y = point.y * height - 240;
    return { x: (320 + .8 * x - .6 * y) / width, y: (240 + .6 * x + .8 * y) / height, z: point.z };
  });
}

test('A-04: iris coordinates use pixel geometry on a tilted, non-square frame', () => {
  for (const landmarks of [face(), rotate(face())]) {
    const result = extractFeaturesDetailed([landmarks], width, height);
    assert.equal(result.reason, null);
    assert.ok(result.features);
    // Each iris is given as a fraction of its 100 px eye-corner axis, plus
    // signed perpendicular displacement: (35, 10) and (65, -5) pixels.
    const expected = [.35, .1, .65, -.05];
    expected.forEach((value, index) => assert.ok(Math.abs(result.features![index]! - value) < 1e-12));
  }
});

for (const [label, top, bottom, reason] of [
  ['left', 159, 145, 'left-eye-geometry'],
  ['right', 386, 374, 'right-eye-geometry'],
] as const) {
  test(`A-04: ${label} eyelid separation along the eye axis is not an open eye`, () => {
    const landmarks = face();
    const centerX = label === 'left' ? 170 : 400;
    // The lid points are 20 px apart but have zero opening perpendicular to
    // the eye axis. A Euclidean distance incorrectly passes the 8% gate.
    landmarks[top] = { x: (centerX - 10) / width, y: 180 / height, z: 0 };
    landmarks[bottom] = { x: (centerX + 10) / width, y: 180 / height, z: 0 };
    for (const candidate of [landmarks, rotate(landmarks)]) {
      assert.deepEqual(extractFeaturesDetailed([candidate], width, height), { features: null, reason, faceCount: 1 });
    }
  });

  test(`A-04: tangential offset cannot hide a ${label} eyelid aperture below the threshold`, () => {
    const landmarks = face();
    const centerX = label === 'left' ? 170 : 400;
    landmarks[top] = { x: (centerX - 10) / width, y: 177 / height, z: 0 };
    landmarks[bottom] = { x: (centerX + 10) / width, y: 183 / height, z: 0 };
    // True aperture is 6 / 100 = .06; diagonal distance exceeds .20.
    for (const candidate of [landmarks, rotate(landmarks)]) {
      assert.equal(extractFeaturesDetailed([candidate], width, height).reason, reason);
    }
  });
}

test('A-04: non-finite camera dimensions are rejected as invalid frames', () => {
  for (const [frameWidth, frameHeight] of [
    [Infinity, height], [width, Infinity], [NaN, height], [width, NaN],
    [0, height], [width, 0], [-width, height], [width, -height],
  ]) {
    assert.deepEqual(extractFeaturesDetailed([face()], frameWidth!, frameHeight!), {
      features: null, reason: 'invalid-frame', faceCount: 1,
    });
  }
});
