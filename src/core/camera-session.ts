export interface StreamLike { getTracks(): { stop(): void }[] }
export interface DetectorLike { close(): void }
export class CameraSession<S extends StreamLike, D extends DetectorLike> {
  stream: S | null = null;
  detector: D | null = null;
  starting = false;
  private generation = 0;
  async start(acquire: () => Promise<S>, load: () => Promise<D>): Promise<boolean> {
    if (this.starting || this.stream) return false;
    const generation = ++this.generation; this.starting = true;
    try {
      const stream = await acquire();
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      this.stream = stream;
      const detector = await load();
      if (generation !== this.generation) { detector.close(); return false; }
      this.detector = detector; this.starting = false; return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stop(); throw error;
    }
  }
  stop(): void {
    this.generation++; this.starting = false;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.detector?.close(); this.detector = null;
  }
}
