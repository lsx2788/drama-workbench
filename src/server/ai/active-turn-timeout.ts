type Clock = {
  now: () => number;
  schedule: (callback: () => void, milliseconds: number) => () => void;
};

const realClock: Clock = {
  now: () => performance.now(),
  schedule: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

/** Count model processing time, excluding awaited host tools and child AI work. */
export class ActiveTurnTimeout {
  private remaining: number;
  private started = 0;
  private holds = 0;
  private stopped = false;
  private cancel?: () => void;

  constructor(
    milliseconds: number,
    private readonly onTimeout: () => void,
    private readonly clock: Clock = realClock,
  ) {
    this.remaining = milliseconds;
    this.resume();
  }

  hold() {
    if (this.stopped) return () => {};
    if (this.holds++ === 0) {
      this.remaining = Math.max(
        0,
        this.remaining - Math.max(0, this.clock.now() - this.started),
      );
      this.cancel?.();
      this.cancel = undefined;
    }
    let released = false;
    return () => {
      if (released || this.stopped) return;
      released = true;
      if (--this.holds === 0) this.resume();
    };
  }

  stop() {
    this.stopped = true;
    this.cancel?.();
    this.cancel = undefined;
  }

  private resume() {
    this.started = this.clock.now();
    this.cancel = this.clock.schedule(() => {
      this.stop();
      this.onTimeout();
    }, this.remaining);
  }
}
