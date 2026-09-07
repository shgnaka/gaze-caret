import type { FeatureRejectReason, Landmark } from './features.ts';

export type DiagnosticMode = 'basic' | 'detailed';
export type DiagnosticPhase = 'configure' | 'camera' | 'calibration' | 'validation' | 'practice' | 'measure' | 'paused' | 'results';
export type DiagnosticReason = FeatureRejectReason | 'detector-not-ready' | 'video-not-ready' | 'unchanged-video-time' | 'detector-error';

export interface DiagnosticFrameInput {
  at: number;
  phase: DiagnosticPhase;
  faceCount: number;
  reason: DiagnosticReason | null;
  inferenceMs: number | null;
  features?: readonly number[] | null;
  landmarks?: readonly (readonly Landmark[])[];
  point?: { x: number; y: number } | null;
  target?: { x: number; y: number } | null;
}

export interface DiagnosticFrame extends Omit<DiagnosticFrameInput, 'features' | 'landmarks'> {
  features?: number[];
  landmarks?: Landmark[][];
}

export interface DiagnosticCounters {
  frames: number;
  validFeatures: number;
  faceCount: { zero: number; one: number; twoOrMore: number };
  rejectionReasons: Partial<Record<DiagnosticReason, number>>;
  skipped: Partial<Record<'detector-not-ready' | 'video-not-ready' | 'unchanged-video-time', number>>;
  errors: Record<string, number>;
  inferenceTotalMs: number;
  inferenceMaxMs: number;
}

export interface DiagnosticEvent {
  at: number;
  type: string;
  detail?: string;
}

export interface DiagnosticReport {
  schemaVersion: 1;
  mode: DiagnosticMode;
  metadata: Record<string, string>;
  counters: DiagnosticCounters;
  timings: Record<string, number>;
  events: DiagnosticEvent[];
  frames?: DiagnosticFrame[];
}

export type PublicDiagnosticReport = Omit<DiagnosticReport, 'mode' | 'frames'> & { mode: 'basic' };

export interface DiagnosticRecorderOptions {
  mode?: DiagnosticMode;
  maxFrames?: number;
  maxEvents?: number;
}

const emptyCounters = (): DiagnosticCounters => ({
  frames: 0,
  validFeatures: 0,
  faceCount: { zero: 0, one: 0, twoOrMore: 0 },
  rejectionReasons: {},
  skipped: {},
  errors: {},
  inferenceTotalMs: 0,
  inferenceMaxMs: 0,
});

const increment = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1;
};

export class DiagnosticRecorder {
  private readonly mode: DiagnosticMode;
  private readonly maxFrames: number;
  private readonly maxEvents: number;
  private readonly metadata: Record<string, string> = {};
  private readonly counters = emptyCounters();
  private readonly timings: Record<string, number> = {};
  private events: DiagnosticEvent[] = [];
  private frames: DiagnosticFrame[] = [];

  constructor(options: DiagnosticRecorderOptions = {}) {
    this.mode = options.mode ?? 'basic';
    this.maxFrames = Math.max(0, options.maxFrames ?? 900);
    this.maxEvents = Math.max(0, options.maxEvents ?? 100);
  }

  setMetadata(metadata: Record<string, string>): void {
    for (const [key, value] of Object.entries(metadata)) this.metadata[key] = value.slice(0, 200);
  }

  recordFrame(input: DiagnosticFrameInput): void {
    this.counters.frames++;
    const bucket = input.faceCount <= 0 ? 'zero' : input.faceCount === 1 ? 'one' : 'twoOrMore';
    this.counters.faceCount[bucket]++;
    if (input.features) this.counters.validFeatures++;
    if (input.reason) increment(this.counters.rejectionReasons, input.reason);
    if (input.inferenceMs !== null && Number.isFinite(input.inferenceMs)) {
      this.counters.inferenceTotalMs += input.inferenceMs;
      this.counters.inferenceMaxMs = Math.max(this.counters.inferenceMaxMs, input.inferenceMs);
    }
    if (this.mode !== 'detailed' || this.maxFrames === 0) return;
    const frame: DiagnosticFrame = {
      at: input.at,
      phase: input.phase,
      faceCount: input.faceCount,
      reason: input.reason,
      inferenceMs: input.inferenceMs,
    };
    if (input.point !== undefined) frame.point = input.point ? { ...input.point } : null;
    if (input.target !== undefined) frame.target = input.target ? { ...input.target } : null;
    if (input.features) frame.features = [...input.features];
    if (input.landmarks) frame.landmarks = input.landmarks.map(face => face.map(point => ({ ...point })));
    this.frames.push(frame);
    if (this.frames.length > this.maxFrames) this.frames.splice(0, this.frames.length - this.maxFrames);
  }

  recordSkip(reason: 'detector-not-ready' | 'video-not-ready' | 'unchanged-video-time'): void {
    increment(this.counters.skipped, reason);
  }

  recordError(name: string): void {
    increment(this.counters.errors, name.slice(0, 100));
  }

  recordTiming(name: string, milliseconds: number): void {
    if (Number.isFinite(milliseconds) && milliseconds >= 0) this.timings[name] = milliseconds;
  }

  recordEvent(event: DiagnosticEvent): void {
    const safe: DiagnosticEvent = { at: event.at, type: event.type.slice(0, 100) };
    if (event.detail) safe.detail = event.detail.slice(0, 200);
    this.events.push(safe);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
  }

  snapshot(): DiagnosticReport {
    const report: DiagnosticReport = {
      schemaVersion: 1,
      mode: this.mode,
      metadata: { ...this.metadata },
      counters: {
        ...this.counters,
        faceCount: { ...this.counters.faceCount },
        rejectionReasons: { ...this.counters.rejectionReasons },
        skipped: { ...this.counters.skipped },
        errors: { ...this.counters.errors },
      },
      timings: { ...this.timings },
      events: this.events.map(event => ({ ...event })),
    };
    if (this.mode === 'detailed') report.frames = this.frames.map(frame => {
      const copy: DiagnosticFrame = {
        at: frame.at,
        phase: frame.phase,
        faceCount: frame.faceCount,
        reason: frame.reason,
        inferenceMs: frame.inferenceMs,
      };
      if (frame.point !== undefined) copy.point = frame.point ? { ...frame.point } : null;
      if (frame.target !== undefined) copy.target = frame.target ? { ...frame.target } : null;
      if (frame.features) copy.features = [...frame.features];
      if (frame.landmarks) copy.landmarks = frame.landmarks.map(face => face.map(point => ({ ...point })));
      return copy;
    });
    return report;
  }

  publicSnapshot(): PublicDiagnosticReport {
    const { mode: _mode, frames: _frames, ...safe } = this.snapshot();
    return { ...safe, mode: 'basic' };
  }
}
