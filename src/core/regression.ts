import type { Point } from './select-gaze-point.ts';
export interface CalibrationSample { features: number[]; target: Point; group: number }
export interface RidgeModel { mean: number[]; scale: number[]; weights: number[][] }
export function fitRidge(samples: readonly CalibrationSample[], lambda = 1): RidgeModel {
  const n = samples[0]?.features.length ?? 0;
  if (!n || !Number.isFinite(lambda) || lambda <= 0 || samples.length < 2 || samples.some(s => s.features.length !== n || ![...s.features,s.target.x,s.target.y].every(Number.isFinite))) throw new RangeError('Invalid calibration');
  const mean = Array.from({ length: n }, (_, j) => samples.reduce((a,s) => a + s.features[j]!, 0) / samples.length);
  if (!mean.every(Number.isFinite)) throw new RangeError('Nonfinite calibration statistics');
  const scale = mean.map((m,j) => Math.sqrt(samples.reduce((a,s) => a + (s.features[j]! - m) ** 2, 0) / samples.length) || 1);
  if (!scale.every(s => Number.isFinite(s) && s > 0)) throw new RangeError('Nonfinite calibration statistics');
  // QR solves the augmented least-squares system without forming X'X.
  // Feature-only sqrt(lambda) penalty rows leave the intercept unpenalized.
  const r = Array.from({ length: n+1 }, () => Array<number>(n+3).fill(0));
  for (let i = 1; i <= n; i++) r[i]![i] = Math.sqrt(lambda);
  for (const s of samples) {
    const row = [1, ...s.features.map((v,j) => (v - mean[j]!) / scale[j]!), s.target.x, s.target.y];
    // Givens rotations append one observation to the triangular system and
    // apply exactly the same orthogonal transforms to both target axes.
    for (let i = 0; i <= n; i++) {
      if (row[i] === 0) continue;
      const diagonal = r[i]![i]!, incoming = row[i]!;
      const magnitude = Math.hypot(diagonal, incoming);
      if (!Number.isFinite(magnitude) || magnitude === 0) throw new RangeError('Singular calibration');
      const cosine = diagonal / magnitude, sine = incoming / magnitude;
      r[i]![i] = magnitude;
      for (let j = i+1; j < n+3; j++) {
        const upper = r[i]![j]!, lower = row[j]!;
        r[i]![j] = cosine * upper + sine * lower;
        row[j] = -sine * upper + cosine * lower;
      }
    }
  }
  const weights = Array.from({ length: n+1 }, () => [0, 0]);
  for (let i = n; i >= 0; i--) {
    const diagonal = r[i]![i]!;
    if (!Number.isFinite(diagonal) || diagonal === 0) throw new RangeError('Singular calibration');
    for (let axis = 0; axis < 2; axis++) {
      let value = r[i]![n+1+axis]!;
      for (let j = i+1; j <= n; j++) value -= r[i]![j]! * weights[j]![axis]!;
      weights[i]![axis] = value / diagonal;
    }
  }
  if (!weights.flat().every(Number.isFinite)) throw new RangeError('Nonfinite model');
  return { mean, scale, weights };
}
export function predict(model: RidgeModel, features: readonly number[]): Point | null {
  if (!model || !Array.isArray(model.mean) || !Array.isArray(model.scale) || !Array.isArray(model.weights)) return null;
  const n = model.mean.length;
  if (!n || features.length !== n || model.scale.length !== n || model.weights.length !== n + 1) return null;
  for (let i = 0; i < n; i++) {
    if (![features[i], model.mean[i], model.scale[i]].every(Number.isFinite) || model.scale[i]! <= 0) return null;
  }
  for (const row of model.weights) {
    if (!Array.isArray(row) || row.length !== 2 || !Number.isFinite(row[0]) || !Number.isFinite(row[1])) return null;
  }
  const x = [1, ...features.map((v,j) => (v - model.mean[j]!) / model.scale[j]!)];
  const p = { x: 0, y: 0 };
  for (let i = 0; i < x.length; i++) { p.x += x[i]! * model.weights[i]![0]!; p.y += x[i]! * model.weights[i]![1]!; }
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}
export function balancedSamples(groups: readonly CalibrationSample[][]): CalibrationSample[] {
  const count = Math.min(...groups.map(g => g.length));
  if (!groups.length || count < 1) throw new RangeError('Missing calibration location');
  return groups.flatMap(g => Array.from({ length: count }, (_, i) => g[Math.floor(i * g.length / count)]!));
}
