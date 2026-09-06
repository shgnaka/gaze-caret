import type { GazeSample, Point } from './select-gaze-point.ts';
export type Mode = 'camera' | 'demo';
export interface Target extends Point { id: string; block: string; region: string; line: number; text: string }
export type Outcome = 'exact' | 'adjacent' | 'other-line' | 'other-block' | 'unavailable' | 'aborted';
export interface Trial { id: number; target: Target; presentedAt: number; decidedAt: number; outcome: Outcome; point: Point | null; reason: string | null }
export interface RunConfig { mode: Mode; total: number; blockSize: number; fixture: string; seed: number }
export class Experiment {
  readonly config: Readonly<RunConfig>;
  phase: 'validation' | 'ready' | 'trial' | 'feedback' | 'break' | 'results' = 'validation';
  trials: Trial[] = [];
  pending: { target: Target; presentedAt: number } | null = null;
  constructor(config: RunConfig) {
    if (!Number.isSafeInteger(config.total) || config.total < 1 || config.total > 300 ||
        !Number.isSafeInteger(config.blockSize) || config.blockSize < 1 || config.blockSize > config.total) throw new RangeError('Invalid run size');
    this.config = Object.freeze({ ...config });
  }
  validate(): void {
    if (this.phase === 'validation' || this.phase === 'break') this.phase = this.trials.length >= this.config.total ? 'results' : 'ready';
  }
  begin(target: Target, at: number): boolean {
    if (this.phase !== 'ready' || !Number.isFinite(at) || at < 0) return false;
    this.pending = { target: { ...target }, presentedAt: at }; this.phase = 'trial'; return true;
  }
  decide(point: Point | null, candidate: Target | null, reason: string | null, at: number): boolean {
    if (this.phase !== 'trial' || !this.pending || !Number.isFinite(at) || at < this.pending.presentedAt + 500) return false;
    const { target, presentedAt } = this.pending;
    const usable = point && Number.isFinite(point.x) && Number.isFinite(point.y);
    const outcome: Outcome = !usable || !candidate ? 'unavailable'
      : candidate.block !== target.block ? 'other-block'
      : candidate.region !== target.region ? 'other-line'
      : candidate.line === target.line ? 'exact'
      : Math.abs(candidate.line - target.line) === 1 ? 'adjacent' : 'other-line';
    this.trials.push({ id: this.trials.length + 1, target, presentedAt, decidedAt: at, outcome, point: usable ? { ...point } : null, reason });
    this.pending = null; this.phase = 'feedback'; return true;
  }
  advance(): void {
    if (this.phase !== 'feedback') return;
    this.phase = this.trials.length >= this.config.total ? 'results'
      : this.trials.length % this.config.blockSize === 0 ? 'break' : 'ready';
  }
  interrupt(reason: string, at: number): void {
    if (this.phase === 'results') return;
    if (this.pending) {
      this.trials.push({ id: this.trials.length + 1, ...this.pending, decidedAt: Math.max(at, this.pending.presentedAt), outcome: 'aborted', point: null, reason });
      this.pending = null;
    }
    this.phase = this.trials.length >= this.config.total ? 'results' : 'validation';
  }
}
export class GazeHistory {
  private samples: GazeSample[] = [];
  private lastAt = -Infinity;
  add(sample: GazeSample): void {
    if (!Number.isFinite(sample.sampledAt) || !Number.isFinite(sample.producedAt) || sample.sampledAt <= this.lastAt || sample.producedAt < sample.sampledAt) return;
    this.lastAt = sample.sampledAt;
    this.samples.push({ ...sample });
    this.samples = this.samples.filter(s => s.sampledAt >= sample.sampledAt - 1000).slice(-60);
  }
  snapshot(at: number): GazeSample[] { this.samples = this.samples.filter(s => s.sampledAt >= at - 1000); return this.samples.map(s => ({ ...s })); }
  clear(): void { this.samples = []; this.lastAt = -Infinity; }
}
export const OUTCOMES: readonly Outcome[] = ['exact', 'adjacent', 'other-line', 'other-block', 'unavailable', 'aborted'];
export function issueBody(sessionId: string, config: RunConfig, trials: readonly Trial[], feedback: string): string {
  const counts = OUTCOMES.map(o => `${o}: ${trials.filter(t => t.outcome === o).length}`).join('\n');
  return `gaze-caret experiment report v1\nSession: ${sessionId}\nMode: ${config.mode === 'demo' ? 'DEMO (not gaze accuracy)' : 'CAMERA'}\nFixture: ${config.fixture}\nSeed: ${config.seed}\nStarted: ${trials.length} / Planned: ${config.total}\nBlock size: ${config.blockSize}\n\n${counts}\n\nFeedback:\n${feedback.slice(0,500)}\n\nThis summary includes all started trials, including unavailable and aborted trials. No camera images or raw gaze samples are included. Full JSON may be shared separately by the participant.`;
}
export function issueUrl(body: string, sessionId: string): string {
  const url = new URL('https://github.com/shgnaka/gaze-caret/issues/new');
  url.searchParams.set('title', `[experiment] ${sessionId}`); url.searchParams.set('body', body);
  if (url.href.length > 8000) throw new RangeError('Issue draft too long; use the copy button');
  return url.href;
}
export interface ValidationPoint { target: Point; point: Point | null; reason: string | null; error: number | null }
export function interruptedValidation(points: readonly ValidationPoint[], pending: Point | null, reason: string): ValidationPoint[] {
  return pending ? [...points,{target:{...pending},point:null,reason:`aborted:${reason}`,error:null}] : [...points];
}
