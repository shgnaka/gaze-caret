import type { Point } from './select-gaze-point.ts';
export interface CalibrationSample { features: number[]; target: Point; group: number }
export interface RidgeModel { mean: number[]; scale: number[]; weights: number[][] }
export function fitRidge(samples: readonly CalibrationSample[], lambda = 1): RidgeModel {
  const n = samples[0]?.features.length ?? 0;
  if (!n || !Number.isFinite(lambda) || lambda <= 0 || samples.length < 2 || samples.some(s => s.features.length !== n || ![...s.features,s.target.x,s.target.y].every(Number.isFinite))) throw new RangeError('Invalid calibration');
  const mean = Array.from({ length: n }, (_, j) => samples.reduce((a,s) => a + s.features[j]!, 0) / samples.length);
  const scale = mean.map((m,j) => Math.sqrt(samples.reduce((a,s) => a + (s.features[j]! - m) ** 2, 0) / samples.length) || 1);
  const a = Array.from({ length: n+1 }, () => Array<number>(n+3).fill(0));
  for (const s of samples) {
    const x = [1, ...s.features.map((v,j) => (v - mean[j]!) / scale[j]!)];
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) a[i]![j] = a[i]![j]! + x[i]! * x[j]!;
      a[i]![n+1] = a[i]![n+1]! + x[i]! * s.target.x;
      a[i]![n+2] = a[i]![n+2]! + x[i]! * s.target.y;
    }
  }
  for (let i = 1; i <= n; i++) a[i]![i] = a[i]![i]! + lambda;
  // Pivoted elimination solves both screen axes; intercept is not penalized.
  for (let i = 0; i <= n; i++) {
    let pivot = i;
    for (let k = i+1; k <= n; k++) if (Math.abs(a[k]![i]!) > Math.abs(a[pivot]![i]!)) pivot = k;
    [a[i],a[pivot]] = [a[pivot]!,a[i]!];
    const d = a[i]![i]!; if (Math.abs(d) < 1e-12 || !Number.isFinite(d)) throw new RangeError('Singular calibration');
    for (let j = i; j < n+3; j++) a[i]![j] = a[i]![j]! / d;
    for (let k = 0; k <= n; k++) if (k !== i) {
      const f = a[k]![i]!;
      for (let j = i; j < n+3; j++) a[k]![j] = a[k]![j]! - f * a[i]![j]!;
    }
  }
  const weights = a.map(row => [row[n+1]!,row[n+2]!]);
  if (!weights.flat().every(Number.isFinite)) throw new RangeError('Nonfinite model');
  return { mean, scale, weights };
}
export function predict(model: RidgeModel, features: readonly number[]): Point | null {
  if (features.length !== model.mean.length || !features.length || !features.every(Number.isFinite)) return null;
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
