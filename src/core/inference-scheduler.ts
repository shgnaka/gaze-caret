/**
 * Serve fixed-frequency deadlines on display ticks without accumulating rounding.
 * Each call admits at most one attempt; a full-period stall starts a fresh phase.
 * Partial lateness retains the phase and may shorten the next admission interval.
 */
export class InferenceScheduler {
  private lastAt = -Infinity;
  private anchorAt: number | null = null;
  private deadlineIndex = 1;
  private readonly intervalMs: number;

  constructor(hz = 15) {
    this.intervalMs = 1000 / hz;
    if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(this.intervalMs)) {
      throw new RangeError('Invalid inference frequency');
    }
  }

  take(at: number): boolean {
    if (!Number.isFinite(at) || at < 0 || at <= this.lastAt) return false;
    const nextAt = this.anchorAt === null ? null : this.anchorAt + this.deadlineIndex * this.intervalMs;
    // Allow only floating-point roundoff, not a fraction of a display frame.
    const tolerance = Number.EPSILON * Math.max(1, at, nextAt ?? 0) * 8;
    if (nextAt !== null && at + tolerance < nextAt) return false;
    if (nextAt === null || at - nextAt + tolerance >= this.intervalMs) {
      // Start a fresh phase initially or after a full-period stall.
      this.anchorAt = at;
      this.deadlineIndex = 1;
    } else {
      this.deadlineIndex++;
    }
    this.lastAt = at;
    return true;
  }

  reset(): void { this.lastAt = -Infinity; this.anchorAt = null; this.deadlineIndex = 1; }
}
