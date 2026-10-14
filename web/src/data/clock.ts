/**
 * The simulated clock for the mock: starts at a chosen moment and can run
 * faster than real time. Changing speed keeps the current simulated moment.
 */
export class SimClock {
  private baseSim: number;
  private baseReal: number;
  speed: number;

  constructor(start: number, speed = 1, private readonly realNow: () => number = Date.now) {
    this.baseSim = start;
    this.baseReal = realNow();
    this.speed = speed;
  }

  now(): Date {
    return new Date(this.baseSim + (this.realNow() - this.baseReal) * this.speed);
  }

  setSpeed(speed: number): void {
    this.baseSim = this.now().getTime();
    this.baseReal = this.realNow();
    this.speed = speed;
  }
}

/** Poll often enough that a train moves at most about one block between updates. */
export function pollIntervalFor(speed: number, base = 5000): number {
  return Math.max(Math.round(base / Math.max(speed, 1)), 250);
}
