/**
 * Smooth motion between position updates.
 *
 * Updates arrive every few seconds (mock) or about every 30 s (live). Each train
 * keeps its last few snapped positions; the viewer draws it one update interval
 * in the past, interpolating along the track between the two samples around
 * that moment. Trains glide along curves instead of jumping or cutting corners,
 * and small backward jitter in the data never makes a train reverse.
 */

export interface TrackSample {
  /** Milliseconds */
  time: number;
  pathId: string;
  distance: number;
}

export interface EasedPosition {
  pathId: string;
  distance: number;
  /** m/s between the samples used, 0 when holding */
  speed: number;
}

/** Larger jumps than this are treated as a different train run or a data glitch: no glide. */
export const TELEPORT_DISTANCE = 1500;
/** Backward moves up to this are noise and are held at the last distance. */
export const BACKWARD_TOLERANCE = 80;

export class TrackHistory {
  private samples: TrackSample[] = [];

  constructor(private readonly keep = 4) {}

  get latest(): TrackSample | undefined {
    return this.samples[this.samples.length - 1];
  }

  push(sample: TrackSample): void {
    const last = this.latest;
    if (last && sample.time <= last.time) return;
    if (last && last.pathId === sample.pathId) {
      const delta = sample.distance - last.distance;
      if (delta < 0 && -delta <= BACKWARD_TOLERANCE) {
        sample = { ...sample, distance: last.distance };
      } else if (delta < -BACKWARD_TOLERANCE || delta > TELEPORT_DISTANCE) {
        this.samples = [];
      }
    } else if (last) {
      this.samples = [];
    }
    this.samples.push(sample);
    if (this.samples.length > this.keep) this.samples.shift();
  }

  /** Position at a moment, interpolated along the track between samples. */
  at(time: number): EasedPosition | null {
    const s = this.samples;
    if (!s.length) return null;
    const first = s[0]!;
    if (time <= first.time) return { pathId: first.pathId, distance: first.distance, speed: 0 };
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i]!;
      const b = s[i + 1]!;
      if (time <= b.time) {
        const span = b.time - a.time;
        const t = span > 0 ? (time - a.time) / span : 1;
        return {
          pathId: b.pathId,
          distance: a.distance + (b.distance - a.distance) * t,
          speed: span > 0 ? ((b.distance - a.distance) / span) * 1000 : 0,
        };
      }
    }
    const last = s[s.length - 1]!;
    return { pathId: last.pathId, distance: last.distance, speed: 0 };
  }
}
