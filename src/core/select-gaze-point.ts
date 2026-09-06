export interface GazeSample {
  readonly x: number | null;
  readonly y: number | null;
  readonly sampledAt: number;
  readonly producedAt: number;
  readonly contextId: string;
  readonly modelId: string;
  readonly valid: boolean;
  readonly invalidReason: string | null;
}

export interface SelectionRequest {
  readonly pressedAt: number;
  readonly contextId: string | null;
  readonly modelId: string | null;
}

export interface SelectionSettings {
  readonly windowStartAgeMs: number;
  readonly windowEndAgeMs: number;
  readonly minSamples: number;
  readonly maxMadCssPx: number;
}

export const DEFAULT_SELECTION_SETTINGS: SelectionSettings = Object.freeze({
  windowStartAgeMs: 250,
  windowEndAgeMs: 50,
  minSamples: 3,
  maxMadCssPx: 40,
});

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type UnavailableReason =
  | 'invalid-context'
  | 'insufficient-samples'
  | 'stale-data'
  | 'excessive-spread';

export interface GazeDecision {
  readonly pressedAt: number;
  readonly contextId: string | null;
  readonly modelId: string | null;
  readonly window: { readonly startAt: number; readonly endAt: number };
  readonly sampleCount: number;
  readonly newestSampleAgeMs: number | null;
  readonly oldestSampleAgeMs: number | null;
  readonly mad: Point | null;
  readonly point: Point | null;
  readonly reason: UnavailableReason | null;
}

/**
 * Decide synchronously from the unique-frame snapshot already received at key time.
 * All timestamps use the same monotonic clock; coordinates are viewport CSS pixels.
 * The caller owns history limits, frame deduplication and context invalidation.
 */
export function selectGazePoint(
  samples: readonly GazeSample[],
  request: SelectionRequest,
  settings: SelectionSettings = DEFAULT_SELECTION_SETTINGS,
): GazeDecision {
  validateSelectionInputs(request, settings);
  const empty: GazeDecision = {
    ...request,
    window: {
      startAt: request.pressedAt - settings.windowStartAgeMs,
      endAt: request.pressedAt - settings.windowEndAgeMs,
    },
    sampleCount: 0,
    newestSampleAgeMs: null,
    oldestSampleAgeMs: null,
    mad: null,
    point: null,
    reason: 'insufficient-samples',
  };
  if (!request.contextId || !request.modelId) {
    return { ...empty, reason: 'invalid-context' };
  }

  const available = samples.filter(isUsableSample).filter(sample =>
    sample.producedAt <= request.pressedAt,
  );
  const matching = available.filter(sample =>
    sample.contextId === request.contextId && sample.modelId === request.modelId,
  );
  if (available.length > 0 && matching.length === 0) {
    return { ...empty, reason: 'invalid-context' };
  }
  const selected = matching.filter(sample =>
    sample.sampledAt >= empty.window.startAt && sample.sampledAt <= empty.window.endAt,
  );
  const times = selected.map(sample => sample.sampledAt);
  const metrics: GazeDecision = {
    ...empty,
    sampleCount: selected.length,
    newestSampleAgeMs: times.length ? request.pressedAt - Math.max(...times) : null,
    oldestSampleAgeMs: times.length ? request.pressedAt - Math.min(...times) : null,
  };
  if (selected.length < settings.minSamples) {
    const stale = matching.length > 0 &&
      matching.every(sample => sample.sampledAt < empty.window.startAt);
    return { ...metrics, reason: stale ? 'stale-data' : 'insufficient-samples' };
  }

  const x = selected.map(sample => sample.x);
  const y = selected.map(sample => sample.y);
  const point = { x: median(x), y: median(y) };
  const mad = {
    x: median(x.map(value => Math.abs(value - point.x))),
    y: median(y.map(value => Math.abs(value - point.y))),
  };
  if (mad.x > settings.maxMadCssPx || mad.y > settings.maxMadCssPx) {
    return { ...metrics, mad, reason: 'excessive-spread' };
  }
  return {
    ...metrics,
    point,
    mad,
    reason: null,
  };
}

function isUsableSample(sample: GazeSample): sample is GazeSample & Point {
  return sample.valid && sample.invalidReason === null &&
    sample.x !== null && sample.y !== null &&
    Number.isFinite(sample.x) && Number.isFinite(sample.y) &&
    Number.isFinite(sample.sampledAt) && Number.isFinite(sample.producedAt) &&
    sample.sampledAt >= 0 && sample.producedAt >= sample.sampledAt;
}

function validateSelectionInputs(request: SelectionRequest, settings: SelectionSettings): void {
  if (!Number.isFinite(request.pressedAt) || request.pressedAt < 0) {
    throw new RangeError('pressedAt must be a finite, non-negative monotonic timestamp');
  }
  if (!Number.isFinite(settings.windowStartAgeMs) ||
      !Number.isFinite(settings.windowEndAgeMs) ||
      settings.windowEndAgeMs < 0 ||
      settings.windowStartAgeMs < settings.windowEndAgeMs ||
      !Number.isSafeInteger(settings.minSamples) || settings.minSamples < 1 ||
      !Number.isFinite(settings.maxMadCssPx) || settings.maxMadCssPx < 0) {
    throw new RangeError('Invalid gaze selection settings');
  }
}

// Only called after the minimum count check, including for absolute deviations.
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
