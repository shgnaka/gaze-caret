import { OUTCOMES } from './runner.ts';
import type { Outcome, Trial } from './runner.ts';

export interface RateSummary { count: number; rate: number | null }
export interface ErrorQuantiles { p50: number | null; p90: number | null; p95: number | null }
export interface EvaluationSummary {
  total: number;
  outcomes: Record<Outcome, RateSummary>;
  exactOrAdjacent: RateSummary;
  coordinateError: {
    validCount: number;
    missingCount: number;
    absoluteX: ErrorQuantiles;
    absoluteY: ErrorQuantiles;
    euclidean: ErrorQuantiles;
  };
}

function quantiles(values: number[]): ErrorQuantiles {
  values.sort((a, b) => a - b);
  const rank = (p: number): number | null => values.length ? values[Math.ceil(p * values.length) - 1]! : null;
  return { p50: rank(0.5), p90: rank(0.9), p95: rank(0.95) };
}

/**
 * Summarize one caller-selected model and condition cohort in viewport CSS pixels.
 * Trial records lack cohort identities; the caller must partition them before calling.
 */
export function summarizeTrials(trials: readonly Trial[]): EvaluationSummary {
  const counts = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0])) as Record<Outcome, number>;
  const absoluteX: number[] = [], absoluteY: number[] = [], euclidean: number[] = [];
  for (const trial of trials) {
    if (!OUTCOMES.includes(trial.outcome)) throw new RangeError('Unknown trial outcome');
    counts[trial.outcome]++;
    if (!trial.point || ![trial.point.x, trial.point.y, trial.target.x, trial.target.y].every(Number.isFinite)) continue;
    const dx = Math.abs(trial.point.x - trial.target.x), dy = Math.abs(trial.point.y - trial.target.y);
    const distance = Math.hypot(dx, dy);
    if (![dx, dy, distance].every(Number.isFinite)) continue;
    absoluteX.push(dx); absoluteY.push(dy); euclidean.push(distance);
  }
  const total = trials.length;
  const rate = (count: number): RateSummary => ({ count, rate: total ? count / total : null });
  return {
    total,
    outcomes: Object.fromEntries(OUTCOMES.map(outcome => [outcome, rate(counts[outcome])])) as Record<Outcome, RateSummary>,
    exactOrAdjacent: rate(counts.exact + counts.adjacent),
    coordinateError: {
      validCount: absoluteX.length, missingCount: total - absoluteX.length,
      absoluteX: quantiles(absoluteX), absoluteY: quantiles(absoluteY), euclidean: quantiles(euclidean),
    },
  };
}
