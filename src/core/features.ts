export interface Landmark { x: number; y: number; z: number }

export type FeatureRejectReason =
  | 'invalid-frame'
  | 'no-face'
  | 'multiple-faces'
  | 'invalid-landmark'
  | 'left-eye-geometry'
  | 'right-eye-geometry'
  | 'eyes-too-small'
  | 'non-finite-feature';

export interface FeatureExtractionResult {
  features: number[] | null;
  reason: FeatureRejectReason | null;
  faceCount: number;
}

const REQUIRED_INDICES = [33, 133, 468, 159, 145, 362, 263, 473, 386, 374, 234, 454, 1];

function rejected(reason: FeatureRejectReason, faceCount: number): FeatureExtractionResult {
  return { features: null, reason, faceCount };
}

export function extractFeaturesDetailed(
  faces: readonly Landmark[][],
  width: number,
  height: number,
): FeatureExtractionResult {
  const faceCount = faces.length;
  if (!(width > 0 && height > 0)) return rejected('invalid-frame', faceCount);
  if (faceCount === 0) return rejected('no-face', faceCount);
  if (faceCount > 1) return rejected('multiple-faces', faceCount);

  const f = faces[0]!;
  if (REQUIRED_INDICES.some(i => {
    const point = f[i];
    return !point || ![point.x, point.y, point.z].every(Number.isFinite) ||
      point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1;
  })) return rejected('invalid-landmark', faceCount);

  const p = (i: number) => ({ x: f[i]!.x * width, y: f[i]!.y * height });
  const eye = (a: number, b: number, iris: number, top: number, bottom: number): number[] | null => {
    const c = p(a), d = p(b), v = p(iris), t = p(top), u = p(bottom);
    const dx = d.x - c.x, dy = d.y - c.y, w = Math.hypot(dx, dy);
    if (w < 8 || Math.hypot(t.x - u.x, t.y - u.y) / w < 0.08) return null;
    return [
      ((v.x - c.x) * dx + (v.y - c.y) * dy) / (w * w),
      (-(v.x - c.x) * dy + (v.y - c.y) * dx) / (w * w),
    ];
  };

  const leftEye = eye(33, 133, 468, 159, 145);
  if (!leftEye) return rejected('left-eye-geometry', faceCount);
  const rightEye = eye(362, 263, 473, 386, 374);
  if (!rightEye) return rejected('right-eye-geometry', faceCount);

  const left = p(33), right = p(263);
  const eyeWidth = Math.hypot(right.x - left.x, right.y - left.y);
  if (eyeWidth < 20) return rejected('eyes-too-small', faceCount);

  const mx = (left.x + right.x) / 2, my = (left.y + right.y) / 2, nose = p(1);
  const features = [
    ...leftEye,
    ...rightEye,
    mx / width,
    my / height,
    eyeWidth / width,
    (right.y - left.y) / eyeWidth,
    (nose.x - mx) / eyeWidth,
    (nose.y - my) / eyeWidth,
    f[234]!.z - f[454]!.z,
    (f[234]!.x + f[454]!.x) / 2,
  ];
  if (!features.every(Number.isFinite)) return rejected('non-finite-feature', faceCount);
  return { features, reason: null, faceCount };
}

export function extractFeatures(faces: readonly Landmark[][], width: number, height: number): number[] | null {
  return extractFeaturesDetailed(faces, width, height).features;
}

export function acceptsCalibrationFrame(startedAt: number, sampledAt: number, count: number): boolean {
  return Number.isFinite(sampledAt) && sampledAt >= startedAt + 300 && sampledAt <= startedAt + 1300 && count < 15;
}
